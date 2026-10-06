import type {
  ModelApi,
  ModelModality,
  PiProviderSnapshot,
  ProviderImportEntry,
  ProviderImportManifest,
  ProviderManifestSanitizeResult,
  ProviderModelManifest,
  VoiceModelCapability,
} from '@qitu/contracts';

const MANIFEST_VERSION = 'qitu.provider-import.v1' as const;
const SAFE_APIS: readonly ModelApi[] = [
  'openai-completions',
  'openai-responses',
  'anthropic-messages',
];
const SAFE_MODALITIES: readonly ModelModality[] = ['text', 'image', 'audio'];
const SAFE_VOICE_OPERATIONS = ['asr', 'tts', 'realtime'] as const;
const SECRET_KEY =
  /^(?:api[_-]?key|access[_-]?token|refresh[_-]?token|token|secret|password|credential|authorization)$/i;
const SECRET_TEXT =
  /(api[_-]?key|access[_-]?token|refresh[_-]?token|token|secret|password|authorization)\s*[:=]\s*[^\s,;]+/gi;

/**
 * Convert pi's already parsed public catalog into a credential-free manifest.
 * The adapter intentionally accepts `unknown` so callers cannot accidentally
 * pass `auth.json` through a structural cast and have secrets echoed back.
 */
export function createProviderImportManifest(
  input: readonly unknown[],
  options: { generatedAt?: string } = {},
): ProviderManifestSanitizeResult {
  const droppedFields: string[] = [];
  const warnings: string[] = [];
  const providers: ProviderImportEntry[] = [];

  input.forEach((raw, index) => {
    if (!isRecord(raw)) {
      warnings.push(`providers[${index}] ignored: entry is not an object`);
      return;
    }
    const provider = sanitizeProvider(raw, index, droppedFields, warnings);
    if (provider) providers.push(provider);
  });

  return {
    manifest: {
      contractVersion: MANIFEST_VERSION,
      source: 'pi',
      generatedAt: options.generatedAt ?? new Date().toISOString(),
      redacted: true,
      providers,
      warnings: warnings.map(redactText),
    },
    droppedFields,
  };
}

/** Alias with a name suitable for import endpoints and CLI adapters. */
export const sanitizePiProviderSnapshots = createProviderImportManifest;

export function assertProviderImportManifestRedacted(manifest: ProviderImportManifest): void {
  if (
    manifest.contractVersion !== MANIFEST_VERSION ||
    manifest.source !== 'pi' ||
    manifest.redacted !== true
  ) {
    throw new Error('PROVIDER_MANIFEST_VERSION_INVALID');
  }
  const secretPath = findSecretPath(manifest);
  if (secretPath !== null) throw new Error(`PROVIDER_MANIFEST_CONTAINS_SECRET_FIELD:${secretPath}`);
}

function sanitizeProvider(
  raw: Record<string, unknown>,
  index: number,
  droppedFields: string[],
  warnings: string[],
): ProviderImportEntry | null {
  collectSecretFields(raw, `providers[${index}]`, droppedFields);
  const id = safeId(raw.id);
  if (!id) {
    warnings.push(`providers[${index}] ignored: missing id`);
    return null;
  }
  const api = normalizeApi(raw.api);
  if (api === null) {
    warnings.push(`${id}: unsupported API was ignored`);
    return null;
  }
  const baseUrl = sanitizeBaseUrl(raw.baseUrl);
  if (!baseUrl && typeof raw.baseUrl === 'string' && raw.baseUrl.trim()) {
    warnings.push(`${id}: base URL was removed because it is not a safe HTTP URL`);
  }

  const auth = isRecord(raw.auth) ? raw.auth : {};
  const models = Array.isArray(raw.models)
    ? raw.models.flatMap((model, modelIndex) => {
        const result = sanitizeModel(model, id, modelIndex, api, droppedFields, warnings);
        return result ? [result] : [];
      })
    : [];

  return {
    id,
    label: redactText(safeLabel(raw.label, id)),
    api,
    baseUrl,
    authHeader: raw.authHeader !== false,
    auth: {
      kind: normalizeCredentialKind(auth.kind),
      configured: auth.configured === true,
      keyFingerprint: safeFingerprint(auth.keyFingerprint),
      source: auth.source === 'pi' || auth.source === 'server' ? auth.source : 'unknown',
    },
    models,
    enabled: raw.enabled !== false,
    source: 'pi',
  };
}

function sanitizeModel(
  raw: unknown,
  providerId: string,
  index: number,
  providerApi: ModelApi,
  droppedFields: string[],
  warnings: string[],
): ProviderModelManifest | null {
  if (!isRecord(raw)) {
    warnings.push(`${providerId}.models[${index}] ignored: entry is not an object`);
    return null;
  }
  collectSecretFields(raw, `${providerId}.models[${index}]`, droppedFields);
  const id = safeId(raw.id);
  if (!id) {
    warnings.push(`${providerId}.models[${index}] ignored: missing id`);
    return null;
  }
  const api = normalizeApi(raw.api, providerApi);
  if (api === null) {
    warnings.push(`${providerId}/${id}: unsupported API was ignored`);
    return null;
  }
  const input = normalizeModalities(raw.input);
  const output = normalizeModalities(raw.output);
  const voice = sanitizeVoice(raw.voice);
  if (voice !== null && voice.operations.length === 0)
    warnings.push(`${providerId}/${id}: empty voice capability removed`);
  return {
    id,
    label: redactText(safeLabel(raw.label, id)),
    api,
    input: input.length > 0 ? input : ['text'],
    output: output.length > 0 ? output : ['text'],
    contextWindow: positiveIntOrNull(raw.contextWindow),
    maxTokens: positiveIntOrNull(raw.maxTokens),
    enabled: raw.enabled !== false,
    source:
      raw.source === 'pi' || raw.source === 'fetched' || raw.source === 'manual'
        ? raw.source
        : 'unknown',
    capabilities: {
      supportsStreaming: readBoolean(raw.capabilities, 'supportsStreaming', true),
      supportsTools: readBoolean(raw.capabilities, 'supportsTools', false),
      supportsReasoning: readBoolean(raw.capabilities, 'supportsReasoning', false),
    },
    voice: voice && voice.operations.length > 0 ? voice : null,
  };
}

function sanitizeVoice(raw: unknown): VoiceModelCapability | null {
  if (!isRecord(raw)) return null;
  const operations = Array.isArray(raw.operations)
    ? raw.operations.filter(
        (entry): entry is VoiceModelCapability['operations'][number] =>
          typeof entry === 'string' &&
          SAFE_VOICE_OPERATIONS.includes(entry as (typeof SAFE_VOICE_OPERATIONS)[number]),
      )
    : [];
  const languages = boundedStrings(raw.languages);
  const codecs = boundedStrings(raw.codecs);
  const sampleRatesHz = Array.isArray(raw.sampleRatesHz)
    ? raw.sampleRatesHz.filter(
        (value): value is number =>
          typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= 1_000_000,
      )
    : [];
  return { operations, languages, codecs, sampleRatesHz };
}

function normalizeApi(value: unknown, fallback?: ModelApi): ModelApi | null {
  if (value === undefined || value === null || value === '') return fallback ?? 'openai-completions';
  return typeof value === 'string' && SAFE_APIS.includes(value as ModelApi)
    ? (value as ModelApi)
    : null;
}

function normalizeCredentialKind(value: unknown): ProviderImportEntry['auth']['kind'] {
  return value === 'api_key' || value === 'oauth' || value === 'ambient' || value === 'none'
    ? value
    : 'unknown';
}

function normalizeModalities(value: unknown): ModelModality[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (entry): entry is ModelModality =>
      typeof entry === 'string' && SAFE_MODALITIES.includes(entry as ModelModality),
  );
}

function sanitizeBaseUrl(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) return '';
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return '';
    url.username = '';
    url.password = '';
    url.search = '';
    url.hash = '';
    url.pathname = url.pathname.replace(/\/{2,}/g, '/').replace(/\/$/, '');
    return url.toString().replace(/\/$/, '');
  } catch {
    return '';
  }
}

function collectSecretFields(value: unknown, path: string, droppedFields: string[]): void {
  if (!isRecord(value)) return;
  for (const [key, child] of Object.entries(value)) {
    const childPath = `${path}.${key}`;
    if (SECRET_KEY.test(key)) {
      droppedFields.push(childPath);
      continue;
    }
    if (isRecord(child) || Array.isArray(child))
      collectSecretFields(child, childPath, droppedFields);
  }
}

function findSecretPath(value: unknown, path = 'manifest'): string | null {
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const found = findSecretPath(value[index], `${path}[${index}]`);
      if (found) return found;
    }
    return null;
  }
  if (!isRecord(value)) return null;
  for (const [key, child] of Object.entries(value)) {
    if (SECRET_KEY.test(key)) return `${path}.${key}`;
    const found = findSecretPath(child, `${path}.${key}`);
    if (found) return found;
  }
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function safeId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const id = value.trim();
  return id.length > 0 && id.length <= 160 ? id : null;
}

function safeLabel(value: unknown, fallback: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) return fallback;
  return value.trim().slice(0, 240);
}

function safeFingerprint(value: unknown): string | null {
  if (typeof value !== 'string' || !/^[a-f0-9]{8,128}$/i.test(value)) return null;
  return value.toLowerCase();
}

function boundedStrings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
    .slice(0, 64)
    .map((entry) => redactText(entry.trim().slice(0, 80)));
}

function positiveIntOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : null;
}

function readBoolean(value: unknown, key: string, fallback: boolean): boolean {
  return isRecord(value) && typeof value[key] === 'boolean' ? (value[key] as boolean) : fallback;
}

function redactText(value: string): string {
  return value.replace(SECRET_TEXT, (match) => match.replace(/([:=])\s*[^\s,;]+$/, '$1[redacted]'));
}

export type { PiProviderSnapshot };
