'use client';

import { useEffect, useRef, useState } from 'react';
import type { ArtifactExportFormat } from '@qitu/contracts';
import { useTutorDataSource } from '../TutorDataSourceProvider';

const FORMATS: readonly { value: ArtifactExportFormat; label: string }[] = [
  { value: 'pdf', label: 'PDF' }, { value: 'docx', label: 'Word' },
  { value: 'pptx', label: 'PPT' }, { value: 'xlsx', label: 'Excel' },
];

export function ArtifactExportButtons({ artifactId, versionId, title }: { artifactId: string; versionId: string; title: string }) {
  const source = useTutorDataSource();
  const [format, setFormat] = useState<ArtifactExportFormat>('pdf');
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const active = useRef<AbortController | null>(null);
  useEffect(() => {
    setPending(false); setMessage(null); setError(null);
    return () => { active.current?.abort(); active.current = null; };
  }, [artifactId, versionId]);
  if (!source.exportLearningArtifact) return null;
  const download = async () => {
    if (pending || !source.exportLearningArtifact) return;
    active.current?.abort();
    const request = new AbortController(); active.current = request;
    setPending(true); setMessage(null); setError(null);
    try {
      const blob = await source.exportLearningArtifact(artifactId, versionId, format, request.signal);
      if (active.current !== request || request.signal.aborted) return;
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url; link.download = `${title.replace(/[\x00-\x1f\x7f/\\]/g, '_')}.${format}`;
      document.body.append(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setMessage('文件已生成，正在下载。');
    } catch (cause) {
      if (active.current === request && !request.signal.aborted) setError(navigator.onLine === false
        ? '网络已断开，恢复后可以重新导出。' : cause instanceof Error ? cause.message : '文件导出失败，请重试。');
    } finally {
      if (active.current === request) { active.current = null; setPending(false); }
    }
  };
  return <div>
    <label>导出格式 <select value={format} disabled={pending} onChange={event => {
      const selected = FORMATS.find(item => item.value === event.target.value);
      if (selected) setFormat(selected.value);
    }}>{FORMATS.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
    <button type="button" disabled={pending} onClick={() => { void download(); }}>{pending ? '正在生成文件…' : '导出这一版作品'}</button>
    {message ? <p role="status">{message}</p> : null}
    {error ? <p role="alert">{error}</p> : null}
  </div>;
}
