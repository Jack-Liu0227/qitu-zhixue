'use client';

import type { CodeContent, CodeLanguage } from '../types/workbench';

export interface CodeEditorProps {
  value: CodeContent;
  readOnly: boolean;
  onChange: (next: CodeContent) => void;
}

const LANGUAGES: CodeLanguage[] = ['python', 'javascript', 'typescript'];

export function CodeEditor({ value, readOnly, onChange }: CodeEditorProps) {
  const isEmpty = value.source.trim() === '';
  return (
    <div className="qitu-code-editor" data-empty={isEmpty ? 'true' : 'false'}>
      <div className="qitu-code-editor-bar">
        <label>
          语言
          <select
            value={value.language}
            disabled={readOnly}
            onChange={(event) => onChange({ ...value, language: event.target.value as CodeLanguage })}
          >
            {LANGUAGES.map((language) => (
              <option key={language} value={language}>
                {language}
              </option>
            ))}
          </select>
        </label>
      </div>
      <textarea
        className="qitu-code-editor-area"
        value={value.source}
        readOnly={readOnly}
        spellCheck={false}
        placeholder="开始编写…"
        onChange={(event) => onChange({ ...value, source: event.target.value })}
      />
    </div>
  );
}
