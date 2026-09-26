'use client';

/**
 * CONFIRM GATE: student-facing wording for `escalation.notice` is pending a
 * product decision. Until then we show a single, non-technical acknowledgement.
 *
 * Never expose raw internals: no stall counts, no 「已通知班主任」, no
 * escalation ids. Keep the wording behind this constant so a product decision
 * only has to change one string.
 */
export const ESCALATION_STUDENT_MESSAGE =
  '别担心，我会继续陪着你，我们换一个更容易开始的小步骤好吗？';

export interface EscalationNoticeProps {
  visible: boolean;
}

export function EscalationNotice({ visible }: EscalationNoticeProps) {
  if (!visible) return null;
  return (
    <div className="qitu-voice-escalation" role="status" aria-live="polite">
      {ESCALATION_STUDENT_MESSAGE}
    </div>
  );
}
