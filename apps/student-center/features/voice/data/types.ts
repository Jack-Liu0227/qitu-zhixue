import type {
  CreateTutorTurnResponse,
  RealtimeClientEvent,
  RealtimeServerEvent,
} from '@qitu/contracts';

/**
 * Transport lifecycle for the voice realtime channel.
 *
 * The only contract the components know about. A WebSocket-backed transport and
 * the in-memory mock both satisfy it, so swapping the data layer does not touch
 * the components.
 */
export type VoiceTransportStatus = 'connecting' | 'open' | 'closed' | 'error';

export interface VoiceTransport {
  /** Send one frozen-contract client event upstream. */
  send(event: RealtimeClientEvent): void;
  close(): void;
  /** Subscribe to server events. Returns an unsubscribe function. */
  onEvent(handler: (event: RealtimeServerEvent) => void): () => void;
  /** Subscribe to lifecycle changes. Returns an unsubscribe function. */
  onStatus(handler: (status: VoiceTransportStatus) => void): () => void;
}

export interface VoiceSessionRequest {
  /** Resume an existing session; omit to create a fresh one. */
  sessionId?: string;
  /**
   * In-memory streaming cursor. The server replays every event with
   * `seq > afterSeq`. NEVER persisted (see minor-safety rule).
   */
  afterSeq: number;
}

export interface VoiceSessionBootstrap {
  sessionId: string;
  /** Highest seq the server has journaled at connect time. */
  lastSeq: number;
  transport: VoiceTransport;
}

export interface VoiceTextTurnRequest {
  sessionId: string;
  turnId: string;
  text: string;
  idempotencyKey: string;
}

/** Mirrors `POST /tutor/sessions/:id/turns` (or the exploration equivalent). */
export type VoiceTextTurnAccepted = CreateTutorTurnResponse;

export type VoiceSessionErrorCode =
  | 'SESSION_NOT_FOUND'
  | 'PERMISSION_DENIED'
  | 'RATE_LIMITED'
  | 'MINOR_VOICE_CONSENT_REQUIRED'
  | 'NETWORK';

export class VoiceSessionError extends Error {
  readonly code: VoiceSessionErrorCode;

  constructor(code: VoiceSessionErrorCode, message: string) {
    super(message);
    this.name = 'VoiceSessionError';
    this.code = code;
  }
}

/**
 * The single swappable data source for the voice feature.
 *
 * Wave 4 repoints `voiceDataSource` at the real API without touching any
 * component: components only ever call these two methods.
 */
export interface VoiceDataSource {
  /**
   * Open or resume a realtime voice session. Resolves with a transport the
   * session hook drives. `afterSeq` drives `subscribe` replay.
   */
  openSession(request: VoiceSessionRequest): Promise<VoiceSessionBootstrap>;
  /**
   * Text fallback used when the realtime channel is unavailable. Maps to the
   * REST turn endpoint so the degraded path is a real, usable path.
   */
  submitTextTurn(request: VoiceTextTurnRequest): Promise<VoiceTextTurnAccepted>;
}
