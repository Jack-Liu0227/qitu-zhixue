import type { ModelApi, ModelModality } from './models.js';

/** Versioned, credential-free provider catalog exchanged during pi import. */
export const PROVIDER_IMPORT_MANIFEST_VERSION = 'qitu.provider-import.v1' as const;

export type ProviderManifestSource = 'pi' | 'admin' | 'runtime';
export type ProviderCredentialKind = 'api_key' | 'oauth' | 'ambient' | 'none' | 'unknown';

export interface ProviderCredentialSummary {
  kind: ProviderCredentialKind;
  configured: boolean;
  /** A one-way fingerprint only; never a key, token or credential payload. */
  keyFingerprint: string | null;
  source: 'pi' | 'server' | 'unknown';
}

export type VoiceModelOperation = 'asr' | 'tts' | 'realtime';

export interface VoiceModelCapability {
  operations: readonly VoiceModelOperation[];
  languages: readonly string[];
  codecs: readonly string[];
  sampleRatesHz: readonly number[];
}

export interface ProviderModelManifest {
  id: string;
  label: string;
  api: ModelApi;
  input: readonly ModelModality[];
  output: readonly ModelModality[];
  contextWindow: number | null;
  maxTokens: number | null;
  enabled: boolean;
  source: 'pi' | 'fetched' | 'manual' | 'unknown';
  capabilities: {
    supportsStreaming: boolean;
    supportsTools: boolean;
    supportsReasoning: boolean;
  };
  voice: VoiceModelCapability | null;
}

export interface ProviderImportEntry {
  id: string;
  label: string;
  api: ModelApi;
  /** Whether the resolved credential should be sent as Bearer auth. */
  authHeader: boolean;
  /** URL with user info, query and fragment removed. */
  baseUrl: string;
  auth: ProviderCredentialSummary;
  models: readonly ProviderModelManifest[];
  enabled: boolean;
  source: ProviderManifestSource;
}

export interface ProviderImportManifest {
  contractVersion: typeof PROVIDER_IMPORT_MANIFEST_VERSION;
  source: 'pi';
  generatedAt: string;
  redacted: true;
  providers: readonly ProviderImportEntry[];
  warnings: readonly string[];
}

/**
 * Input consumed by a local pi adapter. It deliberately has no credential
 * field; auth files are resolved by the server's secure credential path.
 */
export interface PiProviderSnapshot {
  id: string;
  label?: string;
  api?: string;
  baseUrl?: string;
  authHeader?: boolean;
  auth?: {
    kind?: ProviderCredentialKind;
    configured?: boolean;
    keyFingerprint?: string | null;
    source?: 'pi' | 'server' | 'unknown';
  };
  models?: readonly {
    id: string;
    label?: string;
    api?: string;
    input?: readonly string[];
    output?: readonly string[];
    contextWindow?: number | null;
    maxTokens?: number | null;
    enabled?: boolean;
    source?: ProviderModelManifest['source'];
    capabilities?: Partial<ProviderModelManifest['capabilities']>;
    voice?: Partial<VoiceModelCapability> | null;
  }[];
}

export interface ProviderManifestSanitizeResult {
  manifest: ProviderImportManifest;
  /** Field paths dropped because they could contain credentials. */
  droppedFields: readonly string[];
}
