import { BadRequestException } from '@nestjs/common';
import { FEEDBACK_ATTACHMENT_MAX_BYTES, FEEDBACK_ATTACHMENT_TYPES, type FeedbackAttachmentInfo } from '@qitu/contracts';
import { TextDecoder } from 'node:util';

export function invalidAttachment(): never {
  throw new BadRequestException({ code: 'FEEDBACK_ATTACHMENT_INVALID', message: '附件无效、已过期或不属于当前反馈。' });
}
export function parseAttachment(body: unknown) {
  if (!body || typeof body !== 'object' || !('childId' in body) || !('fileName' in body) || !('contentType' in body) || !('base64' in body)) return invalidAttachment();
  if (Object.keys(body).some(key => !['childId', 'fileName', 'contentType', 'base64'].includes(key))
    || typeof body.childId !== 'string' || !body.childId.trim() || body.childId.length > 160
    || typeof body.fileName !== 'string' || typeof body.contentType !== 'string' || typeof body.base64 !== 'string') return invalidAttachment();
  const contentType = FEEDBACK_ATTACHMENT_TYPES.find(type => type === body.contentType);
  const fileName = body.fileName.trim();
  if (!contentType || !fileName || fileName.length > 160 || /[\x00-\x1f\x7f/\\]/.test(fileName)
    || body.base64.length > Math.ceil(FEEDBACK_ATTACHMENT_MAX_BYTES / 3) * 4
    || body.base64.length % 4 !== 0 || /[^A-Za-z0-9+/=]/.test(body.base64)) return invalidAttachment();
  const bytes = Buffer.from(body.base64, 'base64');
  if (!bytes.length || bytes.length > FEEDBACK_ATTACHMENT_MAX_BYTES || bytes.toString('base64') !== body.base64) return invalidAttachment();
  const suffix = fileName.toLowerCase().split('.').at(-1);
  const valid = contentType === 'image/png' ? suffix === 'png' && bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))
    : contentType === 'image/jpeg' ? ['jpg', 'jpeg'].includes(suffix ?? '') && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
    : contentType === 'application/pdf' ? suffix === 'pdf' && bytes.subarray(0, 5).toString() === '%PDF-'
    : suffix === 'txt' && validText(bytes);
  if (!valid) return invalidAttachment();
  return { childId: body.childId.trim(), fileName, contentType, bytes };
}
function validText(bytes: Buffer) {
  try { return !/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); } catch { return false; }
}
export function attachmentInfo(row: { id: string; fileName: string; contentType: string; sizeBytes: number; createdAt: Date }): FeedbackAttachmentInfo {
  const contentType = FEEDBACK_ATTACHMENT_TYPES.find(type => type === row.contentType);
  if (!contentType) return invalidAttachment();
  return { id: row.id, fileName: row.fileName, contentType, sizeBytes: row.sizeBytes, createdAt: row.createdAt.toISOString() };
}
