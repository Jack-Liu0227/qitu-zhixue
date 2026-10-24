'use client';

import React from 'react';
import katex from 'katex';
import { MermaidView } from './MermaidView';

function renderKaTeX(latex: string, displayMode: boolean): string | null {
  if (latex.length > 4096) {
    return null;
  }
  try {
    return katex.renderToString(latex.trim(), {
      displayMode,
      throwOnError: false,
      output: 'htmlAndMathml',
      trust: false,
      strict: 'ignore',
      errorColor: '#b42318',
      maxExpand: 200,
      maxSize: 20,
    });
  } catch {
    return null;
  }
}

/**
 * Enhanced KaTeX & Markdown & Mermaid renderer for PBL tutor.
 * Supports:
 * - Mermaid diagrams: ```mermaid ... ```
 * - Code blocks: ```language ... ```
 * - Block math: $$ ... $$ and \[ ... \]
 * - Inline math: $ ... $ and \( ... \)
 * - Rich markdown: tables, bold, inline code, ordered/unordered lists, paragraphs
 */
export function MarkdownMathView({ content }: { content: string }) {
  if (!content) return null;
  const normalizedContent = content.replace(/\r\n?/g, '\n');

  // Split content by mermaid blocks, code blocks, and block math ($$ ... $$ or \[ ... \])
  const blockRegex = /(```[a-zA-Z0-9_-]*[\s\S]*?```|\$\$[\s\S]*?\$\$|\\\[[\s\S]*?\\\])/g;
  const parts = normalizedContent.split(blockRegex);

  return (
    <div className="qitu-markdown-math-content" style={{ fontSize: '14.5px', lineHeight: 1.75, color: 'inherit' }}>
      {parts.map((part, index) => {
        if (!part) return null;

        // 1. Mermaid code block
        if (/^```mermaid\s/i.test(part) && part.endsWith('```')) {
          const code = part.replace(/^```mermaid\s*/i, '').replace(/```$/, '').trim();
          return <MermaidView key={index} code={code} />;
        }

        // 2. Generic code block
        if (part.startsWith('```') && part.endsWith('```')) {
          const match = part.match(/^```([a-zA-Z0-9_-]*)\s*([\s\S]*?)```$/);
          const lang = match && match[1] ? match[1] : '';
          const code = (match && match[2] ? match[2] : part.slice(3, -3)).trim();
          return (
            <div
              key={index}
              style={{
                margin: '12px 0',
                borderRadius: '8px',
                background: '#0f172a',
                color: '#f8fafc',
                overflow: 'hidden',
                boxShadow: '0 2px 6px rgba(0, 0, 0, 0.08)',
              }}
            >
              {lang ? (
                <div
                  style={{
                    padding: '4px 12px',
                    fontSize: '11px',
                    color: '#94a3b8',
                    background: '#1e293b',
                    borderBottom: '1px solid #334155',
                    textTransform: 'uppercase',
                    fontFamily: 'JetBrains Mono, Consolas, monospace',
                  }}
                >
                  {lang}
                </div>
              ) : null}
              <pre
                style={{
                  margin: 0,
                  padding: '12px 16px',
                  fontSize: '13px',
                  fontFamily: 'JetBrains Mono, Consolas, monospace',
                  overflowX: 'auto',
                  lineHeight: 1.6,
                }}
              >
                <code>{code}</code>
              </pre>
            </div>
          );
        }

        // 3. Block Math: $$ ... $$ or \[ ... \]
        if (
          (part.startsWith('$$') && part.endsWith('$$')) ||
          (part.startsWith('\\[') && part.endsWith('\\]'))
        ) {
          const rawMath = part.startsWith('$$') ? part.slice(2, -2).trim() : part.slice(2, -2).trim();
          const html = renderKaTeX(rawMath, true);

          return (
            <div
              key={index}
              className="qitu-math-block"
              style={{
                margin: '14px 0',
                padding: '14px 18px',
                borderRadius: '12px',
                overflowX: 'auto',
              }}
            >
              {html === null ? <code className="katex-fallback">{rawMath}</code> : <div
                dangerouslySetInnerHTML={{ __html: html }}
                style={{ textAlign: 'center', fontSize: '18px', padding: '6px 0' }}
              />}
            </div>
          );
        }

        // 4. Regular markdown paragraphs / lists
        return <MarkdownParagraph key={index} text={part} />;
      })}
    </div>
  );
}

function MarkdownParagraph({ text }: { text: string }) {
  const lines = text.split('\n');
  let nextLine = 0;

  return (
    <>
      {lines.map((line, lIdx) => {
        if (lIdx < nextLine) return null;
        const table = readMarkdownTable(lines, lIdx);
        if (table) {
          nextLine = table.nextLine;
          const cellStyle: React.CSSProperties = {
            padding: '8px 10px', border: '1px solid var(--qitu-border, #dbe3ef)',
            verticalAlign: 'top', minWidth: '90px', overflowWrap: 'anywhere',
          };
          return (
            <div key={lIdx} role="region" aria-label="教学表格" tabIndex={0}
              style={{ maxWidth: '100%', overflowX: 'auto', margin: '12px 0' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'inherit' }}>
                <thead><tr>{table.headers.map((header, index) => (
                  <th key={index} scope="col" style={{ ...cellStyle, textAlign: table.alignments[index] }}>
                    <InlineRichText text={header} />
                  </th>
                ))}</tr></thead>
                <tbody>{table.rows.map((row, rowIndex) => (
                  <tr key={rowIndex}>{row.map((cell, index) => (
                    <td key={index} style={{ ...cellStyle, textAlign: table.alignments[index] }}>
                      <InlineRichText text={cell} />
                    </td>
                  ))}</tr>
                ))}</tbody>
              </table>
            </div>
          );
        }
        const trimmed = line.trim();
        if (!trimmed) {
          return <div key={lIdx} style={{ height: '8px' }} />;
        }

        // Unordered list item
        if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
          return (
            <div key={lIdx} style={{ display: 'flex', gap: '8px', margin: '4px 0 4px 12px' }}>
              <span className="qitu-list-bullet" style={{ color: 'var(--qitu-primary, #2563eb)' }}>•</span>
              <div>
                <InlineRichText text={trimmed.slice(2)} />
              </div>
            </div>
          );
        }

        // Numbered list item
        const numMatch = trimmed.match(/^(\d+)\.\s+(.*)/);
        if (numMatch && numMatch[1] && numMatch[2]) {
          return (
            <div key={lIdx} style={{ display: 'flex', gap: '8px', margin: '4px 0 4px 12px' }}>
              <span className="qitu-list-num" style={{ color: 'var(--qitu-primary, #2563eb)', fontWeight: 600, minWidth: '18px' }}>{numMatch[1]}.</span>
              <div>
                <InlineRichText text={numMatch[2]} />
              </div>
            </div>
          );
        }

        return (
          <p key={lIdx} style={{ margin: '6px 0' }}>
            <InlineRichText text={line} />
          </p>
        );
      })}
    </>
  );
}

function tableCells(line: string): string[] | null {
  let text = line.trim();
  if (!text.includes('|')) return null;
  if (text.startsWith('|')) text = text.slice(1);
  if (text.endsWith('|') && !text.endsWith('\\|')) text = text.slice(0, -1);
  const cells: string[] = [];
  let cell = '';
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === '\\' && text[index + 1] === '|') {
      cell += '|'; index += 1;
    } else if (char === '|') {
      cells.push(cell.trim()); cell = '';
    } else {
      cell += char;
    }
  }
  cells.push(cell.trim());
  return cells;
}

function readMarkdownTable(lines: string[], start: number) {
  const headers = tableCells(lines[start] ?? '');
  const separators = tableCells(lines[start + 1] ?? '');
  if (!headers || !separators || headers.length !== separators.length
    || !separators.every((cell) => /^:?-{3,}:?$/.test(cell))) return null;
  const alignments = separators.map((cell): 'left' | 'center' | 'right' =>
    cell.endsWith(':') ? (cell.startsWith(':') ? 'center' : 'right') : 'left');
  const rows: string[][] = [];
  let nextLine = start + 2;
  while (nextLine < lines.length) {
    const row = tableCells(lines[nextLine] ?? '');
    // Leave malformed rows visible as prose instead of silently dropping cells.
    if (!row || row.length !== headers.length) break;
    rows.push(row); nextLine += 1;
  }
  return { headers, alignments, rows, nextLine };
}

function InlineRichText({ text }: { text: string }) {
  // Parse inline math ($...$ or \(...\)), code (`...`), bold (**...**)
  const tokens = text.split(/(`[^`\n]+?`|\*\*[^*]+?\*\*|\$[^$\n]+?\$|\\\([\s\S]+?\\\))/g);

  return (
    <>
      {tokens.map((token, idx) => {
        if (!token) return null;

        // Inline math ($...$ or \(...\))
        if (
          (token.startsWith('$') && token.endsWith('$') && token.length > 2) ||
          (token.startsWith('\\(') && token.endsWith('\\)') && token.length > 4)
        ) {
          const rawMath = token.startsWith('$') ? token.slice(1, -1) : token.slice(2, -2);
          const html = renderKaTeX(rawMath, false);
          if (html === null) return <code key={idx} className="katex-fallback">{rawMath}</code>;
          return (
            <span
              key={idx}
              dangerouslySetInnerHTML={{ __html: html }}
              style={{
                display: 'inline-block',
                margin: '0 2px',
                verticalAlign: 'baseline',
              }}
            />
          );
        }

        // Inline code (`...`)
        if (token.startsWith('`') && token.endsWith('`') && token.length > 2) {
          const code = token.slice(1, -1);
          return (
            <code
              key={idx}
              className="qitu-inline-code"
              style={{
                padding: '2px 6px',
                borderRadius: '4px',
                fontFamily: 'JetBrains Mono, Consolas, monospace',
                fontSize: '12.5px',
              }}
            >
              {code}
            </code>
          );
        }

        // Bold (**...**)
        if (token.startsWith('**') && token.endsWith('**') && token.length > 4) {
          const bold = token.slice(2, -2);
          return (
            <strong key={idx} className="qitu-rich-bold" style={{ fontWeight: 600, color: 'var(--qitu-heading, inherit)' }}>
              <InlineRichText text={bold} />
            </strong>
          );
        }

        return <span key={idx}>{token}</span>;
      })}
    </>
  );
}
