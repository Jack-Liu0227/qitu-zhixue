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
          className="qitu-tutor-other-expanded"
          onSubmit={(event) => {
            event.preventDefault();
            const text = otherText.trim();
            if (text.length === 0) return;
            onSelect('其他', text);
            setOtherText('');
            setOtherOpen(false);
          }}
          style={{
            marginTop: '12px',
            padding: '16px',
            background: '#ffffff',
            borderRadius: '12px',
            border: '1.5px solid #bfdbfe',
            boxShadow: '0 4px 16px rgba(37, 99, 235, 0.08)',
            display: 'flex',
            flexDirection: 'column',
            gap: '10px',
            animation: 'fadeIn 0.2s ease',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', fontWeight: 600, color: '#1e3a8a' }}>
              <span>✍️</span> 自由反馈与调整建议
            </div>
            <button
              type="button"
              onClick={() => {
                setOtherOpen(false);
                setOtherText('');
              }}
              style={{
                background: 'none',
                border: 'none',
                color: '#94a3b8',
                fontSize: '13px',
                cursor: 'pointer',
                padding: '2px 6px',
                borderRadius: '4px',
              }}
              title="收起反馈框"
            >
              ✕ 收起
            </button>
          </div>

          {/* 快捷灵感标签 */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
            {[
              '我想换一个更有挑战的课题',
              '我想深入探究几何碰撞数学推导',
              '希望最终做出 Python 仿真动画',
              '作品需要包含战机射击与敌人生成',
            ].map((tag) => (
              <button
                key={tag}
                type="button"
                onClick={() => setOtherText((prev) => (prev ? `${prev}；${tag}` : tag))}
                style={{
                  fontSize: '11.5px',
                  padding: '3px 9px',
                  borderRadius: '20px',
                  background: '#eff6ff',
                  border: '1px solid #dbeafe',
                  color: '#2563eb',
                  cursor: 'pointer',
                  transition: 'all 0.15s ease',
                }}
              >
                + {tag}
              </button>
            ))}
          </div>

          <textarea
            value={otherText}
            onChange={(event) => setOtherText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
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
            style={{
              width: '100%',
              minHeight: '76px',
              padding: '10px 12px',
              border: '1.5px solid #cbd5e1',
              borderRadius: '8px',
              fontSize: '13.5px',
              lineHeight: '1.6',
              color: '#0f172a',
              background: '#f8fafc',
              resize: 'vertical',
              outline: 'none',
              transition: 'border-color 0.2s, box-shadow 0.2s',
              fontFamily: 'inherit',
              boxSizing: 'border-box',
            }}
            onFocus={(e) => {
              e.currentTarget.style.borderColor = '#2563eb';
              e.currentTarget.style.boxShadow = '0 0 0 3px rgba(37, 99, 235, 0.15)';
              e.currentTarget.style.background = '#ffffff';
            }}
            onBlur={(e) => {
              e.currentTarget.style.borderColor = '#cbd5e1';
              e.currentTarget.style.boxShadow = 'none';
              e.currentTarget.style.background = '#f8fafc';
            }}
          />

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingTop: '2px' }}>
            <span style={{ fontSize: '11.5px', color: '#94a3b8' }}>
              按 <kbd style={{ padding: '1px 4px', background: '#e2e8f0', borderRadius: '3px', fontSize: '10.5px' }}>Enter</kbd> 发送，<kbd style={{ padding: '1px 4px', background: '#e2e8f0', borderRadius: '3px', fontSize: '10.5px' }}>Shift+Enter</kbd> 换行
            </span>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                type="button"
                onClick={() => {
                  setOtherOpen(false);
                  setOtherText('');
                }}
                style={{
                  padding: '6px 14px',
                  background: '#f1f5f9',
                  border: '1px solid #e2e8f0',
                  color: '#64748b',
                  borderRadius: '6px',
                  fontSize: '12.5px',
                  fontWeight: 500,
                  cursor: 'pointer',
                }}
              >
                取消
              </button>
              <button
                type="submit"
                disabled={!otherText.trim()}
                style={{
                  padding: '6px 18px',
                  background: otherText.trim() ? '#2563eb' : '#94a3b8',
                  border: 'none',
                  color: '#ffffff',
                  borderRadius: '6px',
                  fontSize: '12.5px',
                  fontWeight: 600,
                  cursor: otherText.trim() ? 'pointer' : 'not-allowed',
                  boxShadow: otherText.trim() ? '0 2px 8px rgba(37, 99, 235, 0.25)' : 'none',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '4px',
                }}
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
