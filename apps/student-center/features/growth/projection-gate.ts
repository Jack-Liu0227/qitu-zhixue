/**
 * GROWTH_STUDENT_PROJECTION_GATE — the single switchboard for every student
 * growth cell that is still awaiting a product-owner decision.
 *
 * The three-role projection matrix (growth-spec.md §4) is an UNAPPROVED
 * proposal (确认门 G4). The student column is implemented as specified, but the
 * cells it marks "awaiting approval" are NOT hard-coded into components: they
 * read this object, so a decision (or its reversal) changes exactly one place.
 * This module never invents a permission decision.
 *
 * Gates referenced:
 *  - G1: RESOLVED by ADR 0004 (Accepted) — 成长轨迹 is the 6th nav item.
 *  - G3: whether the child may see any risk-derived signal at all.
 *  - G4: approval of the whole three-role projection matrix.
 *  - G5: approval of the trajectory visual design.
 *
 * This file is the ONLY place that knows an internal risk label. Components
 * receive already-safe wording, and the student view type in `types.ts` cannot
 * carry an internal label.
 */

export interface GrowthStudentProjectionGate {
  navigation: 'sub-route-only' | 'nav-item';
  matrixApproval: 'pending-student-column-only' | 'approved';
  /**
   * `withheld` matches the spec's primary wording (matrix rows 3/4 = 不可见).
   * `reworded` surfaces ONLY the approved child-facing phrases below. The raw
   * internal labels (`stall` / `emotion` / `escalated`) are never rendered.
   */
  studentRiskSignals: 'withheld' | 'reworded';
  /** The only child-facing wording permitted for each internal signal. */
  riskSignalRewording: {
    stall: string;
    emotion: string;
    escalated: string;
    no_progress: string;
  };
  /** Matrix rows the child must never see (rows 1, 2, 5, 9). */
  withheldSourceTypes: readonly string[];
  visualDesignApproval: 'pending-proposal' | 'approved';
}

export const GROWTH_STUDENT_PROJECTION_GATE: GrowthStudentProjectionGate = {
  /** ADR 0004 (Accepted): `/student/growth` is the 6th first-class nav item. */
  navigation: 'nav-item',

  /** G4 — only the student column ships until the matrix is approved. */
  matrixApproval: 'pending-student-column-only',

  /** G3 — spec-stated default is 不可见; flip to `reworded` if G3 says yes. */
  studentRiskSignals: 'withheld',

  /** growth-spec.md §5 recommended wording; the final call belongs to product. */
  riskSignalRewording: {
    stall: '这道题有点难，你坚持尝试了很久——换个思路试试',
    emotion: '今天先到这里，休息一下，已经很棒了',
    escalated: '老师会来和你一起看看，你做得很好',
    no_progress: '我们换个方向试试',
  },

  withheldSourceTypes: ['guardian_feedback', 'mentor_note', 'tutor_record', 'escalation_event'],

  /** G5 — visual design is a proposal derived from the existing design language. */
  visualDesignApproval: 'pending-proposal',
};

export type RewordableRiskSignal = keyof GrowthStudentProjectionGate['riskSignalRewording'];

/**
 * Maps an internal risk signal to pre-approved child-facing wording.
 *
 * This is the ONLY reader of an internal signal. With the gate at `withheld`
 * the data source never calls it for rendering; with the gate at `reworded` it
 * returns an approved phrase and never the raw label or a count.
 */
export function rewordRiskSignal(signal: RewordableRiskSignal | null): string | null {
  if (signal === null) {
    return null;
  }
  return GROWTH_STUDENT_PROJECTION_GATE.riskSignalRewording[signal];
}
