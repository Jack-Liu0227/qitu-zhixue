import type { TutorReplyBlock } from '@qitu/contracts';
import { EvidenceChip } from './EvidenceChip';
import { HintLevelIndicator } from './HintLevelIndicator';
import { NumberedQuestionList } from './NumberedQuestionList';
import { OptionChips } from './OptionChips';
import { ToolCallTimeline } from './ToolCallTimeline';

/**
 * Safe fallback for a reply block that is not one of the five modelled
 * variants.
 *
 * It deliberately shows NO content from the offending payload: dumping the raw
 * text would be exactly the unmodelled-prose path this page forbids.
 */
export function SafeReplyFallback() {
  return (
    <p className="qitu-tutor-block-fallback" role="note">
      这条回复的格式暂时无法安全展示，请重新提问或换一个入口。
    </p>
  );
}

/**
 * The ONLY renderer for assistant output.
 *
 * WHY RAW MARKDOWN IS BANNED HERE: the product shows structured teaching blocks
 * (numbered questions, A/B/C options), not prose. More importantly, a
 * free-form Markdown/prose renderer would let the model smuggle a complete
 * answer inside narrative text, bypassing the hint ladder and the
 * admission-layer guardrail. The closed `TutorReplyBlock` union narrows that
 * path at the type level (design 6.1), so `text` is rendered as plain text and
 * no Markdown renderer is imported.
 */
export function TutorReplyBlockView({
  block,
  onSelectOption,
  disabled = false,
}: {
  block: TutorReplyBlock;
  onSelectOption?: (label: string, text?: string) => void;
  disabled?: boolean;
}) {
  switch (block.kind) {
    case 'text':
      return <p className="qitu-tutor-text">{block.text}</p>;
    case 'questions':
      return <NumberedQuestionList items={block.items} />;
    case 'options':
      return (
        <OptionChips
          items={block.items}
          allowOther={block.allowOther}
          onSelect={(label, text) => onSelectOption?.(label, text)}
          disabled={disabled}
        />
      );
    case 'hint':
      return (
        <div className="qitu-tutor-hint">
          <HintLevelIndicator level={block.level} />
          <p className="qitu-tutor-text">{block.text}</p>
        </div>
      );
    case 'evidence':
      return <EvidenceChip reference={block.ref} />;
    case 'tool':
      // A lone step; a run of consecutive steps is grouped into one panel by
      // `ChatBubble` so the student reads one 「执行过程」 card, not N of them.
      return <ToolCallTimeline calls={[block.call]} />;
    default: {
      // Compile-time exhaustiveness: a new variant must be handled here.
      const neverBlock: never = block;
      void neverBlock;
      return <SafeReplyFallback />;
    }
  }
}
