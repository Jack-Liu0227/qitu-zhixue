'use client';

import { useState } from 'react';

export interface HeuristicQuizCardProps {
  questionId: string;
  stem: string;
  type?: 'single' | 'multiple' | 'heuristic';
  options: { key: string; text: string; hint?: string }[];
  explanation?: string;
  selectedKey?: string;
  onSelectOption?: (key: string, text: string) => void;
  disabled?: boolean;
}

export function HeuristicQuizCard({
  stem,
  type = 'single',
  options,
  explanation,
  selectedKey: initialSelectedKey,
  onSelectOption,
  disabled = false,
}: HeuristicQuizCardProps) {
  const [selectedKey, setSelectedKey] = useState<string | undefined>(initialSelectedKey);
  const [showHint, setShowHint] = useState(false);

  const handleSelect = (key: string, text: string) => {
    if (disabled) return;
    setSelectedKey(key);
    onSelectOption?.(key, text);
  };

  return (
    <div className="qitu-quiz-card">
      <div className="qitu-quiz-header">
        <span className="qitu-quiz-badge">
          {type === 'heuristic' ? '💡 启发式思考' : type === 'multiple' ? '多选题' : '单选题'}
        </span>
        <span className="qitu-quiz-hint-tag">项目式引导探索</span>
      </div>

      <h4 className="qitu-quiz-stem">{stem}</h4>

      <div className="qitu-quiz-options">
        {options.map((option) => {
          const isSelected = selectedKey === option.key;
          return (
            <button
              key={option.key}
              type="button"
              className={`qitu-quiz-option-btn${isSelected ? ' is-selected' : ''}`}
              disabled={disabled}
              onClick={() => handleSelect(option.key, option.text)}
            >
              <span className="qitu-quiz-option-key">{option.key}</span>
              <div className="qitu-quiz-option-content">
                <span className="qitu-quiz-option-text">{option.text}</span>
                {option.hint && isSelected ? (
                  <span className="qitu-quiz-option-feedback">{option.hint}</span>
                ) : null}
              </div>
              <span className="qitu-quiz-option-indicator">
                {isSelected ? '✓' : '→'}
              </span>
            </button>
          );
        })}
      </div>

      {/* 确认发送给 Agent 交互栏 */}
      {selectedKey && (
        <div style={{ marginTop: '12px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', background: '#eff6ff', borderRadius: '10px', border: '1px solid #bfdbfe' }}>
          <span style={{ fontSize: '12.5px', color: '#1e40af', fontWeight: 500 }}>
            已选定：<strong style={{ fontWeight: 700 }}>{selectedKey}</strong>（确认后向导师提交你的探究结论）
          </span>
          <button
            type="button"
            disabled={disabled}
            onClick={() => {
              const opt = options.find((o) => o.key === selectedKey);
              if (opt) onSelectOption?.(opt.key, opt.text);
            }}
            style={{
              padding: '6px 16px',
              background: '#2563eb',
              color: '#ffffff',
              border: 'none',
              borderRadius: '8px',
              fontSize: '13px',
              fontWeight: 600,
              cursor: disabled ? 'not-allowed' : 'pointer',
              boxShadow: '0 1px 3px rgba(37,99,235,0.3)',
            }}
          >
            确认提交给导师 ↵
          </button>
        </div>
      )}

      <div className="qitu-quiz-footer">
        <button
          type="button"
          className="qitu-quiz-toggle-hint-btn"
          onClick={() => setShowHint(!showHint)}
        >
          {showHint ? '隐藏思考锦囊' : '💡 查看思考锦囊与提示'}
        </button>

        {showHint ? (
          <div className="qitu-quiz-hint-box">
            <strong>搭档提示：</strong>
            <p>
              从真实问题的核心变量入手，思考输入条件与预期输出之间的因果链条。试着用控制变量的方法分析不同选项带来的差异。
            </p>
          </div>
        ) : null}

        {explanation && selectedKey ? (
          <div className="qitu-quiz-explanation">
            <strong>解析与下一步：</strong>
            <p>{explanation}</p>
          </div>
        ) : null}
      </div>
    </div>
  );
}
