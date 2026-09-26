'use client';

import { useState } from 'react';
import type { PedagogicMove } from '@qitu/contracts';
import { EmptyState, RobotMascot } from '@qitu/ui';
import type { TutorSuggestion } from '../types/workbench';

export interface TutorAdviceRailProps {
  projectId: string;
  sessionId: string | null;
  suggestions: TutorSuggestion[];
  disabled: boolean;
  onAsk: (move: PedagogicMove) => void;
  onSend: (text: string) => void;
}

/** The 4-icon capability subset (of the 6-move vocabulary) shown in the rail. */
const CAPABILITIES: { move: PedagogicMove; label: string; hint: string }[] = [
  { move: 'hint', label: '给点提示', hint: '卡住时先要一个提示' },
  { move: 'scaffold', label: '拆解步骤', hint: '把大问题拆成小步' },
  { move: 'review_work', label: '帮我看草稿', hint: '让 AI 读一下当前草稿' },
  { move: 'explain', label: '讲清楚', hint: '需要直接解释概念' },
];

export function TutorAdviceRail({
  projectId,
  sessionId,
  suggestions,
  disabled,
  onAsk,
  onSend,
}: TutorAdviceRailProps) {
  const [input, setInput] = useState('');

  const submit = () => {
    const value = input.trim();
    if (value === '' || disabled) return;
    onSend(value);
    setInput('');
  };

  return (
    <aside className="qitu-tutor-advice" aria-label="AI搭档建议">
      <header className="qitu-tutor-advice-head">
        <RobotMascot size={48} mood="thinking" />
        <div>
          <h2>AI搭档</h2>
          <p className="qitu-tutor-advice-project">项目 {projectId}</p>
          {sessionId ? <p className="qitu-tutor-advice-session">已连接对话</p> : null}
        </div>
      </header>

      <div className="qitu-tutor-capabilities">
        {CAPABILITIES.map((capability) => (
          <button
            key={capability.move}
            type="button"
            className="qitu-tutor-capability"
            disabled={disabled}
            title={capability.hint}
            onClick={() => onAsk(capability.move)}
          >
            {capability.label}
          </button>
        ))}
      </div>

      {suggestions.length === 0 ? (
        <EmptyState
          title="暂时没有建议"
          description="继续编辑草稿，AI 会结合当前项目给出建议。"
        />
      ) : (
        <ol className="qitu-tutor-suggestions">
          {suggestions.slice(0, 4).map((suggestion, index) => (
            <li key={suggestion.id} className="qitu-tutor-suggestion">
              <span className="qitu-tutor-suggestion-index">{index + 1}</span>
              <div>
                <strong>{suggestion.title}</strong>
                <p>{suggestion.body}</p>
              </div>
            </li>
          ))}
        </ol>
      )}

      <div className="qitu-tutor-composer">
        <input
          value={input}
          disabled={disabled}
          placeholder="问 AI搭档…"
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') submit();
          }}
        />
        <button type="button" className="qitu-button qitu-button-primary" disabled={disabled} onClick={submit}>
          发送
        </button>
      </div>
    </aside>
  );
}
