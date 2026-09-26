import type {
  ApiErrorCode,
  ProjectStage,
  RealtimeServerEvent,
  TutorHintLevel,
  TutorReplyBlock,
  TutorTurnModality,
} from '@qitu/contracts';

/**
 * The intent-candidate payload is NOT exported by `@qitu/contracts` (the source
 * declares an internal `IntentCandidateDraft`). Derive the shape from the frozen
 * event instead of re-declaring it.
 */
export type VoiceIntentCandidate = Extract<
  RealtimeServerEvent,
  { type: 'intent.candidate' }
>['intent'];

export interface VoiceTranscriptMessage {
  key: string;
  turnId: string;
  role: 'student' | 'assistant';
  text: string;
  modality: TutorTurnModality;
  seq: number;
  streaming: boolean;
  blocks?: TutorReplyBlock[];
  hintLevel?: TutorHintLevel | null;
  /** True after `safety.block`; the blocked content is never rendered. */
  blocked?: boolean;
}

export interface VoiceSessionState {
  sessionId: string | null;
  /** Highest server seq applied. In-memory only — never persisted. */
  cursor: number;
  messages: VoiceTranscriptMessage[];
  intent: VoiceIntentCandidate | null;
  safetyBlock: { code: ApiErrorCode; message: string } | null;
  speakingTurnId: string | null;
  escalatedTurnIds: string[];
  lastHintLevel: TutorHintLevel | null;
  lastStage: ProjectStage | null;
}

export function createInitialVoiceState(sessionId: string | null = null): VoiceSessionState {
  return {
    sessionId,
    cursor: 0,
    messages: [],
    intent: null,
    safetyBlock: null,
    speakingTurnId: null,
    escalatedTurnIds: [],
    lastHintLevel: null,
    lastStage: null,
  };
}

function studentKey(turnId: string): string {
  return `student:${turnId}`;
}

function assistantKey(turnId: string): string {
  return `assistant:${turnId}`;
}

function upsertMessage(
  messages: VoiceTranscriptMessage[],
  key: string,
  create: () => VoiceTranscriptMessage,
  patch: (message: VoiceTranscriptMessage) => VoiceTranscriptMessage,
): VoiceTranscriptMessage[] {
  const index = messages.findIndex((message) => message.key === key);
  if (index === -1) return [...messages, create()];
  const next = messages.slice();
  const existing = next[index];
  if (!existing) return messages;
  next[index] = patch(existing);
  return next;
}

function blockText(block: TutorReplyBlock): string {
  switch (block.kind) {
    case 'text':
      return block.text;
    case 'hint':
      return block.text;
    case 'questions':
      return block.items.join(' ');
    case 'options':
      return block.items.map((item) => item.text).join(' ');
    case 'evidence':
      return block.ref;
    default:
      return '';
  }
}

/** Owner of the optimistic student bubble that is shown before `asr.final`/ack. */
export function withOptimisticStudentTurn(
  state: VoiceSessionState,
  input: { turnId: string; text: string; modality: TutorTurnModality; seq?: number },
): VoiceSessionState {
  const { turnId, text, modality, seq = 0 } = input;
  return {
    ...state,
    messages: upsertMessage(
      state.messages,
      studentKey(turnId),
      () => ({
        key: studentKey(turnId),
        turnId,
        role: 'student',
        text,
        modality,
        seq,
        streaming: modality === 'voice',
      }),
      (message) => ({ ...message, text, modality, seq: Math.max(message.seq, seq) }),
    ),
  };
}

/** Reconcile the optimistic turn with the server-assigned seq. */
export function withAcknowledgedSeq(
  state: VoiceSessionState,
  turnId: string,
  seq: number,
): VoiceSessionState {
  return {
    ...state,
    messages: upsertMessage(
      state.messages,
      studentKey(turnId),
      () => ({
        key: studentKey(turnId),
        turnId,
        role: 'student',
        text: '',
        modality: 'text',
        seq,
        streaming: false,
      }),
      (message) => ({ ...message, seq: Math.max(message.seq, seq) }),
    ),
  };
}

function reduceEvent(state: VoiceSessionState, event: RealtimeServerEvent): VoiceSessionState {
  switch (event.type) {
    case 'turn.ack':
      return withAcknowledgedSeq(state, event.turnId, event.seq);

    case 'asr.partial':
      return {
        ...state,
        messages: upsertMessage(
          state.messages,
          studentKey(event.turnId),
          () => ({
            key: studentKey(event.turnId),
            turnId: event.turnId,
            role: 'student',
            text: event.text,
            modality: 'voice',
            seq: event.seq,
            streaming: true,
          }),
          (message) => ({ ...message, text: event.text, streaming: true, seq: event.seq }),
        ),
      };

    case 'asr.final':
      return {
        ...state,
        messages: upsertMessage(
          state.messages,
          studentKey(event.turnId),
          () => ({
            key: studentKey(event.turnId),
            turnId: event.turnId,
            role: 'student',
            text: event.transcript,
            modality: 'voice',
            seq: event.seq,
            streaming: false,
          }),
          (message) => ({
            ...message,
            text: event.transcript,
            streaming: false,
            seq: event.seq,
          }),
        ),
      };

    case 'intent.candidate':
      return { ...state, intent: event.intent };

    case 'tutor.delta':
      return {
        ...state,
        messages: upsertMessage(
          state.messages,
          assistantKey(event.turnId),
          () => ({
            key: assistantKey(event.turnId),
            turnId: event.turnId,
            role: 'assistant',
            text: event.text,
            modality: 'voice',
            seq: event.seq,
            streaming: true,
          }),
          (message) => ({
            ...message,
            text: `${message.text}${event.text}`,
            streaming: true,
            seq: event.seq,
          }),
        ),
      };

    case 'tutor.block':
      return {
        ...state,
        messages: upsertMessage(
          state.messages,
          assistantKey(event.turnId),
          () => ({
            key: assistantKey(event.turnId),
            turnId: event.turnId,
            role: 'assistant',
            text: blockText(event.block),
            modality: 'voice',
            seq: event.seq,
            streaming: false,
            blocks: [event.block],
          }),
          (message) => ({
            ...message,
            text: message.text.length > 0 ? message.text : blockText(event.block),
            blocks: [event.block],
            streaming: false,
            seq: event.seq,
          }),
        ),
      };

    case 'tts.audio':
      // NEVER store the audio payload. Only track speaking state for the indicator.
      return { ...state, speakingTurnId: event.isFinal ? null : event.turnId };

    case 'safety.block':
      return {
        ...state,
        safetyBlock: { code: event.code, message: event.message },
        speakingTurnId: null,
        messages: upsertMessage(
          state.messages,
          assistantKey(event.turnId),
          () => ({
            key: assistantKey(event.turnId),
            turnId: event.turnId,
            role: 'assistant',
            text: '',
            modality: 'voice',
            seq: event.seq,
            streaming: false,
            blocked: true,
          }),
          (message) => ({ ...message, text: '', blocks: undefined, streaming: false, blocked: true }),
        ),
      };

    case 'turn.done':
      return {
        ...state,
        speakingTurnId: null,
        lastHintLevel: event.turnSummary.hintLevel,
        lastStage: event.turnSummary.stage,
        messages: upsertMessage(
          state.messages,
          assistantKey(event.turnId),
          () => ({
            key: assistantKey(event.turnId),
            turnId: event.turnId,
            role: 'assistant',
            text: '',
            modality: 'voice',
            seq: event.seq,
            streaming: false,
            hintLevel: event.turnSummary.hintLevel,
          }),
          (message) => ({
            ...message,
            streaming: false,
            hintLevel: event.turnSummary.hintLevel,
            seq: event.seq,
          }),
        ),
      };

    case 'escalation.notice':
      return {
        ...state,
        escalatedTurnIds: state.escalatedTurnIds.includes(event.turnId)
          ? state.escalatedTurnIds
          : [...state.escalatedTurnIds, event.turnId],
      };

    default:
      return state;
  }
}

/**
 * Apply one server event with session-scoped dedupe.
 *
 * `stream.replay` is a control frame: its embedded `events` are applied in seq
 * order through this same reducer, so a reconnect can never duplicate a turn.
 * Any event whose `seq` is at or below the cursor is dropped.
 */
export function applyServerEvent(
  state: VoiceSessionState,
  event: RealtimeServerEvent,
): VoiceSessionState {
  if (event.type === 'stream.replay') {
    let next = state;
    for (const replayed of [...event.events].sort((a, b) => a.seq - b.seq)) {
      next = applyServerEvent(next, replayed);
    }
    const cursor = Math.max(next.cursor, event.seq, event.nextSeq - 1);
    return { ...next, cursor };
  }

  if (event.seq <= state.cursor) return state;

  const next = reduceEvent(state, event);
  return { ...next, cursor: Math.max(next.cursor, event.seq) };
}
