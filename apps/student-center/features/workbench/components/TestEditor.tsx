'use client';

import { EmptyState } from '@qitu/ui';
import type { TestCase, TestCaseStatus, TestContent } from '../types/workbench';

export interface TestEditorProps {
  value: TestContent;
  readOnly: boolean;
  onChange: (next: TestContent) => void;
}

const STATUS_LABEL: Record<TestCaseStatus, string> = {
  pending: '待运行',
  pass: '通过',
  fail: '失败',
};

const STATUS_CYCLE: Record<TestCaseStatus, TestCaseStatus> = {
  pending: 'pass',
  pass: 'fail',
  fail: 'pending',
};

function nextCaseId(cases: TestCase[]): string {
  return `case-${cases.length + 1}-${Date.now().toString(36)}`;
}

export function TestEditor({ value, readOnly, onChange }: TestEditorProps) {
  const updateCase = (id: string, patch: Partial<TestCase>) => {
    onChange({ cases: value.cases.map((item) => (item.id === id ? { ...item, ...patch } : item)) });
  };

  const addCase = () => {
    onChange({
      cases: [
        ...value.cases,
        { id: nextCaseId(value.cases), name: '', input: '', expected: '', status: 'pending' },
      ],
    });
  };

  const removeCase = (id: string) => {
    onChange({ cases: value.cases.filter((item) => item.id !== id) });
  };

  return (
    <div className="qitu-test-editor">
      {value.cases.length === 0 ? (
        <EmptyState
          title="还没有测试用例"
          description="添加一条用例，写下输入和期望输出。"
          action={
            <button type="button" className="qitu-button qitu-button-primary" onClick={addCase} disabled={readOnly}>
              添加测试用例
            </button>
          }
        />
      ) : (
        <ul className="qitu-test-list">
          {value.cases.map((testCase) => (
            <li key={testCase.id} className="qitu-test-item">
              <input
                className="qitu-test-name"
                value={testCase.name}
                readOnly={readOnly}
                placeholder="用例名称"
                onChange={(event) => updateCase(testCase.id, { name: event.target.value })}
              />
              <textarea
                className="qitu-test-input"
                value={testCase.input}
                readOnly={readOnly}
                placeholder="输入"
                onChange={(event) => updateCase(testCase.id, { input: event.target.value })}
              />
              <textarea
                className="qitu-test-expected"
                value={testCase.expected}
                readOnly={readOnly}
                placeholder="期望输出"
                onChange={(event) => updateCase(testCase.id, { expected: event.target.value })}
              />
              <button
                type="button"
                className={`qitu-test-status is-${testCase.status}`}
                disabled={readOnly}
                onClick={() => updateCase(testCase.id, { status: STATUS_CYCLE[testCase.status] })}
              >
                {STATUS_LABEL[testCase.status]}
              </button>
              <button
                type="button"
                className="qitu-test-remove"
                disabled={readOnly}
                aria-label="删除用例"
                onClick={() => removeCase(testCase.id)}
              >
                删除
              </button>
            </li>
          ))}
        </ul>
      )}
      {value.cases.length > 0 ? (
        <button type="button" className="qitu-button qitu-button-ghost" onClick={addCase} disabled={readOnly}>
          添加测试用例
        </button>
      ) : null}
    </div>
  );
}
