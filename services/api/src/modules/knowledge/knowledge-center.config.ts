import { engineDefinition, ENGINE_FIELD_ALIASES } from './knowledge-engine.catalog';
import { BadRequestException } from '@nestjs/common';

export const ENGINE_CATALOG = [
  ['llamaindex', 'LlamaIndex', '本地引擎'],
  ['pageindex-oss', 'PageIndex OSS', '本地引擎'],
  ['graphrag', 'GraphRAG', '本地引擎'],
  ['lightrag', 'LightRAG', '本地引擎'],
  ['lightrag-server', 'LightRAG Server', '服务器引擎'],
  ['pageindex', 'PageIndex Cloud', '云服务'],
  ['ima', 'Tencent ima', '云服务'],
  ['weknora', 'WeKnora', '云服务'],
  ['obsidian', 'Obsidian', '外部知识源'],
  ['marginnote', 'MarginNote 4', '外部知识源'],
  ['kiwix', 'Kiwix / ZIM', '外部知识源'],
] as const;
export type KnowledgeBaseMode = 'create_new' | 'link_existing';
export type KnowledgeBaseFlavour =
  | 'obsidian'
  | 'linked'
  | 'subagent'
  | 'lightrag_server'
  | 'ima'
  | 'weknora'
  | 'marginnote4'
  | 'kiwix';

/** DeepTutor flavour names intentionally differ from the local engine id for MarginNote. */
export const PROVIDER_FLAVIOUR: Record<string, KnowledgeBaseFlavour> = {
  obsidian: 'obsidian',
  'lightrag-server': 'lightrag_server',
  ima: 'ima',
  weknora: 'weknora',
  marginnote: 'marginnote4',
  kiwix: 'kiwix',
};
const CONNECTION_FIELDS: Record<KnowledgeBaseFlavour, string[]> = {
  obsidian: ['vaultPath'],
  linked: ['externalPath', 'ragProvider', 'indexVersion', 'embeddingSignature'],
  subagent: ['agentKind', 'cwd', 'partnerId'],
  lightrag_server: ['serverUrl', 'workspace'],
  ima: ['remoteKnowledgeBaseId', 'clientId'],
  weknora: ['serverUrl', 'remoteKnowledgeBaseId'],
  marginnote4: ['deviceId', 'serverUrl'],
  kiwix: ['serverUrl', 'zimName'],
};
const SECRET_FIELD =
  /token|password|secret|api[-_]?key|cookie|authorization|private[-_]?key|credential/i;
export function parseKnowledgeBaseConnection(
  provider: string,
  mode: KnowledgeBaseMode,
  raw: unknown,
): { flavour: KnowledgeBaseFlavour | null; externalRef: Record<string, string> } {
  if (mode !== 'create_new' && mode !== 'link_existing')
    throw new BadRequestException({ code: 'CONFIG_INVALID', message: '知识库模式无效' });
  const input = record(raw ?? {});
  if (Object.keys(input).some((key) => SECRET_FIELD.test(key)))
    throw new BadRequestException({
      code: 'CONFIG_SECRET_FORBIDDEN',
      message: '连接配置不得包含凭证',
    });
  const flavour =
    mode === 'link_existing' && ['llamaindex', 'graphrag', 'lightrag'].includes(provider)
      ? 'linked'
      : (PROVIDER_FLAVIOUR[provider] ?? null);
  if (mode === 'link_existing' && !flavour)
    throw new BadRequestException({
      code: 'REMOTE_CONNECTION_UNSUPPORTED',
      message: '该引擎不支持连接已有知识库',
    });
  if (!flavour) return { flavour: null, externalRef: {} };
  const allowed = new Set(CONNECTION_FIELDS[flavour]);
  if (Object.keys(input).some((key) => !allowed.has(key)))
    throw new BadRequestException({ code: 'CONFIG_INVALID', message: '连接配置包含未知字段' });
  const externalRef: Record<string, string> = {};
  for (const [key, value] of Object.entries(input)) {
    if (typeof value !== 'string' || !value.trim() || value.length > 2048)
      throw new BadRequestException({ code: 'CONFIG_INVALID', message: `连接字段 ${key} 无效` });
    if (key === 'serverUrl') {
      let url: URL;
      try {
        url = new URL(value.trim());
      } catch {
        throw new BadRequestException({ code: 'CONFIG_INVALID', message: `连接字段 ${key} 无效` });
      }
      if (
        url.username ||
        url.password ||
        url.search ||
        url.hash ||
        !['https:', 'http:'].includes(url.protocol) ||
        (url.protocol === 'http:' && !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname))
      )
        throw new BadRequestException({
          code: 'CONFIG_SECRET_FORBIDDEN',
          message: 'serverUrl 不得携带凭证或非安全明文地址',
        });
    }
    externalRef[key] = value.trim();
  }
  if (flavour === 'linked' && (!externalRef.externalPath || !externalRef.ragProvider))
    throw new BadRequestException({
      code: 'CONFIG_INVALID',
      message: 'linked 连接需要 externalPath 与 ragProvider',
    });
  if (flavour === 'linked' && externalRef.ragProvider !== provider)
    throw new BadRequestException({
      code: 'CONFIG_INVALID',
      message: 'linked ragProvider 必须与选定引擎一致',
    });
  return { flavour, externalRef };
}

export function redactConnection(connection: {
  flavour: string;
  provider: string;
  externalRef: Record<string, unknown>;
  status: string;
  credentialRef?: string | null;
  lastErrorCode?: string | null;
}): Record<string, unknown> {
  const externalRef = { ...connection.externalRef };
  if (typeof externalRef.externalPath === 'string') externalRef.externalPath = '[allowlisted path]';
  return {
    flavour: connection.flavour,
    provider: connection.provider,
    externalRef,
    credentialConfigured: Boolean(connection.credentialRef),
    status: connection.status,
    lastErrorCode: connection.lastErrorCode ?? null,
  };
}

export type EngineConfig = {
  name: string;
  description: string;
  provider: string;
  enabled: boolean;
  config: Record<string, unknown>;
};
export type ProjectToolConfig = {
  name: string;
  description: string;
  enabled: boolean;
  tools: string[];
  boundAssistants: string[];
};
export interface PlatformKnowledgeConfig {
  mcpServers: Record<string, Record<string, unknown>>;
  knowledgeEngines: Record<string, EngineConfig>;
  platformTools: { 'project-knowledge': ProjectToolConfig };
}
export const KNOWLEDGE_TOOL = {
  name: '知识库检索',
  description: '检索和阅读管理员授权的知识库',
  tools: ['knowledge_search', 'knowledge_read'],
};
const common = [
  'connectionRef',
  'allowedKnowledgeBaseIds',
  'allowMaterialize',
  'embeddingModelRef',
  'llmModelRef',
];
const fields: Record<string, string[]> = {
  llamaindex: [
    'retrieval_profile',
    'top_k',
    'vector_candidate_multiplier',
    'bm25_candidate_multiplier',
    'reranker_model',
    'rerank_top_k',
    'vector_index_type',
    'hnsw_m',
    'hnsw_ef_construction',
    'hnsw_ef_search',
    'chunk_size',
    'chunk_overlap',
    'image_description_concurrency',
    'image_description_timeout',
  ],
  graphrag: ['mode', 'response_type', 'community_level', 'dynamic_community_selection'],
  lightrag: [
    'mode',
    'top_k',
    'response_type',
    'file_concurrency',
    'llm_concurrency',
    'llm_timeout',
    'entity_extract_max_gleaning',
    'baseModelRef',
    'extractModelRef',
    'keywordModelRef',
    'queryModelRef',
    'vlmModelRef',
  ],
  'pageindex-oss': ['mode'],
  pageindex: ['mode'],
  'lightrag-server': ['mode', 'top_k'],
  ima: [],
  weknora: [],
  obsidian: [],
  marginnote: [],
  kiwix: [],
};
function invalid(message: string): never {
  throw new BadRequestException({ code: 'CONFIG_INVALID', message });
}
export function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid('配置必须是 JSON 对象');
  return value as Record<string, unknown>;
}
export function validateKnowledgeConfig(
  input: unknown,
  current: PlatformKnowledgeConfig,
): PlatformKnowledgeConfig {
  const root = record(input);
  if (
    Object.keys(root).some((k) => !['mcpServers', 'knowledgeEngines', 'platformTools'].includes(k))
  )
    invalid('存在未知配置分区');
  const result = structuredClone(current);
  if (root.mcpServers !== undefined) {
    const servers = record(root.mcpServers);
    if (Object.keys(current.mcpServers).some((id) => !(id in servers)))
      invalid('请停用 MCP，不可通过遗漏删除注册项');
    for (const [id, raw] of Object.entries(servers)) {
      const previous = current.mcpServers[id];
      const server = record(raw);
      if (!previous) invalid('MCP 连接须先通过服务端注册，不能从 JSON 执行任意命令');
      if (
        Object.keys(server).some((k) => !['name', 'enabled', 'transport', 'tools'].includes(k)) ||
        typeof server.name !== 'string' ||
        !server.name.trim() ||
        server.name.length > 160 ||
        typeof server.enabled !== 'boolean' ||
        server.transport !== previous.transport ||
        !Array.isArray(server.tools) ||
        server.tools.some((t) => typeof t !== 'string') ||
        new Set(server.tools).size !== server.tools.length
      )
        invalid('MCP 配置字段无效或包含只读状态');
      result.mcpServers[id] = server;
    }
  }
  if (root.knowledgeEngines !== undefined) {
    const engines = record(root.knowledgeEngines);
    if (Object.keys(current.knowledgeEngines).some((id) => !(id in engines)))
      invalid('不能通过遗漏配置删除引擎，请先停用并检查关联库');
    for (const [id, raw] of Object.entries(engines)) {
      if (!/^[a-z][a-z0-9-]{0,79}$/.test(id)) invalid('引擎 ID 无效');
      const e = record(raw);
      if (
        Object.keys(e).some(
          (k) => !['name', 'description', 'provider', 'enabled', 'config'].includes(k),
        )
      )
        invalid(`${id} 包含只读或未知字段`);
      if (
        typeof e.name !== 'string' ||
        !e.name.trim() ||
        e.name.length > 160 ||
        typeof e.description !== 'string' ||
        e.description.length > 600 ||
        typeof e.enabled !== 'boolean' ||
        !ENGINE_CATALOG.some((x) => x[0] === e.provider)
      )
        invalid(`${id} 引擎定义无效`);
      if (current.knowledgeEngines[id] && current.knowledgeEngines[id].provider !== e.provider)
        invalid('已有引擎不能变更 provider');
      const config = record(e.config);
      if (Object.keys(config).some((key) => SECRET_FIELD.test(key)))
        throw new BadRequestException({
          code: 'CONFIG_SECRET_FORBIDDEN',
          message: 'JSON 配置不得包含凭证',
        });
      const definition = engineDefinition(String(e.provider));
      const allowed = [
        ...common,
        ...(fields[String(e.provider)] ?? []),
        ...definition.fields.map((f) => f.key),
      ];
      for (const [key, value] of Object.entries(config)) {
        if (!allowed.includes(key)) invalid(`${id}.config.${key} 不受支持`);
        const field = definition.fields.find((f) => f.key === (ENGINE_FIELD_ALIASES[key] ?? key));
        if (field) {
          if (
            field.type === 'number' &&
            (typeof value !== 'number' ||
              !Number.isInteger(value) ||
              value < (field.min ?? 0) ||
              value > (field.max ?? 100000))
          )
            invalid(`${key} 超出允许范围`);
          if (field.type === 'boolean' && typeof value !== 'boolean') invalid(`${key} 须为布尔值`);
          if (
            field.type === 'select' &&
            (typeof value !== 'string' || !field.options?.includes(value))
          )
            invalid(`${key} 选项无效`);
          if (
            ['string', 'model'].includes(field.type) &&
            (typeof value !== 'string' || value.length > 2048)
          )
            invalid(`${key} 须为有界文本`);
          if (
            field.type === 'list' &&
            value !== null &&
            (!Array.isArray(value) ||
              value.length > 500 ||
              value.some((v) => typeof v !== 'string' || !v || v.length > 160))
          )
            invalid(`${key} 清单无效`);
        }
        if (key === 'server_url') {
          let url: URL;
          try {
            url = new URL(String(value));
          } catch {
            invalid('server_url 无效');
          }
          if (
            !['https:', 'http:'].includes(url.protocol) ||
            url.username ||
            url.password ||
            url.search ||
            url.hash
          )
            invalid('server_url 不得携带凭证或查询参数');
        }
        if (
          key.endsWith('Ref') &&
          (typeof value !== 'string' || !/^[a-zA-Z0-9._:/-]{1,160}$/.test(value))
        )
          invalid(`${key} 须为稳定引用`);
        if (key === 'allowMaterialize' && typeof value !== 'boolean')
          invalid('allowMaterialize 须为布尔值');
        if (
          key === 'allowedKnowledgeBaseIds' &&
          value !== null &&
          (!Array.isArray(value) ||
            value.length > 500 ||
            value.some((x) => typeof x !== 'string' || x.length > 160) ||
            new Set(value).size !== value.length)
        )
          invalid('来源白名单无效');
        const numeric = [
          'top_k',
          'vector_candidate_multiplier',
          'bm25_candidate_multiplier',
          'rerank_top_k',
          'hnsw_m',
          'hnsw_ef_construction',
          'hnsw_ef_search',
          'chunk_size',
          'chunk_overlap',
          'image_description_concurrency',
          'image_description_timeout',
          'community_level',
          'file_concurrency',
          'llm_concurrency',
          'llm_timeout',
          'entity_extract_max_gleaning',
        ];
        if (
          numeric.includes(key) &&
          (typeof value !== 'number' ||
            !Number.isInteger(value) ||
            value <
              (['chunk_overlap', 'community_level', 'entity_extract_max_gleaning'].includes(key)
                ? 0
                : 1) ||
            value > 100000)
        )
          invalid(`${key} 超出范围`);
        if (
          ['response_type', 'reranker_model'].includes(key) &&
          (typeof value !== 'string' || value.length > 200)
        )
          invalid(`${key} 须为文本`);
        if (key === 'dynamic_community_selection' && typeof value !== 'boolean')
          invalid(`${key} 须为布尔值`);
      }
      if (config.top_k !== undefined && (typeof config.top_k !== 'number' || config.top_k > 20))
        invalid('top_k 允许 1 到 20');
      if (
        config.chunk_overlap !== undefined &&
        (typeof config.chunk_overlap !== 'number' ||
          typeof config.chunk_size !== 'number' ||
          config.chunk_overlap >= config.chunk_size)
      )
        invalid('chunk_overlap 须小于 chunk_size');
      if (
        config.retrieval_profile !== undefined &&
        !['vector', 'hybrid'].includes(String(config.retrieval_profile))
      )
        invalid('retrieval_profile 无效');
      if (
        config.vector_index_type !== undefined &&
        !['flat', 'hnsw'].includes(String(config.vector_index_type))
      )
        invalid('vector_index_type 无效');
      const modes: Record<string, string[]> = {
        graphrag: ['local', 'global', 'drift', 'basic'],
        lightrag: ['naive', 'local', 'global', 'hybrid', 'mix'],
        'lightrag-server': ['naive', 'local', 'global', 'hybrid', 'mix'],
      };
      if (
        config.mode !== undefined &&
        (!modes[String(e.provider)] || !modes[String(e.provider)]!.includes(String(config.mode)))
      )
        invalid('该引擎检索模式无效');
      result.knowledgeEngines[id] = e as unknown as EngineConfig;
    }
  }
  if (root.platformTools !== undefined) {
    const tools = record(root.platformTools);
    if (Object.keys(tools).some((k) => k !== 'project-knowledge') || !tools['project-knowledge'])
      invalid('平台工具清单无效');
    const t = record(tools['project-knowledge']);
    if (
      Object.keys(t).some(
        (k) => !['name', 'description', 'tools', 'enabled', 'boundAssistants'].includes(k),
      ) ||
      t.name !== KNOWLEDGE_TOOL.name ||
      t.description !== KNOWLEDGE_TOOL.description ||
      JSON.stringify(t.tools) !== JSON.stringify(KNOWLEDGE_TOOL.tools)
    )
      invalid('平台工具注册字段只读');
    if (
      typeof t.enabled !== 'boolean' ||
      !Array.isArray(t.boundAssistants) ||
      t.boundAssistants.length > 300 ||
      t.boundAssistants.some((x) => typeof x !== 'string') ||
      new Set(t.boundAssistants).size !== t.boundAssistants.length
    )
      invalid('知识库检索授权无效');
    result.platformTools['project-knowledge'] = t as unknown as ProjectToolConfig;
  }
  return result;
}

/**
 * 助手绑定聚焦写入的纯校验（docs/design/20261018-knowledge-center-deeptutor-reference.md §2）。
 * 服务层 `saveAssistantBindings` 使用；错误经 `CONFIG_INVALID`/绑定专用码抛出。
 */
export function parseAssistantBindingsInput(body: unknown): {
  expectedRevision: number;
  assistantIds: string[];
} {
  const input = record(body);
  if (
    Object.keys(input).some((k) => !['expectedRevision', 'assistantIds'].includes(k)) ||
    !Number.isInteger(input.expectedRevision) ||
    !Array.isArray(input.assistantIds)
  )
    invalid('须提交 expectedRevision 与 assistantIds');
  const assistantIds = input.assistantIds as unknown[];
  if (
    assistantIds.length > 300 ||
    assistantIds.some((id) => typeof id !== 'string' || id.length > 160) ||
    new Set(assistantIds).size !== assistantIds.length
  )
    invalid('助手绑定列表无效');
  return {
    expectedRevision: input.expectedRevision as number,
    assistantIds: assistantIds as string[],
  };
}

/** 绑定的助手必须存在且启用；任一不满足即拒绝（400）。 */
export function assertAssistantsBindable(
  assistantIds: readonly string[],
  rows: readonly { id: string; enabled: boolean }[],
): void {
  const known = new Map(rows.map((row) => [row.id, row.enabled]));
  for (const id of assistantIds) {
    if (!known.has(id) || known.get(id) !== true)
      throw new BadRequestException({
        code: 'KNOWLEDGE_BINDING_ASSISTANT_UNAVAILABLE',
        message: `助手不存在或未启用：${id}`,
      });
  }
}
