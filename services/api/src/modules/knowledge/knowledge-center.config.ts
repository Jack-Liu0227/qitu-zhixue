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
export const PROJECT_TOOL = {
  name: '项目知识库检索',
  description: '检索和阅读当前项目绑定的知识库',
  tools: ['project_knowledge_search', 'project_knowledge_read'],
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
      const allowed = [...common, ...(fields[String(e.provider)] ?? [])];
      for (const [key, value] of Object.entries(config)) {
        if (!allowed.includes(key)) invalid(`${id}.config.${key} 不受支持`);
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
      t.name !== PROJECT_TOOL.name ||
      t.description !== PROJECT_TOOL.description ||
      JSON.stringify(t.tools) !== JSON.stringify(PROJECT_TOOL.tools)
    )
      invalid('平台工具注册字段只读');
    if (
      typeof t.enabled !== 'boolean' ||
      !Array.isArray(t.boundAssistants) ||
      t.boundAssistants.length > 300 ||
      t.boundAssistants.some((x) => typeof x !== 'string') ||
      new Set(t.boundAssistants).size !== t.boundAssistants.length
    )
      invalid('项目检索授权无效');
    result.platformTools['project-knowledge'] = t as unknown as ProjectToolConfig;
  }
  return result;
}
