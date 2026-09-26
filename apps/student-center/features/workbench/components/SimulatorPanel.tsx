'use client';

import { useState } from 'react';
import type { SimScenario, SimulatorTranscriptEntry } from '../types/workbench';

export interface SimulatorPanelProps {
  scenario: SimScenario;
  transcript: SimulatorTranscriptEntry[];
  sending: boolean;
  error: string | null;
  disabled: boolean;
  onSend: (input: string) => void;
  onReset: () => void;
}

/**
 * Simulator 试聊面板。
 *
 * 每轮「试聊」由 `useSimulatorRun` 调 `POST /projects/:id/simulator-runs` 持久化；
 * 运行记录**不进入项目证据**。「重置对话」只清客户端 run id，不新增端点。
 * 转写仅存在内存，绝不写入离线草稿缓冲。
 */
export function SimulatorPanel({
  scenario,
  transcript,
  sending,
  error,
  disabled,
  onSend,
  onReset,
}: SimulatorPanelProps) {
  const [input, setInput] = useState('');

  const submit = () => {
    const value = input.trim();
    if (value === '' || disabled || sending) return;
    onSend(value);
    setInput('');
  };

  return (
    <div className="qitu-simulator-panel" data-empty={transcript.length === 0 ? 'true' : 'false'}>
      <div className="qitu-simulator-scenario">
        <span className="qitu-simulator-bot">{scenario.botName || '机器人'}</span>
        <p>{scenario.openingMessage || '（尚未设置开场白，去「模拟器」草稿里写一句吧）'}</p>
      </div>
      <div className="qitu-simulator-transcript" aria-live="polite">
        {transcript.length === 0 ? (
          <p className="qitu-simulator-hint">开始试聊…</p>
        ) : (
          transcript.map((entry, index) => (
            <div key={`${entry.at}-${index}`} className={`qitu-simulator-turn is-${entry.role}`}>
              <span className="qitu-simulator-role">{entry.role === 'student' ? '我' : scenario.botName || '机器人'}</span>
              <p>{entry.text}</p>
            </div>
          ))
        )}
        {sending ? <p className="qitu-simulator-hint">正在发送…</p> : null}
        {error ? <p className="qitu-simulator-error">试聊失败，请重试。</p> : null}
      </div>
      <div className="qitu-simulator-composer">
        <input
          value={input}
          disabled={disabled || sending}
          placeholder="输入一句话开始试聊"
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') submit();
          }}
        />
        <button type="button" className="qitu-button qitu-button-primary" onClick={submit} disabled={disabled || sending}>
          试聊
        </button>
        <button type="button" className="qitu-button qitu-button-ghost" onClick={onReset} disabled={disabled}>
          {scenario.resetPrompt || '重置对话'}
        </button>
      </div>
      <p className="qitu-simulator-note">试聊记录会被保存用于回放，但不会计入项目证据。</p>
    </div>
  );
}
