import type { ProviderCredentialSummary } from './provider-manifest.js';

/** Server-side voice gateway contract. Audio payloads are transport-neutral. */
export const VOICE_GATEWAY_VERSION = 'qitu.voice-gateway.v1' as const;

export type VoiceCodec = 'pcm_s16le' | 'opus' | 'webm' | 'wav' | 'mp3' | (string & {});
export type VoiceGatewayOperation = 'transcribe' | 'synthesize' | 'realtime';

export interface VoiceAudioInput {
  codec: VoiceCodec;
  mimeType: string;
  sampleRateHz: number | null;
  channels: number | null;
  durationMs: number | null;
  /** Base64 is used at JSON boundaries; binary adapters may replace this. */
  dataBase64: string;
}

export interface VoiceModelSelection {
  providerId: string;
  modelId: string;
}

export interface VoiceModelDescriptor {
  providerId: string;
  modelId: string;
  label: string;
  operations: readonly VoiceGatewayOperation[];
  languages: readonly string[];
  codecs: readonly VoiceCodec[];
  available: boolean;
  credential: Pick<ProviderCredentialSummary, 'configured' | 'keyFingerprint'>;
}

export interface VoiceGatewayCapabilities {
  generatedAt: string;
  defaultModel: VoiceModelSelection | null;
  models: readonly VoiceModelDescriptor[];
}

export interface VoiceTranscriptionRequest {
  requestId: string;
  idempotencyKey: string;
  model: VoiceModelSelection;
  audio: VoiceAudioInput;
  language: string | null;
  signal?: AbortSignal;
}

export interface VoiceTranscriptionResult {
  requestId: string;
  transcript: string;
  language: string | null;
  durationMs: number | null;
  model: VoiceModelSelection;
}

export interface VoiceSynthesisRequest {
  requestId: string;
  idempotencyKey: string;
  model: VoiceModelSelection;
  text: string;
  language: string | null;
  voice: string | null;
  format: VoiceCodec;
  signal?: AbortSignal;
}

export interface VoiceAudioChunk {
  requestId: string;
  sequence: number;
  dataBase64: string;
  codec: VoiceCodec;
  isFinal: boolean;
}

export type VoiceSynthesisEvent =
  | { type: 'audio'; chunk: VoiceAudioChunk }
  | { type: 'done'; requestId: string; model: VoiceModelSelection }
  | { type: 'error'; code: string; message: string; retryable: boolean };

export interface VoiceGateway {
  capabilities(): Promise<VoiceGatewayCapabilities>;
  transcribe(input: VoiceTranscriptionRequest): Promise<VoiceTranscriptionResult>;
  synthesize(input: VoiceSynthesisRequest): AsyncGenerator<VoiceSynthesisEvent>;
}

export interface VoiceGatewayError extends Error {
  code: string;
  retryable: boolean;
}
