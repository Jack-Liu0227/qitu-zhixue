import { BadRequestException } from '@nestjs/common';

export function masteryInputError(message: string): BadRequestException {
  return new BadRequestException({ code: 'MASTERY_INPUT_INVALID', message });
}

export function masteryDate(value: unknown, fallback?: Date): Date {
  if (value === undefined || value === null) {
    if (fallback) return new Date(fallback);
    throw masteryInputError('缺少时间参数');
  }
  if (
    typeof value !== 'string' ||
    !/^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/u.test(
      value,
    )
  ) {
    throw masteryInputError('时间必须是带时区的 ISO 时间');
  }
  const date = new Date(value);
  const day = new Date(`${value.slice(0, 10)}T00:00:00.000Z`);
  if (
    !Number.isFinite(date.getTime()) ||
    !Number.isFinite(day.getTime()) ||
    day.toISOString().slice(0, 10) !== value.slice(0, 10)
  ) {
    throw masteryInputError('时间无效');
  }
  return date;
}

export function masteryId(value: unknown, required = false): string | undefined {
  if (value === undefined || value === null) {
    if (required) throw masteryInputError('缺少对象标识');
    return undefined;
  }
  if (
    typeof value !== 'string' ||
    value.length > 200 ||
    !value.trim() ||
    /[\s,\u0000-\u001f]/u.test(value)
  ) {
    throw masteryInputError('对象标识无效');
  }
  return value;
}

export function masteryLimit(value: unknown): number {
  if (value === undefined || value === null) return 50;
  const parsed =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && /^\d+$/u.test(value)
        ? Number(value)
        : NaN;
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 100)
    throw masteryInputError('limit 必须是 1 到 100 的整数');
  return parsed;
}

export function masteryQuery(
  raw: Record<string, unknown>,
  fields: readonly string[],
): Record<string, string | undefined> {
  const result: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (!fields.includes(key) || (value !== undefined && typeof value !== 'string')) {
      throw masteryInputError('查询包含不允许的字段或重复参数');
    }
    result[key] = value as string | undefined;
  }
  return result;
}
