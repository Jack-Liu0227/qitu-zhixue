import { ApiError } from './index';
import { createIdempotencyKey } from './idempotency';
import { FEEDBACK_ATTACHMENT_MAX_BYTES, FEEDBACK_ATTACHMENT_TYPES, type FeedbackAttachmentInfo } from '@qitu/contracts';
const keys = new WeakMap<File, Map<string, string>>();
export async function uploadFeedbackAttachment(file: File, childId: string): Promise<FeedbackAttachmentInfo> {
  const contentType = FEEDBACK_ATTACHMENT_TYPES.find(type => type === file.type)
    ?? (file.name.toLowerCase().endsWith('.txt') ? 'text/plain' : undefined);
  if (!contentType || !file.size || file.size > FEEDBACK_ATTACHMENT_MAX_BYTES) throw new Error('请选择不超过 2 MB 的 PNG、JPEG、PDF 或 UTF-8 文本文件。');
  let scoped = keys.get(file);
  if (!scoped) { scoped = new Map(); keys.set(file, scoped); }
  const key = scoped.get(childId) ?? createIdempotencyKey();
  scoped.set(childId, key);
  const base64 = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('文件读取失败，请重新选择。'));
    reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result.slice(reader.result.indexOf(',') + 1)) : reject(new Error('文件读取失败。'));
    reader.readAsDataURL(file);
  });
  let response: Response;
  try { response = await fetch('/api/v1/feedback/attachments', { method: 'POST', credentials: 'include',
    headers: { 'content-type': 'application/json', 'idempotency-key': key }, body: JSON.stringify({ childId, fileName: file.name, contentType, base64 }) });
  } catch { throw new Error('网络已断开，请恢复连接后重试上传。'); }
  const value: { data?: FeedbackAttachmentInfo; detail?: string; message?: string; code?: string } = await response.json();
  if (!response.ok || !value.data) throw new ApiError(value.detail ?? value.message ?? '附件上传失败。', response.status, value.code);
  return value.data;
}
export async function removeFeedbackAttachment(id: string) {
  const response = await fetch(`/api/v1/feedback/attachments/${encodeURIComponent(id)}`, { method: 'DELETE', credentials: 'include' });
  if (!response.ok) throw new ApiError('附件尚未移除，请重试。', response.status);
}
