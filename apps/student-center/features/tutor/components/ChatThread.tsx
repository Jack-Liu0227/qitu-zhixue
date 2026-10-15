'use client';

import { useEffect, useRef, type ReactNode } from 'react';
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
  subAgentHud,
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
  subAgentHud?: ReactNode;
  composer: ReactNode;
}) {
  const hasTurns = turns.length > 0;
  const newestAssistant = lastAssistantTurn(turns);
  const newestTurn = turns.at(-1);
  // Only the newest assistant turn can still be receiving events; giving the
  // caret to every assistant bubble would claim the finished ones are live.
  const streamingTurnId = streaming && newestAssistant !== null ? newestAssistant.turnId : null;
  const showIndicator =
    streaming &&
    status !== 'loading' &&
    (newestTurn?.role !== 'assistant' ||
      newestAssistant === null ||
      newestAssistant.blocks.length === 0);
  // Caption the indicator with the step the server is actually on, so the
  // student reads 「正在查看你的掌握度记录」 instead of a generic spinner.
  const runningToolLabel = findRunningToolLabel(turns);

  const bottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [turns.length, streaming]);

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
          <div
            style={{
              maxWidth: '640px',
              margin: '40px auto',
              padding: '24px',
              background: 'linear-gradient(135deg, #f0f7ff, #ffffff)',
              border: '1.5px solid #bfdbfe',
              borderRadius: '16px',
              boxShadow: '0 8px 24px rgba(37,99,235,0.06)',
              textAlign: 'center',
            }}
          >
            <div style={{ fontSize: '42px', marginBottom: '12px' }}>👋</div>
            <h3 style={{ margin: '0 0 8px', fontSize: '18px', color: '#102a5c', fontWeight: 700 }}>
              你好！我是你的 AI 项目式学习搭档
            </h3>
            <p
              style={{ margin: '0 0 20px', fontSize: '13.5px', color: '#64748b', lineHeight: 1.6 }}
            >
              在启途智学，我们不直接灌输答案，而是陪你一同探究、推导与实践。告诉我有关于你的兴趣、好奇的物理现象或想开发的小游戏，我将为你量身推荐契合的探究课题，并在确认后唤醒专属导师团队全链路陪伴你！
            </p>
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '8px',
                alignItems: 'stretch',
                textAlign: 'left',
              }}
            >
              <div
                style={{ fontSize: '12px', fontWeight: 600, color: '#2563eb', marginBottom: '2px' }}
              >
                💡 试试这样开启我们的第一步：
              </div>
              <button
                type="button"
                onClick={() =>
                  onSelectOption(
                    '我想探究',
                    '我想亲手推导动能定理 W=ΔEk，了解外力做功与速度变化的奥秘',
                  )
                }
                style={{
                  padding: '10px 14px',
                  background: '#ffffff',
                  border: '1px solid #cbd5e1',
                  borderRadius: '10px',
                  fontSize: '13px',
                  color: '#1e293b',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  transition: 'all 0.15s ease',
                }}
              >
                <span>
                  ⚡ <strong>动手学物理</strong>：我想亲手推导动能定理 W=ΔEk，搞懂外力做功与动能转换
                </span>
                <span style={{ color: '#2563eb' }}>→</span>
              </button>
              <button
                type="button"
                onClick={() =>
                  onSelectOption('我想探究', '我想设计并编写一款雷霆战机游戏，学习主循环与碰撞算法')
                }
                style={{
                  padding: '10px 14px',
                  background: '#ffffff',
                  border: '1px solid #cbd5e1',
                  borderRadius: '10px',
                  fontSize: '13px',
                  color: '#1e293b',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  transition: 'all 0.15s ease',
                }}
              >
                <span>
                  🚀 <strong>趣味编程</strong>：我想设计一款雷霆战机游戏，攻克 Pygame
                  游戏主循环与碰撞检测
                </span>
                <span style={{ color: '#2563eb' }}>→</span>
              </button>
              <button
                type="button"
                onClick={() =>
                  onSelectOption(
                    '我想探究',
                    '我想了解生活中常见的过山车与自由落体是如何实现能量转化的',
                  )
                }
                style={{
                  padding: '10px 14px',
                  background: '#ffffff',
                  border: '1px solid #cbd5e1',
                  borderRadius: '10px',
                  fontSize: '13px',
                  color: '#1e293b',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  transition: 'all 0.15s ease',
                }}
              >
                <span>
                  🎢 <strong>现象探秘</strong>：过山车俯冲时为何速度越来越快？带我从能量守恒开始探究
                </span>
                <span style={{ color: '#2563eb' }}>→</span>
              </button>
            </div>
          </div>
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

        {showIndicator ? <TypingIndicator label={runningToolLabel ?? 'AI搭档正在思考'} /> : null}

        {status === 'error' && hasTurns ? (
          <ErrorState
            title="刚才这一步没有成功"
            description={error?.message}
            errorCode={error?.code}
            onRetry={onRetry}
          />
        ) : null}

        <div ref={bottomRef} style={{ height: '1px', width: '100%' }} />
      </div>

      {subAgentHud}
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
