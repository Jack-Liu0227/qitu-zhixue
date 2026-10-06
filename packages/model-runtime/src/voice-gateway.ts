import type {
  VoiceGateway,
  VoiceGatewayCapabilities,
  VoiceSynthesisEvent,
  VoiceSynthesisRequest,
  VoiceTranscriptionRequest,
  VoiceTranscriptionResult,
} from '@qitu/contracts';

const MAX_AUDIO_BASE64_LENGTH = 16 * 1024 * 1024;
const BASE64_RE = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u;

/** Provider adapter implemented by Qwen or another server-side voice backend. */
export interface VoiceGatewayProvider {
  capabilities(): Promise<VoiceGatewayCapabilities>;
  transcribe(input: VoiceTranscriptionRequest): Promise<VoiceTranscriptionResult>;
  synthesize(input: VoiceSynthesisRequest): AsyncGenerator<VoiceSynthesisEvent>;
}

/**
 * Keep voice model selection separate from text ModelRuntime. The adapter does
 * not carry credentials and validates request shape before it reaches a
 * provider-specific implementation.
 */
export function createVoiceGateway(provider: VoiceGatewayProvider): VoiceGateway {
  if (!provider?.capabilities || !provider.transcribe || !provider.synthesize) {
    throw new Error('VOICE_GATEWAY_PROVIDER_NOT_CONFIGURED');
  }

  return Object.freeze({
    capabilities: () => provider.capabilities(),
    transcribe: async (input: VoiceTranscriptionRequest) => {
      assertTranscriptionRequest(input);
      return provider.transcribe(input);
    },
    synthesize: (input: VoiceSynthesisRequest) => {
      assertSynthesisRequest(input);
      return provider.synthesize(input);
    },
  });
}

function assertTranscriptionRequest(input: VoiceTranscriptionRequest): void {
  if (!input?.requestId?.trim() || !input.idempotencyKey?.trim())
    throw new Error('VOICE_REQUEST_INVALID');
  if (!input.model?.providerId?.trim() || !input.model.modelId?.trim())
    throw new Error('VOICE_MODEL_REQUIRED');
  if (!input.audio?.dataBase64?.trim() || !input.audio.codec || !input.audio.mimeType) {
    throw new Error('VOICE_AUDIO_REQUIRED');
  }
  const data = input.audio.dataBase64.trim();
  if (data.length > MAX_AUDIO_BASE64_LENGTH || !BASE64_RE.test(data)) {
    throw new Error('VOICE_AUDIO_INVALID');
  }
}

function assertSynthesisRequest(input: VoiceSynthesisRequest): void {
  if (!input?.requestId?.trim() || !input.idempotencyKey?.trim())
    throw new Error('VOICE_REQUEST_INVALID');
  if (!input.model?.providerId?.trim() || !input.model.modelId?.trim())
    throw new Error('VOICE_MODEL_REQUIRED');
  if (!input.text?.trim() || input.text.length > 100_000) throw new Error('VOICE_TEXT_INVALID');
  if (!input.format) throw new Error('VOICE_FORMAT_REQUIRED');
}

export type {
  VoiceGateway,
  VoiceGatewayCapabilities,
  VoiceSynthesisEvent,
  VoiceSynthesisRequest,
  VoiceTranscriptionRequest,
  VoiceTranscriptionResult,
};
