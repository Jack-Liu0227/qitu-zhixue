'use client';

import { useEffect, useId, useMemo, useState } from 'react';

interface MermaidViewProps {
  code: string;
  className?: string;
}

export function MermaidView({ code, className }: MermaidViewProps) {
  const reactId = useId();
  const safeId = useMemo(() => `mermaid_${reactId.replace(/[^a-zA-Z0-9]/g, '_')}_${Math.random().toString(36).substring(2, 7)}`, [reactId]);
  const [svgHtml, setSvgHtml] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const trimmedCode = useMemo(() => {
    let clean = (code || '').trim();
    if (clean.startsWith('```mermaid')) {
      clean = clean.replace(/^```mermaid\s*/i, '').replace(/```$/, '').trim();
    } else if (clean.startsWith('```')) {
      clean = clean.replace(/^```[a-zA-Z0-9_-]*\s*/i, '').replace(/```$/, '').trim();
    }
    return clean;
  }, [code]);

  useEffect(() => {
    let cancelled = false;

    async function renderDiagram() {
      if (!trimmedCode) {
        setLoading(false);
        return;
      }
      setLoading(true);
      setError(null);

      try {
        const mermaidModule = await import('mermaid');
        const mermaid = mermaidModule.default;
        mermaid.initialize({
          startOnLoad: false,
          theme: 'neutral',
          securityLevel: 'loose',
          fontFamily: 'system-ui, -apple-system, sans-serif',
        });

        const { svg } = await mermaid.render(safeId, trimmedCode);

        if (!cancelled) {
          setSvgHtml(svg);
          setError(null);
          setLoading(false);
        }
      } catch (err: unknown) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Mermaid diagram syntax error');
          setLoading(false);
        }
      }
    }

    void renderDiagram();

    return () => {
      cancelled = true;
    };
  }, [trimmedCode, safeId]);

  if (error) {
    return (
      <div
        className={`qitu-mermaid-fallback-container ${className ?? ''}`}
        style={{
          margin: '12px 0',
          padding: '12px 16px',
          borderRadius: '8px',
          background: '#f8fafc',
          border: '1.5px dashed #94a3b8',
          fontSize: '13px',
          color: '#334155',
        }}
        role="figure"
        aria-label="Mermaid diagram fallback"
      >
        <div style={{ fontWeight: 600, marginBottom: '6px', color: '#475569' }}>
          📊 Diagram Specification:
        </div>
        <pre
          style={{
            margin: 0,
            padding: '10px 14px',
            background: '#ffffff',
            border: '1px solid #e2e8f0',
            borderRadius: '6px',
            fontSize: '12px',
            fontFamily: 'JetBrains Mono, Consolas, monospace',
            overflowX: 'auto',
            whiteSpace: 'pre-wrap',
          }}
        >
          {trimmedCode}
        </pre>
      </div>
    );
  }

  if (loading && !svgHtml) {
    return (
      <div
        className="qitu-mermaid-loading"
        style={{
          margin: '12px 0',
          padding: '24px',
          textAlign: 'center',
          color: '#64748b',
          fontSize: '13px',
          background: '#f8fafc',
          borderRadius: '8px',
          border: '1px solid #e2e8f0',
        }}
      >
        <span>Rendering diagram...</span>
      </div>
    );
  }

  return (
    <div
      className={`qitu-mermaid-diagram-card ${className ?? ''}`}
      style={{
        margin: '14px 0',
        padding: '16px 20px',
        borderRadius: '12px',
        background: '#ffffff',
        border: '1.5px solid #e2e8f0',
        boxShadow: '0 2px 8px rgba(15, 23, 42, 0.04)',
        overflowX: 'auto',
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
      }}
      dangerouslySetInnerHTML={{ __html: svgHtml ?? '' }}
    />
  );
}
