'use client';

import React from 'react';

/**
 * Lightweight, safe Markdown & Math renderer without heavy external dependencies.
 * Handles:
 * - Block math: $$ ... $$
 * - Inline math: $ ... $
 * - Bold: **text**
 * - Inline code: `code`
 * - Code blocks: ```lang ... ```
 * - Unordered list: - item or * item
 * - Line breaks and paragraphs
 */
export function MarkdownMathView({ content }: { content: string }) {
  if (!content) return null;

  // Split content by block math $$ ... $$
  const parts = content.split(/(\$\$[\s\S]*?\$\$)/g);

  return (
    <div className="qitu-markdown-math-content" style={{ fontSize: '14px', lineHeight: 1.7, color: 'inherit' }}>
      {parts.map((part, index) => {
        if (part.startsWith('$$') && part.endsWith('$$')) {
          const math = part.slice(2, -2).trim();
          return (
            <div
              key={index}
              style={{
                margin: '12px 0',
                padding: '10px 16px',
                background: '#f8fafc',
                border: '1px solid #e2e8f0',
                borderRadius: '8px',
                overflowX: 'auto',
                fontFamily: 'KaTeX_Main, Cambria Math, "Times New Roman", serif',
                fontSize: '16px',
                textAlign: 'center',
                color: '#1e293b',
              }}
            >
              <span style={{ fontWeight: 600, letterSpacing: '0.02em' }}>{math}</span>
            </div>
          );
        }

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
          <p key={lIdx} style={{ margin: '4px 0' }}>
            <InlineRichText text={line} />
          </p>
        );
      })}
    </>
  );
}

function InlineRichText({ text }: { text: string }) {
  // Parse inline math ($...$), code (`...`), bold (**...**)
  const tokens = text.split(/(\$[^$\n]+?\$|`[^`\n]+?`|\*\*[^*]+?\*\*)/g);

  return (
    <>
      {tokens.map((token, idx) => {
        if (token.startsWith('$') && token.endsWith('$') && token.length > 2) {
          const math = token.slice(1, -1);
          return (
            <span
              key={idx}
              style={{
                fontFamily: 'KaTeX_Main, Cambria Math, "Times New Roman", serif',
                padding: '0 3px',
                color: '#1d4ed8',
                fontWeight: 600,
                background: '#eff6ff',
                borderRadius: '4px',
              }}
            >
              {math}
            </span>
          );
        }

        if (token.startsWith('`') && token.endsWith('`') && token.length > 2) {
          const code = token.slice(1, -1);
          return (
            <code
              key={idx}
              style={{
                background: '#f1f5f9',
                color: '#0f172a',
                padding: '1px 5px',
                borderRadius: '4px',
                fontFamily: 'JetBrains Mono, Consolas, monospace',
                fontSize: '12.5px',
              }}
            >
              {code}
            </code>
          );
        }

        if (token.startsWith('**') && token.endsWith('**') && token.length > 4) {
          const bold = token.slice(2, -2);
          return (
            <strong key={idx} style={{ fontWeight: 600, color: '#0f172a' }}>
              {bold}
            </strong>
          );
        }

        return <span key={idx}>{token}</span>;
      })}
    </>
  );
}
