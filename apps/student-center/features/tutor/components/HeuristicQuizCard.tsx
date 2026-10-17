'use client';

import { useMemo, useState } from 'react';
import type { AnswerInteractiveQuizResponse, TutorHintLevel } from '@qitu/contracts';
import { createIdempotencyKey } from '../idempotency';
import { HintLevelIndicator } from './HintLevelIndicator';
import { MarkdownMathView } from './MarkdownMathView';

export interface HeuristicQuizCardProps {
  questionId: string;
  stem: string;
  type?: 'single' | 'multiple' | 'heuristic';
  options: { key: string; text: string; hint?: string }[];
  rationaleHint?: string;
  graded?: { correct: boolean; attempts: number; hintLevel: TutorHintLevel };
  onSubmitAnswer?: (selectedKeys: string[], idempotencyKey: string) => Promise<AnswerInteractiveQuizResponse>;
  onRequestExplanation?: () => Promise<void>;
  disabled?: boolean;
}

/**
 * Quiz UI is deliberately dumb about correctness. The only result it renders
 * is the response returned by the server's grading endpoint.
 */
export function HeuristicQuizCard({
  questionId,
  stem,
  type = 'single',
  options,
  rationaleHint,
  graded,
  onSubmitAnswer,
  onRequestExplanation,
  disabled = false,
}: HeuristicQuizCardProps) {
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  const [pending, setPending] = useState(false);
  const [answer, setAnswer] = useState<AnswerInteractiveQuizResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [explainPending, setExplainPending] = useState(false);
  const [explainError, setExplainError] = useState<string | null>(null);
  const effectiveGrade = answer ?? (graded ? { ...graded, explanation: null, correctKeys: null, conceptDeltas: [], replayed: false, quizId: questionId } : null);
  const idempotencyKey = useMemo(() => createIdempotencyKey(), [questionId]);
  const isMulti = type === 'multiple';

  const toggle = (key: string) => {
    if (disabled || pending || effectiveGrade) return;
    setSelectedKeys((current) => {
      if (!isMulti) return [key];
      return current.includes(key) ? current.filter((item) => item !== key) : [...current, key];
    });
  };

  const submit = async () => {
    if (selectedKeys.length === 0 || disabled || pending || !onSubmitAnswer) return;
    setPending(true);
    setError(null);
    try {
      const result = await onSubmitAnswer(selectedKeys, idempotencyKey);
      setAnswer(result);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '答案暂时无法提交，请重试');
    } finally {
      setPending(false);
    }
  };

  const requestExplanation = async () => {
    if (!onRequestExplanation || explainPending || disabled) return;
    setExplainPending(true);
    setExplainError(null);
    try {
      await onRequestExplanation();
    } catch (cause) {
      setExplainError(cause instanceof Error ? cause.message : '解析暂时无法获取，请重试');
    } finally {
      setExplainPending(false);
    }
  };

  return (
    <section className="qitu-quiz-card" aria-label="互动测验">
      <div className="qitu-quiz-header">
        <span className="qitu-quiz-badge">{type === 'heuristic' ? '启发式思考' : isMulti ? '多选题' : '单选题'}</span>
        {effectiveGrade ? <span className={effectiveGrade.correct ? 'qitu-quiz-result is-correct' : 'qitu-quiz-result is-wrong'}>{effectiveGrade.correct ? '服务端判定：答对' : '服务端判定：继续思考'}</span> : null}
      </div>
      <div className="qitu-quiz-stem"><MarkdownMathView content={stem} /></div>
      <div className="qitu-quiz-options" aria-disabled={disabled || Boolean(effectiveGrade)}>
        {options.map((option) => {
          const selected = selectedKeys.includes(option.key);
          return (
            <button key={option.key} type="button" className={`qitu-quiz-option-btn${selected ? ' is-selected' : ''}`} disabled={disabled || pending || Boolean(effectiveGrade)} onClick={() => toggle(option.key)}>
              <span className="qitu-quiz-option-key">{option.key}</span>
              <span className="qitu-quiz-option-content"><span className="qitu-quiz-option-text">{option.text}</span></span>
              <span className="qitu-quiz-option-indicator" aria-hidden="true">{selected ? '✓' : '→'}</span>
            </button>
          );
        })}
      </div>
      {!effectiveGrade ? <button type="button" className="qitu-button qitu-button-primary qitu-button-sm qitu-quiz-submit" disabled={disabled || pending || selectedKeys.length === 0 || !onSubmitAnswer} onClick={() => void submit()}>{pending ? '正在提交并判分…' : '提交答案'}</button> : null}
      {error ? <p className="qitu-interaction-error" role="alert">{error} <button type="button" onClick={() => void submit()} disabled={pending}>重试</button></p> : null}
      {effectiveGrade ? (
        <div className="qitu-quiz-feedback" role="status">
          <div className="qitu-quiz-grade-meta"><span>第 {effectiveGrade.attempts} 次作答</span><HintLevelIndicator level={effectiveGrade.hintLevel} /></div>
          {rationaleHint && !effectiveGrade.correct ? <p><strong>下一步提示：</strong>{rationaleHint}</p> : null}
          {effectiveGrade.nextGuidance ? <p><strong>服务端引导：</strong>{effectiveGrade.nextGuidance}</p> : null}
          {effectiveGrade.explanation ? <div className="qitu-quiz-explanation"><strong>解析</strong><MarkdownMathView content={effectiveGrade.explanation} /></div> : null}
          {effectiveGrade.conceptDeltas.length > 0 ? <ul className="qitu-quiz-deltas">{effectiveGrade.conceptDeltas.map((delta) => <li key={delta.conceptId}>概念掌握度 {Math.round(delta.before * 100)}% → {Math.round(delta.after * 100)}%{delta.mastered ? ' · 已达标' : ''}</li>)}</ul> : null}
          {!effectiveGrade.explanation && onRequestExplanation ? <button type="button" className="qitu-button qitu-button-ghost qitu-button-sm" disabled={explainPending || disabled} onClick={() => void requestExplanation()}>{explainPending ? '正在请求解析…' : '请求解析'}</button> : null}
          {explainError ? <p className="qitu-interaction-error" role="alert">{explainError}</p> : null}
        </div>
      ) : null}
    </section>
  );
}
