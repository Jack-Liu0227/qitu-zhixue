'use client';

import React, { useMemo } from 'react';
import katex from 'katex';

/**
 * Enhanced LaTeX with semantic physics colors:
 * - W (Work): Blue #2563eb
 * - Ek / ΔEk (Kinetic Energy): Purple #9333ea
 * - m (Mass): Emerald #16a34a
 * - v (Velocity): Orange #ea580c
 */
function enhanceKineticFormula(latex: string): string {
  if (latex.includes('\\color')) return latex;
  if (!latex.includes('E_k') && !latex.includes('mv') && !latex.includes('W')) return latex;

  return latex
    .replace(/W_\{?\\text\{合\}\}?/g, '{\\color{#2563eb}W_{\\text{合}}}')
    .replace(/\\Delta E_k/g, '{\\color{#9333ea}\\Delta E_k}')
    .replace(/E_k/g, '{\\color{#9333ea}E_k}')
    .replace(/(?<![a-zA-Z\\])m(?![a-zA-Z])/g, '{\\color{#16a34a}m}')
    .replace(/v_([12])/g, '{\\color{#ea580c}v_$1}')
    .replace(/(?<![a-zA-Z\\])v(?![a-zA-Z_0-9])/g, '{\\color{#ea580c}v}');
}

function renderKaTeX(latex: string, displayMode: boolean): string {
  try {
    const formatted = enhanceKineticFormula(latex.trim());
    return katex.renderToString(formatted, {
      displayMode,
      throwOnError: false,
      output: 'htmlAndMathml',
      trust: true,
    });
  } catch {
    return `<span class="katex-fallback">${latex}</span>`;
  }
}

/**
 * KaTeX powered Markdown & Math renderer for PBL tutor.
 * Supports:
 * - Block math: $$ ... $$
 * - Inline math: $ ... $
 * - Colorized physics variables (W, m, v, Ek)
 * - Variable explanation badge legend
 */
export function MarkdownMathView({ content }: { content: string }) {
  if (!content) return null;

  // Split content by block math $$ ... $$
  const parts = content.split(/(\$\$[\s\S]*?\$\$)/g);

  return (
    <div className="qitu-markdown-math-content" style={{ fontSize: '14.5px', lineHeight: 1.75, color: 'inherit' }}>
      {parts.map((part, index) => {
        if (part.startsWith('$$') && part.endsWith('$$')) {
          const rawMath = part.slice(2, -2).trim();
          const html = renderKaTeX(rawMath, true);
          const isKinetic = rawMath.includes('E_k') || rawMath.includes('mv') || rawMath.includes('W');

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
              <div
                dangerouslySetInnerHTML={{ __html: html }}
                style={{ textAlign: 'center', fontSize: '18px', padding: '6px 0' }}
              />

              {isKinetic && (
                <div
                  style={{
                    marginTop: '10px',
                    paddingTop: '8px',
                    borderTop: '1px dashed #cbd5e1',
                    display: 'flex',
                    flexWrap: 'wrap',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '12px',
                    fontSize: '11.5px',
                  }}
                >
                  <span style={{ color: '#64748b', fontWeight: 600 }}>变量色彩导读：</span>
                  <span style={{ color: '#1d4ed8', fontWeight: 600, background: '#eff6ff', padding: '2px 8px', borderRadius: '4px' }}>
                    ● W 做功 (力与位移累积)
                  </span>
                  <span style={{ color: '#7e22ce', fontWeight: 600, background: '#faf5ff', padding: '2px 8px', borderRadius: '4px' }}>
                    ● ΔEk 动能改变量
                  </span>
                  <span style={{ color: '#15803d', fontWeight: 600, background: '#f0fdf4', padding: '2px 8px', borderRadius: '4px' }}>
                    ● m 质量 (线性影响)
                  </span>
                  <span style={{ color: '#c2410c', fontWeight: 600, background: '#fff7ed', padding: '2px 8px', borderRadius: '4px' }}>
                    ● v 速度 (平方倍增影响)
                  </span>
                </div>
              )}
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
          <p key={lIdx} style={{ margin: '6px 0' }}>
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
          const rawMath = token.slice(1, -1);
          const html = renderKaTeX(rawMath, false);
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
