/**
 * Renders the `evidence` reply variant as a read-only citation row.
 * Evidence references are server-recorded; the client never edits them.
 */
export function EvidenceChip({ reference }: { reference: string }) {
  return (
    <span className="qitu-tutor-evidence">
      <span className="qitu-tutor-evidence-label">证据</span>
      <span className="qitu-tutor-evidence-ref">{reference}</span>
    </span>
  );
}
