import type { TutorReplyBlock } from '@qitu/contracts';
import { EvidenceChip } from './EvidenceChip';
import { HintLevelIndicator } from './HintLevelIndicator';
import { NumberedQuestionList } from './NumberedQuestionList';
import { OptionChips } from './OptionChips';
import { ToolCallTimeline } from './ToolCallTimeline';
import { ModelThinkingCard } from './ModelThinkingCard';
import { PblStageCard } from './PblStageCard';
import { ArtifactFileCard } from './ArtifactFileCard';
import { HeuristicQuizCard } from './HeuristicQuizCard';
import { KineticEnergyInteractiveCard } from './KineticEnergyInteractiveCard';
import { CircuitSimulationCard } from './CircuitSimulationCard';
import { AttachmentView } from './AttachmentView';

import { MarkdownMathView } from './MarkdownMathView';
import { IdeaCards } from './IdeaCards';

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
 * The structured renderer for assistant output with Markdown and Math LaTeX support.
 */
export function TutorReplyBlockView({
  block,
  onSelectOption,
  onOneClickCreateProject,
  disabled = false,
}: {
  block: TutorReplyBlock;
  onSelectOption?: (label: string, text?: string) => void;
  onOneClickCreateProject?: (goal: string, interest: string) => void;
  disabled?: boolean;
}) {
  switch (block.kind) {
    case 'text':
      return <MarkdownMathView content={block.text} />;
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
    case 'think':
      return <ModelThinkingCard content={block.content} closed={block.closed} />;
    case 'pbl_card':
      return (
        <PblStageCard
          phase={block.phase}
          title={block.title}
          teammateLabel={block.teammateLabel}
          summary={block.summary}
          tags={block.tags}
          actionLabel={block.actionLabel}
          onAction={() => block.actionLabel && onSelectOption?.(block.actionLabel, block.actionLabel)}
        />
      );
    case 'artifact':
      return (
        <ArtifactFileCard
          fileName={block.fileName}
          fileType={block.fileType}
          title={block.title}
          summary={block.summary}
          content={block.content}
          downloadUrl={block.downloadUrl}
          sizeText={block.sizeText}
          nodeRef={block.nodeRef}
        />
      );
    case 'quiz':
      return (
        <HeuristicQuizCard
          questionId={block.questionId}
          stem={block.stem}
          type={block.type}
          options={block.options}
          explanation={block.explanation}
          selectedKey={block.selectedKey}
          onSelectOption={(key, text) => onSelectOption?.(key, text)}
          disabled={disabled}
        />
      );
    case 'interactive_experiment':
      return (
        <KineticEnergyInteractiveCard
          disabled={disabled}
          onExperimentComplete={(summary) => onSelectOption?.('实验结论', summary)}
        />
      );
    case 'circuit_experiment':
      return (
        <CircuitSimulationCard
          disabled={disabled}
          onExperimentComplete={(summary) => onSelectOption?.('电路探究结论', summary)}
        />
      );
    case 'attachment':
      return <AttachmentView attachment={block} />;
    case 'idea_cards':
      return onOneClickCreateProject ? (
        <IdeaCards
          cards={block.cards}
          disabled={disabled}
          confirming={disabled}
          onCreate={onOneClickCreateProject}
        />
      ) : (
        <SafeReplyFallback />
      );
    default: {
      // Compile-time exhaustiveness: a new variant must be handled here.
      const neverBlock: never = block;
      void neverBlock;
      return <SafeReplyFallback />;
    }
  }
}
