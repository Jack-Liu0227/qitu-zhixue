'use client';

import { useLayoutEffect, useRef, type ReactNode } from 'react';
import type { TutorProjectContext, TutorTurn } from '@qitu/contracts';
import { EmptyState, ErrorState, OfflineBanner, SkeletonBlock } from '@qitu/ui';
import type { TutorLoadStatus, TutorViewError } from '../types';
import { findRunningToolLabel, isTutorReplyBlock } from '../state';
import { ChatBubble } from './ChatBubble';
import { TypingIndicator } from './TypingIndicator';
import { ProjectConversationHistory } from './ProjectConversationHistory';
import { ProjectTeachingPlanRecovery } from './ProjectTeachingPlanRecovery';
import { ExplorationWelcome } from './ExplorationWelcome';
import { firstExperimentTurns, learningActivityTurnId } from '../lib/timelinePresentation';
import { nextThreadScroll, type ThreadScrollState } from '../lib/threadScroll';

/** Center conversation column. The composer remains inside this flex column. */
export function ChatThread({
  sessionId,
  turns,
  status,
  error,
  streaming,
  offline,
  escalated,
  disabled,
  onRetry,
  onNewExploration,
  onReconnect,
  onSelectOption,
  onPrepareDraft,
  onSubmitQuestionAnswer,
  onOneClickCreateProject,
  onRequestQuizExplanation,
  onAnswerQuiz,
  onExperimentAction,
  onFeedback,
  projectId,
  currentAssistantName,
  isConfirmingProject = false,
  composer,
  learningActivity,
  coursewareSnapshots = false,
  projectContext,
  explorationContext,
  idle = false,
}: {
  sessionId: string | null;
  turns: TutorTurn[];
  status: TutorLoadStatus;
  error: TutorViewError | null;
  streaming: boolean;
  offline: boolean;
  escalated: boolean;
  disabled: boolean;
  onRetry: () => void;
  onNewExploration?: () => void;
  onReconnect: () => void;
  onSelectOption: (label: string, text?: string) => void;
  onPrepareDraft?: (text?: string) => void;
  onSubmitQuestionAnswer?: (answer: string) => void;
  onOneClickCreateProject?: (goal: string, interest: string, templateVersionId: string) => void;
  onRequestQuizExplanation?: (quizId: string) => Promise<void>;
  onAnswerQuiz?: (quizId: string, selectedKeys: string[], idempotencyKey: string) => Promise<import('@qitu/contracts').AnswerInteractiveQuizResponse>;
  onExperimentAction?: (experimentId: string, action: 'submit_prediction' | 'run' | 'record_observation', payload: unknown, idempotencyKey: string) => void | Promise<boolean | import('@qitu/contracts').TutorExperimentActionResponse>;
  onFeedback?: (turnId: string, kind: import('@qitu/contracts').TutorFeedbackKind, idempotencyKey: string) => Promise<void>;
  projectId?: string | null;
  currentAssistantName?: string;
  isConfirmingProject?: boolean;
  composer: ReactNode;
  learningActivity?: ReactNode;
  coursewareSnapshots?: boolean;
  projectContext?: TutorProjectContext;
  explorationContext?: TutorProjectContext;
  idle?: boolean;
}) {
  const hasTurns = turns.length > 0;
  const bindingUnavailable = error?.code === 'PROJECT_BINDING_RECONFIRM_REQUIRED'
    || error?.code === 'PROJECT_TEACHING_BUNDLE_UNAVAILABLE' || error?.code === 'PROJECT_TEAM_UNAVAILABLE';
  const newestAssistant = lastAssistantTurn(turns);
  const newestTurn = turns.at(-1);
  const openingOnly = idle && !hasTurns || !projectId && Boolean(explorationContext?.exploration) && turns.length === 1
    && newestTurn?.seq === 1 && newestTurn.role === 'assistant';
  const streamingTurnId = streaming && newestTurn?.role === 'assistant' ? newestTurn.turnId : null;
  const showIndicator =
    streaming &&
    status !== 'loading' &&
    (newestTurn?.role !== 'assistant' || newestAssistant === null || newestAssistant.blocks.length === 0);
  const runningToolLabel = findRunningToolLabel(turns);
  const threadScrollRef = useRef<HTMLDivElement | null>(null);
  const turnElements = useRef(new Map<string, HTMLDivElement>());
  const scrollState = useRef<ThreadScrollState>({ sessionId: null, following: true });
  const experimentTurns = firstExperimentTurns(turns);
  const activityTurnId = learningActivityTurnId(turns, streamingTurnId);

  useLayoutEffect(() => {
    const element = threadScrollRef.current;
    if (!element) return;
    const { state, target } = nextThreadScroll(scrollState.current, {
      sessionId, ready: status !== 'loading', openingOnly, turn: newestTurn,
    });
    scrollState.current = state;
    if (!target) return;
    const anchor = target.kind === 'turn' ? turnElements.current.get(target.turnId) : null;
    const top = anchor ? element.scrollTop + anchor.getBoundingClientRect().top
      - element.getBoundingClientRect().top - 20 : 0;
    element.scrollTo({ top: Math.max(0, top), left: 0, behavior: 'auto' });
  }, [sessionId, status, turns, openingOnly, newestTurn]);

  return (
    <div className="qitu-tutor-col qitu-tutor-col-center">
      {offline ? <OfflineBanner readOnly onRetry={onReconnect} /> : null}
      {escalated ? (
        <p className="qitu-tutor-escalation" role="status">
          你的困难已记录。AI搭档会继续提供提示与补救，无需等待老师处理。
        </p>
      ) : null}

      <div
        ref={threadScrollRef}
        className="qitu-chat-thread"
        aria-live="polite"
        onScroll={(event) => {
          const element = event.currentTarget;
          const latest = newestTurn && turnElements.current.get(newestTurn.turnId);
          if (latest) scrollState.current.following = latest.getBoundingClientRect().top
            < element.getBoundingClientRect().bottom - 24;
        }}
      >
        {status === 'loading' && !hasTurns ? (
          <div className="qitu-tutor-thread-loading" aria-busy="true">
            <SkeletonBlock lines={3} height={24} />
            <TypingIndicator />
          </div>
        ) : null}

        {status === 'error' && !hasTurns ? (
          <div>
            <ErrorState
              title={bindingUnavailable ? '这个项目的导师配置需要更新' : '会话没有加载出来'}
              description={bindingUnavailable ? '请联系老师或管理员，在项目模板的导师团队配置中恢复此项目。配置完成后可重试继续学习。' : error?.message}
              errorCode={bindingUnavailable ? undefined : error?.code}
              onRetry={onRetry}
            />
            {bindingUnavailable && projectId && <ProjectConversationHistory key={projectId} projectId={projectId} />}
            {error?.code === 'PROJECT_TEACHING_PLAN_UNAVAILABLE' && projectId ? <ProjectTeachingPlanRecovery projectId={projectId} onRecovered={onRetry} /> : null}
            {bindingUnavailable && onNewExploration && <div style={{ textAlign: 'center' }}>
              <p>你也可以先开启一次新的兴趣探索。</p>
              <button type="button" className="qitu-button qitu-button-ghost" onClick={onNewExploration}>新建探索会话</button>
            </div>}
          </div>
        ) : null}

        {status === 'empty' && !hasTurns ? (
          idle ? <ExplorationWelcome preview onSelectOption={(_, text) => onPrepareDraft?.(text)}
            disabled={disabled || offline || !onPrepareDraft} /> :
          <div className="qitu-tutor-empty-thread">
            <h3>从你的好奇心开始</h3>
            <p>告诉我你想研究的现象、感兴趣的主题，或想亲手做出的作品。</p>
          </div>
        ) : null}

        {turns.flatMap((turn) => [<div key={turn.turnId} data-tutor-turn={turn.turnId} style={{ display: 'grid', minWidth: 0 }} ref={(node) => {
          if (node) turnElements.current.set(turn.turnId, node); else turnElements.current.delete(turn.turnId);
        }}>{!projectId && explorationContext?.exploration && turn.seq === 1 && turn.role === 'assistant'
          && turn.blocks.every(isTutorReplyBlock)
          && turn.blocks.some(block => block.kind === 'options') ? (
          <ExplorationWelcome key={turn.turnId} context={explorationContext} blocks={turn.blocks}
            onSelectOption={onSelectOption} disabled={disabled || offline} />
        ) : (
          <ChatBubble
            key={turn.turnId}
            turn={turn}
            currentAssistantName={currentAssistantName}
            onSelectOption={onSelectOption}
            onSubmitQuestionAnswer={onSubmitQuestionAnswer}
            onOneClickCreateProject={onOneClickCreateProject}
            onRequestQuizExplanation={onRequestQuizExplanation}
            onAnswerQuiz={onAnswerQuiz}
            onExperimentAction={onExperimentAction}
            onFeedback={onFeedback}
            projectId={projectId}
            coursewareSnapshots={coursewareSnapshots}
            experimentTurns={experimentTurns}
            projectContext={projectContext}
            disabled={disabled || offline}
            streaming={turn.turnId === streamingTurnId}
          />
        )}</div>,
        // A stable sibling key preserves reading position and pending answers
        // when the lesson controls move alongside a new completed reply.
        learningActivity && turn.turnId === activityTurnId ? <div
          key={`learning-activity:${sessionId}`} className="qitu-chat-learning-activity"
          data-learning-activity-turn={turn.turnId} aria-label="当前课件与课时任务">
          {learningActivity}
        </div> : null])}
        {showIndicator ? <TypingIndicator label={runningToolLabel ?? 'AI搭档正在思考'} /> : null}

        {status === 'error' && hasTurns ? (
          <ErrorState
            title="刚才这一步没有成功"
            description={error?.message}
            errorCode={error?.code}
            onRetry={onRetry}
          />
        ) : null}
      </div>
      {isConfirmingProject ? <span className="qitu-sr-only" role="status">正在创建项目</span> : null}
      {composer}
    </div>
  );
}

function lastAssistantTurn(turns: readonly TutorTurn[]): TutorTurn | null {
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    const turn = turns[index];
    if (turn?.role === 'assistant') return turn;
  }
  return null;
}
