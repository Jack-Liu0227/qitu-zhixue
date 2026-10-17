import { adminEnvelopeRequest } from './types';
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
  jobs: { id: string; state: string; error_code: string | null; attempts: number }[];
}
export interface EngineGroup {
  provider: string;
  name: string;
  group: string;
  instances: (Engine & {
    id: string;
    revision: number;
    health: { health_status: string; error_code: string | null; checked_at: string } | null;
    associatedBases: { id: string; name: string }[];
    configurationUrl: string;
  })[];
}
export const centerRequest = <T>(
  path: string,
  method: 'GET' | 'POST' | 'PUT' = 'GET',
  body?: unknown,
  idempotencyKey?: string,
) => adminEnvelopeRequest<T>({ path: `/api/v1/admin/${path}`, method, body, idempotencyKey });
export const fetchCenterConfig = () => centerRequest<CenterConfig>('platform-config');
export const saveCenterConfig = (
  body: { expectedRevision: number; config: CenterConfig['config'] },
  key: string,
) => centerRequest<CenterConfig>('platform-config', 'PUT', body, key);
