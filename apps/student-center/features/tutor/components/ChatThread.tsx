'use client';

import { useEffect, useLayoutEffect, useRef, type ReactNode } from 'react';
import type { TutorTurn } from '@qitu/contracts';
import { EmptyState, ErrorState, OfflineBanner, SkeletonBlock } from '@qitu/ui';
import type { TutorLoadStatus, TutorViewError } from '../types';
import { findRunningToolLabel } from '../state';
import { ChatBubble } from './ChatBubble';
import { TypingIndicator } from './TypingIndicator';

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
  onReconnect,
  onSelectOption,
  onOneClickCreateProject,
  currentAssistantName,
  isConfirmingProject = false,
  composer,
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
  onReconnect: () => void;
  onSelectOption: (label: string, text?: string) => void;
  onOneClickCreateProject?: (goal: string, interest: string) => void;
  currentAssistantName?: string;
  isConfirmingProject?: boolean;
  composer: ReactNode;
}) {
  const hasTurns = turns.length > 0;
  const newestAssistant = lastAssistantTurn(turns);
  const newestTurn = turns.at(-1);
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
    element.scrollTo({ top: element.scrollHeight, left: 0, behavior: 'auto' });
    nearBottomRef.current = true;
  }, [sessionId]);

  useEffect(() => {
    const element = threadScrollRef.current;
    if (!element || sessionId === null || !nearBottomRef.current || status === 'loading') return;
    element.scrollTo({ top: element.scrollHeight, left: 0, behavior: 'auto' });
  }, [sessionId, status, streaming, turns]);

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
          <ErrorState
            title="会话没有加载出来"
            description={error?.message}
            errorCode={error?.code}
            onRetry={onRetry}
          />
        ) : null}

        {status === 'empty' && !hasTurns ? (
          <div className="qitu-tutor-empty-thread">
            <h3>从你的好奇心开始</h3>
            <p>告诉我你想研究的现象、感兴趣的主题，或想亲手做出的作品。启途智学助手会在对话中整理可确认的项目想法。</p>
            <button
              type="button"
              className="qitu-button qitu-button-ghost"
              onClick={() => onSelectOption('开始探索', '我想从自己的兴趣开始探索一个项目')}
              disabled={disabled || offline}
            >
              开始自由探索
            </button>
          </div>
        ) : null}

        {turns.map((turn) => (
          <ChatBubble
            key={turn.turnId}
            turn={turn}
            currentAssistantName={currentAssistantName}
            onSelectOption={onSelectOption}
            onOneClickCreateProject={onOneClickCreateProject}
            disabled={disabled || offline}
            streaming={turn.turnId === streamingTurnId}
          />
        ))}

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
