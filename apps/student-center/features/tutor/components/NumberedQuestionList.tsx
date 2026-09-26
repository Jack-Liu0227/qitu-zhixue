/**
 * Renders the `questions` reply variant as a 1/2/3 numbered list.
 * Plain list items — no markdown, no prose renderer.
 */
export function NumberedQuestionList({ items }: { items: string[] }) {
  return (
    <ol className="qitu-tutor-questions">
      {items.map((item, index) => (
        <li key={`${index}-${item}`}>{item}</li>
      ))}
    </ol>
  );
}
