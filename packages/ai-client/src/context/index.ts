import type { PedagogicMove } from '../pedagogy';
import type { TutorHintLevel } from '../index';

/**
 * Server-assembled `context_packet` handed to the tutor engine each turn.
 * Server-owned value: clients never write any field of this record.
 */
export interface ContextPacket {
  sessionId: string;
  projectId: string | null;
  /**
   * Current project stage from the server state machine (a `ProjectStage`
   * value; see `@qitu/contracts`).
   */
  stage: string;
  turnId: string;
  /**
   * The turn's authoritative text. For voice turns this is the server's
   * `asr.final` transcript.
   */
  text: string;
  /**
   * The move the student requested this turn. The recorded, authoritative
   * `pedagogic_move` is always server-computed.
   */
  requestedMove: PedagogicMove;
  /** Current hint level for the active question, or null when not started. */
  hintLevel: TutorHintLevel | null;
  /**
   * Recent-session summary injected into the prompt each turn. Modality is
   * intentionally NOT part of `context_packet`; it lives on the turn record.
   */
  recentSummary: {
    summary: string;
    lastHintLevel: TutorHintLevel | null;
    stallCount: number;
    escalated: boolean;
  };
}
