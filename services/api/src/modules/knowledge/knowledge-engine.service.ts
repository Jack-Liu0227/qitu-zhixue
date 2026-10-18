import {
  BadRequestException,
  Injectable,
  Inject,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import { spawn } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { engineDefinition } from './knowledge-engine.catalog';
import { sql } from 'drizzle-orm';
import { KnowledgeCenterService } from './knowledge-center.service';
import {
  IdempotencyStore,
  hashIdempotentInput,
  throwHttpForIdempotencyError,
} from '../../common/idempotency';
import { ModelRegistryService } from '../model-registry/model-registry.service';
import { record, validateKnowledgeConfig, type EngineConfig } from './knowledge-center.config';
const REMOTE_CREDENTIAL_PROVIDERS = ['lightrag-server', 'pageindex', 'ima', 'weknora'];
import { KnowledgeAdapterRegistry, type EngineReadiness } from './knowledge-engine.adapters';

export interface EngineHit {
  memberId: string;
  text: string;
  score: number | null;
  locator: Record<string, unknown> | null;
}
export interface EngineReceipt {
  ok: boolean;
  errorCode?: string;
  hits?: EngineHit[];
  manifest?: Record<string, unknown>;
  status?: EngineReadiness;
  checks?: { key: string; label: string; ok: boolean; detail: string; optional: boolean }[];
}

/** Private process adapter. No paths, credentials or raw upstream diagnostics cross the API. */
@Injectable()
export class KnowledgeEngineService {
  private readonly adapters = new KnowledgeAdapterRegistry(
    (engine, request) => this.upstream(engine, request),
    async (engine, request) => {
      if (!engine.config.apiKey && !engine.config.clientId) return null;
      const receipt = await this.upstream(engine, request);
      return { ...receipt, status: receipt.status ?? (receipt.ok ? 'ready' : 'unavailable') };
    },
  );
  constructor(
    private readonly center: KnowledgeCenterService,
    private readonly models: ModelRegistryService,
    @Optional() @Inject(IdempotencyStore) private readonly idempotency?: IdempotencyStore,
  ) {}
  adapterFor(provider: string) {
    return this.adapters.get(provider);
  }
  async execute(engine: EngineConfig, request: Record<string, unknown>): Promise<EngineReceipt> {
    if (!engine.enabled) return { ok: false, status: 'unavailable', errorCode: 'ENGINE_DISABLED' };
    if (['documents', 'read_document'].includes(String(request.operation)) && engine.provider !== 'llamaindex')
      return this.upstream(engine, request);
    const adapter = this.adapterFor(engine.provider);
    if (adapter) {
      const receipt =
        request.operation === 'search'
          ? await adapter.search(engine, request)
          : request.operation === 'check'
            ? await adapter.check(engine)
            : {
                ok: false,
                status: 'needs_setup' as const,
                errorCode: 'REMOTE_OPERATION_UNSUPPORTED',
              };
      return receipt;
    }
    if (engine.provider !== 'llamaindex') return this.upstream(engine, request);
    const reference = engine.config.embeddingModelRef;
    if (typeof reference !== 'string' || !reference.includes(':'))
      return { ok: false, status: 'needs_setup', errorCode: 'MODEL_NOT_BOUND' };
    let embedding: Record<string, unknown>;
    try {
      const separator = reference.indexOf(':');
      const target = this.models.resolveRuntimeTargetByModel({
        providerId: reference.slice(0, separator),
        modelId: reference.slice(separator + 1),
      });
      if (!target.output?.includes('embedding'))
        return { ok: false, status: 'needs_setup', errorCode: 'EMBEDDING_MODEL_REQUIRED' };
      if (!target.api.startsWith('openai-'))
        return { ok: false, status: 'needs_setup', errorCode: 'EMBEDDING_PROTOCOL_UNSUPPORTED' };
      const endpoint = target.baseUrl.replace(/\/+$/, '');
      embedding = {
        model: target.modelId,
        api_key: target.credential,
        base_url: endpoint.endsWith('/embeddings') ? endpoint : `${endpoint}/embeddings`,
        binding: 'openai',
        dim: 0,
        request_timeout: 60,
      };
    } catch {
      return { ok: false, status: 'needs_setup', errorCode: 'MODEL_NOT_READY' };
    }
    return this.callBridge({
      ...request,
      provider: engine.provider,
      config: engine.config,
      embedding,
    });
  }
  modelOptions() {
    return this.models.listAgentModelOptions().map((model) => ({
      value: `${model.providerId}:${model.modelId}`,
      label: model.label,
      available: model.available,
      input: model.input,
      output: model.output,
    }));
  }
  private async upstream(
    engine: EngineConfig,
    request: Record<string, unknown>,
  ): Promise<EngineReceipt> {
    const resolved: Record<string, unknown> = {};
    const checks: NonNullable<EngineReceipt['checks']> = [];
    const modelFields = engineDefinition(engine.provider).fields.filter(
      (field) => field.type === 'model',
    );
    for (const field of modelFields) {
      const reference =
        engine.config[field.key] ??
        (field.key === 'llmModelRef' ? engine.config.baseModelRef : undefined);
      const optional = [
        'extractModelRef',
        'keywordModelRef',
        'queryModelRef',
        'vlmModelRef',
      ].includes(field.key);
      try {
        if (typeof reference !== 'string' || !reference.includes(':')) throw new Error();
        const split = reference.indexOf(':');
        const target = this.models.resolveRuntimeTargetByModel({
          providerId: reference.slice(0, split),
          modelId: reference.slice(split + 1),
        });
        if (
          !target.api.startsWith('openai-') ||
          (field.key === 'embeddingModelRef'
            ? !target.output?.includes('embedding')
            : !target.output?.includes('text')) ||
          (field.key === 'vlmModelRef' && !target.input?.includes('image'))
        )
          throw new Error();
        resolved[field.key] = {
          model: target.modelId,
          api_key: target.credential,
          base_url: target.baseUrl,
          binding: 'openai',
        };
        checks.push({
          key: field.key,
          label: field.label,
          ok: true,
          detail: '模型已从启途模型目录解析',
          optional,
        });
      } catch {
        checks.push({
          key: field.key,
          label: field.label,
          ok: false,
          detail:
            optional && reference === undefined
              ? '未单独绑定，使用基础模型；视觉未绑定则关闭'
              : '请在模型接入中配置并绑定可用模型',
          optional: optional && reference === undefined,
        });
      }
    }
    const credentials = REMOTE_CREDENTIAL_PROVIDERS.includes(engine.provider)
      ? Object.fromEntries(
          ['apiKey', 'clientId']
            .filter((key) => engine.config[key] !== undefined)
            .map((key) => [key, engine.config[key]]),
        )
      : undefined;
    const overrideUrl = (request.externalRef as Record<string, unknown> | undefined)?.serverUrl;
    if (
      credentials &&
      overrideUrl &&
      String(overrideUrl).replace(/\/+$/, '') !==
        String(engine.config.server_url ?? '').replace(/\/+$/, '')
    )
      credentials.apiKey = '';
    const receipt = await this.callBridge(
      {
        ...request,
        credentials,
        provider: engine.provider,
        config: engine.config,
        models: resolved,
      },
      true,
    );
    if (receipt.ok && checks.some((c) => !c.ok && !c.optional))
      return {
        ok: false,
        status: 'needs_setup',
        errorCode: 'MODEL_NOT_READY',
        checks: [...checks, ...(receipt.checks ?? [])],
      };
    return { ...receipt, checks: [...checks, ...(receipt.checks ?? [])] };
  }
  private callBridge(request: Record<string, unknown>, extended = false): Promise<EngineReceipt> {
    const python = process.env.QITU_KNOWLEDGE_PYTHON;
    const source = process.env.QITU_DEEPTUTOR_SOURCE;
    if (!python || !source)
      return Promise.resolve({
        ok: false,
        status: 'not_installed',
        errorCode: 'ENGINE_DEPENDENCY_MISSING',
      });
    return new Promise((resolveResult) => {
      const bridge = resolve(
        process.env.QITU_KNOWLEDGE_BRIDGE ??
          resolve(process.cwd(), '../../integrations/deeptutor-knowledge/bridge.py'),
      );
      const child = spawn(
        python,
        [extended ? resolve(dirname(bridge), 'engine_runtime.py') : bridge],
        {
          env: { ...process.env, PYTHONPATH: source },
          stdio: ['pipe', 'pipe', 'pipe'],
        },
      );
      let output = '';
      let oversized = false;
      const timer = setTimeout(
        () => child.kill('SIGKILL'),
        request.operation === 'build'
          ? 14 * 60_000
          : request.operation === 'search'
            ? 120_000
            : 35_000,
      );
      child.stdout.on('data', (part: Buffer) => {
        output += part.toString();
        if (Buffer.byteLength(output) > 2 * 1024 * 1024) {
          oversized = true;
          child.kill('SIGKILL');
        }
      });
      child.stderr.resume();
      child.on('error', () => {
        clearTimeout(timer);
        resolveResult({ ok: false, status: 'unavailable', errorCode: 'ENGINE_DEPENDENCY_MISSING' });
      });
      child.on('close', () => {
        clearTimeout(timer);
        try {
          if (oversized) throw new Error();
          resolveResult(JSON.parse(output.trim().split('\n').at(-1) ?? '') as EngineReceipt);
        } catch {
          resolveResult({ ok: false, status: 'unavailable', errorCode: 'ENGINE_EXECUTION_FAILED' });
        }
      });
      child.stdin.on('error', () => {});
      child.stdin.end(JSON.stringify(request));
    });
  }
  async probe(id: string, body: unknown) {
    const input = record(body);
    if (Object.keys(input).some((key) => !['engine'].includes(key)))
      throw new BadRequestException('连接测试参数无效');
    const { config } = await this.center.configuration();
    const next = validateKnowledgeConfig(
      { knowledgeEngines: { ...config.knowledgeEngines, [id]: input.engine } },
      config,
    );
    const engine = next.knowledgeEngines[id]!;
    if (!REMOTE_CREDENTIAL_PROVIDERS.includes(engine.provider))
      throw new BadRequestException('该引擎不支持连接预检');
    if (engine.provider === 'ima') {
      if (!engine.config.apiKey && !engine.config.clientId)
        return this.adapterFor('ima')!.check(engine);
    }
    return this.upstream(engine, { operation: 'check' });
  }
  async check(id: string, key?: string) {
    const run = async () => {
      const { revision, config } = await this.center.configuration();
      const engine = config.knowledgeEngines[id];
      let receipt: EngineReceipt;
      if (!engine)
        receipt = { ok: false, status: 'needs_setup', errorCode: 'ENGINE_NOT_CONFIGURED' };
      else {
        const adapter = this.adapterFor(engine.provider);
        receipt = adapter
          ? await adapter.check(engine)
          : engine.provider === 'llamaindex'
            ? await this.execute({ ...engine, enabled: true }, { operation: 'check' })
            : await this.upstream(engine, { operation: 'check' });
        if (!receipt.status) receipt.status = receipt.ok ? 'ready' : 'unavailable';
        if (!receipt.checks?.length)
          receipt.checks = [
            {
              key: 'connection',
              label: '真实连接与依赖检查',
              ok: receipt.ok,
              detail: receipt.errorCode ?? '连接与运行检查已通过',
              optional: false,
            },
          ];
      }
      await this.center
        .database()
        .execute(
          sql`INSERT INTO knowledge_engine_checks(instance_id,config_revision,health_status,error_code,capabilities) VALUES(${id},${revision},${receipt.status ?? (receipt.ok ? 'ready' : 'unavailable')},${receipt.errorCode ?? null},${JSON.stringify({ canIndex: receipt.ok && ['llamaindex', 'graphrag', 'lightrag'].includes(engine?.provider ?? ''), canSearch: receipt.ok && !['obsidian', 'marginnote', 'pageindex', 'pageindex-oss'].includes(engine?.provider ?? ''), canMaterialize: false })}::jsonb) ON CONFLICT(instance_id) DO UPDATE SET config_revision=excluded.config_revision,health_status=excluded.health_status,error_code=excluded.error_code,capabilities=excluded.capabilities,checked_at=now()`,
        );
      return { instanceId: id, revision, ...receipt, checkedAt: new Date().toISOString() };
    };
    if (!key) return run();
    if (!this.idempotency) throw new ServiceUnavailableException('知识中心幂等存储不可用');
    const scope = 'admin.knowledge.engine.check';
    try {
      const result = await this.idempotency.execute(
        scope,
        key,
        hashIdempotentInput(scope, { id }, {}),
        async () => ({ body: await run() }),
      );
      return result.body;
    } catch (error) {
      throwHttpForIdempotencyError(error);
    }
  }
}
