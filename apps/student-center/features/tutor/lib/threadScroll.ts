export interface ThreadScrollState {
  sessionId: string | null;
  turnId?: string;
  following: boolean;
}

interface ScrollUpdate {
  sessionId: string | null;
  ready: boolean;
  openingOnly: boolean;
  turn?: { turnId: string; role: 'assistant' | 'student' };
}

export function nextThreadScroll(previous: ThreadScrollState, update: ScrollUpdate): {
  state: ThreadScrollState;
  target: { kind: 'opening' } | { kind: 'turn'; turnId: string } | null;
} {
  const current = previous.sessionId === update.sessionId
    ? previous : { sessionId: update.sessionId, following: true };
  if (!update.ready) return { state: current, target: null };
  if (!update.turn) return { state: current, target: null };
  if (current.turnId === update.turn.turnId) return { state: current, target: null };

  const reveal = current.turnId === undefined || update.turn.role === 'student' || current.following;
  const state = { sessionId: update.sessionId, turnId: update.turn.turnId,
    following: update.turn.role === 'student' || current.following };
  return { state, target: !reveal ? null : update.openingOnly
    ? { kind: 'opening' } : { kind: 'turn', turnId: update.turn.turnId } };
}
