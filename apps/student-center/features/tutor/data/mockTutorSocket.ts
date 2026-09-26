import type { RealtimeClientEvent, RealtimeServerEvent } from '@qitu/contracts';
import type { TutorSocket } from '../realtime/tutorRealtimeClient';
import { createMockReplayEvent } from './fixtures';

/**
 * Deterministic in-memory transport for the tutor stream.
 *
 * It implements the real `RealtimeClientEvent` / `RealtimeServerEvent` surface:
 * a `subscribe` with `afterSeq` yields a `stream.replay` containing only the
 * events with a greater `seq`. Reconnecting therefore replays the gap and the
 * client's monotonic cursor drops anything already applied — no duplicate turn.
 *
 * `push` is an extra (mock-only) affordance so a submitted turn can produce
 * streamed blocks in tests. The production seam (`TutorSocket`) does not expose
 * it. The seq / replay / idempotency contract is not a stub.
 */
export class MockTutorSocket implements TutorSocket {
  private readonly messageHandlers = new Set<(event: RealtimeServerEvent) => void>();
  private readonly openHandlers = new Set<() => void>();
  private readonly closeHandlers = new Set<() => void>();
  private closed = false;

  send(event: RealtimeClientEvent): void {
    if (this.closed) return;
    if (event.type === 'subscribe') {
      this.emit(createMockReplayEvent(event.afterSeq));
    }
  }

  /** Mock-only: enqueue a server event on the open connection. */
  push(event: RealtimeServerEvent): void {
    this.emit(event);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.closeHandlers.forEach((handler) => handler());
    this.messageHandlers.clear();
    this.openHandlers.clear();
    this.closeHandlers.clear();
  }

  onMessage(handler: (event: RealtimeServerEvent) => void): () => void {
    this.messageHandlers.add(handler);
    return () => this.messageHandlers.delete(handler);
  }

  onOpen(handler: () => void): () => void {
    this.openHandlers.add(handler);
    // Simulate the async socket open handshake.
    queueMicrotask(() => {
      if (!this.closed) handler();
    });
    return () => this.openHandlers.delete(handler);
  }

  onClose(handler: () => void): () => void {
    this.closeHandlers.add(handler);
    return () => this.closeHandlers.delete(handler);
  }

  private emit(event: RealtimeServerEvent): void {
    if (this.closed) return;
    this.messageHandlers.forEach((handler) => handler(event));
  }
}

export function createMockTutorSocket(): TutorSocket {
  return new MockTutorSocket();
}
