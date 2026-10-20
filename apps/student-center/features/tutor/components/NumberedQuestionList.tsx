'use client';

import { useId, useState, type FormEvent } from 'react';

/** Renders structured prompts with a response field that submits through the tutor session. */
export function NumberedQuestionList({
  items,
  onSubmitAnswer,
  disabled = false,
}: {
  items: string[];
  onSubmitAnswer?: (answer: string) => void;
  disabled?: boolean;
}) {
  const [answer, setAnswer] = useState('');
  const answerId = useId();

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = answer.trim();
    if (!trimmed || disabled) return;
    const prompt = items.map((item, index) => `${index + 1}. ${item}`).join('\n');
    onSubmitAnswer?.(`针对引导问题：\n${prompt}\n\n我的回答：\n${trimmed}`);
    setAnswer('');
  };

  return (
    <div className="qitu-tutor-questions-block">
      <ol className="qitu-tutor-questions">
        {items.map((item, index) => (
          <li key={`${index}-${item}`}>{item}</li>
        ))}
      </ol>
      {onSubmitAnswer ? (
        <form className="qitu-tutor-question-answer" onSubmit={submit}>
          <label htmlFor={answerId}>写下你的想法</label>
          <textarea
            id={answerId}
            value={answer}
            onChange={(event) => setAnswer(event.target.value)}
            placeholder="先说说你的观察或推理……"
            rows={3}
            disabled={disabled}
          />
          <button type="submit" disabled={disabled || !answer.trim()}>
            提交回答
          </button>
        </form>
      ) : null}
    </div>
  );
}
