'use client';

import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import type { TutorTurn } from '@qitu/contracts';
import { EmptyState, ErrorState, OfflineBanner, SkeletonBlock } from '@qitu/ui';
import type { TutorLoadStatus, TutorViewError } from '../types';
import { findRunningToolLabel } from '../state';
import { ChatBubble } from './ChatBubble';
import { TypingIndicator } from './TypingIndicator';

/**
 * CENTER COLUMN — the conversation.
 *
 * Implements the NotebookLM-style dialogue area:
 * 1. Top bar with session topic title and 「X sources · cited」 indicator.
 * 2. Clean conversational bubble stream with structured teaching blocks.
 * 3. Floating 「Jump to latest」 pill button with down-arrow.
 * 4. Integrated input capsule composer.
 */
export function ChatThread({
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
  composer,
  sessionTitle,
  sourceCount = 6,
  onCitationClick,
}: {
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
  composer: ReactNode;
  sessionTitle?: string;
  sourceCount?: number;
  onCitationClick?: (index: number) => void;
}) {
  const hasTurns = turns.length > 0;
  const newestAssistant = lastAssistantTurn(turns);
  const streamingTurnId = streaming && newestAssistant !== null ? newestAssistant.turnId : null;
  const showIndicator =
    streaming && hasTurns && (newestAssistant === null || newestAssistant.blocks.length === 0);
  const runningToolLabel = findRunningToolLabel(turns);

  const threadScrollRef = useRef<HTMLDivElement | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const [showJumpToLatest, setShowJumpToLatest] = useState(false);

  // Check scroll position to display the "Jump to latest" pill
  const handleScroll = useCallback(() => {
    const el = threadScrollRef.current;
    if (!el) return;
    const distanceToBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    setShowJumpToLatest(distanceToBottom > 100);
  }, []);

  const scrollToBottom = useCallback((smooth = true) => {
    bottomRef.current?.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto' });
    setShowJumpToLatest(false);
  }, []);

  // Auto-scroll when turns change or stream updates if already near bottom
  useEffect(() => {
    const el = threadScrollRef.current;
    if (!el) return;
    const distanceToBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    if (distanceToBottom < 160 || streaming) {
      scrollToBottom(false);
    }
  }, [turns, streaming, scrollToBottom]);

  return (
    <div className="qitu-tutor-col qitu-tutor-col-center">
      <header className="qitu-chat-top-bar">
        <h2 className="qitu-chat-session-title">
          {sessionTitle || '雷霆战机：从零打造 Python 飞行射击小游戏'}
        </h2>
        <div className="qitu-chat-cited-tag" title="当前会话关联的学习资料与证据">
          <span>{sourceCount} sources · cited</span>
        </div>
      </header>

      {offline ? <OfflineBanner readOnly onRetry={onReconnect} /> : null}
      {escalated ? (
        <p className="qitu-tutor-escalation" role="status">
          已经把你的情况告诉班主任啦，他/她会来看看怎么帮你。
        </p>
      ) : null}

      <div
        className="qitu-chat-thread"
        ref={threadScrollRef}
        onScroll={handleScroll}
        aria-live="polite"
      >
        {status === 'loading' && !hasTurns ? (
          <div className="qitu-tutor-thread-loading" aria-busy="true">
            <SkeletonBlock lines={2} height={24} />
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
          <EmptyState
            title="还没有开始对话"
            description="在下方输入框向 AI搭档提出你的问题，或点「+」让搭档给你提示。"
          />
        ) : null}

        {turns.map((turn) => (
          <ChatBubble
            key={turn.turnId}
            turn={turn}
            onSelectOption={onSelectOption}
            onCitationClick={onCitationClick}
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

        <div ref={bottomRef} style={{ height: 1 }} />
      </div>

      <div className="qitu-composer-container">
        {showJumpToLatest && (
          <button
            type="button"
            className="qitu-jump-to-latest-pill"
            onClick={() => scrollToBottom(true)}
            aria-label="回到底部最新消息"
          >
            <svg
              aria-hidden="true"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
            >
              <path d="M12 5v14M19 12l-7 7-7-7" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <span>Jump to latest</span>
          </button>
        )}
        {composer}
      </div>
    </div>
  );
}

/** The newest assistant turn, or null when there is none. */
function lastAssistantTurn(turns: readonly TutorTurn[]): TutorTurn | null {
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    const turn = turns[index];
    if (turn !== undefined && turn.role === 'assistant') return turn;
  }
  return null;
}
