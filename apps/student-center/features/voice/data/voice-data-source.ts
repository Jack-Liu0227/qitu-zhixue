import {
  createMockTransport,
  createMockVoiceSession,
  publishMockTextTurn,
  type MockVoiceSession,
} from './mock-transport';
import {
  VoiceSessionError,
  type VoiceDataSource,
  type VoiceSessionBootstrap,
  type VoiceSessionRequest,
  type VoiceTextTurnAccepted,
  type VoiceTextTurnRequest,
} from './types';

/**
 * In-memory session registry for the mock data source. It exists only so a
 * reconnect can resume the same journal; it is never serialized or persisted.
 */
const sessions = new Map<string, MockVoiceSession>();
let sessionCounter = 0;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function openSession(request: VoiceSessionRequest): Promise<VoiceSessionBootstrap> {
  await delay(120);
  if (request.sessionId?.startsWith('forbidden')) {
    throw new VoiceSessionError('PERMISSION_DENIED', '没有访问该语音会话的权限');
  }
  if (request.sessionId?.startsWith('consent')) {
    throw new VoiceSessionError(
      'MINOR_VOICE_CONSENT_REQUIRED',
      '需要监护人同意后才能使用语音',
    );
  }
  const sessionId = request.sessionId ?? `voice-session-${(sessionCounter += 1)}`;
  let session = sessions.get(sessionId);
  if (!session) {
    session = createMockVoiceSession(sessionId);
    sessions.set(sessionId, session);
  }
  return {
    sessionId,
    lastSeq: session.seq,
    transport: createMockTransport(session),
  };
}

async function submitTextTurn(request: VoiceTextTurnRequest): Promise<VoiceTextTurnAccepted> {
  await delay(60);
  const session = sessions.get(request.sessionId);
  if (!session) {
    throw new VoiceSessionError('SESSION_NOT_FOUND', '会话不存在');
  }
  // Real usable fallback: the turn is journaled so a later subscribe replays the
  // assistant reply, and it is idempotent on (sessionId, turnId).
  publishMockTextTurn(session, request.turnId, request.text);
  return { turnId: request.turnId, seq: session.seq, accepted: true };
}

/** The single swappable voice data source. Wave 4 repoints this at the API. */
export const voiceDataSource: VoiceDataSource = {
  openSession,
  submitTextTurn,
};

/** Test/preview seam: reset the in-memory mock registry. */
export function resetVoiceDataSourceMock(): void {
  sessions.clear();
  sessionCounter = 0;
}
