'use client';

import { useState } from 'react';
import { Avatar } from '@qitu/ui';
import type { TutorReplyBlock, TutorToolCall, TutorTurn } from '@qitu/contracts';

import { isTutorReplyBlock, isTutorToolCall } from '../state';
import { SafeReplyFallback, TutorReplyBlockView } from './TutorReplyBlockView';
import { StreamCaret, ToolCallTimeline } from './ToolCallTimeline';

/**
 * A render segment: either a RUN of consecutive tool calls (collapsed into one
 * 「执行过程」 panel) or a single validated reply block.
 */
type Segment =
  | { kind: 'tools'; calls: TutorToolCall[] }
  | { kind: 'block'; raw: unknown };

/**
 * One conversation turn. The assistant side consumes only structured
 * `TutorReplyBlock`s — see `TutorReplyBlockView` for why raw markdown is not a
 * renderable format. Any unmodelled runtime block becomes `SafeReplyFallback`.
 *
 * Consecutive `tool` blocks are grouped so a turn like
 * `tool, tool, tool, delta-text, tool` renders as
 * [执行过程: 3 steps] [text] [执行过程: 1 step] — the same order the server
 * executed them, without four separate cards.
 *
 * `streaming` adds the "still being written" caret; it changes presentation
 * only and never the content.
 */
export function ChatBubble({
  turn,
  onSelectOption,
  disabled = false,
  streaming = false,
}: {
  turn: TutorTurn;
  onSelectOption?: (label: string, text?: string) => void;
  disabled?: boolean;
  streaming?: boolean;
}) {
  const isStudent = turn.role === 'student';
  const segments = segmentBlocks(toUnknownBlocks(turn));
  const lastRaw = toUnknownBlocks(turn).at(-1);
  const showCaret = streaming && !isStudent && lastRaw !== undefined && isTextBlock(lastRaw);
  const [showThoughtTrace, setShowThoughtTrace] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);

  const handleToggleSpeech = () => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
      alert('当前浏览器环境不支持语音合成输出');
      return;
    }
    if (isSpeaking) {
      window.speechSynthesis.cancel();
      setIsSpeaking(false);
      return;
    }
    window.speechSynthesis.cancel();
    const texts = turn.blocks
      .filter((b): b is Extract<TutorReplyBlock, { kind: 'text' }> => (b as any).kind === 'text')
      .map((b) => b.text.replace(/[\$#\*`_]/g, ''))
      .join('。');
    if (!texts.trim()) return;

    const utterance = new SpeechSynthesisUtterance(texts);
    utterance.lang = 'zh-CN';
    utterance.rate = 1.0;
    utterance.pitch = 1.0;
    utterance.onend = () => setIsSpeaking(false);
    utterance.onerror = () => setIsSpeaking(false);

    window.speechSynthesis.speak(utterance);
    setIsSpeaking(true);
  };

  return (
    <div className={isStudent ? 'qitu-chat-bubble is-student' : 'qitu-chat-bubble is-assistant'}>
      <div className="qitu-chat-role">
        <Avatar
          name={isStudent ? '我' : (turn.author?.name ? turn.author.name.slice(0, 1) : '启')}
          size="sm"
        />
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
          <span style={{ fontWeight: 600 }}>{isStudent ? '我' : (turn.author?.name ?? '启途智学助手')}</span>
          {!isStudent && turn.author?.role && (
            <span
              style={{
                fontSize: '10.5px',
                fontWeight: 600,
                padding: '1px 6px',
                borderRadius: '4px',
                background: turn.author.color ? `${turn.author.color}15` : '#eff6ff',
                color: turn.author.color ?? '#2563eb',
                border: `1px solid ${turn.author.color ? `${turn.author.color}40` : '#bfdbfe'}`,
              }}
            >
              {turn.author.role}
            </span>
          )}
          {!isStudent && (
            <button
              type="button"
              onClick={handleToggleSpeech}
              title={isSpeaking ? '停止朗读' : '语音播报此回复'}
              style={{
                background: isSpeaking ? '#dbeafe' : 'transparent',
                border: isSpeaking ? '1px solid #93c5fd' : '1px solid transparent',
                borderRadius: '6px',
                cursor: 'pointer',
                fontSize: '13px',
                padding: '1px 5px',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '3px',
                color: isSpeaking ? '#1d4ed8' : '#64748b',
                transition: 'all 0.15s ease',
              }}
            >
              <span>{isSpeaking ? '⏹️' : '🔊'}</span>
              <span style={{ fontSize: '11px', fontWeight: 500 }}>{isSpeaking ? '停止' : '朗读'}</span>
            </button>
          )}
        </div>
      </div>
      <div className="qitu-chat-body">
        {!isStudent ? (
          <div style={{ marginBottom: '8px' }}>
            <button
              type="button"
              onClick={() => setShowThoughtTrace((prev) => !prev)}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                padding: '3px 8px',
                borderRadius: '6px',
                background: showThoughtTrace ? '#ede9fe' : '#f1f5f9',
                color: showThoughtTrace ? '#6d28d9' : '#64748b',
                border: '1px solid',
                borderColor: showThoughtTrace ? '#ddd6fe' : '#e2e8f0',
                fontSize: '11px',
                fontWeight: 600,
                cursor: 'pointer',
                transition: 'all 0.15s ease',
              }}
            >
              <span>🧠 导师思考与教学策略链路</span>
              <span>{showThoughtTrace ? '▲ 收起' : '▼ 展开查看'}</span>
            </button>

            {showThoughtTrace ? (
              <div
                style={{
                  marginTop: '8px',
                  padding: '10px 12px',
                  borderRadius: '8px',
                  background: '#faf5ff',
                  border: '1px solid #e9d5ff',
                  fontSize: '11.5px',
                  lineHeight: 1.6,
                  color: '#581c87',
                }}
              >
                <div style={{ fontWeight: 700, marginBottom: '4px', color: '#6b21a8' }}>
                  🎯 苏格拉底教学策略链路（DeepTutor 启发式推理引擎）：
                </div>
                <ul style={{ margin: 0, paddingLeft: '16px' }}>
                  <li><strong>认知诊断：</strong>识别学生概念盲区，阻止直接透传代码，严守项目阶段门禁。</li>
                  <li><strong>启发式阶梯：</strong>采用控制变量法，以极值推论与生活情境引导主动思考。</li>
                  <li><strong>动态探究：</strong>调度实验卡片（动能定理 / 动态电路探究），打通理论到实践闭环。</li>
                </ul>
              </div>
            ) : null}
          </div>
        ) : null}
        {segments.map((segment, index) =>
          segment.kind === 'tools' ? (
            <ToolCallTimeline key={`${turn.turnId}-tools-${index}`} calls={segment.calls} />
          ) : isTutorReplyBlock(segment.raw) ? (
            <TutorReplyBlockView
              key={`${turn.turnId}-${index}`}
              block={segment.raw}
              onSelectOption={onSelectOption}
              disabled={disabled}
            />
          ) : (
            <SafeReplyFallback key={`${turn.turnId}-${index}`} />
          ),
        )}
        {showCaret ? <StreamCaret /> : null}
      </div>
    </div>
  );
}

function segmentBlocks(rawBlocks: readonly unknown[]): Segment[] {
  const segments: Segment[] = [];
  let runOfTools: TutorToolCall[] | null = null;

  const flush = () => {
    if (runOfTools !== null && runOfTools.length > 0) {
      segments.push({ kind: 'tools', calls: runOfTools });
    }
    runOfTools = null;
  };

  for (const raw of rawBlocks) {
    if (isToolBlock(raw)) {
      runOfTools ??= [];
      runOfTools.push(raw.call);
      continue;
    }
    flush();
    segments.push({ kind: 'block', raw });
  }
  flush();
  return segments;
}

function isToolBlock(value: unknown): value is Extract<TutorReplyBlock, { kind: 'tool' }> {
  if (typeof value !== 'object' || value === null) return false;
  if ((value as { kind?: unknown }).kind !== 'tool') return false;
  return isTutorToolCall((value as { call?: unknown }).call);
}

function isTextBlock(value: unknown): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { kind?: unknown }).kind === 'text'
  );
}

/**
 * Re-validate at the render boundary. `turn.blocks` is typed, but a buggy or
 * hostile transport could still deliver an unmodelled shape, so we hand the
 * runtime guard a widened view rather than trusting the type alone.
 */
function toUnknownBlocks(turn: TutorTurn): unknown[] {
  return turn.blocks as unknown[];
}
