import type { RealtimeClientEvent, RealtimeServerEvent } from '@qitu/contracts';

/**
 * Minimal transport seam for the tutor session WebSocket.
 *
 * The feature ships a deterministic mock implementation (see
 * `../data/mockTutorSocket.ts`) so the seq / replay / reconnect surface can be
 * exercised without a backend. The seam keeps the real
 * `RealtimeClientEvent` / `RealtimeServerEvent` envelopes, so swapping in a
 * browser WebSocket later does not touch component code.
 */
export interface TutorSocket {
  send(event: RealtimeClientEvent): void;
  close(): void;
  onMessage(handler: (event: RealtimeServerEvent) => void): () => void;
  onOpen(handler: () => void): () => void;
  onClose(handler: () => void): () => void;
}

export type TutorSocketFactory = (sessionId: string) => TutorSocket;

export type TutorRealtimeStatus = 'idle' | 'connecting' | 'open' | 'offline' | 'closed';

export interface TutorRealtimeOptions {
  sessionId: string;
  /** Cursor seeded from `GET /tutor/sessions/:id` `lastSeq`. */
  initialSeq: number;
  createSocket: TutorSocketFactory;
  onEvent: (event: RealtimeServerEvent) => void;
  onStatus?: (status: TutorRealtimeStatus) => void;
  /** Called when the server reports the cursor is invalid and a refetch is needed. */
  onResyncRequired?: () => void;
  maxReconnectAttempts?: number;
}

/**
 * Client for `WS /api/v1/tutor/sessions/:id/stream`.
 *
 * Responsibilities:
 * - On every (re)connect sends `{ type: 'subscribe', afterSeq }` where
 *   `afterSeq` is the monotonic in-memory cursor.
 * - Applies server events with a strictly monotonic `seq`; a `seq` at or below
 *   the cursor is DROPPED so a replay after reconnect never duplicates a turn.
 * - A detected gap triggers a resubscribe from the cursor rather than rendering
 *   a partial thread.
 * - Reconnects with exponential backoff.
 *
 * The cursor lives in memory only — it is never persisted to browser storage
 * because it is derived from a minor's raw conversation.
 */
export class TutorRealtimeClient {
  private readonly options: TutorRealtimeOptions;
  private socket: TutorSocket | null = null;
  private unsubscribeMessage: (() => void) | null = null;
  private unsubscribeOpen: (() => void) | null = null;
  private unsubscribeClose: (() => void) | null = null;
  private lastAppliedSeq: number;
  private reconnectAttempts = 0;
  private disposed = false;
  private status: TutorRealtimeStatus = 'idle';

  constructor(options: TutorRealtimeOptions) {
    this.options = options;
    this.lastAppliedSeq = options.initialSeq;
  }

  getLastAppliedSeq(): number {
    return this.lastAppliedSeq;
  }

  getStatus(): TutorRealtimeStatus {
    return this.status;
  }

  connect(): void {
    if (this.disposed) return;
    this.setStatus(this.reconnectAttempts === 0 ? 'connecting' : 'connecting');
    const socket = this.options.createSocket(this.options.sessionId);
    this.socket = socket;
    this.unsubscribeMessage = socket.onMessage((event) => this.handleEvent(event));
    this.unsubscribeOpen = socket.onOpen(() => {
      this.reconnectAttempts = 0;
      this.setStatus('open');
      // Ask the server to replay anything we have not applied yet.
      socket.send({
        type: 'subscribe',
        sessionId: this.options.sessionId,
        turnId: '',
        seq: 0,
        timestamp: new Date().toISOString(),
        afterSeq: this.lastAppliedSeq,
      });
    });
    this.unsubscribeClose = socket.onClose(() => {
      if (this.disposed) return;
      this.setStatus('offline');
      this.scheduleReconnect();
    });
  }

  /** Send any client event (e.g. `stall.signal`, `audio.chunk`) over the socket. */
  send(event: RealtimeClientEvent): void {
    this.socket?.send(event);
  }

  disconnect(): void {
    this.disposed = true;
    this.teardownSocket();
    this.setStatus('closed');
  }

  private handleEvent(event: RealtimeServerEvent): void {
    if (event.type === 'stream.replay') {
      if (!event.cursorValid) {
        this.options.onResyncRequired?.();
      }
      const ordered = [...event.events].sort((a, b) => a.seq - b.seq);
      for (const replayed of ordered) {
        this.applyEvent(replayed);
      }
      return;
    }
    this.applyEvent(event);
  }

  private applyEvent(event: RealtimeServerEvent): void {
    if (event.seq <= 0) {
      // Server events must carry a journal seq; ignore malformed transport noise.
      return;
    }
    if (event.seq <= this.lastAppliedSeq) {
      // Duplicate from a replay — drop it. This is the idempotency of reconnect.
      return;
    }
    if (event.seq > this.lastAppliedSeq + 1 && this.lastAppliedSeq > 0) {
      // Gap: resubscribe from the cursor instead of rendering a hole.
      this.options.onResyncRequired?.();
      this.teardownSocket();
      this.scheduleReconnect();
      return;
    }
    this.lastAppliedSeq = event.seq;
    this.options.onEvent(event);
  }

  private scheduleReconnect(): void {
    const max = this.options.maxReconnectAttempts ?? 6;
    if (this.reconnectAttempts >= max) {
      this.setStatus('offline');
      return;
    }
    const attempt = this.reconnectAttempts;
    this.reconnectAttempts += 1;
    const delay = Math.min(1000 * 2 ** attempt, 15000);
    globalThis.setTimeout(() => {
      if (!this.disposed) this.connect();
    }, delay);
  }

  private teardownSocket(): void {
    this.unsubscribeMessage?.();
    this.unsubscribeOpen?.();
    this.unsubscribeClose?.();
    this.unsubscribeMessage = null;
    this.unsubscribeOpen = null;
    this.unsubscribeClose = null;
    this.socket?.close();
    this.socket = null;
  }

  private setStatus(status: TutorRealtimeStatus): void {
    this.status = status;
    this.options.onStatus?.(status);
  }
}
