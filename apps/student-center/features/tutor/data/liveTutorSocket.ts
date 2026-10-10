import type { ApiErrorCode, RealtimeClientEvent, RealtimeServerEvent } from '@qitu/contracts';
import type { TutorSocket } from '../realtime/tutorRealtimeClient';
import { TutorDataError } from './dataSource';
import { openTutorStream, type TutorStreamRequest } from './tutorStream';

/**
 * `TutorSocket` backed by `POST /api/v1/tutor/sessions/:id/stream` (SSE).
 *
 * It keeps the exact contract the components already rely on:
 * - `onOpen` fires once, asynchronously, like a real socket handshake.
 * - `subscribe { afterSeq }` answers with `stream.replay` built from the local
 *   journal, so `TutorRealtimeClient`'s monotonic cursor deduplicates exactly
 *   as it did against the mock.
 * - Events reach the client in journal order with a strictly contiguous `seq`.
 *
 * Difference from a WebSocket: a turn is delivered by the SSE response of that
 * turn's own POST, not by a push on a shared channel. `startTurn()` is the
 * affordance that opens it (mirroring `MockTutorSocket.push`); it is NOT part
 * of the `TutorSocket` seam.
 *
 * SEQ RENORMALISATION: the client's journal is local, so the only thing the UI
 * needs from `seq` is strict contiguity starting at the cursor it asked for.
 * This socket therefore renumbers incoming events onto `cursor + 1, cursor + 2,
 * …`. That keeps `TutorRealtimeClient`'s duplicate/gap detection correct even
 * if the API restarts its own counters, and prevents a whole stream being
 * silently dropped as "already seen".
 *
 * The journal lives in memory only — it is derived from a minor's raw
 * conversation and is therefore never persisted to browser storage.
 */
export class LiveTutorSocket implements TutorSocket {
  private readonly messageHandlers = new Set<(event: RealtimeServerEvent) => void>();
  private readonly openHandlers = new Set<() => void>();
  private readonly closeHandlers = new Set<() => void>();
  private readonly journal: RealtimeServerEvent[] = [];
  private readonly projectId: string | undefined;
  private readonly onUnreachable: (error: TutorDataError) => void;
  private abortActiveStream: (() => void) | null = null;
  private lastSeq: number;
  private turnCounter = 0;
  private disposed = false;

  constructor(
    readonly sessionId: string,
    options: {
      projectId?: string;
      /** The client's applied cursor from `GET /tutor/session`. */
      initialSeq?: number;
      onUnreachable: (error: TutorDataError) => void;
    },
  ) {
    this.projectId = options.projectId;
    this.onUnreachable = options.onUnreachable;
    this.lastSeq = options.initialSeq ?? 0;
  }

  send(event: RealtimeClientEvent): void {
    if (this.disposed) return;
    if (event.type === 'subscribe') {
      // The client's cursor is authoritative; adopt it before replaying.
      this.lastSeq = Math.max(this.lastSeq, event.afterSeq);
      this.emitReplay(event.afterSeq);
      return;
    }
    if (event.type === 'turn.cancel') {
      this.abortActiveStream?.();
      this.abortActiveStream = null;
    }
  }

  /**
   * Start a turn. Returns the journal baseline synchronously; the first
   * streamed event is `baseline + 1`, which is what lets the UI place the
   * student's own echo before the assistant's reply.
   */
  startTurn(request: Omit<TutorStreamRequest, 'sessionId' | 'projectId'>): number {
    if (this.disposed) return this.lastSeq;
    const turnId = `live-${this.sessionId}-${(this.turnCounter += 1)}`;
    const baseline = this.lastSeq;
    const streamRequest: TutorStreamRequest = {
      ...request,
      sessionId: this.sessionId,
      ...(this.projectId !== undefined ? { projectId: this.projectId } : {}),
    };

    this.abortActiveStream?.();
    this.abortActiveStream = openTutorStream(streamRequest, {
      sessionId: this.sessionId,
      turnId,
      onEvent: (event) => this.emit(this.renumber(event, turnId)),
      onFailure: (error) => {
        this.abortActiveStream = null;
        this.onUnreachable(error);
      },
      onSettled: () => {
        this.abortActiveStream = null;
      },
    });
    return baseline;
  }

  /** Abort the in-flight turn without tearing the socket down. */
  cancel(): void {
    this.abortActiveStream?.();
    this.abortActiveStream = null;
  }

  /**
   * Report a turn that will never finish, so the UI can stop waiting and say
   * why. Emits a `safety.block` envelope because that is the only
   * server-event-shaped failure channel the realtime contract defines; the
   * student sees `message`, never the code.
   *
   * `code` picks the most honest member of the additive `ApiErrorCode` union:
   * 401 → `UNAUTHENTICATED`, 429 → `RATE_LIMITED`, anything else →
   * `AI_SAFETY_BLOCK` (the code that accompanies `safety.block`).
   */
  failStream(error: TutorDataError): void {
    if (this.disposed) return;
    const code: ApiErrorCode =
      error.status === 401
        ? 'UNAUTHENTICATED'
        : error.status === 429
          ? 'RATE_LIMITED'
          : 'AI_SAFETY_BLOCK';
    this.emit(
      this.renumber(
        {
          type: 'safety.block',
          sessionId: this.sessionId,
          turnId: '',
          seq: 0,
          timestamp: new Date().toISOString(),
          code,
          message: error.message,
        },
        '',
      ),
    );
  }

  /**
   * Detach listeners and abort the in-flight stream.
   *
   * This mirrors `TutorRealtimeClient.teardownSocket()`: the journal and the
   * seq cursor SURVIVE, so a reconnect re-attaches to the same instance and
   * replays whatever arrived while nobody was listening. Only `dispose()`
   * makes the socket unusable.
   */
  close(): void {
    this.abortActiveStream?.();
    this.abortActiveStream = null;
    this.closeHandlers.forEach((handler) => handler());
    this.messageHandlers.clear();
    this.openHandlers.clear();
    this.closeHandlers.clear();
  }

  /** Permanent teardown; the instance must not be reused afterwards. */
  dispose(): void {
    this.close();
    this.disposed = true;
  }

  onMessage(handler: (event: RealtimeServerEvent) => void): () => void {
    this.messageHandlers.add(handler);
    return () => this.messageHandlers.delete(handler);
  }

  onOpen(handler: () => void): () => void {
    this.openHandlers.add(handler);
    // Fire on the next microtask, like a real socket handshake, and never
    // synchronously from inside `connect()`.
    queueMicrotask(() => {
      if (!this.disposed) handler();
    });
    return () => this.openHandlers.delete(handler);
  }

  onClose(handler: () => void): () => void {
    this.closeHandlers.add(handler);
    return () => this.closeHandlers.delete(handler);
  }

  private renumber(event: RealtimeServerEvent, turnId: string): RealtimeServerEvent {
    this.lastSeq += 1;
    return {
      ...event,
      turnId: event.turnId !== '' ? event.turnId : turnId,
      seq: this.lastSeq,
    };
  }

  private emitReplay(afterSeq: number): void {
    const events = this.journal.filter((event) => event.seq > afterSeq);
    const lastEvent = events[events.length - 1];
    const seq = lastEvent !== undefined ? lastEvent.seq : afterSeq;
    this.messageHandlers.forEach((handler) =>
      handler({
        type: 'stream.replay',
        sessionId: this.sessionId,
        turnId: '',
        seq,
        timestamp: new Date().toISOString(),
        events,
        nextSeq: seq + 1,
        cursorValid: true,
      }),
    );
  }

  private emit(event: RealtimeServerEvent): void {
    if (this.disposed) return;
    // Journal first: with no attached listener the event must still be
    // replayable on the next `subscribe`.
    this.journal.push(event);
    this.messageHandlers.forEach((handler) => handler(event));
  }
}
