'use client';

import React, { useState } from 'react';
import katex from 'katex';
import styles from './CoursewareRichContent.module.css';

/**
 * Safely render a LaTeX string with KaTeX
 */
export function renderKaTeX(latex: string, displayMode = false): string | null {
  if (!latex || typeof latex !== 'string') return null;
  const trimmed = latex.trim();
  if (trimmed.length === 0 || trimmed.length > 4096) return null;
  try {
    return katex.renderToString(trimmed, {
      displayMode,
      throwOnError: false,
      output: 'htmlAndMathml',
      trust: false,
      strict: 'ignore',
      errorColor: '#dc2626',
      maxExpand: 200,
      maxSize: 25,
    });
  } catch {
    return null;
  }
}

/**
 * Copy to clipboard button with transient feedback
 */
export function CopyButton({ text, label = '复制' }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback for clipboard failures
    }
  };

  return (
    <button
      type="button"
      onClick={handleCopy}
      className={styles.copyBtn}
      title={copied ? '已复制到剪贴板' : label}
      aria-label={copied ? '已复制' : label}
    >
      {copied ? (
        <>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12" />
          </svg>
          <span>已复制</span>
        </>
      ) : (
        <>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
          </svg>
          <span>{label}</span>
        </>
      )}
    </button>
  );
}

/**
 * Dedicated Math Formula Board with KaTeX, header badge, and copy support
 */
export function CoursewareFormulaCard({ tex, title = '核心推导公式' }: { tex: string; title?: string }) {
  if (!tex || !tex.trim()) return null;
  const raw = tex.trim();
  const html = renderKaTeX(raw, true);

  return (
    <div className={styles.formulaCard} aria-label="数学公式展示">
      <div className={styles.formulaHeader}>
        <div className={styles.formulaTitle}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M4 19h4l4-14h4l4 14" />
            <path d="M7 14h10" />
          </svg>
          <span>{title}</span>
        </div>
        <CopyButton text={raw} label="复制 LaTeX" />
      </div>
      <div className={styles.formulaBody}>
        {html ? (
          <div
            className={styles.katexDisplay}
            dangerouslySetInnerHTML={{ __html: html }}
          />
        ) : (
          <div className={styles.formulaFallback}>
            <span className={styles.fallbackNotice}>公式解析提示</span>
            <code>{raw}</code>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Styled IDE Code Block
 */
export function CoursewareCodeBlock({ code, language }: { code: string; language?: string }) {
  const lang = (language || 'code').toUpperCase();
  return (
    <div className={styles.codeBlockWrapper}>
      <div className={styles.codeBlockHeader}>
        <span className={styles.codeLangBadge}>{lang}</span>
        <CopyButton text={code} label="复制代码" />
      </div>
      <pre className={styles.codePre}>
        <code>{code}</code>
      </pre>
    </div>
  );
}

/**
 * Concept Flow Diagram Card for Nodes and Edges
 */
export function CoursewareFlowCard({
  nodes,
  edges,
}: {
  nodes?: readonly { id: string; label: string }[];
  edges?: readonly { from: string; to: string }[];
}) {
  if (!nodes || nodes.length === 0) return null;

  return (
    <div className={styles.flowCard} aria-label="概念逻辑与光路流向">
      <div className={styles.flowHeader}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="6" cy="6" r="3" />
          <circle cx="18" cy="18" r="3" />
          <line x1="8.5" y1="8.5" x2="15.5" y2="15.5" />
        </svg>
        <span>概念节点与光路逻辑</span>
      </div>

      <div className={styles.flowContent}>
        {/* Node pills */}
        <div className={styles.nodesContainer}>
          <span className={styles.nodeGroupLabel}>要素节点：</span>
          <div className={styles.nodePills}>
            {nodes.map(n => (
              <span key={n.id} className={styles.nodePill}>
                <span className={styles.nodeIdTag}>{n.id}</span>
                <span className={styles.nodeLabel}>{n.label}</span>
              </span>
            ))}
          </div>
        </div>

        {/* Edges / Paths */}
        {edges && edges.length > 0 && (
          <div className={styles.edgesContainer}>
            <span className={styles.edgeGroupLabel}>光路 / 逻辑流：</span>
            <div className={styles.edgeList}>
              {edges.map((edge, idx) => {
                const fromNode = nodes.find(n => n.id === edge.from);
                const toNode = nodes.find(n => n.id === edge.to);
                return (
                  <div key={idx} className={styles.edgePath}>
                    <span className={styles.edgeNodeRef}>{fromNode ? fromNode.label : edge.from}</span>
                    <span className={styles.edgeArrow} aria-hidden="true">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <line x1="5" y1="12" x2="19" y2="12" />
                        <polyline points="12 5 19 12 12 19" />
                      </svg>
                    </span>
                    <span className={styles.edgeNodeRef}>{toNode ? toNode.label : edge.to}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Rich Text Formatter: Parses Markdown, Inline/Block LaTeX, Code Blocks, Inline Code, Citations
 */
export function CoursewareRichText({ content }: { content: string }) {
  if (!content) return null;

  // Split by code blocks: ```lang ... ``` and block math: $$ ... $$ or \[ ... \]
  const blockRegex = /(```[a-zA-Z0-9_-]*[\s\S]*?```|\$\$[\s\S]*?\$\$|\\\[[\s\S]*?\\\])/g;
  const blocks = content.split(blockRegex);

  return (
    <div className={styles.richTextContainer}>
      {blocks.map((block, bIdx) => {
        if (!block) return null;

        // 1. Code blocks
        if (block.startsWith('```') && block.endsWith('```')) {
          const match = block.match(/^```([a-zA-Z0-9_-]*)\s*([\s\S]*?)```$/);
          const lang = match && match[1] ? match[1] : '';
          const code = (match && match[2] ? match[2] : block.slice(3, -3)).trim();
          return <CoursewareCodeBlock key={bIdx} code={code} language={lang} />;
        }

        // 2. Block math: $$ ... $$ or \[ ... \]
        if (
          (block.startsWith('$$') && block.endsWith('$$') && block.length > 4) ||
          (block.startsWith('\\[') && block.endsWith('\\]') && block.length > 4)
        ) {
          const rawMath = block.startsWith('$$') ? block.slice(2, -2) : block.slice(2, -2);
          const mathHtml = renderKaTeX(rawMath, true);
          if (mathHtml) {
            return (
              <div
                key={bIdx}
                className={styles.katexDisplay}
                dangerouslySetInnerHTML={{ __html: mathHtml }}
              />
            );
          }
          return <pre key={bIdx} className={styles.codePre}><code>{rawMath}</code></pre>;
        }

        // 3. Regular text with possible inline math ($...$ or \(...\)), inline code (`...`), bold (**...**), citations
        return <ParagraphWithInlines key={bIdx} text={block} />;
      })}
    </div>
  );
}

/**
 * Handles inline math, inline code, bolding, citations, and line breaks within text
 */
function ParagraphWithInlines({ text }: { text: string }) {
  const lines = text.split('\n');

  return (
    <div className={styles.paragraphGroup}>
      {lines.map((line, lIdx) => {
        if (!line.trim()) {
          return <div key={lIdx} className={styles.emptyLine} />;
        }

        // Parse inline math ($...$, \(...\)), inline code (`...`), and citations (（来源：...）)
        // Matches $...$, \(...\), `...`, or citations like （来源：...）
        const inlineRegex = /(\$[^\$\n]+?\$|\\\([^\)]+?\\\)|`[^`\n]+?`|（来源：[^）]+?）)/g;
        const segments = line.split(inlineRegex);

        return (
          <p key={lIdx} className={styles.paragraphLine}>
            {segments.map((seg, sIdx) => {
              if (!seg) return null;

              // Inline math: $...$ or \(...\)
              if (
                (seg.startsWith('$') && seg.endsWith('$') && seg.length > 2) ||
                (seg.startsWith('\\(') && seg.endsWith('\\)') && seg.length > 4)
              ) {
                const mathStr = seg.startsWith('$') ? seg.slice(1, -1) : seg.slice(2, -2);
                const html = renderKaTeX(mathStr, false);
                if (html) {
                  return (
                    <span
                      key={sIdx}
                      className={styles.katexInline}
                      dangerouslySetInnerHTML={{ __html: html }}
                    />
                  );
                }
                return <code key={sIdx} className={styles.inlineCode}>{mathStr}</code>;
              }

              // Inline code: `...`
              if (seg.startsWith('`') && seg.endsWith('`') && seg.length > 2) {
                const codeStr = seg.slice(1, -1);
                return <code key={sIdx} className={styles.inlineCode}>{codeStr}</code>;
              }

              // Citation highlight: （来源：...）
              if (seg.startsWith('（来源：') && seg.endsWith('）')) {
                return (
                  <span key={sIdx} className={styles.citationBadge}>
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
                      <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
                    </svg>
                    <span>{seg.slice(1, -1)}</span>
                  </span>
                );
              }

              // Also check if text segment has unbracketed LaTeX commands like \Delta, \lambda, \sin, etc.
              // If there's an obvious LaTeX equation like "\Delta s = n\lambda", render as math
              if (/\\(Delta|lambda|theta|sin|cos|frac|approx|neq|pm|sum|int|infty|times|cdot)/.test(seg) && /[=><\\]/.test(seg)) {
                const html = renderKaTeX(seg, false);
                if (html) {
                  return (
                    <span
                      key={sIdx}
                      className={styles.katexInline}
                      dangerouslySetInnerHTML={{ __html: html }}
                    />
                  );
                }
              }

              // Bold **text**
              if (seg.includes('**')) {
                const boldParts = seg.split(/(\*\*[^*]+?\*\*)/g);
                return (
                  <React.Fragment key={sIdx}>
                    {boldParts.map((bp, bpIdx) => {
                      if (bp.startsWith('**') && bp.endsWith('**') && bp.length > 4) {
                        return <strong key={bpIdx} className={styles.boldText}>{bp.slice(2, -2)}</strong>;
                      }
                      return bp;
                    })}
                  </React.Fragment>
                );
              }

              return <span key={sIdx}>{seg}</span>;
            })}
          </p>
        );
      })}
    </div>
  );
}
