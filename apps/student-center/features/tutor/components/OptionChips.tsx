'use client';

import { useState } from 'react';

/**
 * Renders the `options` reply variant as A/B/C chips plus an 「其他」 affordance
 * when the server allows free input. Selecting a chip sends the option label
 * back as a turn (never a rendered AI decision).
 */
export function OptionChips({
  items,
  allowOther,
  onSelect,
  disabled = false,
}: {
  items: { label: string; text: string }[];
  allowOther: boolean;
  onSelect: (label: string, text?: string) => void;
  disabled?: boolean;
}) {
  const [otherOpen, setOtherOpen] = useState(false);
  const [otherText, setOtherText] = useState('');

  return (
    <div className="qitu-tutor-options">
      <div className="qitu-tutor-option-row">
        {items.map((item) => (
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
        ))}
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
          className="qitu-tutor-other"
          onSubmit={(event) => {
            event.preventDefault();
            const text = otherText.trim();
            if (text.length === 0) return;
            onSelect('其他', text);
            setOtherText('');
            setOtherOpen(false);
          }}
        >
          <input
            value={otherText}
            onChange={(event) => setOtherText(event.target.value)}
            placeholder="说说你的想法…"
            aria-label="其他想法"
          />
          <button type="submit" className="qitu-button qitu-button-primary">
            提交
          </button>
        </form>
      ) : null}
    </div>
  );
}
