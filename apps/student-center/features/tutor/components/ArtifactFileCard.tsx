'use client';

import { useState } from 'react';

export interface ArtifactFileCardProps {
  fileName: string;
  fileType: 'markdown' | 'code' | 'document' | 'data' | 'image' | 'archive';
  title: string;
  summary?: string;
  content?: string;
  downloadUrl?: string;
  sizeText?: string;
  nodeRef?: string;
}

export function ArtifactFileCard({
  fileName,
  fileType,
  title,
  summary,
  content,
  downloadUrl,
  sizeText = '14.2 KB',
  nodeRef,
}: ArtifactFileCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const [savedEvidence, setSavedEvidence] = useState(false);

  const getFileIcon = () => {
    switch (fileType) {
      case 'code':
        return (
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="16 18 22 12 16 6" />
            <polyline points="8 6 2 12 8 18" />
          </svg>
        );
      case 'data':
        return (
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <ellipse cx="12" cy="5" rx="9" ry="3" />
            <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3" />
            <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" />
          </svg>
        );
      case 'image':
        return (
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
            <circle cx="8.5" cy="8.5" r="1.5" />
            <polyline points="21 15 16 10 5 21" />
          </svg>
        );
      default:
        return (
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <polyline points="14 2 14 8 20 8" />
            <line x1="16" y1="13" x2="8" y2="13" />
            <line x1="16" y1="17" x2="8" y2="17" />
            <polyline points="10 9 9 9 8 9" />
          </svg>
        );
    }
  };

  const handleCopy = () => {
    if (content) {
      void navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleDownload = () => {
    if (downloadUrl) {
      window.open(downloadUrl, '_blank');
      return;
    }
    const blob = new Blob([content ?? ''], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="qitu-artifact-card">
      <div className="qitu-artifact-header">
        <div className={`qitu-artifact-icon is-${fileType}`}>{getFileIcon()}</div>
        <div className="qitu-artifact-meta">
          <div className="qitu-artifact-badge-row">
            <span className="qitu-artifact-badge">阶段交付物</span>
            {nodeRef ? <span className="qitu-artifact-node-tag">关联节点: {nodeRef}</span> : null}
            <span className="qitu-artifact-size">{sizeText}</span>
          </div>
          <strong className="qitu-artifact-title">{title}</strong>
          <span className="qitu-artifact-filename">{fileName}</span>
        </div>
      </div>

      {summary ? <p className="qitu-artifact-summary">{summary}</p> : null}

      {content ? (
        <div className="qitu-artifact-content-container">
          <div className="qitu-artifact-actions">
            <button
              type="button"
              className="qitu-artifact-btn"
              onClick={() => setExpanded(!expanded)}
            >
              {expanded ? '收起预览' : '展开查看内容'}
            </button>
            <button
              type="button"
              className="qitu-artifact-btn"
              onClick={handleCopy}
              disabled={copied}
            >
              {copied ? '已复制 ✔' : '复制全文'}
            </button>
            <button
              type="button"
              className="qitu-artifact-btn is-download"
              onClick={handleDownload}
            >
              ⬇ 导出下载
            </button>
            <button
              type="button"
              className={`qitu-artifact-btn${savedEvidence ? ' is-saved' : ''}`}
              onClick={() => setSavedEvidence(true)}
            >
              {savedEvidence ? '已沉淀为成长档案 ✔' : '📌 沉淀为成果证据'}
            </button>
          </div>

          {expanded ? (
            <pre className="qitu-artifact-preview">
              <code>{content}</code>
            </pre>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
