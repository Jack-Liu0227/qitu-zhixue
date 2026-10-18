/** DeepTutor v1.6.14 / 6cf793b. Presentation and config contract; no credentials. */
export interface EngineField {
  key: string;
  label: string;
  type: 'string' | 'number' | 'boolean' | 'select' | 'model' | 'list';
  group: string;
  description: string;
  default?: unknown;
  options?: string[];
  min?: number;
  max?: number;
}
export interface EngineDefinition {
  provider: string;
  description: string;
  icon: string | null;
  modes: string[];
  prerequisites: string;
  installHint: string | null;
  modelKinds: string[];
  management: string[];
  fields: EngineField[];
  upstreamCommit: string;
}
const pin = '6cf793bd868ba5ecbe64722936d4be8fab5a01df';
const f = (
  key: string,
  label: string,
  type: EngineField['type'],
  group: string,
  description: string,
  value?: unknown,
  extra: Partial<EngineField> = {},
): EngineField => ({
  key,
  label,
  type,
  group,
  description,
  ...(value === undefined ? {} : { default: value }),
  ...extra,
});
const n = (
  key: string,
  label: string,
  value: number,
  min: number,
  max: number,
  group = '检索参数',
  description = '',
) => f(key, label, 'number', group, description, value, { min, max });
const model = (key: string, label: string) =>
  f(key, label, 'model', '模型绑定', '使用模型接入中已配置的 provider:model 稳定引用');
const response = f(
  'response_type',
  '回答组织方式',
  'select',
  '检索参数',
  '知识图谱检索上下文的组织方式',
  'Multiple Paragraphs',
  {
    options: [
      'Multiple Paragraphs',
      'Single Paragraph',
      'Single Sentence',
      'List of 3-7 Points',
      'Multiple-Page Report',
    ],
  },
);
const server = f(
  'server_url',
  '服务地址',
  'string',
  '连接设置',
  '独立服务的 HTTP(S) 地址；私有地址需在服务器允许清单中登记',
);
const apiKey = f(
  'apiKey',
  'API Key',
  'string',
  '连接凭证',
  '管理员可在网页表单或 JSON 中查看和修改',
  '',
);
const cloudUrl = (url: string) =>
  f('server_url', '服务地址', 'string', '连接设置', '官方云端服务地址，由上游客户端使用', url);
const source = [
  f(
    'allowedKnowledgeBaseIds',
    '允许的远端知识库',
    'list',
    '来源授权',
    '每行一个远端知识库 ID；空清单不授权任何库',
    [],
  ),
];
const defs: Record<string, Omit<EngineDefinition, 'provider' | 'upstreamCommit'>> = {
  llamaindex: {
    description: '本地向量检索，支持 BM25 混合融合、重排和 FAISS 索引。',
    icon: 'llamaindex.png',
    modes: ['hybrid', 'vector'],
    prerequisites: '需要可用的嵌入模型。BM25 与交叉编码器为可选依赖；索引结构变更在重建后生效。',
    installHint: null,
    modelKinds: ['embedding'],
    management: ['配置检索与索引', '绑定嵌入模型', '环境预检', '查看关联知识库'],
    fields: [
      model('embeddingModelRef', '嵌入模型'),
      f(
        'retrieval_profile',
        '检索策略',
        'select',
        '检索参数',
        'hybrid 融合关键词与向量；vector 仅向量',
        'hybrid',
        { options: ['hybrid', 'vector'] },
      ),
      n('top_k', '返回片段数', 5, 1, 20),
      n('vector_top_k_multiplier', '向量候选倍数', 2, 1, 10),
      n('bm25_top_k_multiplier', 'BM25 候选倍数', 2, 1, 10),
      f(
        'reranker_model',
        '重排模型',
        'string',
        '检索参数',
        'Hugging Face 交叉编码器标识；留空关闭重排',
        '',
      ),
      n('rerank_top_k', '重排候选数', 50, 1, 100),
      f('vector_index_type', '向量索引', 'select', '索引构建', '下一次完整重建时生效', 'flat', {
        options: ['flat', 'hnsw'],
      }),
      n('hnsw_m', 'HNSW 连接数', 32, 2, 128, '索引构建'),
      n('hnsw_ef_construction', 'HNSW 构建候选', 200, 1, 2000, '索引构建'),
      n('hnsw_ef_search', 'HNSW 查询候选', 64, 1, 2000, '索引构建'),
      n('chunk_size', '分块大小', 1024, 64, 8192, '索引构建'),
      n('chunk_overlap', '分块重叠', 200, 0, 4096, '索引构建'),
      n('image_description_concurrency', '图像描述并发', 2, 1, 16, '多模态'),
      n('image_description_batch_size', '图像描述批量', 4, 1, 32, '多模态'),
      n('image_description_timeout_seconds', '图像描述超时（秒）', 120, 10, 600, '多模态'),
    ],
  },
  'pageindex-oss': {
    description: '本地树形文档索引，通过大模型推理定位内容，无需向量库。',
    icon: 'pageindex.png',
    modes: [],
    prerequisites: '需要 PageIndex SDK 和聊天模型。上游本地索引以 PDF 为输入。',
    installHint: 'pip install pageindex',
    modelKinds: ['llm'],
    management: ['绑定索引模型', '环境预检', '查看关联知识库'],
    fields: [model('llmModelRef', '索引聊天模型')],
  },
  graphrag: {
    description: '微软 GraphRAG，基于实体、关系和社区摘要检索。',
    icon: 'graphrag.png',
    modes: ['local', 'global', 'drift', 'basic'],
    prerequisites:
      '需要 GraphRAG 可选依赖、支持结构化输出的聊天模型和嵌入模型；建索引会消耗模型额度。',
    installHint: "pip install 'deeptutor[graphrag]'",
    modelKinds: ['llm', 'embedding'],
    management: ['选择检索模式', '配置社区检索', '模型兼容预检', '查看关联知识库'],
    fields: [
      model('llmModelRef', '聊天模型'),
      model('embeddingModelRef', '嵌入模型'),
      f(
        'mode',
        '默认检索模式',
        'select',
        '检索参数',
        'local 实体；global 社区；drift 动态追问；basic 向量',
        'local',
        { options: ['local', 'global', 'drift', 'basic'] },
      ),
      response,
      n('community_level', '社区层级', 2, 0, 10),
      f(
        'dynamic_community_selection',
        '动态选择社区',
        'boolean',
        '检索参数',
        '按问题选择相关社区',
        false,
      ),
    ],
  },
  lightrag: {
    description: 'HKUDS LightRAG，本地知识图谱与向量融合，支持多模态解析。',
    icon: 'lightrag.jpg',
    modes: ['naive', 'local', 'global', 'hybrid', 'mix'],
    prerequisites:
      '需要 LightRAG 原生 SDK、聊天和嵌入模型；图像处理需视觉模型。各阶段模型可独立绑定。',
    installHint: "pip install 'deeptutor[rag-lightrag]'",
    modelKinds: ['llm', 'embedding', 'vision'],
    management: ['角色模型与并发', '配置检索模式', '环境预检', '查看关联知识库'],
    fields: [
      model('embeddingModelRef', '嵌入模型'),
      model('llmModelRef', '基础聊天模型'),
      model('extractModelRef', '实体抽取模型（可选）'),
      model('keywordModelRef', '关键词模型（可选）'),
      model('queryModelRef', '查询模型（可选）'),
      model('vlmModelRef', '视觉模型（可选）'),
      f(
        'mode',
        '默认检索模式',
        'select',
        '检索参数',
        'naive 向量；local 实体；global 关系；hybrid 图谱融合；mix 图谱与向量',
        'hybrid',
        { options: ['naive', 'local', 'global', 'hybrid', 'mix'] },
      ),
      n('top_k', '返回片段数', 10, 1, 20),
      response,
      n('max_concurrent_files', '文件处理并发', 2, 1, 16, '索引构建'),
      n('llm_model_max_async', '模型调用并发', 4, 1, 32, '索引构建'),
      n('llm_timeout', '模型超时（秒）', 180, 10, 600, '索引构建'),
      n('entity_extract_max_gleaning', '补充抽取轮数', 1, 0, 5, '索引构建'),
    ],
  },
  'lightrag-server': {
    description: '连接自行部署的 LightRAG Server，就地检索远端图谱与向量。',
    icon: 'lightrag.jpg',
    modes: ['naive', 'local', 'global', 'hybrid', 'mix'],
    prerequisites: '需先部署 LightRAG Server；API Key 可在网页或 JSON 配置中编辑。',
    installHint: null,
    modelKinds: [],
    management: ['设置默认服务地址', '认证检查', '选择检索模式', '连接已有知识库'],
    fields: [
      server,
      apiKey,
      f(
        'mode',
        '默认检索模式',
        'select',
        '检索参数',
        '远端只返回检索上下文，不生成最终回答',
        'mix',
        { options: ['naive', 'local', 'global', 'hybrid', 'mix'] },
      ),
      n('top_k', '返回片段数', 5, 1, 20),
    ],
  },
  pageindex: {
    description: 'PageIndex Cloud 托管文档索引，通过官方 SDK 和 MCP 阅读来源。',
    icon: 'pageindex.png',
    modes: [],
    prerequisites:
      '需要 PageIndex Cloud API key 和推理读取模型。文档会上传至 PageIndex，原文管理与本地库分离。',
    installHint: null,
    modelKinds: ['llm'],
    management: ['凭证状态检查', '推理读取模型', '连接检查', '查看关联知识库'],
    fields: [cloudUrl('https://api.pageindex.ai'), apiKey, model('llmModelRef', '推理读取模型')],
  },
  ima: {
    description: '连接腾讯 ima 已有知识库，检索资料、浏览文档并读取原文。',
    icon: 'tencent-ima.svg',
    modes: [],
    prerequisites:
      '需要 ima Client ID、API key 或已配置的 ima MCP 桥接；外部资料默认只读，项目收集需明确授权。',
    installHint: null,
    modelKinds: [],
    management: ['账户连接检查', '远端库授权', '原文收集授权', '连接已有知识库'],
    fields: [
      cloudUrl('https://ima.qq.com'),
      apiKey,
      f('clientId', 'Client ID', 'string', '连接凭证', 'ima 账户的 OpenAPI Client ID', ''),
      f('connectionRef', '连接引用', 'string', '连接设置', '使用服务器已有 ima 桥接', 'ima-legacy'),
      ...source,
    ],
  },
  weknora: {
    description: '连接腾讯 WeKnora 自托管知识库，通过 REST API 就地检索。',
    icon: null,
    modes: [],
    prerequisites: '需要已部署的 WeKnora 地址和服务端 API key。',
    installHint: null,
    modelKinds: [],
    management: ['默认服务地址', '认证检查', '连接已有知识库'],
    fields: [
      server,
      apiKey,
      f(
        'remoteKnowledgeBaseId',
        '默认远端库 ID',
        'string',
        '连接设置',
        '连接时可针对单个知识库指定',
      ),
    ],
  },
  obsidian: {
    description: '关联 Obsidian Vault，将本地 Markdown 文档作为可同步知识源。',
    icon: 'obsidian.svg',
    modes: [],
    prerequisites: 'Vault 必须位于服务器允许的目录；索引使用库所绑定的本地检索引擎。',
    installHint: null,
    modelKinds: [],
    management: ['设置 Vault 路径', '目录预检', '同步资料'],
    fields: [f('vaultPath', 'Vault 路径', 'string', '连接设置', '服务器允许目录中的真实路径')],
  },
  marginnote: {
    description: '连接 MarginNote 4 设备，使用设备同步的笔记与学习资料。',
    icon: 'marginnote.png',
    modes: [],
    prerequisites:
      '读取已同步的 MarginNote 4 数据库及已授权设备；目录须列入服务器允许清单。设备配对与采集由 MarginNote 插件完成。',
    installHint: null,
    modelKinds: [],
    management: ['设备状态检查', '选择资料存储', '读取已同步笔记'],
    fields: [
      f(
        'databasePath',
        '资料数据库路径',
        'string',
        '连接设置',
        '上游 MarginNote 4 SQLite 数据库；必须位于允许目录',
      ),
      f('deviceId', '设备 ID', 'string', '连接设置', '已登记并授权的 MarginNote 设备'),
    ],
  },
  kiwix: {
    description: '连接 kiwix-serve 的 ZIM 离线百科，按需读取匹配文章。',
    icon: null,
    modes: [],
    prerequisites: '需运行 kiwix-serve 并加载 ZIM；不会复制整个归档或建立本地副本。',
    installHint: null,
    modelKinds: [],
    management: ['服务检查', '选择 ZIM 归档', '读取文章'],
    fields: [
      server,
      f('zimName', 'ZIM 归档名称', 'string', '连接设置', 'kiwix-serve 中已加载的归档名称'),
    ],
  },
};
// Keep the upstream per-role execution controls while using Qitu model references.
for (const [role, label] of [
  ['extract', '实体抽取'],
  ['keyword', '关键词'],
  ['query', '查询'],
  ['vlm', '视觉'],
]) {
  defs.lightrag!.fields.push(
    n(`${role}_max_async`, `${label}并发`, 4, 1, 32, '角色执行参数'),
    n(`${role}_timeout`, `${label}超时（秒）`, 240, 1, 3600, '角色执行参数'),
    f(
      `${role}_reasoning_effort`,
      `${label}推理强度`,
      'select',
      '角色执行参数',
      '须选择对应模型支持的推理强度；默认不覆盖模型设置',
      'default',
      {
        options: [
          'default',
          'none',
          'minimal',
          'low',
          'medium',
          'high',
          'xhigh',
          'max',
          'adaptive',
        ],
      },
    ),
  );
}
export function engineDefinition(provider: string): EngineDefinition {
  return { provider, upstreamCommit: pin, ...defs[provider]! };
}
export const ENGINE_DEFINITIONS = Object.keys(defs).map(engineDefinition);
export const ENGINE_FIELD_ALIASES: Record<string, string> = {
  vector_candidate_multiplier: 'vector_top_k_multiplier',
  bm25_candidate_multiplier: 'bm25_top_k_multiplier',
  image_description_timeout: 'image_description_timeout_seconds',
  file_concurrency: 'max_concurrent_files',
  llm_concurrency: 'llm_model_max_async',
  baseModelRef: 'llmModelRef',
};
