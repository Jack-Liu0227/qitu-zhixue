import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  AccountRegistrationLimiter,
  parseAccountRegistration,
  registrationClientKey,
} from './account-registration.validation';

const input = {
  method: 'email',
  role: 'student',
  email: 'Student@example.test',
  displayName: '学生',
  password: 'fixture-account-password ',
  policyVersion: 'a'.repeat(64),
  acceptedTerms: true,
  ageConsent: true,
};
test('individual registration normalizes identifiers without changing password or selected public role', () => {
  for (const role of ['parent', 'student']) {
    const value = parseAccountRegistration({ ...input, role });
    assert.equal(value.method, 'email');
    if (value.method !== 'email') throw new Error('Expected email registration');
    assert.equal(value.email, 'student@example.test');
    assert.equal(value.password, input.password);
    assert.equal(value.role, role);
  }
});
test('public registration rejects privileged roles, family fields, existing ids and missing consent', () => {
  for (const extra of [
    { role: 'admin' },
    { role: 'teacher' },
    { studentId: 'existing' },
    { parentId: 'existing' },
    { parentEmail: 'parent@example.test' },
    { guardianConsent: true },
    { token: 'invitation' },
    { ageConsent: false },
    { acceptedTerms: false },
    { password: 'short' },
    { email: 'admin@qtzx.local' },
  ])
    assert.throws(() => parseAccountRegistration({ ...input, ...extra }));
});
test('only trusted local proxy last-hop addresses affect registration rate limiting', () => {
  assert.equal(registrationClientKey('127.0.0.1', 'spoofed, 203.0.113.4'), '203.0.113.4');
  assert.equal(registrationClientKey('203.0.113.5', '203.0.113.4'), '203.0.113.5');
  assert.equal(registrationClientKey('127.0.0.1', 'invalid'), '127.0.0.1');
});
test('registration limits per-client attempts and concurrent expensive password work', () => {
  const limiter = new AccountRegistrationLimiter();
  const releases = Array.from({ length: 4 }, (_, index) => limiter.enter(`client-${index}`, 0));
  assert.throws(() => limiter.enter('another', 0), /注册请求较多/);
  releases.forEach((release) => {
    release();
    release();
  });
  for (let i = 0; i < 10; i++) limiter.enter('repeat', 0)();
  assert.throws(() => limiter.enter('repeat', 1), /注册请求较多/);
  limiter.enter('repeat', 15 * 60_000)();
});
