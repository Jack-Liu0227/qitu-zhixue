import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AliyunRegistrationSms, signRegistrationSms } from './aliyun-registration-sms';
import { parseAccountRegistration } from './account-registration.validation';

test('phone registration requires a valid mainland number and one public identity', () => {
  const input = {
    method: 'phone',
    phone: '13800000001',
    challengeId: '01234567-89ab-cdef-0123-456789abcdef',
    code: '012345',
    role: 'student',
    displayName: '学生',
    password: 'student-fixture-password',
    policyVersion: 'a'.repeat(64),
    acceptedTerms: true,
    ageConsent: true,
  };
  const parsed = parseAccountRegistration(input);
  assert.equal(parsed.method, 'phone');
  if (parsed.method !== 'phone') throw new Error('Expected phone method');
  assert.equal(parsed.phone, '+8613800000001');
  for (const extra of [
    { phone: '123' },
    { phone: '+12345678901' },
    { code: '123' },
    { role: 'admin' },
    { email: 'unexpected@example.test' },
  ])
    assert.throws(() => parseAccountRegistration({ ...input, ...extra }));
});

test('Aliyun SMS request fixes host/action/version and encodes signed query parameters', () => {
  const request = signRegistrationSms({
    phone: '+8613800000001',
    code: '012345',
    accessId: 'fixture-id',
    accessSecret: 'fixture-secret',
    signName: '启途 测试',
    templateCode: 'SMS_123',
    date: '2026-10-26T00:00:00Z',
    nonce: 'fixture-nonce',
  });
  const url = new URL(request.url);
  assert.equal(url.origin, 'https://dysmsapi.aliyuncs.com');
  assert.equal(url.searchParams.get('PhoneNumbers'), '13800000001');
  assert.equal(url.searchParams.get('SignName'), '启途 测试');
  assert.deepEqual(JSON.parse(url.searchParams.get('TemplateParam')!), { code: '012345' });
  assert.equal(request.headers['x-acs-action'], 'SendSms');
  assert.equal(request.headers['x-acs-version'], '2017-05-25');
  assert.match(
    request.headers.Authorization!,
    /^ACS3-HMAC-SHA256 Credential=fixture-id,SignedHeaders=host;.*Signature=[a-f0-9]{64}$/,
  );
  assert.equal(request.url.includes('fixture-secret'), false);
});

test('Aliyun adapter fails closed without config and sanitizes upstream failures', async () => {
  const names = ['ACCESS_KEY_ID', 'ACCESS_KEY_SECRET', 'SIGN_NAME', 'TEMPLATE_CODE'].map(
    (name) => 'QITU_ALIYUN_SMS_' + name,
  );
  const previous = names.map((name) => process.env[name]),
    originalFetch = globalThis.fetch;
  try {
    names.forEach((name) => delete process.env[name]);
    const provider = new AliyunRegistrationSms();
    assert.equal(provider.status().available, false);
    for (const [index, value] of ['fixture-id', 'fixture-secret', '测试', 'SMS_123'].entries())
      process.env[names[index]!] = value;
    assert.equal(provider.status().available, true);
    globalThis.fetch = async () => new Response(JSON.stringify({ Code: 'OK' }), { status: 200 });
    await provider.send('+8613800000001', '012345');
    for (const [status, code] of [
      [200, 'isv.BUSINESS_LIMIT_CONTROL'],
      [500, 'OK'],
    ] as const) {
      globalThis.fetch = async () =>
        new Response(JSON.stringify({ Code: code, Message: 'fixture-secret' }), { status });
      await assert.rejects(
        () => provider.send('+8613800000001', '012345'),
        (error) => error instanceof Error && !error.message.includes('fixture-secret'),
      );
    }
    globalThis.fetch = async () => {
      throw new Error('fixture-secret');
    };
    await assert.rejects(() => provider.send('+8613800000001', '012345'), /短信注册暂不可用/);
  } finally {
    globalThis.fetch = originalFetch;
    names.forEach((name, index) => {
      if (previous[index] === undefined) delete process.env[name];
      else process.env[name] = previous[index];
    });
  }
});
