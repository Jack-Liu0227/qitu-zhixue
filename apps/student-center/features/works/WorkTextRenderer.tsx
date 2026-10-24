'use client';

import React, { useState } from 'react';
import katex from 'katex';

export type CerType =
  | 'question'
  | 'claim'
  | 'evidence'
  | 'reasoning'
  | 'limitation'
  | 'revision'
  | 'nextStep'
  | 'reflection';

interface CerConfig {
  type: CerType;
  label: string;
  icon: string;
  borderColor: string;
  bg: string;
  badgeBg: string;
  badgeText: string;
}

const CER_CONFIGS: Record<CerType, CerConfig> = {
  question: {
    type: 'question',
    label: '探究问题',
    icon: '❓',
    borderColor: '#6366f1',
    bg: 'rgba(99, 102, 241, 0.05)',
    badgeBg: '#ede9fe',
    badgeText: '#4338ca',
  },
  claim: {
    type: 'claim',
    label: '核心主张',
    icon: '💡',
    borderColor: '#0284c7',
    bg: 'rgba(2, 132, 199, 0.05)',
    badgeBg: '#e0f2fe',
    badgeText: '#0369a1',
  },
  evidence: {
    type: 'evidence',
    label: '实证依据与观察',
    icon: '🔬',
    borderColor: '#059669',
    bg: 'rgba(5, 150, 105, 0.05)',
    badgeBg: '#d1fae5',
    badgeText: '#047857',
  },
  reasoning: {
    type: 'reasoning',
    label: '科学原理解析',
    icon: '📐',
    borderColor: '#d97706',
    bg: 'rgba(217, 119, 6, 0.05)',
    badgeBg: '#fef3c7',
    badgeText: '#b45309',
  },
  limitation: {
    type: 'limitation',
    label: '适用边界与局限',
    icon: '⚠️',
    borderColor: '#64748b',
    bg: 'rgba(100, 116, 139, 0.05)',
    badgeBg: '#e2e8f0',
    badgeText: '#334155',
  },
  revision: {
    type: 'revision',
    label: '模型修订与优化',
    icon: '🔄',
    borderColor: '#0d9488',
    bg: 'rgba(13, 148, 136, 0.05)',
    badgeBg: '#ccfbf1',
    badgeText: '#0f766e',
  },
  nextStep: {
    type: 'nextStep',
    label: '后续探究与迁移',
    icon: '🚀',
    borderColor: '#2563eb',
    bg: 'rgba(37, 99, 235, 0.05)',
    badgeBg: '#dbeafe',
    badgeText: '#1d4ed8',
  },
  reflection: {
    type: 'reflection',
    label: '学习反思与评估',
    icon: '💭',
    borderColor: '#7c3aed',
    bg: 'rgba(124, 58, 237, 0.05)',
    badgeBg: '#f3e8ff',
    badgeText: '#6d28d9',
  },
};

const CER_PATTERNS: Array<{ regex: RegExp; type: CerType }> = [
  { regex: /^(?:问题|探究问题|核心问题|Question)\s*[:：]\s*/i, type: 'question' },
  { regex: /^(?:主张|核心主张|研究结论|结论|Claim)\s*[:：]\s*/i, type: 'claim' },
  { regex: /^(?:证据|观察证据|实验证据|实证依据|实证数据|Evidence)\s*[:：]\s*/i, type: 'evidence' },
  { regex: /^(?:理由|科学解释|原理解释|原理解析|推理过程|Reasoning)\s*[:：]\s*/i, type: 'reasoning' },
  { regex: /^(?:限制|局限性|适用边界|边界条件|误差分析|Limitations?)\s*[:：]\s*/i, type: 'limitation' },
  { regex: /^(?:修订|模型修订|改进方案|假设修正|Revision)\s*[:：]\s*/i, type: 'revision' },
  { regex: /^(?:下一步|后续探究|迁移预测|迁移探究|Next\s*Steps?)\s*[:：]\s*/i, type: 'nextStep' },
  { regex: /^(?:反思|学习反思|自我评估|自我反思|Reflection)\s*[:：]\s*/i, type: 'reflection' },
];

export interface ModelParameter {
  name: string;
  value: string;
}

export interface ModelObservation {
  metric: string;
  value: string;
}

export interface ControlledModelRecord {
  lesson: number;
  parameters: ModelParameter[];
  observations: ModelObservation[];
}

export interface RuntimeReceipt {
  at?: string;
  level?: number;
  python?: string;
  pygame?: string;
  videoDriver?: string;
  sourceSha256?: string;
  passed?: boolean;
  checks?: string[];
  integerPositionRegression?: Record<string, unknown>;
  scope?: string;
}

type ParsedBlock =
  | { type: 'headerBadge'; tag: string; rest?: string }
  | { type: 'cer'; config: CerConfig; content: string }
  | { type: 'table'; headers: string[]; rows: string[][] }
  | { type: 'modelRecords'; records: ControlledModelRecord[] }
  | { type: 'runtimeReceipt'; receipt: RuntimeReceipt }
  | { type: 'code'; language: string; filename?: string; code: string }
  | { type: 'diary'; entries: string[] }
  | { type: 'heading'; level: number; text: string }
  | { type: 'list'; items: string[]; ordered: boolean }
  | { type: 'paragraph'; text: string };

function renderKaTeX(latex: string, displayMode = false): string | null {
  if (!latex || latex.length > 2048) return null;
  try {
    return katex.renderToString(latex.trim(), {
      displayMode,
      throwOnError: false,
      output: 'htmlAndMathml',
      trust: false,
      strict: 'ignore',
      errorColor: '#b42318',
    });
  } catch {
    return null;
  }
}

/**
 * Text renderer supporting math formulas, bold, code tokens.
 */
function FormattedInline({ text }: { text: string }) {
  if (!text) return null;

  // Split by LaTeX tokens ($...$ or \(...\)), code tokens (`...`), bold tokens (**...**)
  const tokens = text.split(/(`[^`\n]+?`|\*\*[^*]+?\*\*|\$[^$\n]+?\$|\\\[[\s\S]+?\\\]|\\\([\s\S]+?\\\))/g);

  return (
    <>
      {tokens.map((token, idx) => {
        if (!token) return null;

        // 1. Explicit KaTeX math
        if (
          (token.startsWith('$') && token.endsWith('$') && token.length > 2) ||
          (token.startsWith('\\(') && token.endsWith('\\)') && token.length > 4) ||
          (token.startsWith('\\[') && token.endsWith('\\]') && token.length > 4)
        ) {
          const rawMath = token.startsWith('$') ? token.slice(1, -1) : token.slice(2, -2);
          const html = renderKaTeX(rawMath, token.startsWith('\\['));
          if (html !== null) {
            return <span key={idx} dangerouslySetInnerHTML={{ __html: html }} className="qitu-work-katex" />;
          }
          return <code key={idx} className="katex-fallback">{rawMath}</code>;
        }

        // 2. Bold text
        if (token.startsWith('**') && token.endsWith('**') && token.length > 4) {
          return (
            <strong key={idx} className="qitu-work-bold">
              <FormattedInline text={token.slice(2, -2)} />
            </strong>
          );
        }

        // 3. Inline code
        if (token.startsWith('`') && token.endsWith('`') && token.length > 2) {
          return <code key={idx} className="qitu-work-inline-code">{token.slice(1, -1)}</code>;
        }

        // 4. Standard text with formula detection (e.g. I = I₀ (sin β / β)² cos² α or Δx = λD/d)
        return <FormulaOrTextPiece key={idx} text={token} />;
      })}
    </>
  );
}

/**
 * Renders plain text, automatically rendering formulas like `I = I₀ (sin β / β)² cos² α`, `Δx = λD/d`, `a sinθ = λ`, `2λ/a` with KaTeX.
 */
function FormulaOrTextPiece({ text }: { text: string }) {
  // Pattern matching common physics formulas
  const formulaRegex = /(I\s*=\s*I₀\s*\([^\n)]+\)²\s*cos²\s*α|Δx\s*=\s*λD\/d|a\s*sin[θ\s]*=\s*λ|[0-9]*λ\/[a-zA-Z0-9]+)/g;
  const parts = text.split(formulaRegex);

  return (
    <>
      {parts.map((part, pIdx) => {
        if (!part) return null;
        if (formulaRegex.test(part)) {
          const mathHtml = renderKaTeX(part, false);
          if (mathHtml !== null) {
            return <span key={pIdx} dangerouslySetInnerHTML={{ __html: mathHtml }} className="qitu-work-katex" />;
          }
          return <span key={pIdx} className="qitu-work-math-fallback">{part}</span>;
        }
        return <span key={pIdx}>{part}</span>;
      })}
    </>
  );
}

function isTableSeparator(line: string): boolean {
  return /^\s*\|?\s*:?-+:?\s*(\|?\s*:?-+:?\s*)+\|?\s*$/.test(line);
}

function parseMarkdownTable(lines: string[]): { headers: string[]; rows: string[][] } {
  const cleanLine = (l: string) => l.trim().replace(/^\|/, '').replace(/\|$/, '');
  const splitCells = (l: string) => cleanLine(l).split('|').map(c => c.trim());

  const headers = splitCells(lines[0] || '');
  const rows = lines.slice(2).map(splitCells).filter(r => r.length > 0 && r.some(c => c !== ''));
  return { headers, rows };
}

function tryParseModelRecords(text: string): ControlledModelRecord[] | null {
  try {
    const match = text.match(/\[\s*\{[\s\S]*\}\s*\]/);
    if (!match) return null;
    const data = JSON.parse(match[0]);
    if (!Array.isArray(data) || data.length === 0) return null;
    if (data.every(item => typeof item === 'object' && item !== null && ('parameters' in item || 'observations' in item || 'lesson' in item))) {
      return data as ControlledModelRecord[];
    }
  } catch {
    return null;
  }
  return null;
}

function tryParseRuntimeReceipt(text: string): RuntimeReceipt | null {
  try {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return null;
    const data = JSON.parse(match[0]);
    if (typeof data === 'object' && data !== null && ('passed' in data || 'checks' in data || 'level' in data)) {
      return data as RuntimeReceipt;
    }
  } catch {
    return null;
  }
  return null;
}

/**
 * Checks if a string contains multiple inline CER tags (e.g. `Claim: ... Evidence: ... Reasoning: ...`)
 */
function splitInlineCer(text: string): Array<{ type: CerType; content: string }> | null {
  const inlineSplitRegex = /(?=(?:Claim|Evidence|Reasoning|Limitations?|Question|Revision|Next\s*Steps?|Reflection|问题|主张|证据|理由|限制|修订|下一步|反思)\s*[:：])/i;
  const parts = text.split(inlineSplitRegex).map(p => p.trim()).filter(Boolean);
  if (parts.length <= 1) return null;

  const results: Array<{ type: CerType; content: string }> = [];
  for (const part of parts) {
    let matched = false;
    for (const pattern of CER_PATTERNS) {
      if (pattern.regex.test(part)) {
        const content = part.replace(pattern.regex, '').trim();
        results.push({ type: pattern.type, content });
        matched = true;
        break;
      }
    }
    if (!matched && results.length > 0) {
      const last = results[results.length - 1];
      if (last) last.content += ` ${part}`;
    }
  }
  return results.length >= 2 ? results : null;
}

/**
 * Parses raw artifact text into structured semantic blocks.
 */
function parseWorkText(rawText: string): ParsedBlock[] {
  if (!rawText || !rawText.trim()) return [];
  const normalized = rawText.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
  const lines = normalized.split('\n');
  const blocks: ParsedBlock[] = [];

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line === undefined) {
      i++;
      continue;
    }
    const trimmed = line.trim();

    // Skip empty lines
    if (!trimmed) {
      i++;
      continue;
    }

    // 1. Source code block indicator: `完整源码 game.py:`, `对应源码片段：`, `源码:`, etc.
    const codeHeaderMatch = trimmed.match(
      /^(?:完整源码|对应源码片段|源码片段|完整代码|源码实现|Python\s*源码|源码|代码片段|代码|Source\s*Code|Code)(?:\s+([a-zA-Z0-9_.-]+\.[a-zA-Z0-9]+|[a-zA-Z0-9_.-]+))?\s*[:：]\s*(.*)$/i
    );
    if (codeHeaderMatch) {
      const filename = codeHeaderMatch[1];
      const inlineCode = codeHeaderMatch[2];
      const codeLines: string[] = [];
      if (inlineCode && inlineCode.trim()) codeLines.push(inlineCode);
      for (let j = i + 1; j < lines.length; j++) {
        const nextLine = lines[j];
        if (nextLine !== undefined) codeLines.push(nextLine);
      }
      const language = filename && filename.endsWith('.py') ? 'python' : 'python';
      blocks.push({
        type: 'code',
        language,
        filename: filename || undefined,
        code: codeLines.join('\n').trimEnd(),
      });
      break;
    }

    // 2. Fallback: raw code detection (e.g. `"""docstring..."""`, `import random`, `import pygame`, `class Game:`)
    if (
      trimmed.startsWith('"""') ||
      trimmed.startsWith("'''") ||
      /^(?:import\s+[a-zA-Z0-9_]+|from\s+[a-zA-Z0-9_]+\s+import|class\s+[a-zA-Z0-9_]+[:(]|def\s+[a-zA-Z0-9_]+\s*\()/.test(trimmed)
    ) {
      const codeLines: string[] = [line];
      let j = i + 1;
      while (j < lines.length) {
        const nextLine = lines[j];
        if (nextLine === undefined) break;
        if (/^[【\[]/.test(nextLine.trim()) || CER_PATTERNS.some(p => p.regex.test(nextLine.trim()))) {
          break;
        }
        codeLines.push(nextLine);
        j++;
      }
      if (codeLines.length >= 3) {
        blocks.push({
          type: 'code',
          language: 'python',
          filename: 'game.py',
          code: codeLines.join('\n').trimEnd(),
        });
        i = j;
        continue;
      }
    }

    // 2. Markdown fenced code block ```
    if (trimmed.startsWith('```')) {
      const langMatch = trimmed.match(/^```([a-zA-Z0-9_-]*)/);
      const language = langMatch && langMatch[1] ? langMatch[1] : 'code';
      const codeLines: string[] = [];
      i++;
      while (i < lines.length) {
        const codeLine = lines[i];
        if (codeLine === undefined || codeLine.trim().startsWith('```')) break;
        codeLines.push(codeLine);
        i++;
      }
      i++; // skip closing ```
      blocks.push({
        type: 'code',
        language,
        code: codeLines.join('\n'),
      });
      continue;
    }

    // 3. Controlled Model Record JSON block
    if (/(?:受控模型记录|受控物理模型|模型记录[（(]非实测[）)])/i.test(trimmed)) {
      const recordLines: string[] = [trimmed];
      let j = i + 1;
      let combined = trimmed;
      while (j < lines.length && !combined.includes('}]')) {
        const nextLine = lines[j];
        if (nextLine !== undefined) {
          recordLines.push(nextLine);
          combined += `\n${nextLine}`;
        }
        j++;
      }
      const records = tryParseModelRecords(combined);
      if (records) {
        blocks.push({ type: 'modelRecords', records });
        i = j;
        continue;
      }
    }

    // 4. Runtime Receipt JSON block
    if (/实际运行回执\s*[:：]/i.test(trimmed)) {
      const receiptLines: string[] = [trimmed];
      let j = i + 1;
      let combined = trimmed;
      while (j < lines.length && !combined.includes('}')) {
        const nextLine = lines[j];
        if (nextLine !== undefined) {
          receiptLines.push(nextLine);
          combined += `\n${nextLine}`;
        }
        j++;
      }
      const receipt = tryParseRuntimeReceipt(combined);
      if (receipt) {
        blocks.push({ type: 'runtimeReceipt', receipt });
        i = j;
        continue;
      }
    }

    // 5. Markdown Table: line contains | and next line is table separator |---|---|
    const nextLineForTable = lines[i + 1];
    if (trimmed.includes('|') && nextLineForTable !== undefined && isTableSeparator(nextLineForTable)) {
      const tableLines: string[] = [trimmed, nextLineForTable];
      i += 2;
      while (i < lines.length) {
        const tableLine = lines[i];
        if (tableLine === undefined || !tableLine.trim().includes('|')) break;
        tableLines.push(tableLine);
        i++;
      }
      const table = parseMarkdownTable(tableLines);
      if (table.headers.length > 0) {
        blocks.push({ type: 'table', headers: table.headers, rows: table.rows });
      }
      continue;
    }

    // 6. Evidence Diary block
    if (/^(?:\[证据日记\]|【证据日记】)/i.test(trimmed)) {
      const entries: string[] = [];
      const firstText = trimmed.replace(/^(?:\[证据日记\]|【证据日记】)\s*/i, '').trim();
      if (firstText) entries.push(firstText);
      i++;
      while (i < lines.length) {
        const diaryLine = lines[i];
        if (diaryLine === undefined || !diaryLine.trim() || /^[【\[]/.test(diaryLine.trim())) break;
        entries.push(diaryLine.trim());
        i++;
      }
      blocks.push({ type: 'diary', entries });
      continue;
    }

    // 7. Header Tag: e.g. `【合成测试样例】第5课，review。`
    const headerMatch = trimmed.match(/^【(.*?)】\s*(.*)$/);
    if (headerMatch && headerMatch[1] !== undefined) {
      blocks.push({
        type: 'headerBadge',
        tag: headerMatch[1],
        rest: headerMatch[2] || undefined,
      });
      i++;
      continue;
    }

    // 8. Check for Inline CER (multiple CER labels in one paragraph)
    const inlineCers = splitInlineCer(trimmed);
    if (inlineCers) {
      for (const item of inlineCers) {
        blocks.push({
          type: 'cer',
          config: CER_CONFIGS[item.type],
          content: item.content,
        });
      }
      i++;
      continue;
    }

    // 9. Standard CER paragraph
    let cerMatched = false;
    for (const pattern of CER_PATTERNS) {
      if (pattern.regex.test(trimmed)) {
        let content = trimmed.replace(pattern.regex, '').trim();
        // Check if next lines are continuation of this CER
        i++;
        while (i < lines.length) {
          const cerLine = lines[i];
          if (
            cerLine === undefined ||
            !cerLine.trim() ||
            CER_PATTERNS.some(p => p.regex.test(cerLine.trim())) ||
            cerLine.trim().startsWith('【') ||
            cerLine.trim().startsWith('[') ||
            cerLine.trim().startsWith('|') ||
            cerLine.trim().startsWith('```') ||
            cerLine.trim().includes('受控模型记录') ||
            cerLine.trim().includes('实际运行回执') ||
            cerLine.trim().includes('源码片段')
          ) {
            break;
          }
          content += `\n${cerLine.trim()}`;
          i++;
        }
        blocks.push({
          type: 'cer',
          config: CER_CONFIGS[pattern.type],
          content,
        });
        cerMatched = true;
        break;
      }
    }
    if (cerMatched) continue;

    // 10. Headings: `# `, `## `, `### `
    const headingMatch = trimmed.match(/^(#{1,3})\s+(.*)$/);
    if (headingMatch && headingMatch[1] !== undefined && headingMatch[2] !== undefined) {
      blocks.push({
        type: 'heading',
        level: headingMatch[1].length,
        text: headingMatch[2],
      });
      i++;
      continue;
    }

    // 11. Unordered list
    if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
      const items: string[] = [trimmed.slice(2).trim()];
      i++;
      while (i < lines.length) {
        const listLine = lines[i];
        if (listLine === undefined || (!listLine.trim().startsWith('- ') && !listLine.trim().startsWith('* '))) break;
        items.push(listLine.trim().slice(2).trim());
        i++;
      }
      blocks.push({ type: 'list', items, ordered: false });
      continue;
    }

    // 12. Ordered list
    const numMatch = trimmed.match(/^(\d+)\.\s+(.*)$/);
    if (numMatch && numMatch[2] !== undefined) {
      const items: string[] = [numMatch[2].trim()];
      i++;
      while (i < lines.length) {
        const numLine = lines[i];
        if (numLine === undefined || !/^\d+\.\s+/.test(numLine.trim())) break;
        items.push(numLine.trim().replace(/^\d+\.\s+/, '').trim());
        i++;
      }
      blocks.push({ type: 'list', items, ordered: true });
      continue;
    }

    // 13. Regular paragraph
    blocks.push({ type: 'paragraph', text: trimmed });
    i++;
  }

  return blocks;
}

function CodeBlockView({ language, filename, code }: { language: string; filename?: string; code: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      void navigator.clipboard.writeText(code).then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      });
    }
  };

  const codeLines = code.split('\n');

  return (
    <div className="qitu-work-code-block" tabIndex={0} aria-label={`${filename || language} 源码展示`}>
      <div className="qitu-work-code-header">
        <div className="qitu-work-code-title-group">
          <div className="qitu-work-code-dots">
            <span className="qitu-dot-red" />
            <span className="qitu-dot-yellow" />
            <span className="qitu-dot-green" />
          </div>
          <span className="qitu-work-code-lang">
            {filename ? `📄 ${filename} · Python` : (language === 'python' ? '🐍 Python 源码实现' : `${language.toUpperCase()} 源码`)}
          </span>
          <span className="qitu-work-code-linecount">{codeLines.length} 行代码</span>
        </div>
        <button type="button" className="qitu-work-code-copy" onClick={handleCopy}>
          {copied ? '✓ 已复制到剪贴板' : '复制代码'}
        </button>
      </div>
      <div className="qitu-work-code-scroll">
        <pre className="qitu-work-code-pre">
          <code>
            {codeLines.map((line, idx) => (
              <span key={idx} className="qitu-code-line">
                <span className="qitu-code-linenum">{idx + 1}</span>
                <span className="qitu-code-content">{line || ' '}</span>
              </span>
            ))}
          </code>
        </pre>
      </div>
    </div>
  );
}

function ModelRecordsView({ records }: { records: ControlledModelRecord[] }) {
  return (
    <div className="qitu-work-model-dashboard" aria-label="受控物理仿真模型记录">
      <div className="qitu-work-model-banner">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: '18px' }}>🔬</span>
          <div>
            <strong>受控物理模型实验记录（非实测）</strong>
            <p style={{ margin: 0, fontSize: '12px', color: 'var(--qitu-muted)' }}>
              基于受控仿真物理模型生成，提供可复核的参数设定与理论计算指标
            </p>
          </div>
        </div>
      </div>

      <div className="qitu-work-model-list">
        {records.map((rec, rIdx) => (
          <div key={rIdx} className="qitu-work-model-card">
            <div className="qitu-work-model-card-head">
              <span className="qitu-work-model-badge">第 {rec.lesson} 课时实验配置</span>
            </div>

            {Array.isArray(rec.parameters) && rec.parameters.length > 0 && (
              <div className="qitu-work-model-group">
                <span className="qitu-work-model-group-title">控制参数 (Parameters)</span>
                <div className="qitu-work-param-grid">
                  {rec.parameters.map((param, pIdx) => (
                    <div key={pIdx} className="qitu-work-param-pill">
                      <span className="qitu-work-param-name">{param.name}</span>
                      <span className="qitu-work-param-val">{param.value}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {Array.isArray(rec.observations) && rec.observations.length > 0 && (
              <div className="qitu-work-model-group">
                <span className="qitu-work-model-group-title">理论测量与观察指标 (Observations)</span>
                <div className="qitu-work-obs-grid">
                  {rec.observations.map((obs, oIdx) => (
                    <div key={oIdx} className="qitu-work-obs-card">
                      <span className="qitu-work-obs-metric">{obs.metric}</span>
                      <span className="qitu-work-obs-val">{obs.value}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="qitu-work-model-note">
        💡 提示：该记录仅为波动光学受控算法计算结果。进行真实激光实验前，需经指导教师安全审查并全程佩戴防激光护目镜。
      </div>
    </div>
  );
}

function RuntimeReceiptView({ receipt }: { receipt: RuntimeReceipt }) {
  return (
    <div className="qitu-work-receipt-card" aria-label="工程运行与自动化测试回执">
      <div className="qitu-work-receipt-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: '18px' }}>🚀</span>
          <div>
            <strong>自动化运行验证回执</strong>
            <span style={{ marginLeft: 8, fontSize: '12px', color: 'var(--qitu-muted)' }}>
              第 {receipt.level ?? 1} 级功能验证
            </span>
          </div>
        </div>
        <span className={`qitu-work-receipt-status ${receipt.passed !== false ? 'is-passed' : 'is-warning'}`}>
          {receipt.passed !== false ? '✅ 自动化测试已通过' : '⚠️ 需核验'}
        </span>
      </div>

      <div className="qitu-work-receipt-meta">
        {receipt.python && <span>Python {receipt.python}</span>}
        {receipt.pygame && <span>Pygame {receipt.pygame}</span>}
        {receipt.videoDriver && <span>驱动: {receipt.videoDriver}</span>}
        {receipt.at && <span>测试时间: {new Date(receipt.at).toLocaleString('zh-CN')}</span>}
      </div>

      {Array.isArray(receipt.checks) && receipt.checks.length > 0 && (
        <div className="qitu-work-receipt-checks">
          <span className="qitu-work-receipt-checks-title">自动化行为测试项清单 ({receipt.checks.length}项通过)</span>
          <div className="qitu-work-checks-grid">
            {receipt.checks.map((check, cIdx) => (
              <div key={cIdx} className="qitu-work-check-item">
                <span className="qitu-work-check-icon">✓</span>
                <span>{check}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {receipt.scope && (
        <div className="qitu-work-receipt-scope">
          <span>验证范围：</span>{receipt.scope}
        </div>
      )}
    </div>
  );
}

/**
 * High-aesthetic structured text renderer for Student Works Gallery.
 */
export function WorkTextRenderer({ text }: { text: string }) {
  const blocks = parseWorkText(text);

  if (blocks.length === 0) {
    return (
      <div className="qitu-work-empty">
        <p>暂无可预览的文字成果记录。</p>
      </div>
    );
  }

  return (
    <div className="qitu-works-text qitu-work-article">
      {blocks.map((block, idx) => {
        switch (block.type) {
          case 'headerBadge':
            return (
              <div key={idx} className="qitu-work-header-badge-row">
                <span className="qitu-work-header-badge">
                  <span style={{ marginRight: 4 }}>🔖</span>
                  {block.tag}
                </span>
                {block.rest && (
                  <span className="qitu-work-header-rest">
                    <FormattedInline text={block.rest} />
                  </span>
                )}
              </div>
            );

          case 'cer':
            return (
              <section
                key={idx}
                className="qitu-cer-card"
                style={{
                  borderLeftColor: block.config.borderColor,
                  backgroundColor: block.config.bg,
                }}
              >
                <div className="qitu-cer-head">
                  <span
                    className="qitu-cer-badge"
                    style={{
                      backgroundColor: block.config.badgeBg,
                      color: block.config.badgeText,
                    }}
                  >
                    <span style={{ marginRight: 4 }}>{block.config.icon}</span>
                    {block.config.label}
                  </span>
                </div>
                <div className="qitu-cer-content">
                  <FormattedInline text={block.content} />
                </div>
              </section>
            );

          case 'table':
            return (
              <div key={idx} className="qitu-work-table-container">
                <table className="qitu-work-table">
                  <thead>
                    <tr>
                      {block.headers.map((h, hIdx) => (
                        <th key={hIdx}>
                          <FormattedInline text={h} />
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {block.rows.map((row, rIdx) => (
                      <tr key={rIdx}>
                        {row.map((cell, cIdx) => (
                          <td key={cIdx}>
                            <FormattedInline text={cell} />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );

          case 'modelRecords':
            return <ModelRecordsView key={idx} records={block.records} />;

          case 'runtimeReceipt':
            return <RuntimeReceiptView key={idx} receipt={block.receipt} />;

          case 'code':
            return <CodeBlockView key={idx} language={block.language} filename={block.filename} code={block.code} />;

          case 'diary':
            return (
              <div key={idx} className="qitu-work-diary-card">
                <div className="qitu-work-diary-head">
                  <span>📝 证据记录日记</span>
                </div>
                <div className="qitu-work-diary-body">
                  {block.entries.map((entry, eIdx) => (
                    <div key={eIdx} className="qitu-work-diary-entry">
                      <FormattedInline text={entry} />
                    </div>
                  ))}
                </div>
              </div>
            );

          case 'heading': {
            const Tag = block.level === 1 ? 'h3' : block.level === 2 ? 'h4' : 'h5';
            return (
              <Tag key={idx} className="qitu-work-heading">
                <FormattedInline text={block.text} />
              </Tag>
            );
          }

          case 'list':
            return block.ordered ? (
              <ol key={idx} className="qitu-work-list is-ordered">
                {block.items.map((item, lIdx) => (
                  <li key={lIdx}>
                    <FormattedInline text={item} />
                  </li>
                ))}
              </ol>
            ) : (
              <ul key={idx} className="qitu-work-list is-unordered">
                {block.items.map((item, lIdx) => (
                  <li key={lIdx}>
                    <FormattedInline text={item} />
                  </li>
                ))}
              </ul>
            );

          case 'paragraph':
          default:
            return (
              <p key={idx} className="qitu-work-paragraph">
                <FormattedInline text={block.text} />
              </p>
            );
        }
      })}
    </div>
  );
}
