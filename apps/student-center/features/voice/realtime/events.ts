import type { AudioCodec, RealtimeClientEvent, TutorTurnModality } from '@qitu/contracts';

/**
 * Typed builders for every client -> server realtime envelope.
 *
 * These construct real `@qitu/contracts` `RealtimeClientEvent` values: the
 * envelope (`sessionId` / `turnId` / `seq` / `timestamp`) plus the payload
 * fields frozen in `packages/contracts/src/realtime.ts`.
 */

function nowIso(): string {
  return new Date().toISOString();
}

export function buildSubscribe(sessionId: string, afterSeq: number): RealtimeClientEvent {
  return {
    type: 'subscribe',
    sessionId,
    turnId: '',
    seq: 0,
    timestamp: nowIso(),
    afterSeq,
  };
}

export function buildPing(sessionId: string): RealtimeClientEvent {
  return { type: 'ping', sessionId, turnId: '', seq: 0, timestamp: nowIso() };
}

export interface TurnStartParams {
  sessionId: string;
  turnId: string;
  modality: TutorTurnModality;
  /** Present for text turns, omitted for voice turns. */
  text?: string;
  idempotencyKey: string;
}

export function buildTurnStart(params: TurnStartParams): RealtimeClientEvent {
  const { sessionId, turnId, modality, text, idempotencyKey } = params;
  if (modality === 'voice') {
    return {
      type: 'turn.start',
      sessionId,
      turnId,
      seq: 0,
      timestamp: nowIso(),
      modality,
      idempotencyKey,
    };
  }
  return {
    type: 'turn.start',
    sessionId,
    turnId,
    seq: 0,
    timestamp: nowIso(),
    modality,
    text: text ?? '',
    idempotencyKey,
  };
}

export interface AudioChunkParams {
  sessionId: string;
  turnId: string;
  /** Client-side per-turn chunk ordering sequence. */
  seq: number;
  dataBase64: string;
  codec: AudioCodec;
}

export function buildAudioChunk(params: AudioChunkParams): RealtimeClientEvent {
  return {
    type: 'audio.chunk',
    sessionId: params.sessionId,
    turnId: params.turnId,
    seq: params.seq,
    timestamp: nowIso(),
    dataBase64: params.dataBase64,
    codec: params.codec,
    isFinal: false,
  };
}

export interface AudioEndParams {
  sessionId: string;
  turnId: string;
  durationMs: number;
  voiceActivityMs: number;
}

export function buildAudioEnd(params: AudioEndParams): RealtimeClientEvent {
  return {
    type: 'audio.end',
    sessionId: params.sessionId,
    turnId: params.turnId,
    seq: 0,
    timestamp: nowIso(),
    durationMs: params.durationMs,
    voiceActivityMs: params.voiceActivityMs,
  };
}

export interface TurnCancelParams {
  sessionId: string;
  turnId: string;
  reason: 'interrupt' | 'user';
}

export function buildTurnCancel(params: TurnCancelParams): RealtimeClientEvent {
  return {
    type: 'turn.cancel',
    sessionId: params.sessionId,
    turnId: params.turnId,
    seq: 0,
    timestamp: nowIso(),
    reason: params.reason,
  };
}

export interface StallSignalParams {
  sessionId: string;
  turnId: string;
  idempotencyKey: string;
}

export function buildStallSignal(params: StallSignalParams): RealtimeClientEvent {
  return {
    type: 'stall.signal',
    sessionId: params.sessionId,
    turnId: params.turnId,
    seq: 0,
    timestamp: nowIso(),
    modality: 'voice',
    idempotencyKey: params.idempotencyKey,
  };
}
