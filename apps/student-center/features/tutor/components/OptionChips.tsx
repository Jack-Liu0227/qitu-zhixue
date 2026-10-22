'use client';

import { useState } from 'react';
import type { TutorReplyBlock } from '@qitu/contracts';

export interface OptionChipsProps {
  items: Extract<TutorReplyBlock, { kind: 'options' }>['items'];
  allowOther?: boolean;
  onSelect: (label: string, text?: string) => void;
  disabled?: boolean;
}

/**
 * Option chips view with high contrast and eye-care mode compatibility.
 */
export function OptionChips({
  items,
  allowOther = false,
  onSelect,
  disabled = false,
}: OptionChipsProps) {
  const [otherOpen, setOtherOpen] = useState(false);
  const [otherText, setOtherText] = useState('');

  return (
    <div className="qitu-tutor-options" role="group" aria-label="快捷选项">
      <div className="qitu-tutor-options-chips">
        {items.map((item) => {
          return (
            <button
              key={`${item.label}-${item.text}`}
              type="button"
              className="qitu-tutor-option-chip"
              disabled={disabled}
              onClick={() => onSelect(item.label, item.text)}
            >
              <span className="qitu-tutor-option-label">{item.label}</span>
              <span className="qitu-tutor-option-text">{item.text}</span>
            </button>
          );
        })}
        {allowOther ? (
          <button
            type="button"
            className="qitu-tutor-option-chip is-other"
            disabled={disabled}
            onClick={() => setOtherOpen((open) => !open)}
          >
            其他
          </button>
        ) : null}
      </div>

      {allowOther && otherOpen ? (
        <form
          className="qitu-tutor-other-expanded"
          onSubmit={(event) => {
            event.preventDefault();
            if (disabled) return;
            const text = otherText.trim();
            if (text.length === 0) return;
            onSelect('其他', text);
            setOtherText('');
            setOtherOpen(false);
          }}
        >
          <div className="qitu-tutor-other-header">
            <div className="qitu-tutor-other-title">
              <span>✍️</span> 自由反馈与调整建议
            </div>
            <button
              type="button"
              className="qitu-tutor-other-close"
              onClick={() => {
                setOtherOpen(false);
                setOtherText('');
              }}
              title="收起反馈框"
            >
              ✕ 收起
            </button>
          </div>

          {/* 快捷灵感标签 */}
          <div className="qitu-tutor-other-tags">
            {[
              '我想先看一个例子',
              '请把这一步讲慢一点',
              '我想比较两种解释',
              '我有不同的观察',
            ].map((tag) => (
              <button
                key={tag}
                type="button"
                className="qitu-tutor-other-tag-btn"
                disabled={disabled}
                onClick={() => setOtherText((prev) => (prev ? `${prev}；${tag}` : tag))}
              >
                + {tag}
              </button>
            ))}
          </div>

          <textarea
            className="qitu-tutor-other-textarea"
            disabled={disabled}
            value={otherText}
            onChange={(event) => setOtherText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                if (disabled) return;
                const text = otherText.trim();
                if (text.length === 0) return;
                onSelect('其他', text);
                setOtherText('');
                setOtherOpen(false);
              }
            }}
            rows={3}
            placeholder="说说你的探究想法、调整方向或具体疑问...（按 Enter 发送，Shift+Enter 换行）"
            aria-label="其他想法"
          />

          <div className="qitu-tutor-other-footer">
            <span className="qitu-tutor-other-hint">
              按 <kbd>Enter</kbd> 发送，<kbd>Shift+Enter</kbd> 换行
            </span>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                type="button"
                className="qitu-tutor-other-cancel"
                onClick={() => {
                  setOtherOpen(false);
                  setOtherText('');
                }}
              >
                取消
              </button>
              <button
                type="submit"
                className="qitu-tutor-other-submit"
                disabled={disabled || !otherText.trim()}
              >
                发送想法 🚀
              </button>
            </div>
          </div>
        </form>
      ) : null}
    </div>
  );
}
