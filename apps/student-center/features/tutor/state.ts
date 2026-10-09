import type {
  RealtimeServerEvent,
  TutorReplyBlock,
  TutorToolCall,
  TutorTurn,
} from '@qitu/contracts';

/**
 * Runtime guard for the closed `TutorReplyBlock` union.
 *
 * The type system already narrows every server reply, but a compromised or
 * buggy transport could send an unmodelled shape. We re-validate at the
 * boundary so an unknown block renders a safe fallback instead of leaking raw
 * text. See `TutorReplyBlockView` for why raw markdown is banned.
 */
export function isTutorReplyBlock(value: unknown): value is TutorReplyBlock {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as { kind?: unknown };
  switch (candidate.kind) {
    case 'text':
      return typeof (value as { text?: unknown }).text === 'string';
    case 'questions':
      return isStringArray((value as { items?: unknown }).items);
    case 'options': {
      const options = value as { items?: unknown; allowOther?: unknown };
      return Array.isArray(options.items) && typeof options.allowOther === 'boolean';
    }
    case 'hint': {
      const hint = value as { level?: unknown; text?: unknown };
      return typeof hint.level === 'number' && typeof hint.text === 'string';
    }
    case 'evidence':
      return typeof (value as { ref?: unknown }).ref === 'string';
    case 'tool':
      return isTutorToolCall((value as { call?: unknown }).call);
    case 'think': {
      const think = value as { content?: unknown; closed?: unknown };
      return typeof think.content === 'string' && typeof think.closed === 'boolean';
    }
    case 'pbl_card': {
      const card = value as { title?: unknown; summary?: unknown };
      return typeof card.title === 'string' && typeof card.summary === 'string';
    }
    default:
      return false;
  }
}

/** Runtime guard for `TutorToolCall` (also used by the stream parser). */
export function isTutorToolCall(value: unknown): value is TutorToolCall {
  if (typeof value !== 'object' || value === null) return false;
  const call = value as {
    callId?: unknown;
    name?: unknown;
    label?: unknown;
    status?: unknown;
    result?: unknown;
  };
  if (typeof call.callId !== 'string' || call.callId.length === 0) return false;
  if (typeof call.name !== 'string' || typeof call.label !== 'string') return false;
  if (call.status !== 'running' && call.status !== 'done' && call.status !== 'error') return false;
  return call.result === undefined || typeof call.result === 'string';
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

/** Sort turns by their server sequence so replay never reorders a thread. */
export function sortTurnsBySeq(turns: readonly TutorTurn[]): TutorTurn[] {
  return [...turns].sort((a, b) => a.seq - b.seq);
}

/**
 * Local echo of the student's own message.
 *
 * The SSE stream carries only the assistant's half of a turn, so without this
 * the student's own sentence would not appear until the reply finished. The
 * echo is built exclusively from the student's own input — no server-owned
 * field (hint level, stage, tool result) is ever invented here.
 *
 * FRACTIONAL SEQ: the echo takes `baseline + 0.5`. `CreateTutorTurnResponse.seq`
 * is the journal baseline, and the first streamed event is `baseline + 1`, so a
 * half step places the echo after the whole history and before the reply
 * without ever tying with a real event. It is dropped and replaced by the
 * server's own turn the next time the session is loaded from the API.
 */
export function createStudentEchoTurn(input: {
  turnId: string;
  /** Journal baseline from `CreateTutorTurnResponse.seq`. */
  baselineSeq: number;
  text: string;
  createdAt?: string;
}): TutorTurn {
  return {
    turnId: input.turnId,
    role: 'student',
    blocks: input.text.length > 0 ? [{ kind: 'text', text: input.text }] : [],
    hintLevel: null,
    stageBefore: null,
    stageAfter: null,
    seq: input.baselineSeq + 0.5,
    createdAt: input.createdAt ?? new Date().toISOString(),
    modality: 'text',
  };
}

/** Remove one locally-created turn (used when the stream settles or retries). */
export function dropTurn(turns: readonly TutorTurn[], turnId: string): TutorTurn[] {
  return turns.filter((turn) => turn.turnId !== turnId);
}

/**
 * A monotonic replay cursor: drop anything at or below the last applied seq so
 * a reconnect + `subscribe.afterSeq` replay cannot duplicate a turn.
 */
export function isDuplicateSeq(seq: number, lastAppliedSeq: number): boolean {
  return seq <= lastAppliedSeq;
}

/**
 * Fold one server event into the rendered turn list.
 *
 * Streaming assembly is intentionally small: `tutor.delta` grows the in-flight
 * text block, `tutor.tool_call` / `tutor.tool_result` maintain the visible tool
 * timeline, `tutor.block` appends a finished block, and `turn.done` finalises
 * the ladder level and stage. The server remains the owner of all of these
 * values — nothing here invents a hint level, a stage or a tool result.
 */
export function applyServerEventToTurns(
  turns: readonly TutorTurn[],
  event: RealtimeServerEvent,
): TutorTurn[] {
  switch (event.type) {
    case 'tutor.delta':
      return sortTurnsBySeq(appendDelta(turns, event));
    case 'tutor.tool_call':
      return sortTurnsBySeq(appendToolCall(turns, event));
    case 'tutor.tool_result':
      return sortTurnsBySeq(resolveToolCall(turns, event));
    case 'tutor.block':
      return sortTurnsBySeq(upsertBlock(turns, event));
    case 'turn.done':
      return sortTurnsBySeq(finalizeTurn(turns, event));
    default:
      return [...turns];
  }
}

type BlockEvent = Extract<RealtimeServerEvent, { type: 'tutor.block' }>;
type DoneEvent = Extract<RealtimeServerEvent, { type: 'turn.done' }>;
type DeltaEvent = Extract<RealtimeServerEvent, { type: 'tutor.delta' }>;
type ToolCallEvent = Extract<RealtimeServerEvent, { type: 'tutor.tool_call' }>;
type ToolResultEvent = Extract<RealtimeServerEvent, { type: 'tutor.tool_result' }>;

/** Fields every server event carries; enough to mint the turn on first touch. */
interface TurnAnchor {
  turnId: string;
  seq: number;
  timestamp: string;
}

/**
 * Immutably update (or create) the assistant turn identified by `turnId`.
 * `seq` is written from the event so the final ordering follows the journal.
 */
function withAssistantTurn(
  turns: readonly TutorTurn[],
  anchor: TurnAnchor,
  mutate: (turn: TutorTurn) => TutorTurn,
): TutorTurn[] {
  const index = turns.findIndex((turn) => turn.turnId === anchor.turnId);
  if (index === -1) {
    return [...turns, mutate(emptyAssistantTurn(anchor))];
  }
  const existing = turns[index];
  if (existing === undefined) return [...turns];
  const next = [...turns];
  next[index] = mutate(existing);
  return next;
}

function emptyAssistantTurn(anchor: TurnAnchor): TutorTurn {
  return {
    turnId: anchor.turnId,
    role: 'assistant',
    blocks: [],
    hintLevel: null,
    stageBefore: null,
    stageAfter: null,
    seq: anchor.seq,
    createdAt: anchor.timestamp,
    modality: 'text',
  };
}

/**
 * Grow the trailing text block.
 *
 * Deltas arrive as many small fragments; concatenating them into the last
 * `text` block is what makes the reply appear to be written live instead of
 * popping in as N separate paragraphs.
 */
function appendDelta(turns: readonly TutorTurn[], event: DeltaEvent): TutorTurn[] {
  if (event.text.length === 0) return [...turns];
  return withAssistantTurn(turns, event, (turn) => ({
    ...turn,
    blocks: appendTextFragment(turn.blocks, event.text),
    seq: event.seq,
  }));
}

function appendTextFragment(
  blocks: readonly TutorReplyBlock[],
  fragment: string,
): TutorReplyBlock[] {
  const last = blocks[blocks.length - 1];
  if (last !== undefined && last.kind === 'text') {
    return [...blocks.slice(0, -1), { kind: 'text', text: last.text + fragment }];
  }
  return [...blocks, { kind: 'text', text: fragment }];
}

/** Append a tool step in `running` state; the result arrives separately. */
function appendToolCall(turns: readonly TutorTurn[], event: ToolCallEvent): TutorTurn[] {
  const call: TutorToolCall = {
    callId: event.callId,
    name: event.name,
    label: event.label,
    status: 'running',
  };
  return withAssistantTurn(turns, event, (turn) => ({
    ...turn,
    blocks: [...turn.blocks, { kind: 'tool', call }],
    seq: event.seq,
  }));
}

/**
 * Settle a tool step.
 *
 * A result without a matching call is DROPPED: after a replay hole the client
 * cannot know which step it belonged to, and inventing a label would put words
 * in the tutor's mouth. The seq-gap check in `TutorRealtimeClient` makes this
 * case rare.
 */
function resolveToolCall(turns: readonly TutorTurn[], event: ToolResultEvent): TutorTurn[] {
  const index = turns.findIndex((turn) => turn.turnId === event.turnId);
  if (index === -1) return [...turns];
  const existing = turns[index];
  if (existing === undefined) return [...turns];
  let matched = false;
  const blocks = existing.blocks.map((block): TutorReplyBlock => {
    if (block.kind !== 'tool' || block.call.callId !== event.callId) return block;
    matched = true;
    return {
      kind: 'tool',
      call: {
        ...block.call,
        status: event.status,
        ...(event.result !== undefined ? { result: event.result } : {}),
      },
    };
  });
  if (!matched) return [...turns];
  const next = [...turns];
  next[index] = { ...existing, blocks, seq: event.seq };
  return next;
}

/** All tool steps of one turn, in the order the server executed them. */
export function collectToolCalls(turn: TutorTurn): TutorToolCall[] {
  const calls: TutorToolCall[] = [];
  for (const block of turn.blocks) {
    if (block.kind === 'tool') calls.push(block.call);
  }
  return calls;
}

/**
 * The label of the tool currently executing in the newest assistant turn, or
 * `null` when nothing is running. Drives the streaming indicator's caption so
 * the student sees WHICH step the AI is on, not just a generic spinner.
 */
export function findRunningToolLabel(turns: readonly TutorTurn[]): string | null {
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    const turn = turns[index];
    if (turn === undefined || turn.role !== 'assistant') continue;
    const calls = collectToolCalls(turn);
    for (let callIndex = calls.length - 1; callIndex >= 0; callIndex -= 1) {
      const call = calls[callIndex];
      if (call !== undefined && call.status === 'running') return call.label;
    }
    return null;
  }
  return null;
}

function upsertBlock(turns: readonly TutorTurn[], event: BlockEvent): TutorTurn[] {
  const block = event.block;
  const index = turns.findIndex((turn) => turn.turnId === event.turnId);
  if (index === -1) {
    const created: TutorTurn = {
      turnId: event.turnId,
      role: 'assistant',
      blocks: [block],
      hintLevel: block.kind === 'hint' ? block.level : null,
      stageBefore: null,
      stageAfter: null,
      seq: event.seq,
      createdAt: event.timestamp,
      modality: 'text',
    };
    return [...turns, created];
  }
  const existing = turns[index];
  if (existing === undefined) return [...turns];
  const updated: TutorTurn = {
    ...existing,
    blocks: [...existing.blocks, block],
    hintLevel: block.kind === 'hint' ? block.level : existing.hintLevel,
    seq: event.seq,
  };
  const next = [...turns];
  next[index] = updated;
  return next;
}

function finalizeTurn(turns: readonly TutorTurn[], event: DoneEvent): TutorTurn[] {
  const index = turns.findIndex((turn) => turn.turnId === event.turnId);
  const summary = event.turnSummary;
  if (index === -1) {
    const created: TutorTurn = {
      turnId: event.turnId,
      role: 'assistant',
      blocks: [],
      hintLevel: summary.hintLevel,
      stageBefore: null,
      stageAfter: summary.stage,
      seq: event.seq,
      createdAt: event.timestamp,
      modality: 'text',
    };
    return [...turns, created];
  }
  const existing = turns[index];
  if (existing === undefined) return [...turns];
  const next = [...turns];
  next[index] = {
    ...existing,
    hintLevel: summary.hintLevel ?? existing.hintLevel,
    stageAfter: summary.stage,
    seq: event.seq,
  };
  return next;
}
