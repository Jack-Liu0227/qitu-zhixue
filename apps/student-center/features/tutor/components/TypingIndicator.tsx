/**
 * Streaming indicator shown while the assistant reply is still arriving.
 * Pure decoration — no content is inferred client-side.
 */
export function TypingIndicator({ label = 'AI搭档正在思考' }: { label?: string }) {
  return (
    <div className="qitu-typing-indicator" role="status" aria-live="polite">
      <span className="qitu-typing-dot" />
      <span className="qitu-typing-dot" />
      <span className="qitu-typing-dot" />
      <span className="qitu-typing-label">{label}</span>
    </div>
  );
}
