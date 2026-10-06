import { Injectable } from '@nestjs/common';
import type {
  VoiceGatewayCapabilities,
  VoiceModelSelection,
  VoiceSynthesisRequest,
  VoiceTranscriptionRequest,
} from '@qitu/contracts';
import {
  createQwenVoiceGateway,
  probeQwenVoiceModel,
  type QwenVoiceTarget,
} from '@qitu/model-runtime';
import type { VoiceModelOption } from './pi-import';
import { ModelRegistryService } from './model-registry.service';

const PROBE_CACHE_TTL_MS = 60_000;

interface ProbeCacheEntry {
  expiresAt: number;
  ok: boolean;
  reason: VoiceModelOption['availabilityReason'];
}

/** Qwen's server-owned voice gateway. Credentials never leave this service. */
@Injectable()
export class QwenVoiceGatewayService {
  private readonly probeCache = new Map<string, ProbeCacheEntry>();

  constructor(private readonly registry: ModelRegistryService) {}

  /** Refresh Qwen's server catalog once during Pi initialization. */
  async refreshAvailableModels(actor: string): Promise<void> {
    const providers = this.registry.listProviders().providers;
    for (const provider of providers) {
      if (!isQwenProvider(provider.id, provider.baseUrl)) continue;
      try {
        await this.registry.refreshProvider(provider.id, actor);
      } catch {
        // Keep the imported catalog when an upstream refresh is unavailable;
        // capability probing below will report the model as unavailable.
      }
    }
    this.probeCache.clear();
  }

  async listModels(): Promise<VoiceModelOption[]> {
    const providers = this.registry.listProviders().providers;
    const providerById = new Map(providers.map((provider) => [provider.id, provider]));
    const options = this.registry.listVoiceModels();
    const result: VoiceModelOption[] = [];

    for (const option of options) {
      const provider = providerById.get(option.providerId);
      if (provider === undefined || !option.configured) {
        result.push({ ...option, available: false, availabilityReason: 'provider_not_configured' });
        continue;
      }
      if (option.operations.length === 0) {
        result.push({ ...option, available: false, availabilityReason: 'voice_capability_not_declared' });
        continue;
      }
      if (!isQwenProvider(option.providerId, provider.baseUrl) || provider.api !== 'openai-completions') {
        result.push({ ...option, available: false, availabilityReason: 'voice_adapter_not_configured' });
        continue;
      }

      try {
        const target = this.targetFor(option);
        const probe = await this.probe(target);
        result.push({
          ...option,
          available: probe.ok,
          availabilityReason: probe.ok ? null : probe.reason,
        });
      } catch {
        result.push({ ...option, available: false, availabilityReason: 'voice_provider_unreachable' });
      }
    }
    return result;
  }

  async capabilities(): Promise<VoiceGatewayCapabilities> {
    const models = await this.listModels();
    const available = models.filter((model) => model.available);
    const defaultModel = available[0] === undefined
      ? null
      : { providerId: available[0].providerId, modelId: available[0].modelId };
    return {
      generatedAt: new Date().toISOString(),
      defaultModel,
      models: available.map((model) => ({
        providerId: model.providerId,
        modelId: model.modelId,
        label: `${model.providerName} · ${model.modelName}`,
        operations: model.operations,
        languages: [],
        codecs: ['webm', 'wav', 'mp3'],
        available: true,
        credential: { configured: true, keyFingerprint: null },
      })),
    };
  }

  async defaultModel(): Promise<VoiceModelSelection | null> {
    return (await this.capabilities()).defaultModel;
  }

  async transcribe(input: VoiceTranscriptionRequest) {
    const target = await this.requireTarget(input.model, 'transcribe');
    return createQwenVoiceGateway({ target }).transcribe(input);
  }

  synthesize(input: VoiceSynthesisRequest) {
    return this.requireTarget(input.model, 'synthesize').then((target) =>
      createQwenVoiceGateway({ target }).synthesize(input),
    );
  }

  private async requireTarget(
    selection: VoiceModelSelection,
    operation: 'transcribe' | 'synthesize',
  ): Promise<QwenVoiceTarget> {
    const models = await this.listModels();
    const option = models.find(
      (model) => model.providerId === selection.providerId && model.modelId === selection.modelId,
    );
    if (option === undefined || !option.available) {
      throw new Error('VOICE_MODEL_UNAVAILABLE');
    }
    if (!option.operations.includes(operation)) throw new Error('VOICE_OPERATION_UNAVAILABLE');
    return this.targetFor(option);
  }

  private targetFor(option: VoiceModelOption): QwenVoiceTarget {
    const target = this.registry.resolveRuntimeTargetByModel({
      providerId: option.providerId,
      modelId: option.modelId,
    });
    return {
      providerId: target.providerId,
      providerName: target.providerName,
      modelId: target.modelId,
      baseUrl: target.baseUrl,
      credential: target.credential ?? '',
      authHeader: target.authHeader !== false,
      operations: option.operations,
    };
  }

  private async probe(target: QwenVoiceTarget): Promise<{ ok: boolean; reason: VoiceModelOption['availabilityReason'] }> {
    const key = `${target.providerId}:${target.modelId}`;
    const cached = this.probeCache.get(key);
    if (cached !== undefined && cached.expiresAt > Date.now()) {
      return { ok: cached.ok, reason: cached.reason };
    }
    const result = await probeQwenVoiceModel(target);
    const reason: VoiceModelOption['availabilityReason'] = result.ok
      ? null
      : result.reason === 'model_not_found'
        ? 'voice_model_not_found'
        : result.reason === 'invalid_response'
          ? 'voice_provider_unreachable'
          : 'voice_provider_unreachable';
    this.probeCache.set(key, { expiresAt: Date.now() + PROBE_CACHE_TTL_MS, ok: result.ok, reason });
    return { ok: result.ok, reason };
  }
}

function isQwenProvider(providerId: string, baseUrl: string): boolean {
  const id = providerId.toLowerCase();
  if (id === 'qwen' || id.startsWith('qwen-') || id.includes('qwen')) return true;
  try {
    return new URL(baseUrl).hostname.toLowerCase().endsWith('aliyuncs.com');
  } catch {
    return false;
  }
}
