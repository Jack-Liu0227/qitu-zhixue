import type { ProjectStage } from './project.js';
import type { TutorHintLevel, TutorReplyBlock, TutorTurnModality } from './tutor.js';
import type { ApiErrorCode } from './errors.js';

export type RealtimeClientType =
  | 'subscribe'
  | 'ping'
  | 'turn.start'
  | 'audio.chunk'
  | 'audio.end'
  | 'turn.cancel'
  | 'stall.signal';

export type RealtimeServerType =
  | 'stream.replay'
  | 'turn.ack'
  | 'asr.partial'
  | 'asr.final'
  | 'intent.candidate'
  | 'tutor.delta'
  | 'tutor.block'
  | 'tutor.tool_call'
  | 'tutor.tool_result'
  | 'tts.audio'
  | 'safety.block'
  | 'turn.done'
  | 'escalation.notice';

export type RealtimeMessageType = RealtimeClientType | RealtimeServerType;

export type AudioCodec = 'opus' | 'webm';

/**
 * Common WebSocket envelope fields.
 *
 * `seq` is a session-scoped monotonic sequence number. For server-emitted
 * events it is assigned by the journal at write time; for client-emitted
 * events it is 0, except `audio.chunk`, where it carries the client's
 * per-turn chunk ordering sequence.
 */
export interface RealtimeEnvelopeBase {
  type: RealtimeMessageType;
  sessionId: string;
  turnId: string;
  seq: number;
  timestamp: string;
}

/**
 * Provisional intent-candidate payload for the free-exploration live session.
 * The inspiration data-shape module owns the authoritative `IntentDraft`
 * projection; this inline shape is intentionally unnamed to avoid clashing
 * with that module's exports.
 */
interface IntentCandidateDraft {
  /** 目标用户 */
  targetUser: string;
  /** 核心兴趣 */
  coreInterest: string;
  /** 偏好形式 */
  preferredForm: string;
}

export interface TurnDoneSummary {
  hintLevel: TutorHintLevel | null;
  stage: ProjectStage;
}

export type RealtimeClientEvent =
  | (RealtimeEnvelopeBase & { type: 'subscribe'; afterSeq: number })
  | (RealtimeEnvelopeBase & { type: 'ping' })
  | (RealtimeEnvelopeBase & {
      type: 'turn.start';
      modality: TutorTurnModality;
      text?: string;
      idempotencyKey: string;
    })
  | (RealtimeEnvelopeBase & {
      type: 'audio.chunk';
      dataBase64: string;
      codec: AudioCodec;
      isFinal: false;
    })
  | (RealtimeEnvelopeBase & {
      type: 'audio.end';
      durationMs: number;
      voiceActivityMs: number;
    })
  | (RealtimeEnvelopeBase & { type: 'turn.cancel'; reason: 'interrupt' | 'user' })
  | (RealtimeEnvelopeBase & {
      type: 'stall.signal';
      modality: 'voice';
      idempotencyKey: string;
    });

export type RealtimeServerEvent =
  | (RealtimeEnvelopeBase & {
      type: 'stream.replay';
      /** Replayed events with `seq > afterSeq`. */
      events: RealtimeServerEvent[];
      nextSeq: number;
      /** Whether the client's `afterSeq` cursor is still valid. */
      cursorValid: boolean;
    })
  | (RealtimeEnvelopeBase & { type: 'turn.ack' })
  | (RealtimeEnvelopeBase & { type: 'asr.partial'; text: string })
  | (RealtimeEnvelopeBase & { type: 'asr.final'; transcript: string })
  | (RealtimeEnvelopeBase & { type: 'intent.candidate'; intent: IntentCandidateDraft })
  | (RealtimeEnvelopeBase & { type: 'tutor.delta'; text: string })
  | (RealtimeEnvelopeBase & { type: 'tutor.block'; block: TutorReplyBlock })
  /**
   * 一次工具调用开始。`label` 是面向学生的动作描述（例如「读取你的项目进度」）。
   * 与 `tutor.delta` 一样按 `seq` 单调递增，重连后由 `stream.replay` 补齐。
   */
  | (RealtimeEnvelopeBase & {
      type: 'tutor.tool_call';
      callId: string;
      name: string;
      label: string;
    })
  /** 一次工具调用结束；`result` 为面向学生的简短结论。 */
  | (RealtimeEnvelopeBase & {
      type: 'tutor.tool_result';
      callId: string;
      status: 'done' | 'error';
      result?: string;
    })
  | (RealtimeEnvelopeBase & {
      type: 'tts.audio';
      dataBase64: string;
      codec: AudioCodec;
      isFinal: boolean;
    })
  | (RealtimeEnvelopeBase & {
      type: 'safety.block';
      code: ApiErrorCode;
      message: string;
    })
  | (RealtimeEnvelopeBase & { type: 'turn.done'; turnSummary: TurnDoneSummary })
  | (RealtimeEnvelopeBase & { type: 'escalation.notice'; escalationId: string });

export type RealtimeEvent = RealtimeClientEvent | RealtimeServerEvent;
