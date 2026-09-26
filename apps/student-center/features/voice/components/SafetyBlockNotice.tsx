'use client';

/**
 * Renders the server-authored `safety.block` message.
 *
 * Invariant: the blocked content is NEVER passed to or rendered by this
 * component — only the server's child-appropriate guidance message.
 */
export interface SafetyBlockNoticeProps {
  code: string;
  message: string;
  onDismiss?: () => void;
}

export function SafetyBlockNotice({ message, onDismiss }: SafetyBlockNoticeProps) {
  // `code` is intentionally NOT rendered: internal error codes (e.g.
  // `AI_SAFETY_BLOCK`) must never be shown to the student. Only the
  // server-authored child-appropriate `message` is displayed.
  return (
    <div className="qitu-voice-safety" role="status" aria-live="polite">
      <p className="qitu-voice-safety-message">{message}</p>
      {onDismiss ? (
        <button type="button" className="qitu-button qitu-button-ghost" onClick={onDismiss}>
          我知道了
        </button>
      ) : null}
    </div>
  );
}
