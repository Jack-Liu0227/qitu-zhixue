import { adminEnvelopeRequest } from './types';

export interface ImaKnowledgeBasePage {
  knowledgeBases: { id: string; name: string; description: string | null }[];
  nextCursor: string;
  isEnd: boolean;
}

export type ReadinessStatus =
  | 'ready'
  | 'needs_key'
  | 'needs_setup'
  | 'not_installed'
  | 'unavailable'
  | 'unreachable'
  | 'unchecked';

export interface EngineCapabilities {
  canIndex?: boolean;
  canSearch?: boolean;
  canMaterialize?: boolean;
  create?: boolean;
  connect?: boolean;
  search?: boolean;
  materialize?: boolean;
}

export interface EngineHealth {
  health_status?: string;
  status?: ReadinessStatus;
  error_code: string | null;
  checked_at: string | null;
  capabilities?: EngineCapabilities;
}

export interface Engine {
  name: string;
  description: string;
  provider: string;
  enabled: boolean;
  config: Record<string, unknown>;
}
export interface ToolConfig {
  name: string;
  description: string;
  enabled: boolean;
  tools: string[];
  boundAssistants: string[];
}
export interface CenterConfig {
  revision: number;
  config: {
    mcpServers: Record<string, Record<string, unknown>>;
    knowledgeEngines: Record<string, Engine>;
    platformTools: { 'project-knowledge': ToolConfig };
  };
}
export interface ConnectionSummary {
  status: string;
  flavour?: string | null;
  provider?: string | null;
  externalRef?: Record<string, string | number | boolean | null>;
  lastCheckAt?: string | null;
  lastErrorCode?: string | null;
}
export interface Base {
  id: string;
  name: string;
  kind: string;
  project_id: string | null;
  school_id: string | null;
  engine_instance_id: string | null;
  lifecycle: string;
  build_state: string;
  active_index_version_id: string | null;
  document_count: number;
  updated_at: string;
  created_at?: string;
  revision?: number;
  assistant_count?: number;
  library_settings?: {
    folders?: string[];
    storageWorkspaceRef?: string;
    isDefault?: boolean;
    engineOverrides?: Record<string, unknown>;
  };
  mode?: 'create_new' | 'link_existing';
  flavour?: string | null;
  connection?: ConnectionSummary | null;
}
export interface KnowledgeSource {
  id: string;
  kind: 'folder' | 'github' | 'web' | string;
  status: string;
  sourceConfig?: Record<string, unknown>;
  scheduleHours?: number | null;
  lastSyncAt?: string | null;
  lastSourceRevision?: string | null;
  lastErrorCode?: string | null;
  jobId?: string | null;
}
export type AgentKind = 'admin_assistant' | 'tutor_partner' | 'runtime_agent';
export type BindingMode = 'retrieve' | 'materialize';
export interface KnowledgeBinding {
  agentKind: AgentKind;
  agentId: string;
  agentName?: string | null;
  mode: BindingMode;
  enabled: boolean;
  revision?: number;
  effective?: boolean;
  targetEnabled?: boolean;
  avatar?: string | null;
  readonlyReason?: string | null;
  reasons?: string[];
}
export interface BindingSummary {
  bindingRevision?: number;
  bindings: KnowledgeBinding[];
  catalog?: KnowledgeBinding[];
}
export interface BaseDetail extends Base {
  files: {
    id: string;
    title: string;
    checksum: string;
    source_revision: string;
    origin: Record<string, unknown>;
  }[];
  versions: { id: string; status: string; created_at: string; manifest: Record<string, unknown> }[];
  jobs: {
    id: string;
    state: string;
    error_code: string | null;
    attempts: number;
    operation?: string;
  }[];
  connection?: ConnectionSummary | null;
  sources?: KnowledgeSource[];
  bindings?: BindingSummary;
}
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
export interface EngineCheck {
  ok: boolean;
  status?: ReadinessStatus;
  errorCode?: string;
  checks?: { key: string; label: string; ok: boolean; detail: string; optional: boolean }[];
  checkedAt?: string;
  manifest?: Record<string, unknown>;
}
export interface EngineGroup {
  definition?: EngineDefinition;
  provider: string;
  name: string;
  group: string;
  instances: (Engine & {
    id: string;
    revision: number;
    configurationStatus?: string;
    health: EngineHealth | null;
    associatedBases: { id: string; name: string }[];
    configurationUrl: string;
  })[];
}
export const centerRequest = <T>(
  path: string,
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' = 'GET',
  body?: unknown,
  idempotencyKey?: string,
) => adminEnvelopeRequest<T>({ path: `/api/v1/admin/${path}`, method, body, idempotencyKey });
export const fetchCenterConfig = () => centerRequest<CenterConfig>('platform-config');
export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown> | null;
}
export interface ToolCatalog {
  tools: ToolDefinition[];
  source: 'runtime' | 'mcp' | 'registry' | 'legacy_manifest';
  fetchedAt: string | null;
  stale: boolean;
  message: string | null;
}
export const fetchToolCatalog = (target: string, refresh = false) =>
  centerRequest<ToolCatalog>(
    `platform-config/tools/${target.split('/').map(encodeURIComponent).join('/')}${refresh ? '?refresh=1' : ''}`,
  );
export const saveCenterConfig = (
  body: { expectedRevision: number; config: CenterConfig['config'] },
  key: string,
) => centerRequest<CenterConfig>('platform-config', 'PUT', body, key);

export interface AssistantBindings {
  revision: number;
  assistantIds: string[];
  catalog: { id: string; name: string; avatar: string | null; enabled: boolean }[];
}
export const fetchAssistantBindings = () =>
  centerRequest<AssistantBindings>('knowledge/assistant-bindings');
export const saveAssistantBindings = (
  expectedRevision: number,
  assistantIds: string[],
  idempotencyKey: string,
) =>
  centerRequest<{ revision: number }>(
    'knowledge/assistant-bindings',
    'PUT',
    { expectedRevision, assistantIds },
    idempotencyKey,
  );

export interface LinkProbeRequest {
  provider: string;
  externalPath?: string;
  serverUrl?: string;
  remoteKnowledgeBaseId?: string;
  zimName?: string;
  deviceId?: string;
  [key: string]: string | undefined;
}
export interface LinkProbeResult {
  ok: boolean;
  provider: string;
  version?: string | null;
  docCount?: number | null;
  embedding?: { compatible?: boolean; signature?: string | null };
  warnings?: string[];
  errorCode?: string | null;
}
export interface CreateBaseRequest {
  name: string;
  engineInstanceId: string;
  mode: 'create_new' | 'link_existing';
  retrievalMode?: string;
  storageWorkspaceRef?: string;
  connection?: Record<string, string>;
  embeddingModelRef?: string;
}
export const probeLinkedBase = (body: LinkProbeRequest, key: string) =>
  centerRequest<LinkProbeResult>('knowledge/bases/link-probe', 'POST', body, key);
export const createKnowledgeBase = (body: CreateBaseRequest, key: string) =>
  centerRequest<BaseDetail>('knowledge/bases', 'POST', body, key);
export const fetchBaseBindings = (baseId: string) =>
  centerRequest<BindingSummary>(`knowledge/bases/${encodeURIComponent(baseId)}/bindings`);
export const saveBaseBindings = (
  baseId: string,
  body: { expectedRevision?: number; bindings: KnowledgeBinding[] },
  key: string,
) =>
  centerRequest<BindingSummary>(
    `knowledge/bases/${encodeURIComponent(baseId)}/bindings`,
    'PUT',
    body,
    key,
  );
export const createKnowledgeSource = (baseId: string, body: unknown, key: string) =>
  centerRequest<BaseDetail>(
    `knowledge/bases/${encodeURIComponent(baseId)}/sources`,
    'POST',
    body,
    key,
  );
export const syncKnowledgeSource = (baseId: string, sourceId: string, body: unknown, key: string) =>
  centerRequest<BaseDetail>(
    `knowledge/bases/${encodeURIComponent(baseId)}/sources/${encodeURIComponent(sourceId)}/sync`,
    'POST',
    body,
    key,
  );
export const cancelKnowledgeJob = (jobId: string, key: string) =>
  centerRequest<unknown>(`knowledge/jobs/${encodeURIComponent(jobId)}/cancel`, 'POST', {}, key);
