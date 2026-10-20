import { BadRequestException } from '@nestjs/common';

const PREFIX = 'qitu:inline-text:v1:';
export const MAX_INLINE_REPORT_LENGTH = 10_000;

/** Stored in the existing immutable version note column; never interpreted as HTML. */
export function encodeInlineVersion(note: string, input: unknown): string {
  if (note.startsWith(PREFIX)) invalid('版本说明不能声明服务端内容格式');
  if (input === undefined || input === null) return note;
  const text = boundedStudentText(input, MAX_INLINE_REPORT_LENGTH);
  return PREFIX + JSON.stringify({ note, text });
}

export function decodeInlineVersion(value: string): { note: string; inlineText: string | null } {
  if (!value.startsWith(PREFIX)) return { note: value, inlineText: null };
  try {
    const parsed = JSON.parse(value.slice(PREFIX.length)) as Record<string, unknown>;
    if (typeof parsed.note !== 'string' || parsed.note.length > 500 || typeof parsed.text !== 'string'
      || parsed.text !== boundedStudentText(parsed.text, MAX_INLINE_REPORT_LENGTH)) return { note: '', inlineText: null };
    return { note: parsed.note, inlineText: parsed.text };
  } catch { return { note: '', inlineText: null }; }
}

export function boundedStudentText(input: unknown, max = MAX_INLINE_REPORT_LENGTH): string {
  const text = typeof input === 'string' ? input.trim() : '';
  if (!text || text.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(text)
    || /<\/?[a-z][^>]*>/iu.test(text)) invalid(`内容须为 1–${max} 字的纯文本，不支持 HTML 或脚本`);
  return text;
}

function invalid(message: string): never {
  throw new BadRequestException({ code: 'ARTIFACT_INLINE_TEXT_INVALID', message });
}
