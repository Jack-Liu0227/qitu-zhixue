export interface KnowledgeMatrixAssistant {
  id: string;
  name: string;
  avatar: string | null;
  enabled: boolean;
  retrievalAllowed: boolean;
}

export interface KnowledgeMatrixLibrary {
  id: string;
  name: string;
  revision: number;
  provider: string | null;
  engineInstanceId: string | null;
  enabled: boolean;
  connectionStatus: string | null;
  lastCheckedAt: string | null;
  lastErrorCode: string | null;
  buildState: string;
  reasons: string[];
}

export interface KnowledgeMatrixCell {
  knowledgeBaseId: string;
  assistantId: string;
  enabled: boolean;
}

export interface KnowledgeBindingMatrix {
  complete: boolean;
  configurationRevision: number;
  retrievalEnabled: boolean;
  assistants: KnowledgeMatrixAssistant[];
  libraries: KnowledgeMatrixLibrary[];
  bindings: KnowledgeMatrixCell[];
}

export interface KnowledgeMatrixChange {
  knowledgeBaseId: string;
  expectedRevision: number;
  bindings: { assistantId: string; enabled: boolean }[];
}

export interface KnowledgeMatrixPatch {
  changes: KnowledgeMatrixChange[];
}

export type KnowledgeMatrixSaveResult =
  | { knowledgeBaseId: string; status: 'saved'; revision: number }
  | { knowledgeBaseId: string; status: 'failed'; code: string; message: string };

export interface KnowledgeConnectionCommand {
  expectedRevision: number;
  remoteKnowledgeBaseId?: string;
}
