import { BadRequestException, HttpException } from '@nestjs/common';
import { isIP } from 'node:net';
import { normalizeRegistrationPhone, type AccountRegistrationRequest } from '@qitu/contracts';
import { objectInput, textInput } from '../business/business.validation';

export function parseAccountRegistration(body: unknown): AccountRegistrationRequest {
  const v = objectInput(body, [
    'displayName',
    'role',
    'password',
    'email',
    'phone',
    'method',
    'challengeId',
    'code',
    'policyVersion',
    'acceptedTerms',
    'ageConsent',
  ]);
  const invalid = (message: string) =>
    new BadRequestException({ code: 'ACCOUNT_REGISTRATION_INVALID', message });
  if (v.role !== 'student' && v.role !== 'parent') throw invalid('请选择学生或家长身份');
  if (
    typeof v.password !== 'string' ||
    v.password.length < 12 ||
    v.password.length > 128 ||
    !v.password.trim()
  )
    throw invalid('密码须为 12 至 128 位');
  if (v.acceptedTerms !== true || v.ageConsent !== true)
    throw new BadRequestException({
      code: 'ACCOUNT_REGISTRATION_CONSENT_REQUIRED',
      message: '请阅读服务说明并确认使用授权',
    });
  const common = {
    displayName: textInput(v.displayName, '称呼', 60),
    role: v.role,
    password: v.password,
    policyVersion: textInput(v.policyVersion, '注册说明版本', 64),
    acceptedTerms: true as const,
    ageConsent: true as const,
  };
  if (v.method === 'phone') {
    const phone = typeof v.phone === 'string' ? normalizeRegistrationPhone(v.phone) : null;
    if (
      v.email !== undefined ||
      !phone ||
      typeof v.code !== 'string' ||
      !/^\d{6}$/.test(v.code) ||
      typeof v.challengeId !== 'string' ||
      !/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(v.challengeId)
    )
      throw invalid('请填写手机号和收到的六位验证码');
    return {
      ...common,
      role: v.role,
      method: 'phone',
      phone,
      challengeId: v.challengeId,
      code: v.code,
    };
  }
  if (
    v.method !== 'email' ||
    v.phone !== undefined ||
    v.code !== undefined ||
    v.challengeId !== undefined
  )
    throw invalid('注册方式与登录信息不一致');
  const email = textInput(v.email, '登录邮箱', 150).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || /@(?:qtzx\.local|.*\.qitu\.local)$/i.test(email))
    throw invalid('请填写可用的登录邮箱');
  return { ...common, role: v.role, method: 'email', email };
}

export function registrationClientKey(ip: string, forwardedFor?: string): string {
  if (['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(ip)) {
    const last = forwardedFor?.split(',').at(-1)?.trim();
    if (last && isIP(last)) return last;
  }
  return ip || 'unknown';
}

/** Single-instance protection; shared storage is required before multi-instance deployment. */
export class AccountRegistrationLimiter {
  private readonly clients = new Map<string, { count: number; until: number }>();
  private active = 0;
  enter(client: string, now = Date.now()): () => void {
    for (const [key, value] of this.clients) if (value.until <= now) this.clients.delete(key);
    const value = this.clients.get(client) ?? { count: 0, until: now + 15 * 60_000 };
    if (
      value.count >= 10 ||
      this.active >= 4 ||
      (!this.clients.has(client) && this.clients.size >= 10_000)
    )
      throw new HttpException(
        { code: 'ACCOUNT_REGISTRATION_RATE_LIMITED', message: '注册请求较多，请稍后再试' },
        429,
      );
    value.count++;
    this.clients.set(client, value);
    this.active++;
    let released = false;
    return () => {
      if (!released) {
        released = true;
        this.active--;
      }
    };
  }
}
