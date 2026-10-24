'use client';
import { useEffect, useRef, useState } from 'react';
import { FEEDBACK_ATTACHMENT_MAX_COUNT, type FeedbackAttachmentInfo } from '@qitu/contracts';

export function FeedbackAttachmentLinks({ files = [] }: { files?: FeedbackAttachmentInfo[] }) {
  return files.length ? <ul style={{ paddingLeft: 20, overflowWrap: 'anywhere' }}>{files.map(file => <li key={file.id}>
    <a href={`/api/v1/feedback/attachments/${encodeURIComponent(file.id)}/content`} download>{file.fileName}</a>
    <small style={{ marginLeft: 8 }}>{Math.ceil(file.sizeBytes / 1024)} KB</small>
  </li>)}</ul> : null;
}
export function FeedbackAttachmentPicker({ value, onChange, upload, remove, disabled = false, onBlockedChange }: {
  value: FeedbackAttachmentInfo[]; onChange: (files: FeedbackAttachmentInfo[]) => void;
  upload: (file: File) => Promise<FeedbackAttachmentInfo>; remove: (id: string) => Promise<void>;
  disabled?: boolean; onBlockedChange: (blocked: boolean) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<File | null>(null);
  const [error, setError] = useState('');
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; onBlockedChange(false); }; }, [onBlockedChange]);
  async function add(file: File) {
    if (busy || disabled || value.length >= FEEDBACK_ATTACHMENT_MAX_COUNT) return;
    setBusy(true); setError(''); onBlockedChange(true);
    try {
      const saved = await upload(file);
      if (!alive.current) return;
      onChange([...value, saved]); setFailed(null); onBlockedChange(false);
    } catch (cause: unknown) {
      if (alive.current) { setFailed(file); setError(cause instanceof Error ? cause.message : '附件未能上传，请重试。'); }
    } finally { if (alive.current) setBusy(false); }
  }
  async function discard(id: string) {
    setBusy(true); setError(''); onBlockedChange(true);
    try {
      await remove(id);
      if (alive.current) { onChange(value.filter(file => file.id !== id)); onBlockedChange(false); }
    } catch (cause: unknown) { if (alive.current) setError(cause instanceof Error ? cause.message : '附件移除失败。'); }
    finally { if (alive.current) setBusy(false); }
  }
  return <div style={{ minWidth: 0 }}>
    <p style={{ fontSize: 12 }}>支持 PNG、JPEG、PDF、UTF-8 文本；每个最多 2 MB，共 5 个。未提交的附件保留 24 小时。</p>
    <input type="file" aria-label="添加反馈附件" accept=".png,.jpg,.jpeg,.pdf,.txt" disabled={disabled || busy || !!failed || value.length >= FEEDBACK_ATTACHMENT_MAX_COUNT}
      onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void add(file); }} style={{ maxWidth: '100%' }} />
    {busy && <p role="status">正在保存附件…</p>}
    {error && <p role="alert">{error}</p>}
    {failed && <p>{failed.name} 尚未上传。<button type="button" disabled={busy || disabled} onClick={() => { void add(failed); }}>重试上传</button>
      <button type="button" disabled={busy || disabled} onClick={() => { setFailed(null); setError(''); onBlockedChange(false); }}>取消此文件</button></p>}
    <ul style={{ paddingLeft: 20, overflowWrap: 'anywhere' }}>{value.map(file => <li key={file.id}>{file.fileName} · {Math.ceil(file.sizeBytes / 1024)} KB
      <button type="button" disabled={busy || disabled} onClick={() => { void discard(file.id); }}>移除</button>
    </li>)}</ul>
  </div>;
}
