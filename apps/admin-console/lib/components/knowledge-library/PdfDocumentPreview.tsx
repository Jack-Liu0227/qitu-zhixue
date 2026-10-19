'use client';

import { useEffect, useState } from 'react';
import styles from './KnowledgeLibrary.module.css';

/** Fetch through the authenticated admin API; never expose upstream signed URLs. */
export function PdfDocumentPreview({ url, title }: { url: string; title: string }) {
  const [source, setSource] = useState('');
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    let objectUrl = '';
    setSource('');
    setError('');
    void (async () => {
      try {
        const response = await fetch(url, { credentials: 'include', signal: controller.signal });
        if (!response.ok) {
          throw new Error(
            response.status === 401 || response.status === 403
              ? '登录已失效或没有原文查看权限，请重新登录。'
              : '暂时无法读取 PDF 原文，请重试或切换「提取文本」。',
          );
        }
        if (!response.headers.get('content-type')?.includes('application/pdf')) {
          throw new Error('此来源暂未提供 PDF 原文件，可切换「提取文本」查看。');
        }
        const blob = await response.blob();
        if (controller.signal.aborted) return;
        objectUrl = URL.createObjectURL(blob);
        setSource(objectUrl);
      } catch (e) {
        if (!controller.signal.aborted) setError(e instanceof Error ? e.message : '原文读取失败');
      }
    })();
    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [url, attempt]);
  if (error)
    return (
      <div className={styles.empty} role="alert">
        <p>{error}</p>
        <button className={styles.secondary} onClick={() => setAttempt((n) => n + 1)}>
          重新读取原文
        </button>
      </div>
    );
  if (!source)
    return (
      <div className={styles.empty} role="status">
        正在读取 PDF 原文…
      </div>
    );
  return (
    <iframe className={styles.pdf} title={`${title} PDF 原文预览`} src={`${source}#view=FitH`} />
  );
}
