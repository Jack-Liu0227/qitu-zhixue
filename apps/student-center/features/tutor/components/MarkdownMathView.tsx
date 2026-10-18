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
 * - Rich markdown: bold, inline code, ordered/unordered lists, paragraphs
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
              style={{
                margin: '14px 0',
                padding: '14px 18px',
                background: 'linear-gradient(180deg, #f8fafc 0%, #f1f5f9 100%)',
                border: '1.5px solid #e2e8f0',
                borderRadius: '12px',
                overflowX: 'auto',
                boxShadow: '0 2px 8px rgba(15, 23, 42, 0.03)',
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

  return (
    <>
      {lines.map((line, lIdx) => {
        const trimmed = line.trim();
        if (!trimmed) {
          return <div key={lIdx} style={{ height: '8px' }} />;
        }

        // Unordered list item
        if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
          return (
            <div key={lIdx} style={{ display: 'flex', gap: '8px', margin: '4px 0 4px 12px' }}>
              <span style={{ color: '#2563eb' }}>•</span>
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
              <span style={{ color: '#2563eb', fontWeight: 600, minWidth: '18px' }}>{numMatch[1]}.</span>
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
              style={{
                background: '#f1f5f9',
                color: '#0f172a',
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
            <strong key={idx} style={{ fontWeight: 600, color: '#0f172a' }}>
              <InlineRichText text={bold} />
            </strong>
          );
        }

        return <span key={idx}>{token}</span>;
      })}
    </>
  );
}
