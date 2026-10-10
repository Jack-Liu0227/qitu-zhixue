import type {
  PedagogicMove,
  ProjectStage,
  RealtimeServerEvent,
  TutorHintLevel,
  TutorReplyBlock,
} from '@qitu/contracts';
import { isTutorReplyBlock } from '../state';
import { TutorDataError } from './dataSource';
import {
  TUTOR_TEAM_FRAME_NAME_LIST,
  teamFrameKind,
  teamFrameToReplyBlock,
} from './teamFrames';

/**
 * Transport for `POST /api/v1/tutor/sessions/:id/stream` (Server-Sent Events).
 *
 * WHY SSE AND NOT A WEBSOCKET: the tutor turn is one request/one response —
 * the student asks, the server streams progress and ends. SSE over HTTP gives
 * that shape with the session cookie, nginx proxying (`/api/`), and no second
 * protocol to deploy. The `TutorSocket` seam the components already use is
 * preserved by `LiveTutorSocket`, which pumps these events into the same
 * `RealtimeServerEvent` envelopes the mock produced.
 *
 * The credentials are only ever the httpOnly `qitu_session` cookie; no token
 * is read or stored in JavaScript.
 */
export const TUTOR_STREAM_PATH = (sessionId: string) =>
  `/api/v1/tutor/sessions/${encodeURIComponent(sessionId)}/stream`;

export interface TutorStreamRequest {
  projectId?: string;
  sessionId?: string;
  content?: string;
  pedagogicMove?: PedagogicMove;
  optionLabel?: string;
  idempotencyKey: string;
}

export interface TutorStreamHandlers {
  /** Session the events belong to (stamped onto every envelope). */
  sessionId: string;
  /** Client-side turn id, used when the server omits `turnId`. */
  turnId: string;
  onEvent: (event: RealtimeServerEvent) => void;
  /** Terminal failure: the caller decides whether to fall back or surface it. */
  onFailure: (error: TutorDataError) => void;
  /** Called once the stream ends for any reason. */
  onSettled?: () => void;
}

/**
 * Server-sent frame names this client understands.
 *
 * `TUTOR_TEAM_FRAME_NAME_LIST` 是团队帧常量的唯一出处（data/teamFrames.ts，
 * 与服务端 TEAM_FRAME_NAMES 逐字对齐）；新增帧名只改那一处。
 * 独立验证官 F5：team.* 帧曾被这里白名单外静默丢弃，现已全部收录。
 */
const KNOWN_FRAMES = new Set([
  'tool_call',
  'tool_result',
  'delta',
  'block',
  'done',
  'error',
  'turn.done',
  'tutor.block',
  'tutor.delta',
  'tutor.tool_call',
  'tutor.tool_result',
  ...TUTOR_TEAM_FRAME_NAME_LIST,
]);

/**
 * Open the stream. Returns an abort function; aborting is NOT an error and
 * never calls `onFailure`.
 */
export function openTutorStream(
  request: TutorStreamRequest,
  handlers: TutorStreamHandlers,
): () => void {
  const controller = new AbortController();
  let settled = false;
  const settle = () => {
    if (settled) return;
    settled = true;
    handlers.onSettled?.();
  };

  void (async () => {
    let response: Response;
    try {
      if (request.sessionId === undefined || request.sessionId.length === 0) {
        handlers.onFailure(new TutorDataError('会话尚未建立，请稍后重试。', undefined, 'SESSION_NOT_FOUND'));
        settle();
        return;
      }
      response = await fetch(TUTOR_STREAM_PATH(request.sessionId), {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'text/event-stream' },
        body: JSON.stringify(request),
        credentials: 'same-origin',
        signal: controller.signal,
      });
    } catch (error) {
      if (controller.signal.aborted) {
        settle();
        return;
      }
      handlers.onFailure(toTransportError(error));
      settle();
      return;
    }

    if (!response.ok) {
      handlers.onFailure(await toHttpError(response));
      settle();
      return;
    }
    if (response.body === null) {
      handlers.onFailure(new TutorDataError('服务端没有返回数据流', undefined, 'STREAM_EMPTY'));
      settle();
      return;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        buffer = drainFrames(buffer, handlers);
      }
      // A stream may end without a trailing blank line.
      const tail = drainFrames(`${buffer}\n\n`, handlers);
      buffer = tail;
    } catch (error) {
      if (!controller.signal.aborted) handlers.onFailure(toTransportError(error));
    } finally {
      reader.releaseLock?.();
      settle();
    }
  })();

  return () => controller.abort();
}

/** Split complete `\n\n`-delimited frames out of `buffer`, returning the rest. */
function drainFrames(buffer: string, handlers: TutorStreamHandlers): string {
  let rest = buffer;
  for (;;) {
    const boundary = findFrameBoundary(rest);
    if (boundary === -1) return rest;
    const rawFrame = rest.slice(0, boundary.index);
    rest = rest.slice(boundary.index + boundary.length);
    dispatchFrame(rawFrame, handlers);
  }
}

function findFrameBoundary(value: string): { index: number; length: number } | -1 {
  const lf = value.indexOf('\n\n');
  const crlf = value.indexOf('\r\n\r\n');
  if (lf === -1 && crlf === -1) return -1;
  if (crlf !== -1 && (lf === -1 || crlf < lf)) return { index: crlf, length: 4 };
  return { index: lf, length: 2 };
}

function dispatchFrame(rawFrame: string, handlers: TutorStreamHandlers): void {
  let frameName = '';
  const dataLines: string[] = [];
  for (const line of rawFrame.split(/\r?\n/)) {
    if (line.length === 0 || line.startsWith(':')) continue;
    const separator = line.indexOf(':');
    const field = separator === -1 ? line : line.slice(0, separator);
    const value = separator === -1 ? '' : line.slice(separator + 1).replace(/^ /, '');
    if (field === 'event') frameName = value;
    else if (field === 'data') dataLines.push(value);
  }
  if (dataLines.length === 0) return;
  const payload = parseJson(dataLines.join('\n'));
  if (payload === null) return;
  const name = frameName !== '' ? frameName : readString(payload, 'type');
  if (name === null || !KNOWN_FRAMES.has(name)) return;
  const event = toServerEvent(name, payload, handlers);
  if (event !== null) handlers.onEvent(event);
}

/**
 * Map one `event:`/`data:` frame onto the shared realtime envelope.
 *
 * Both the short names emitted by the SSE tutor stream (`tool_call`, `delta`,
 * `block`, `done`) and the fully-qualified `RealtimeServerType` names are
 * accepted, so an implementation that reuses the realtime vocabulary does not
 * need a second parser.
 */
function toServerEvent(
  name: string,
  payload: Record<string, unknown>,
  handlers: TutorStreamHandlers,
): RealtimeServerEvent | null {
  const sessionId = readString(payload, 'sessionId') ?? handlers.sessionId;
  const turnId = readString(payload, 'turnId') ?? handlers.turnId;
  const seq = readNumber(payload, 'seq');
  if (seq === null) return null;
  const timestamp = readString(payload, 'timestamp') ?? new Date().toISOString();
  const base = { sessionId, turnId, seq, timestamp } as const;

  switch (name) {
    case 'team.phase_advanced':
    case 'team.gate_blocked':
    case 'team.member_delegated':
    case 'team.tool_invoked':
    case 'team.thinking': {
      // 团队帧（F5）：借用已冻结的 `tutor.block` 信封投递，块型限定在
      // pbl_card / tool / think 三种既有变体，渲染为 PblStageCard /
      // ToolCallTimeline / ModelThinkingCard。字段逐字对齐服务端
      // writeTeamFrame + buildTeamFrameData 的扁平 payload；缺必需字段时
      // 返回 null（与其他坏帧处理一致），不伪造内容、不静默替换。
      const kind = teamFrameKind(name);
      if (kind === null) return null;
      // frameId 由服务端 writeTeamFrame 信封固定写入（tutor.controller.ts:417-430）。
      const frameId = readString(payload, 'frameId') ?? `team-${kind}-${base.seq}`;
      const block = teamFrameToReplyBlock(kind, payload, frameId);
      if (block === null || !isTutorReplyBlock(block)) return null;
      return { ...base, type: 'tutor.block', block };
    }
    case 'tool_call':
    case 'tutor.tool_call': {
      const callId = readString(payload, 'callId');
      const label = readString(payload, 'label');
      if (callId === null || label === null) return null;
      return {
        ...base,
        type: 'tutor.tool_call',
        callId,
        name: readString(payload, 'name') ?? 'unknown',
        label,
      };
    }
    case 'tool_result':
    case 'tutor.tool_result': {
      const callId = readString(payload, 'callId');
      if (callId === null) return null;
      const result = readString(payload, 'result');
      return {
        ...base,
        type: 'tutor.tool_result',
        callId,
        status: readString(payload, 'status') === 'error' ? 'error' : 'done',
        ...(result !== null ? { result } : {}),
      };
    }
    case 'delta':
    case 'tutor.delta': {
      const text = readString(payload, 'text');
      if (text === null) return null;
      return { ...base, type: 'tutor.delta', text };
    }
    case 'block':
    case 'tutor.block': {
      const block = payload.block;
      if (!isTutorReplyBlock(block)) return null;
      return { ...base, type: 'tutor.block', block: block as TutorReplyBlock };
    }
    case 'done':
    case 'turn.done': {
      const summary = payload.turnSummary;
      if (typeof summary !== 'object' || summary === null) return null;
      const record = summary as Record<string, unknown>;
      const stage = readString(record, 'stage');
      if (stage === null) return null;
      const hintLevel = readNumber(record, 'hintLevel');
      return {
        ...base,
        type: 'turn.done',
        turnSummary: { hintLevel: toHintLevel(hintLevel), stage: stage as ProjectStage },
      };
    }
    case 'error': {
      return {
        ...base,
        type: 'safety.block',
        code: 'AI_SAFETY_BLOCK',
        message: readString(payload, 'message') ?? '这一步没能完成，请重试。',
      };
    }
    default:
      return null;
  }
}

function toHintLevel(value: number | null): TutorHintLevel | null {
  if (value === 1 || value === 2 || value === 3 || value === 4 || value === 5) return value;
  return null;
}

function parseJson(value: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(value);
    if (typeof parsed !== 'object' || parsed === null) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

function readString(source: Record<string, unknown>, key: string): string | null {
  const value = source[key];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function readNumber(source: Record<string, unknown>, key: string): number | null {
  const value = source[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function toTransportError(error: unknown): TutorDataError {
  const message = error instanceof Error ? error.message : '网络不可用';
  return new TutorDataError(`连接 AI搭档失败：${message}`, undefined, 'NETWORK_OFFLINE');
}

async function toHttpError(response: Response): Promise<TutorDataError> {
  let code: string | undefined;
  let message: string | undefined;
  try {
    const body: unknown = await response.json();
    if (typeof body === 'object' && body !== null) {
      const record = body as Record<string, unknown>;
      if (typeof record.message === 'string') message = record.message;
      if (typeof record.code === 'string') code = record.code;
    }
  } catch {
    // A non-JSON body is still an HTTP failure; fall through to the status text.
  }
  return new TutorDataError(
    message ?? `AI搭档暂时不可用（${response.status}）`,
    response.status,
    code ?? `HTTP_${response.status}`,
  );
}
