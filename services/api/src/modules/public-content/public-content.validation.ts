import { BadRequestException } from '@nestjs/common';
import type {
  ConsultationIdentity,
  ConsultationRequestInput,
  ProblemFieldError,
} from '@qitu/contracts';

const IDENTITIES: readonly ConsultationIdentity[] = ['student', 'parent', 'school'];
const ALLOWED_KEYS = new Set(['name', 'phone', 'identity', 'message']);

const NAME_MAX = 40;
const MESSAGE_MAX = 500;
const PHONE_MAX = 24;

/** 中国大陆手机号 / 座机号（分隔符已剔除）。 */
const MOBILE = /^1[3-9]\d{9}$/;
const LANDLINE = /^0\d{2,3}\d{7,8}$/;

/**
 * 公开咨询入参的**白名单**解析。
 *
 * 写接口一律不信任请求体：只接受已知字段，未知字段直接拒绝（而不是忽略），
 * 这样「前端多传了一个字段」在联调期就会暴露，而不是悄悄进日志或落库。
 * 错误用契约里的 `CONSULTATION_INVALID` + 字段级 `errors`，前端可逐项高亮。
 */
export function parseConsultationInput(body: unknown): ConsultationRequestInput {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    throw invalid([{ message: '请求体必须是 JSON 对象' }]);
  }

  const record = body as Record<string, unknown>;
  const errors: ProblemFieldError[] = [];

  for (const key of Object.keys(record)) {
    if (!ALLOWED_KEYS.has(key)) {
      errors.push({ path: key, message: `不支持的字段：${key}` });
    }
  }

  const name = readString(record.name, 'name', errors, { max: NAME_MAX, required: true });
  const rawPhone = readString(record.phone, 'phone', errors, { max: PHONE_MAX, required: true });
  const message = readString(record.message, 'message', errors, {
    max: MESSAGE_MAX,
    required: false,
  });

  const identity = record.identity;
  const parsedIdentity =
    typeof identity === 'string' && (IDENTITIES as readonly string[]).includes(identity)
      ? (identity as ConsultationIdentity)
      : null;
  if (parsedIdentity === null) {
    errors.push({ path: 'identity', message: '请选择咨询身份（student / parent / school）' });
  }

  const phone = rawPhone === undefined ? undefined : normalizePhone(rawPhone);
  if (phone !== undefined && phone !== '' && !MOBILE.test(phone) && !LANDLINE.test(phone)) {
    errors.push({ path: 'phone', message: '请填写有效的手机号或座机号' });
  }

  if (errors.length > 0) {
    throw invalid(errors);
  }

  return {
    // 到这里三个必填字段必然存在且合法（errors 已保证），断言由校验逻辑兜底。
    name: name as string,
    phone: phone as string,
    identity: parsedIdentity as ConsultationIdentity,
    message: message === undefined || message === '' ? null : message,
  };
}

/** 剔除常见分隔符：`138 0000 0000`、`010-8888 8888`、`（021）…` 视为同一号码。 */
export function normalizePhone(raw: string): string {
  return raw.replace(/[\s\-()（）·.]/g, '');
}

function readString(
  value: unknown,
  path: string,
  errors: ProblemFieldError[],
  options: { max: number; required: boolean },
): string | undefined {
  if (value === undefined || value === null) {
    if (options.required) {
      errors.push({ path, message: '该字段必填' });
    }
    return undefined;
  }
  if (typeof value !== 'string') {
    errors.push({ path, message: '该字段必须是字符串' });
    return undefined;
  }
  const trimmed = value.trim();
  if (trimmed === '' && options.required) {
    errors.push({ path, message: '该字段必填' });
    return undefined;
  }
  if (trimmed.length > options.max) {
    errors.push({ path, message: `长度不能超过 ${options.max} 个字符` });
    return undefined;
  }
  return trimmed;
}

function invalid(errors: ProblemFieldError[]): BadRequestException {
  return new BadRequestException({
    code: 'CONSULTATION_INVALID',
    message: '咨询信息填写有误，请检查后重试',
    errors,
  });
}
