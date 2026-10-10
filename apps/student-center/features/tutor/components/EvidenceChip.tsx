/**
 * Renders the `evidence` reply variant as a read-only citation row.
 * Evidence references are server-recorded; the client never edits them.
 * Styled with an inline badge echoing the reference NotebookLM citations.
 */
export function EvidenceChip({
  reference,
  citationIndex = 1,
  onClick,
}: {
  reference: string;
  citationIndex?: number;
  onClick?: () => void;
}) {
  return (
    <span
      className="qitu-tutor-evidence"
      onClick={onClick}
      title="点击高亮左侧关联材料"
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
    >
      <span className="qitu-inline-citation" aria-label={`材料来源 ${citationIndex}`}>
        {citationIndex}
      </span>
      <span className="qitu-tutor-evidence-label">引用材料</span>
      <span className="qitu-tutor-evidence-ref">{reference}</span>
    </span>
  );
}
