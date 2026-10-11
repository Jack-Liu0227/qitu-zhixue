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
  const [selectedLabel, setSelectedLabel] = useState<string | null>(null);
  const [otherOpen, setOtherOpen] = useState(false);
  const [otherText, setOtherText] = useState('');

  const selectedItem = items.find((i) => i.label === selectedLabel);

  return (
    <div className="qitu-tutor-options">
      <div className="qitu-tutor-option-row">
        {items.map((item) => {
          const isSelected = selectedLabel === item.label;
          return (
            <button
              key={`${item.label}-${item.text}`}
              type="button"
              className={`qitu-tutor-option-chip${isSelected ? ' is-active' : ''}`}
              style={{
                borderColor: isSelected ? '#2563eb' : undefined,
                background: isSelected ? '#eff6ff' : undefined,
                color: isSelected ? '#1d4ed8' : undefined,
                fontWeight: isSelected ? 600 : undefined,
              }}
              disabled={disabled}
              onClick={() => setSelectedLabel(item.label)}
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

      {/* 确认发送按钮 */}
      {selectedItem && (
        <div style={{ marginTop: '10px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 12px', background: '#eff6ff', borderRadius: '8px', border: '1px solid #bfdbfe' }}>
          <span style={{ fontSize: '12px', color: '#1e40af' }}>
            已选择选项 <strong>{selectedItem.label}</strong>：{selectedItem.text}
          </span>
          <button
            type="button"
            disabled={disabled}
            onClick={() => onSelect(selectedItem.label, selectedItem.text)}
            style={{
              padding: '5px 14px',
              background: '#2563eb',
              color: '#ffffff',
              border: 'none',
              borderRadius: '6px',
              fontSize: '12.5px',
              fontWeight: 600,
              cursor: disabled ? 'not-allowed' : 'pointer',
            }}
          >
            确认提交 ↵
          </button>
        </div>
      )}
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
