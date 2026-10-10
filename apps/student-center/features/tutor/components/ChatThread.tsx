'use client';

import type { ReactNode } from 'react';
import type { TutorTurn } from '@qitu/contracts';
import { EmptyState, ErrorState, OfflineBanner, SkeletonBlock } from '@qitu/ui';
import type { TutorLoadStatus, TutorViewError } from '../types';
import { findRunningToolLabel } from '../state';
import { ChatBubble } from './ChatBubble';
import { TypingIndicator } from './TypingIndicator';

/**
 * CENTER COLUMN — the conversation.
 *
 * Renders only server turns; it never constructs a `stageAfter` or a reply
 * block locally. All five states are handled here:
 * loading → skeleton + typing indicator, empty → start prompt,
 * error → retry that KEEPS already-loaded turns, offline → offline banner with
 * read-only history, permission-denied → page-level `PermissionDenied`.
 *
 * STREAMING SURFACE: exactly one bubble is marked `streaming` (the newest
 * assistant turn) so only that one gets the blinking caret. The standalone
 * indicator appears only while that turn still has nothing to show, and its
 * caption names the step the server says it is on.
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
}) {
  const hasTurns = turns.length > 0;
  const newestAssistant = lastAssistantTurn(turns);
  // Only the newest assistant turn can still be receiving events; giving the
  // caret to every assistant bubble would claim the finished ones are live.
  const streamingTurnId = streaming && newestAssistant !== null ? newestAssistant.turnId : null;
  const showIndicator =
    streaming && hasTurns && (newestAssistant === null || newestAssistant.blocks.length === 0);
  // Caption the indicator with the step the server is actually on, so the
  // student reads 「正在查看你的掌握度记录」 instead of a generic spinner.
  const runningToolLabel = findRunningToolLabel(turns);

  return (
    <div className="qitu-tutor-col qitu-tutor-col-center">
      {offline ? <OfflineBanner readOnly onRetry={onReconnect} /> : null}
      {escalated ? (
        <p className="qitu-tutor-escalation" role="status">
          已经把你的情况告诉班主任啦，他/她会来看看怎么帮你。
        </p>
      ) : null}

      <div className="qitu-chat-thread" aria-live="polite">
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
            description="点右边的「给我提示」，让 AI搭档先从一个问题开始陪你思考。"
          />
        ) : null}

        {turns.map((turn) => (
          <ChatBubble
            key={turn.turnId}
            turn={turn}
            onSelectOption={onSelectOption}
            disabled={disabled || offline}
            streaming={turn.turnId === streamingTurnId}
          />
        ))}

        {showIndicator ? (
          <TypingIndicator label={runningToolLabel ?? 'AI搭档正在思考'} />
        ) : null}

        {status === 'error' && hasTurns ? (
          <ErrorState
            title="刚才这一步没有成功"
            description={error?.message}
            errorCode={error?.code}
            onRetry={onRetry}
          />
        ) : null}
      </div>

      {composer}
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
