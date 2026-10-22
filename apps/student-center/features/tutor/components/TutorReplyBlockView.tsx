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
import { OpticsDiffractionScatteringCard } from './OpticsDiffractionScatteringCard';
import { WaveOpticsExperimentCard } from './WaveOpticsExperimentCard';
import { AsideAdvisorCard } from './AsideAdvisorCard';
import { AttachmentView } from './AttachmentView';

import { MarkdownMathView } from './MarkdownMathView';
import { IdeaCards } from './IdeaCards';
import { BoardBlock } from './BoardBlock';
import { LearningOpeningCard } from './LearningOpeningCard';
import { LearningResourceCard, LearningSources } from './LearningResourceCard';
import { MilestoneBlock } from './MilestoneBlock';

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
  onSubmitQuestionAnswer,
  onOneClickCreateProject,
  onRequestQuizExplanation,
  onAnswerQuiz,
  onExperimentAction,
  projectId,
  disabled = false,
}: {
  block: TutorReplyBlock;
  onSelectOption?: (label: string, text?: string) => void;
  onSubmitQuestionAnswer?: (answer: string) => void;
  onOneClickCreateProject?: (goal: string, interest: string, templateVersionId: string) => void;
  onRequestQuizExplanation?: (quizId: string) => Promise<void>;
  onAnswerQuiz?: (quizId: string, selectedKeys: string[], idempotencyKey: string) => Promise<import('@qitu/contracts').AnswerInteractiveQuizResponse>;
  onExperimentAction?: (experimentId: string, action: 'submit_prediction' | 'run' | 'record_observation', payload: unknown, idempotencyKey: string) => void | Promise<boolean | import('@qitu/contracts').TutorExperimentActionResponse>;
  projectId?: string | null;
  disabled?: boolean;
}) {
  switch (block.kind) {
    case 'learning_opening':
      return <LearningOpeningCard block={block} />;
    case 'text':
      return <MarkdownMathView content={block.text} />;
    case 'questions':
      return (
        <NumberedQuestionList
          items={block.items}
          onSubmitAnswer={onSubmitQuestionAnswer}
          disabled={disabled}
        />
      );
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
          <MarkdownMathView content={block.text} />
        </div>
      );
    case 'evidence':
      return <EvidenceChip reference={block.ref} />;
    case 'learning_resource':
      return <LearningResourceCard {...block} disabled={disabled} onRead={onSelectOption} />;
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
          onSubmitAnswer={onAnswerQuiz ? (selectedKeys, idempotencyKey) => onAnswerQuiz(block.questionId, selectedKeys, idempotencyKey) : undefined}
          onRequestExplanation={onRequestQuizExplanation ? () => onRequestQuizExplanation(block.questionId) : undefined}
          rationaleHint={block.rationaleHint}
          graded={block.graded}
          persistedAnswer={block.answer}
          disabled={disabled}
        />
      );
    case 'board':
      return <><BoardBlock title={block.title} steps={block.steps} />{block.provenance ? <div className="qitu-learning-attribution">
        <span>{block.provenance.origin === 'adapted' ? '根据已核验资料改编' : '导师按本课目标生成'} · 翻页用于查看图示</span>
        {block.provenance.sources.length ? <LearningSources sources={block.provenance.sources} /> : null}</div> : null}</>;
    case 'milestone':
      return <MilestoneBlock phaseId={block.phaseId} title={block.title} deliverables={block.deliverables} gate={block.gate} projectId={projectId} />;
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
    case 'aside':
      return (
        <AsideAdvisorCard
          copilot={block.copilot}
          targetPhase={block.targetPhase}
          content={block.content}
          evidenceRef={block.evidenceRef}
          proposalRef={block.proposalRef}
          lesson={block.lesson}
        />
      );
    case 'optics_experiment':
      if (block.specVersion === '2.0.0') return <WaveOpticsExperimentCard key={block.experimentId} block={block} disabled={disabled || block.allowedActions.length === 0}
        onAction={(action, payload, key) => onExperimentAction?.(block.experimentId, action, payload, key)} />;
      if (block.initialMode === 'interference' || block.allowedModels?.some(mode => mode === 'interference')) return <SafeReplyFallback />;
      if (block.allowedActions.length === 0) return <section className="qitu-tutor-hint" role="note">
        <strong>这条历史预览不需要提交预测</strong>
        <p>这里尚未进入可操作的实验任务。可以继续和导师交流，确认项目后按当前课时生成课件。</p>
        <button type="button" className="qitu-button qitu-button-ghost" disabled={disabled}
          onClick={() => onSelectOption?.('继续了解现象', '请围绕当前探究问题继续介绍现象，一次问我一个观察问题。')}>继续了解现象</button>
      </section>;
      return (
        <OpticsDiffractionScatteringCard
          disabled={disabled || block.allowedActions.length === 0}
          savedObservation={block.savedObservation}
          key={block.experimentId}
          initialMode={block.initialMode}
          initialParameters={block.initialParameters}
          allowedModels={block.allowedModels?.filter((mode): mode is 'diffraction' | 'scattering' => mode === 'diffraction' || mode === 'scattering')}
          predictionGate={block.predictionGate}
          onAction={(action, payload, idempotencyKey) => onExperimentAction?.(block.experimentId, action, payload, idempotencyKey)}
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
