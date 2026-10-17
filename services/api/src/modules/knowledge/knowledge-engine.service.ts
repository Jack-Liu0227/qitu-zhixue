import { Injectable } from '@nestjs/common';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { sql } from 'drizzle-orm';
import { KnowledgeCenterService } from './knowledge-center.service';
import { ModelRegistryService } from '../model-registry/model-registry.service';
import type { EngineConfig } from './knowledge-center.config';
import { ImaMcpClient } from '../ai-tutor/ima-mcp.client';

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
}

/** Private process adapter. No paths, credentials or raw upstream diagnostics cross the API. */
@Injectable()
export class KnowledgeEngineService {
  constructor(
    private readonly center: KnowledgeCenterService,
    private readonly models: ModelRegistryService,
  ) {}
  async execute(engine: EngineConfig, request: Record<string, unknown>): Promise<EngineReceipt> {
    if (!engine.enabled) return { ok: false, errorCode: 'ENGINE_DISABLED' };
    if (engine.provider !== 'llamaindex')
      return {
        ok: false,
        errorCode: engine.provider.startsWith('pageindex')
          ? 'REASONING_RETRIEVAL_REQUIRED'
          : 'ENGINE_ADAPTER_NOT_READY',
      };
    const reference = engine.config.embeddingModelRef;
    if (typeof reference !== 'string' || !reference.includes(':'))
      return { ok: false, errorCode: 'MODEL_NOT_BOUND' };
    let embedding: Record<string, unknown>;
    try {
      const separator = reference.indexOf(':');
      const target = this.models.resolveRuntimeTargetByModel({
        providerId: reference.slice(0, separator),
        modelId: reference.slice(separator + 1),
      });
      if (!target.api.startsWith('openai-'))
        return { ok: false, errorCode: 'EMBEDDING_PROTOCOL_UNSUPPORTED' };
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
      return { ok: false, errorCode: 'MODEL_NOT_READY' };
    }
    return this.callBridge({
      ...request,
      provider: engine.provider,
      config: engine.config,
      embedding,
    });
  }
  private callBridge(request: Record<string, unknown>): Promise<EngineReceipt> {
    const python = process.env.QITU_KNOWLEDGE_PYTHON;
    const source = process.env.QITU_DEEPTUTOR_SOURCE;
    if (!python || !source)
      return Promise.resolve({ ok: false, errorCode: 'ENGINE_DEPENDENCY_MISSING' });
    return new Promise((resolveResult) => {
      const bridge = resolve(
        process.env.QITU_KNOWLEDGE_BRIDGE ??
          resolve(process.cwd(), '../../integrations/deeptutor-knowledge/bridge.py'),
      );
      const child = spawn(python, [bridge], {
        env: { ...process.env, PYTHONPATH: source },
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      let output = '';
      let oversized = false;
      const timer = setTimeout(
        () => child.kill('SIGKILL'),
        request.operation === 'build' ? 14 * 60_000 : 35_000,
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
        resolveResult({ ok: false, errorCode: 'ENGINE_DEPENDENCY_MISSING' });
      });
      child.on('close', () => {
        clearTimeout(timer);
        try {
          if (oversized) throw new Error();
          resolveResult(JSON.parse(output.trim().split('\n').at(-1) ?? '') as EngineReceipt);
        } catch {
          resolveResult({ ok: false, errorCode: 'ENGINE_EXECUTION_FAILED' });
        }
      });
      child.stdin.on('error', () => {});
      child.stdin.end(JSON.stringify(request));
    });
  }
  async check(id: string) {
    const { revision, config } = await this.center.configuration();
    const engine = config.knowledgeEngines[id];
    let receipt: EngineReceipt;
    if (
      engine?.enabled &&
      engine.provider === 'ima' &&
      engine.config.connectionRef === 'ima-legacy'
    ) {
      try {
        const tools = await new ImaMcpClient().toolsFor(
          [
            {
              serverId: 'ima-knowledge',
              label: 'ima',
              transport: 'streamable_http',
              toolIds: ['ima_list_knowledge_bases'],
            },
          ],
          async () => {
            const current = await this.center.configuration();
            return (
              current.config.knowledgeEngines[id]?.enabled === true && current.revision === revision
            );
          },
        );
        const response = await tools[0]?.execute({});
        const catalog = response && !response.isError ? JSON.parse(response.text) : null;
        receipt = Array.isArray(catalog?.knowledge_bases)
          ? { ok: true, manifest: { accessibleBases: catalog.knowledge_bases.length } }
          : { ok: false, errorCode: 'SOURCE_CONNECTION_UNAVAILABLE' };
      } catch {
        receipt = { ok: false, errorCode: 'SOURCE_CONNECTION_UNAVAILABLE' };
      }
    } else
      receipt = engine
        ? await this.execute(engine, { operation: 'check' })
        : { ok: false, errorCode: 'ENGINE_NOT_CONFIGURED' };
    await this.center
      .database()
      .execute(
        sql`INSERT INTO knowledge_engine_checks(instance_id,config_revision,health_status,error_code,capabilities) VALUES(${id},${revision},${receipt.ok ? 'ready' : 'unavailable'},${receipt.errorCode ?? null},${JSON.stringify({ canIndex: receipt.ok && engine?.provider === 'llamaindex', canSearch: receipt.ok, canMaterialize: receipt.ok && (engine?.provider !== 'ima' || engine.config.allowMaterialize === true) })}::jsonb) ON CONFLICT(instance_id) DO UPDATE SET config_revision=excluded.config_revision,health_status=excluded.health_status,error_code=excluded.error_code,capabilities=excluded.capabilities,checked_at=now()`,
      );
    return { instanceId: id, revision, ...receipt, checkedAt: new Date().toISOString() };
  }
}
