'use client';

import type { TutorReplyBlock } from '@qitu/contracts';

export interface OptionChipsProps {
  items: Extract<TutorReplyBlock, { kind: 'options' }>['items'];
  allowOther?: boolean;
  onSelect: (label: string, text?: string) => void;
  disabled?: boolean;
}

/**
 * Modern high-contrast interactive option chips view.
 * Redundant secondary forms are omitted in favor of the primary composer.
 */
export function OptionChips({
  items,
  onSelect,
  disabled = false,
}: OptionChipsProps) {
  return (
    <div className="qitu-tutor-options" role="group" aria-label="快捷选项">
      <div className="qitu-tutor-options-chips">
        {items.map((item) => (
          <button
            key={`${item.label}-${item.text}`}
            type="button"
            className="qitu-tutor-option-chip"
            disabled={disabled}
            onClick={() => onSelect(item.label, item.text)}
            title={item.text && item.text !== item.label ? item.text : item.label}
          >
            <span className="qitu-tutor-option-sparkle" aria-hidden="true">✨</span>
            <span className="qitu-tutor-option-label">{item.label}</span>
            {item.text && item.text !== item.label && (
              <span className="qitu-tutor-option-desc">{item.text}</span>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}
