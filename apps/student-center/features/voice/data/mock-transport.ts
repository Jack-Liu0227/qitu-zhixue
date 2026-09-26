import type { RealtimeClientEvent, RealtimeServerEvent } from '@qitu/contracts';
import type { VoiceTransport, VoiceTransportStatus } from './types';

/** Opaque in-memory session journal. Never persisted, never written to disk. */
export interface MockVoiceSession {
  sessionId: string;
  seq: number;
  journal: RealtimeServerEvent[];
  cancelledTurns: Set<string>;
  subscribers: Set<(event: RealtimeServerEvent) => void>;
  statusSubscribers: Set<(status: VoiceTransportStatus) => void>;
}

export function createMockVoiceSession(sessionId: string): MockVoiceSession {
  return {
    sessionId,
    seq: 0,
    journal: [],
    cancelledTurns: new Set(),
    subscribers: new Set(),
    statusSubscribers: new Set(),
  };
}

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
type ServerPayload = DistributiveOmit<RealtimeServerEvent, 'seq' | 'timestamp'>;

/**
 * Mock-only safety trigger. Never echoed back to the UI — `safety.block` carries
 * the server-authored, child-appropriate message.
 */
const MOCK_SAFETY_TRIGGER = '不安全内容';

function deliver(session: MockVoiceSession, payload: ServerPayload): void {
  const event = {
    ...payload,
    seq: session.seq,
    timestamp: new Date().toISOString(),
  } as RealtimeServerEvent;
  for (const subscriber of session.subscribers) subscriber(event);
}

function push(session: MockVoiceSession, payload: ServerPayload): RealtimeServerEvent {
  session.seq += 1;
  const event = {
    ...payload,
    seq: session.seq,
    timestamp: new Date().toISOString(),
  } as RealtimeServerEvent;
  session.journal.push(event);
  for (const subscriber of session.subscribers) subscriber(event);
  return event;
}

function runPipeline(session: MockVoiceSession, turnId: string, spokenText: string): void {
  if (session.cancelledTurns.has(turnId)) return;

  const transcript = spokenText.trim().length > 0 ? spokenText : '我想做一个校园植物观察的小项目';
  const isVoice = spokenText.trim().length === 0;
  if (isVoice) {
    push(session, {
      type: 'asr.partial',
      sessionId: session.sessionId,
      turnId,
      text: transcript.slice(0, 6),
    });
    push(session, {
      type: 'asr.final',
      sessionId: session.sessionId,
      turnId,
      transcript,
    });
    push(session, {
      type: 'intent.candidate',
      sessionId: session.sessionId,
      turnId,
      intent: {
        targetUser: '同学',
        coreInterest: '校园植物',
        preferredForm: '观察记录',
      },
    });
  }

  if (transcript.includes(MOCK_SAFETY_TRIGGER)) {
    push(session, {
      type: 'safety.block',
      sessionId: session.sessionId,
      turnId,
      code: 'AI_SAFETY_BLOCK',
      message: '这个话题我们换一个方向好吗？我更想听听你自己的想法。',
    });
    push(session, {
      type: 'turn.done',
      sessionId: session.sessionId,
      turnId,
      turnSummary: { hintLevel: null, stage: 'exploration' },
    });
    return;
  }

  const reply = '这是个很棒的想法！你希望谁来用它，又想解决什么问题呢？';
  const first = reply.slice(0, 8);
  const rest = reply.slice(8);
  push(session, { type: 'tutor.delta', sessionId: session.sessionId, turnId, text: first });
  push(session, { type: 'tutor.delta', sessionId: session.sessionId, turnId, text: rest });
  push(session, {
    type: 'tutor.block',
    sessionId: session.sessionId,
    turnId,
    block: {
      kind: 'questions',
      items: ['你希望它帮助谁？', '你打算记录哪些信息？'],
    },
  });
  push(session, {
    type: 'tts.audio',
    sessionId: session.sessionId,
    turnId,
    dataBase64: '',
    codec: 'opus',
    isFinal: true,
  });
  push(session, {
    type: 'turn.done',
    sessionId: session.sessionId,
    turnId,
    turnSummary: { hintLevel: 1, stage: 'exploration' },
  });
}

/**
 * Text-fallback path: used by the REST fallback when the socket is down. Events
 * land in the journal and reach any live transport, otherwise they are replayed
 * on the next `subscribe(afterSeq)`.
 */
export function publishMockTextTurn(
  session: MockVoiceSession,
  turnId: string,
  text: string,
): void {
  runPipeline(session, turnId, text);
}

export function createMockTransport(session: MockVoiceSession): VoiceTransport {
  let closed = false;
  let status: VoiceTransportStatus = 'connecting';

  const setStatus = (next: VoiceTransportStatus): void => {
    status = next;
    for (const subscriber of session.statusSubscribers) subscriber(next);
  };

  const handlers = new Set<(event: RealtimeServerEvent) => void>();
  const dispatch = (event: RealtimeServerEvent): void => {
    for (const handler of handlers) handler(event);
  };

  queueMicrotask(() => {
    if (!closed) {
      session.subscribers.add(dispatch);
      setStatus('open');
    }
  });

  return {
    send(event: RealtimeClientEvent): void {
      if (closed) return;
      switch (event.type) {
        case 'subscribe': {
          const replayed = session.journal.filter((entry) => entry.seq > event.afterSeq);
          deliver(session, {
            type: 'stream.replay',
            sessionId: session.sessionId,
            turnId: '',
            events: replayed,
            nextSeq: session.seq + 1,
            cursorValid: true,
          });
          break;
        }
        case 'ping':
          break;
        case 'turn.start':
          push(session, {
            type: 'turn.ack',
            sessionId: session.sessionId,
            turnId: event.turnId,
          });
          if (event.modality === 'text' && (event.text ?? '').trim().length > 0) {
            runPipeline(session, event.turnId, event.text ?? '');
          }
          break;
        case 'audio.chunk':
          break;
        case 'audio.end':
          runPipeline(session, event.turnId, '');
          break;
        case 'turn.cancel':
          session.cancelledTurns.add(event.turnId);
          break;
        case 'stall.signal':
          push(session, {
            type: 'escalation.notice',
            sessionId: session.sessionId,
            turnId: event.turnId,
            escalationId: `esc_${event.turnId}`,
          });
          break;
        default:
          break;
      }
    },
    close(): void {
      if (closed) return;
      closed = true;
      session.subscribers.delete(dispatch);
      handlers.clear();
      setStatus('closed');
    },
    onEvent(handler) {
      handlers.add(handler);
      return () => {
        handlers.delete(handler);
      };
    },
    onStatus(handler) {
      session.statusSubscribers.add(handler);
      handler(status);
      return () => {
        session.statusSubscribers.delete(handler);
      };
    },
  };
}
