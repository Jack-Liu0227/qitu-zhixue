'use client';

import { useRef, useState } from 'react';
import { Avatar } from '@qitu/ui';
import type { TutorReplyBlock, TutorToolCall, TutorTurn } from '@qitu/contracts';

import { isTutorReplyBlock, isTutorToolCall } from '../state';
import { SafeReplyFallback, TutorReplyBlockView } from './TutorReplyBlockView';
import { StreamCaret, ToolCallTimeline } from './ToolCallTimeline';
import { AttachmentView } from './AttachmentView';
import { serializeTutorTurnForClipboard } from '../lib/serializeTutorTurnForClipboard';
import { createIdempotencyKey } from '../idempotency';

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
  currentAssistantName,
  onSelectOption,
  onSubmitQuestionAnswer,
  onOneClickCreateProject,
  onRequestQuizExplanation,
  onAnswerQuiz,
  onExperimentAction,
  onFeedback,
  projectId,
  disabled = false,
  streaming = false,
}: {
  turn: TutorTurn;
  currentAssistantName?: string;
  onSelectOption?: (label: string, text?: string) => void;
  onSubmitQuestionAnswer?: (answer: string) => void;
  onOneClickCreateProject?: (goal: string, interest: string, templateVersionId: string) => void;
  onRequestQuizExplanation?: (quizId: string) => Promise<void>;
  onAnswerQuiz?: (quizId: string, selectedKeys: string[], idempotencyKey: string) => Promise<import('@qitu/contracts').AnswerInteractiveQuizResponse>;
  onExperimentAction?: (experimentId: string, action: 'submit_prediction' | 'run' | 'record_observation', payload: unknown, idempotencyKey: string) => void | Promise<boolean | import('@qitu/contracts').TutorExperimentActionResponse>;
  onFeedback?: (turnId: string, kind: import('@qitu/contracts').TutorFeedbackKind, idempotencyKey: string) => Promise<void>;
  projectId?: string | null;
  disabled?: boolean;
  streaming?: boolean;
}) {
  const isStudent = turn.role === 'student';
  const segments = segmentBlocks(toUnknownBlocks(turn));
  const lastRaw = toUnknownBlocks(turn).at(-1);
  const showCaret = streaming && !isStudent && lastRaw !== undefined && isTextBlock(lastRaw);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [copied, setCopied] = useState(false);
  const [feedbackSent, setFeedbackSent] = useState<import('@qitu/contracts').TutorFeedbackKind | null>(null);
  const [feedbackPending, setFeedbackPending] = useState(false);
  const [feedbackError, setFeedbackError] = useState<string | null>(null);
  const feedbackKeysRef = useRef(new Map<import('@qitu/contracts').TutorFeedbackKind, string>());
  const [speechRate, setSpeechRate] = useState<number>(() => {
    if (typeof window !== 'undefined') {
      try {
        const cached = localStorage.getItem('qitu.tts.rate');
        if (cached) {
          const num = parseFloat(cached);
          if (!isNaN(num) && num > 0) return num;
        }
      } catch {
        // ignore
      }
    }
    return 1.25; // 默认 1.25 倍速，语速更清脆自然
  });

  const SPEEDS = [1.0, 1.25, 1.5, 2.0];

  const handleCycleSpeed = (e: React.MouseEvent) => {
    e.stopPropagation();
    const curIdx = SPEEDS.indexOf(speechRate);
    const nextRate = SPEEDS[(curIdx + 1) % SPEEDS.length] ?? 1.25;
    setSpeechRate(nextRate);
    try {
      localStorage.setItem('qitu.tts.rate', String(nextRate));
    } catch {
      // ignore
    }
    if (isSpeaking && typeof window !== 'undefined' && 'speechSynthesis' in window) {
      // 正在朗读时调整倍速：重新以新语速启播
      window.speechSynthesis.cancel();
      setIsSpeaking(false);
      setTimeout(() => {
        playSpeech(nextRate);
      }, 50);
    }
  };

  const playSpeech = (rate = speechRate) => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
      alert('当前浏览器环境不支持语音合成输出');
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
    utterance.rate = rate;
    utterance.pitch = 1.0;
    utterance.onend = () => setIsSpeaking(false);
    utterance.onerror = () => setIsSpeaking(false);

    window.speechSynthesis.speak(utterance);
    setIsSpeaking(true);
  };

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
    playSpeech(speechRate);
  };

  const handleCopyTurn = async () => {
    const text = serializeTutorTurnForClipboard(turn);
    if (!text) return;
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
      } else if (typeof document !== 'undefined') {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignore clipboard error
    }
  };

  const defaultAssistantName = currentAssistantName || '启途智学助手';
  const displayName = isStudent ? '我' : (turn.author?.name || defaultAssistantName);
  const avatarName = isStudent ? '我' : (displayName ? displayName.slice(0, 1) : '启');

  return (
    <div className={isStudent ? 'qitu-chat-bubble is-student' : 'qitu-chat-bubble is-assistant'}>
      <div className="qitu-chat-role">
        <Avatar
          name={avatarName}
          size="sm"
        />
        <div className="qitu-chat-role-details">
          <span className="qitu-chat-author" style={{ fontWeight: 600 }}>{displayName}</span>
          {!isStudent && turn.author?.role && (
            <span
              className="qitu-chat-author-role"
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

          {/* 纯文本与公式复制按钮（遵守防敏感信息脱敏与纯文本 TeX 导出规范） */}
          <button
            type="button"
            onClick={handleCopyTurn}
            title={copied ? '已复制到剪贴板' : '复制此条对话内容（Markdown + TeX）'}
            style={{
              background: copied ? '#ecfdf5' : 'transparent',
              border: copied ? '1px solid #6ee7b7' : '1px solid transparent',
              borderRadius: '6px',
              cursor: 'pointer',
              fontSize: '12px',
              padding: '1px 6px',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '3px',
              color: copied ? '#059669' : '#64748b',
              transition: 'all 0.15s ease',
            }}
          >
            <span>{copied ? '✓' : '📋'}</span>
            <span style={{ fontSize: '11px', fontWeight: 500 }}>{copied ? '已复制' : '复制'}</span>
          </button>

          {!isStudent && (
            <div className="qitu-chat-speech-actions">
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
                  padding: '1px 6px',
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

              {/* 倍速切换按钮 */}
              <button
                type="button"
                onClick={handleCycleSpeed}
                title={`点击切换朗读倍速 (当前 ${speechRate}x)`}
                style={{
                  background: speechRate !== 1.0 ? '#eff6ff' : '#f8fafc',
                  border: '1px solid',
                  borderColor: speechRate !== 1.0 ? '#bfdbfe' : '#e2e8f0',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  fontSize: '10.5px',
                  padding: '1px 5px',
                  fontWeight: 600,
                  color: speechRate !== 1.0 ? '#2563eb' : '#64748b',
                  transition: 'all 0.15s ease',
                }}
              >
                {speechRate}x
              </button>
            </div>
          )}
        </div>
      </div>
      <div className="qitu-chat-body">
        {turn.attachments && turn.attachments.length > 0 ? (
          <div className="qitu-chat-attachments" style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginBottom: '8px' }}>
            {turn.attachments.map((att, attIdx) => (
              <AttachmentView
                key={att.id || `att-${attIdx}`}
                attachment={{
                  id: att.id,
                  fileName: att.name,
                  fileType: att.type === 'image' ? 'image' : 'document',
                  url: att.url,
                  sizeText: att.sizeText,
                }}
              />
            ))}
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
              onSubmitQuestionAnswer={onSubmitQuestionAnswer}
              onOneClickCreateProject={onOneClickCreateProject}
              onRequestQuizExplanation={onRequestQuizExplanation}
              onAnswerQuiz={onAnswerQuiz}
              onExperimentAction={onExperimentAction}
              projectId={projectId}
              disabled={disabled}
            />
          ) : (
            <SafeReplyFallback key={`${turn.turnId}-${index}`} />
          ),
        )}
        {showCaret ? <StreamCaret /> : null}
        {!isStudent && onFeedback && !streaming ? (
          <div className="qitu-tutor-feedback-actions" role="group" aria-label="回复反馈">
            <span>这条回复对你有帮助吗？</span>
            {(['helpful', 'confusing', 'stuck'] as const).map((kind) => (
              <button
                key={kind}
                type="button"
                disabled={feedbackPending || feedbackSent !== null || disabled}
                onClick={() => {
                  const idempotencyKey = feedbackKeysRef.current.get(kind) ?? createIdempotencyKey();
                  feedbackKeysRef.current.set(kind, idempotencyKey);
                  setFeedbackPending(true);
                  setFeedbackError(null);
                  void onFeedback(turn.turnId, kind, idempotencyKey)
                    .then(() => { setFeedbackSent(kind); feedbackKeysRef.current.delete(kind); })
                    .catch((error: unknown) => setFeedbackError(error instanceof Error ? error.message : '反馈暂未送达，请重试'))
                    .finally(() => setFeedbackPending(false));
                }}
              >
                {feedbackSent === kind ? '已记录' : kind === 'helpful' ? '有帮助' : kind === 'confusing' ? '没看懂' : '我卡住了'}
              </button>
            ))}
            {feedbackError ? <span role="alert">{feedbackError}</span> : null}
          </div>
        ) : null}
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
