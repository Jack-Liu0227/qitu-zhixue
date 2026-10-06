import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

export type PiModelApi = 'openai-completions' | 'openai-responses' | 'anthropic-messages';
export type PiModelModality = 'text' | 'image' | 'audio';

/** Internal import shape. `apiKey` is never returned by an HTTP controller. */
export interface PiImportManifest {
  providers: PiImportProvider[];
}

export interface PiImportProvider {
  id: string;
  name?: string;
  baseUrl: string;
  api?: PiModelApi;
  authHeader?: boolean;
  apiKey?: string;
  models: PiImportModel[];
}

export interface PiImportModel {
  modelId: string;
  displayName?: string;
  api?: PiModelApi;
  input?: PiModelModality[];
  output?: PiModelModality[];
  contextWindow?: number | null;
  maxTokens?: number | null;
}

export interface PiImportResult {
  providers: Array<{
    id: string;
    configured: boolean;
    modelsImported: number;
    modelsSkipped: number;
    voiceModelIds: string[];
  }>;
  importedModels: number;
  skippedModels: number;
  /** Always null until a server-side VoiceGatewayProvider is registered. */
  defaultVoiceModel: { providerId: string; modelId: string } | null;
}

export interface VoiceModelOption {
  providerId: string;
  providerName: string;
  modelId: string;
  modelName: string;
  configured: boolean;
  available: boolean;
  availabilityReason: 'voice_adapter_not_configured' | 'provider_not_configured';
  input: PiModelModality[];
  output: PiModelModality[];
}

const APIS = new Set<PiModelApi>(['openai-completions', 'openai-responses', 'anthropic-messages']);
const MODALITIES = new Set<PiModelModality>(['text', 'image', 'audio']);

/**
 * Read pi's server-mounted config directory without ever serializing secrets.
 * The resulting object is held in memory only long enough for the registry to
 * encrypt provider keys. OAuth records are intentionally metadata-only because
 * ModelRegistry's API-key gateway cannot use desktop OAuth refresh tokens.
 */
export async function readPiImportManifest(configDir = process.env.QITU_PI_CONFIG_DIR): Promise<PiImportManifest> {
  const root = (configDir ?? '').trim();
  if (root.length === 0) throw new Error('PI_CONFIG_DIR_NOT_CONFIGURED');
  const [modelsFile, modelStoreFile, authFile] = await Promise.all([
    readJson(join(root, 'models.json')),
    readJson(join(root, 'models-store.json')),
    readJson(join(root, 'auth.json')),
  ]);

  const providers = new Map<string, PiImportProvider>();
  const modelsRoot = asRecord(modelsFile)?.providers;
  if (modelsRoot) {
    for (const [id, raw] of Object.entries(modelsRoot)) {
      const provider = parseProvider(id, raw);
      if (provider !== null) providers.set(id, provider);
    }
  }

  const store = asRecord(modelStoreFile);
  if (store) {
    for (const [id, raw] of Object.entries(store)) {
      const entry = asRecord(raw);
      const models = asArray(entry?.models).map(parseModel).filter((model): model is PiImportModel => model !== null);
      if (models.length === 0) continue;
      const modelApis = [
        ...new Set(
          models
            .map((model) => model.api)
            .filter((api): api is PiModelApi => api !== undefined),
        ),
      ];
      // Pi's model store carries the protocol that was actually used for each
      // model. When every explicit declaration agrees, prefer it over a stale
      // provider-level value from models.json. The server schema stores one
      // protocol per provider, so this is the only safe way to preserve a
      // complete single-protocol catalog without guessing for mixed catalogs.
      const consistentModelApi = modelApis.length === 1 ? modelApis[0] : undefined;
      const current = providers.get(id);
      const first = asRecord(asArray(entry?.models)[0]);
      const baseUrl = current?.baseUrl || sanitisePiImportBaseUrl(first?.baseUrl) || '';
      if (baseUrl.length === 0) continue;
      const merged: PiImportProvider = current ?? {
        id,
        baseUrl,
        api: normalizeApi(first?.api),
        models: [],
      };
      if (consistentModelApi !== undefined) merged.api = consistentModelApi;
      else if (merged.api === undefined) merged.api = normalizeApi(first?.api);
      const byId = new Map(merged.models.map((model) => [model.modelId, model]));
      for (const model of models) byId.set(model.modelId, { ...byId.get(model.modelId), ...model });
      merged.models = [...byId.values()];
      providers.set(id, merged);
    }
  }

  const authRoot = asRecord(authFile);
  for (const provider of providers.values()) {
    if (provider.apiKey) continue;
    const auth = asRecord(authRoot?.[provider.id]);
    // Pi's canonical auth.json discriminator is `api_key`. Keep accepting the
    // historical `key` spelling for older mounted configs, but never treat an
    // OAuth record as an API key: access/refresh values must not enter the
    // provider manifest or the API-key encryption path.
    const key = auth?.type === 'api_key' || auth?.type === 'key' ? asString(auth.key) : null;
    if (key) provider.apiKey = key;
  }
  const result = [...providers.values()];
  if (result.length === 0) throw new Error('PI_CONFIG_EMPTY');
  return { providers: result };
}

async function readJson(path: string): Promise<unknown | null> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as unknown;
  } catch (error) {
    const code = typeof error === 'object' && error !== null && 'code' in error
      ? String((error as { code?: unknown }).code)
      : '';
    if (code === 'ENOENT') return null;
    throw new Error('PI_CONFIG_INVALID');
  }
}

function parseProvider(id: string, raw: unknown): PiImportProvider | null {
  const value = asRecord(raw);
  const baseUrl = sanitisePiImportBaseUrl(value?.baseUrl);
  if (!value || !baseUrl) return null;
  const models = asArray(value.models).map(parseModel).filter((model): model is PiImportModel => model !== null);
  return {
    id,
    name: asString(value.name) ?? undefined,
    baseUrl,
    api: normalizeApi(value.api),
    authHeader: typeof value.authHeader === 'boolean' ? value.authHeader : undefined,
    // models.json may contain an API key; it remains in this server-only object.
    apiKey: asString(value.apiKey) ?? undefined,
    models,
  };
}

/** Keep provider URLs free of userinfo, query credentials and fragments. */
export function sanitisePiImportBaseUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.trim().length === 0) return null;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    url.username = '';
    url.password = '';
    url.search = '';
    url.hash = '';
    url.pathname = url.pathname.replace(/\/{2,}/g, '/').replace(/\/$/, '');
    const result = url.toString().replace(/\/$/, '');
    return result.length > 0 ? result : null;
  } catch {
    return null;
  }
}

function parseModel(raw: unknown): PiImportModel | null {
  const value = asRecord(raw);
  const modelId = asString(value?.id);
  if (!modelId) return null;
  const input = parseModalities(value?.input);
  const output = parseModalities(value?.output);
  return {
    modelId,
    displayName: asString(value?.name) ?? undefined,
    api: normalizeApi(value?.api),
    input,
    output,
    contextWindow: asNonNegativeInt(value?.contextWindow),
    maxTokens: asNonNegativeInt(value?.maxTokens),
  };
}

function normalizeApi(value: unknown): PiModelApi | undefined {
  if (value === 'openai-codex-responses') return 'openai-responses';
  if (typeof value === 'string' && APIS.has(value as PiModelApi)) return value as PiModelApi;
  if (value === 'anthropic') return 'anthropic-messages';
  return undefined;
}

function parseModalities(value: unknown): PiModelModality[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const result = [...new Set(value.filter((item): item is PiModelModality => typeof item === 'string' && MODALITIES.has(item as PiModelModality)))];
  return result.length > 0 ? result : undefined;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function asNonNegativeInt(value: unknown): number | null | undefined {
  return value === null ? null : typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}
