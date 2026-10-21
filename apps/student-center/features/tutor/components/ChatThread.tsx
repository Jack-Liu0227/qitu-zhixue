'use client';

import { useEffect, useLayoutEffect, useRef, type ReactNode } from 'react';
import type { TutorProjectContext, TutorTurn } from '@qitu/contracts';
import { EmptyState, ErrorState, OfflineBanner, SkeletonBlock } from '@qitu/ui';
import type { TutorLoadStatus, TutorViewError } from '../types';
import { findRunningToolLabel, isTutorReplyBlock } from '../state';
import { ChatBubble } from './ChatBubble';
import { TypingIndicator } from './TypingIndicator';
import { ProjectConversationHistory } from './ProjectConversationHistory';
import { ProjectTeachingPlanRecovery } from './ProjectTeachingPlanRecovery';
import { ExplorationWelcome } from './ExplorationWelcome';

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
  explorationContext?: TutorProjectContext;
  idle?: boolean;
}) {
  const hasTurns = turns.length > 0;
  const bindingUnavailable = error?.code === 'PROJECT_BINDING_RECONFIRM_REQUIRED'
    || error?.code === 'PROJECT_TEACHING_BUNDLE_UNAVAILABLE' || error?.code === 'PROJECT_TEAM_UNAVAILABLE';
  const newestAssistant = lastAssistantTurn(turns);
  const newestTurn = turns.at(-1);
  const openingOnly = !projectId && Boolean(explorationContext?.exploration) && turns.length === 1
    && newestTurn?.seq === 1 && newestTurn.role === 'assistant';
  const streamingTurnId = streaming && newestAssistant !== null ? newestAssistant.turnId : null;
  const showIndicator =
    streaming &&
    status !== 'loading' &&
    (newestTurn?.role !== 'assistant' || newestAssistant === null || newestAssistant.blocks.length === 0);
  const runningToolLabel = findRunningToolLabel(turns);
  const threadScrollRef = useRef<HTMLDivElement | null>(null);
  const nearBottomRef = useRef(true);

  useLayoutEffect(() => {
    const element = threadScrollRef.current;
    if (!element) return;
    element.scrollTo({ top: openingOnly ? 0 : element.scrollHeight, left: 0, behavior: 'auto' });
    nearBottomRef.current = true;
  }, [sessionId, openingOnly]);

  useEffect(() => {
    const element = threadScrollRef.current;
    if (!element || sessionId === null || status === 'loading') return;
    if (!openingOnly && !nearBottomRef.current && newestTurn?.role !== 'student') return;
    element.scrollTo({ top: openingOnly ? 0 : element.scrollHeight, left: 0, behavior: 'auto' });
  }, [sessionId, status, streaming, turns, openingOnly, newestTurn?.role]);

  return (
    <div className="qitu-tutor-col qitu-tutor-col-center">
      {offline ? <OfflineBanner readOnly onRetry={onReconnect} /> : null}
      {escalated ? (
        <p className="qitu-tutor-escalation" role="status">
          已经把你的情况告诉班主任啦，他/她会来看看怎么帮你。
        </p>
      ) : null}

      <div
        ref={threadScrollRef}
        className="qitu-chat-thread"
        aria-live="polite"
        onScroll={(event) => {
          const element = event.currentTarget;
          nearBottomRef.current = element.scrollHeight - element.scrollTop - element.clientHeight < 160;
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
          <div className="qitu-tutor-empty-thread">
            <h3>{idle ? '会话已清理，下一次探索由你开启' : '从你的好奇心开始'}</h3>
            <p>{idle ? '可以从左侧继续已有对话，或开始一次新的探索。' : '告诉我你想研究的现象、感兴趣的主题，或想亲手做出的作品。启途智学助手会在对话中整理可确认的项目想法。'}</p>
            <button
              type="button"
              className="qitu-button qitu-button-ghost"
              onClick={() => idle ? onNewExploration?.() : onSelectOption('开始探索', '我想从自己的兴趣开始探索一个项目')}
              disabled={offline || (idle ? !onNewExploration : disabled)}
            >
              开始自由探索
            </button>
          </div>
        ) : null}

        {turns.map((turn) => !projectId && explorationContext?.exploration && turn.seq === 1 && turn.role === 'assistant'
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
            disabled={disabled || offline}
            streaming={turn.turnId === streamingTurnId}
          />
        ))}

        {learningActivity}
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
      {idle ? null : composer}
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
