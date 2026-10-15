'use client';

import React, { useState } from 'react';

export interface AttachmentItem {
  id?: string;
  fileName: string;
  fileType: 'image' | 'document' | 'code' | 'archive' | 'audio' | 'other';
  url: string;
  sizeText?: string;
  thumbnailUrl?: string;
}

function getFileIcon(type: string, name: string) {
  if (type === 'image') return '🖼️';
  if (name.endsWith('.py')) return '🐍';
  if (name.endsWith('.js') || name.endsWith('.ts') || name.endsWith('.tsx') || name.endsWith('.jsx')) return '📜';
  if (name.endsWith('.cpp') || name.endsWith('.c') || name.endsWith('.java')) return '⚙️';
  if (name.endsWith('.pdf')) return '📕';
  if (name.endsWith('.zip') || name.endsWith('.tar') || name.endsWith('.gz')) return '📦';
  if (name.endsWith('.md') || name.endsWith('.txt')) return '📝';
  if (type === 'code') return '💻';
  return '📎';
}

export function AttachmentView({ attachment }: { attachment: AttachmentItem }) {
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const isImage = attachment.fileType === 'image';

  return (
    <>
      {isImage ? (
        <div style={{ marginTop: '8px', marginBottom: '8px' }}>
          <div
            onClick={() => setLightboxOpen(true)}
            style={{
              position: 'relative',
              maxWidth: '320px',
              borderRadius: '12px',
              overflow: 'hidden',
              cursor: 'zoom-in',
              border: '1px solid #e2e8f0',
              boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
              background: '#f8fafc',
              transition: 'transform 0.15s ease, box-shadow 0.15s ease',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.transform = 'scale(1.01)';
              e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.1)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = 'scale(1)';
              e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,0.06)';
            }}
            title="点击放大查看图片"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={attachment.url}
              alt={attachment.fileName}
              style={{
                display: 'block',
                width: '100%',
                maxHeight: '260px',
                objectFit: 'cover',
              }}
            />
            <div
              style={{
                padding: '6px 10px',
                fontSize: '11.5px',
                color: '#475569',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                background: 'rgba(255, 255, 255, 0.95)',
                borderTop: '1px solid #f1f5f9',
              }}
            >
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '200px' }}>
                {attachment.fileName}
              </span>
              {attachment.sizeText && <span style={{ color: '#94a3b8', fontSize: '10.5px' }}>{attachment.sizeText}</span>}
            </div>
          </div>
        </div>
      ) : (
        <div
          style={{
            margin: '8px 0',
            padding: '10px 14px',
            borderRadius: '10px',
            background: '#ffffff',
            border: '1px solid #e2e8f0',
            display: 'inline-flex',
            alignItems: 'center',
            gap: '12px',
            boxShadow: '0 2px 6px rgba(0,0,0,0.04)',
            maxWidth: '100%',
          }}
        >
          <span style={{ fontSize: '24px', lineHeight: 1 }} aria-hidden="true">
            {getFileIcon(attachment.fileType, attachment.fileName)}
          </span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div
              style={{
                fontSize: '13px',
                fontWeight: 600,
                color: '#1e293b',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                maxWidth: '240px',
              }}
              title={attachment.fileName}
            >
              {attachment.fileName}
            </div>
            <div style={{ fontSize: '11px', color: '#64748b', marginTop: '2px' }}>
              {attachment.sizeText || '文件附件'}
            </div>
          </div>
          <a
            href={attachment.url}
            download={attachment.fileName}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              padding: '4px 10px',
              fontSize: '11.5px',
              fontWeight: 600,
              color: '#2563eb',
              background: '#eff6ff',
              border: '1px solid #bfdbfe',
              borderRadius: '6px',
              textDecoration: 'none',
              cursor: 'pointer',
              whiteSpace: 'nowrap',
            }}
          >
            下载查看
          </a>
        </div>
      )}

      {/* Lightbox 全屏预览 */}
      {lightboxOpen && (
        <div
          onClick={() => setLightboxOpen(false)}
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            zIndex: 99999,
            backgroundColor: 'rgba(15, 23, 42, 0.85)',
            backdropFilter: 'blur(4px)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '24px',
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              position: 'relative',
              maxWidth: '90vw',
              maxHeight: '90vh',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
            }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={attachment.url}
              alt={attachment.fileName}
              style={{
                maxWidth: '100%',
                maxHeight: '82vh',
                objectFit: 'contain',
                borderRadius: '8px',
                boxShadow: '0 20px 40px rgba(0,0,0,0.5)',
              }}
            />
            <div
              style={{
                marginTop: '12px',
                color: '#f8fafc',
                fontSize: '13px',
                display: 'flex',
                gap: '16px',
                alignItems: 'center',
                background: 'rgba(0,0,0,0.5)',
                padding: '6px 14px',
                borderRadius: '20px',
              }}
            >
              <span>{attachment.fileName}</span>
              {attachment.sizeText && <span style={{ opacity: 0.7 }}>{attachment.sizeText}</span>}
              <button
                type="button"
                onClick={() => setLightboxOpen(false)}
                style={{
                  background: 'none',
                  border: 'none',
                  color: '#fff',
                  cursor: 'pointer',
                  fontWeight: 'bold',
                  padding: '2px 6px',
                }}
              >
                ✕ 关闭
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
