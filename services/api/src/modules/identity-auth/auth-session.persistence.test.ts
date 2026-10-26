import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { AuthService, verifyScryptPassword, type SessionRecord } from './auth.service';
import { AuthSessionPersistence } from './auth-session.persistence';
import { hashFamilyPassword } from '../directory/family-invitation.service';

class FixtureSessions extends AuthSessionPersistence {
  rows = new Map<string, SessionRecord>();
  constructor() {
    super(null);
  }
  override async load() {
    return [...this.rows.entries()];
  }
  override async saveUser(userId: string, records: [string, SessionRecord][]) {
    for (const [key, value] of this.rows) if (value.user.id === userId) this.rows.delete(key);
    for (const row of records) this.rows.set(...row);
  }
  override async remove(hash: string) {
    this.rows.delete(hash);
  }
}

test('session survives an API restart and logout revokes its durable digest', async () => {
  const password = 'fixture-password-only';
  const user = {
    userId: 'parent-test',
    email: 'parent@example.test',
    displayName: '测试家长',
    role: 'parent' as const,
  };
  const directory = {
    findCredentialByEmail: async () => ({
      user,
      passwordHash: createHash('sha256').update(password).digest('hex'),
    }),
    allowsDemoLogin: () => false,
    findUser: async () => user,
  };
  const persistence = new FixtureSessions();
  const first = new AuthService(directory, persistence);
  const login = await first.login(user.email, password);
  assert.equal(persistence.rows.has(login.token), false);
  assert.equal(persistence.rows.has(createHash('sha256').update(login.token).digest('hex')), true);
  const restarted = new AuthService(directory, persistence);
  await restarted.onModuleInit();
  assert.equal(restarted.getSession(login.token).user.id, user.userId);
  await restarted.logoutPersisted(login.token);
  const next = new AuthService(directory, persistence);
  await next.onModuleInit();
  assert.throws(() => next.getSession(login.token));
});

test('new family passwords use independent salted scrypt records', () => {
  const password = 'fixture-long-password';
  const first = hashFamilyPassword(password);
  const second = hashFamilyPassword(password);
  assert.notEqual(first, second);
  assert.equal(verifyScryptPassword(password, first), true);
  assert.equal(verifyScryptPassword('wrong-password', first), false);
  assert.equal(verifyScryptPassword(password, 'scrypt$malformed'), false);
});
