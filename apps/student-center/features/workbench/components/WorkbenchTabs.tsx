'use client';

import type { WorkbenchKind } from '../types/workbench';

export interface WorkbenchTab {
  kind: WorkbenchKind;
  label: string;
}

/** Fixed tab ↔ kind mapping: 流程设计/代码/模拟器/测试. */
export const WORKBENCH_TABS: readonly WorkbenchTab[] = [
  { kind: 'flow', label: '流程设计' },
  { kind: 'code', label: '代码' },
  { kind: 'sim', label: '模拟器' },
  { kind: 'test', label: '测试' },
];

export interface WorkbenchTabsProps {
  activeKind: WorkbenchKind;
  onChange: (kind: WorkbenchKind) => void;
  disabled?: boolean;
}

export function WorkbenchTabs({ activeKind, onChange, disabled = false }: WorkbenchTabsProps) {
  return (
    <div className="qitu-workbench-tabs" role="tablist" aria-label="工作区">
      {WORKBENCH_TABS.map((tab) => (
        <button
          key={tab.kind}
          type="button"
          role="tab"
          aria-selected={tab.kind === activeKind}
          className={tab.kind === activeKind ? 'qitu-workbench-tab is-active' : 'qitu-workbench-tab'}
          onClick={() => onChange(tab.kind)}
          disabled={disabled && tab.kind !== activeKind}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
