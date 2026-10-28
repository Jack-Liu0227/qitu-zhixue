import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { createHash, createHmac, randomUUID } from 'node:crypto';

const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const encode = (value: string) =>
  encodeURIComponent(value).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
const unavailable = () =>
  new ServiceUnavailableException({
    code: 'REGISTRATION_SMS_UNAVAILABLE',
    message: '短信注册暂不可用，请稍后重试或选择邮箱注册',
  });

/** ACS3 signature: https://help.aliyun.com/zh/sdk/product-overview/v3-request-structure-and-signature */
export function signRegistrationSms(input: {
  phone: string;
  code: string;
  accessId: string;
  accessSecret: string;
  signName: string;
  templateCode: string;
  date: string;
  nonce: string;
}) {
  const params: Record<string, string> = {
    PhoneNumbers: input.phone.replace(/^\+86/, ''),
    SignName: input.signName,
    TemplateCode: input.templateCode,
    TemplateParam: JSON.stringify({ code: input.code }),
  };
  const query = Object.keys(params)
    .sort()
    .map((key) => `${encode(key)}=${encode(params[key] ?? '')}`)
    .join('&');
  const headers: Record<string, string> = {
    host: 'dysmsapi.aliyuncs.com',
    'x-acs-action': 'SendSms',
    'x-acs-version': '2017-05-25',
    'x-acs-date': input.date,
    'x-acs-signature-nonce': input.nonce,
    'x-acs-content-sha256': hash(''),
  };
  const names = Object.keys(headers).sort();
  const signedHeaders = names.join(';');
  const canonical = [
    'POST',
    '/',
    query,
    names.map((name) => `${name}:${headers[name]}\n`).join(''),
    signedHeaders,
    hash(''),
  ].join('\n');
  const signature = createHmac('sha256', input.accessSecret)
    .update(`ACS3-HMAC-SHA256\n${hash(canonical)}`)
    .digest('hex');
  headers.Authorization = `ACS3-HMAC-SHA256 Credential=${input.accessId},SignedHeaders=${signedHeaders},Signature=${signature}`;
  return { url: `https://dysmsapi.aliyuncs.com/?${query}`, headers };
}

@Injectable()
export class AliyunRegistrationSms {
  private configuration() {
    const accessId = process.env.QITU_ALIYUN_SMS_ACCESS_KEY_ID?.trim();
    const accessSecret = process.env.QITU_ALIYUN_SMS_ACCESS_KEY_SECRET?.trim();
    const signName = process.env.QITU_ALIYUN_SMS_SIGN_NAME?.trim();
    const templateCode = process.env.QITU_ALIYUN_SMS_TEMPLATE_CODE?.trim();
    if (!accessId || !accessSecret || !signName || !templateCode || !/^SMS_\d+$/.test(templateCode))
      throw unavailable();
    return { accessId, accessSecret, signName, templateCode };
  }
  status(): { available: boolean; reason: string } {
    try {
      this.configuration();
      return { available: true, reason: '支持中国大陆手机号，通过短信验证码注册' };
    } catch {
      return { available: false, reason: '短信服务尚未配置，可先使用邮箱注册' };
    }
  }
  async send(phone: string, code: string): Promise<void> {
    const request = signRegistrationSms({
      ...this.configuration(),
      phone,
      code,
      date: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
      nonce: randomUUID(),
    });
    try {
      const response = await fetch(request.url, {
        method: 'POST',
        headers: request.headers,
        redirect: 'error',
        signal: AbortSignal.timeout(10_000),
      });
      const value: unknown = await response.json();
      if (
        !response.ok ||
        !value ||
        typeof value !== 'object' ||
        !('Code' in value) ||
        value.Code !== 'OK'
      )
        throw unavailable();
    } catch {
      throw unavailable();
    }
  }
}
