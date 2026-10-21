import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { parseTestLoginOptions } from '../apps/auth-portal/app/login/test-accounts.ts';

test('test login accepts the disabled response and the four supported role choices', () => {
  assert.deepEqual(parseTestLoginOptions({ data: { accounts: [] } }), { accounts: [] });
  const accounts = ['student', 'parent', 'teacher', 'admin'].map(role => ({ role, email: `${role}@example.test`, password: randomUUID() }));
  assert.deepEqual(parseTestLoginOptions({ data: { accounts } }).accounts, accounts);
});

test('test login rejects malformed, duplicate and unsupported choices', () => {
  const account = { role: 'student', email: 'student@example.test', password: randomUUID() };
  for (const value of [null, {}, { data: null }, { data: { accounts: {} } },
    { data: { accounts: [account, account] } },
    { data: { accounts: [{ ...account, role: 'support' }] } },
    { data: { accounts: [{ ...account, role: ['student'] }] } },
    { data: { accounts: [{ ...account, password: '' }] } },
  ]) assert.throws(() => parseTestLoginOptions(value));
});
