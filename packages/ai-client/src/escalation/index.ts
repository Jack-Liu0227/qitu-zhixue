import type { PedagogicMove } from '../pedagogy';

/**
 * Mentor-escalation triggers. The server counts a 4-turn stall window and
 * escalates on the 4th consecutive stall signal, on detected frustration, or
 * when the AI cannot advance.
 */
export type MentorEscalationTrigger =
  | 'stall_window_exceeded'
  | 'frustration_detected'
  | 'ai_cannot_advance';

/**
 * Payload describing a mentor escalation (the data behind the
 * `escalation.notice` WebSocket event). Server-owned; clients never write it.
 */
export interface MentorEscalationNotice {
  escalationId: string;
  sessionId: string;
  turnId: string;
  trigger: MentorEscalationTrigger;
  /** The move that produced the escalation, e.g. `stall_signal`. */
  move: PedagogicMove;
}
