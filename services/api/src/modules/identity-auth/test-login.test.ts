import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { test, type TestContext } from 'node:test';
import type { DirectoryPersonRef } from '@qitu/contracts';
import { AuthService } from './auth.service';
import { allowsConfiguredTestLogin } from './test-login';

const password = randomUUID();
const passwordHash = createHash('sha256').update(password).digest('hex');
const passwordVariables = ['STUDENT', 'PARENT', 'TEACHER', 'ADMIN'].map(role => `QITU_TEST_LOGIN_PASSWORD_${role}`);

function configure(t: TestContext, enabled?: string, configuredPassword?: string) {
  const originalEnabled = process.env.QITU_TEST_LOGIN_ENABLED;
  const originalPasswords = passwordVariables.map(key => process.env[key]);
  t.after(() => {
    if (originalEnabled === undefined) delete process.env.QITU_TEST_LOGIN_ENABLED;
    else process.env.QITU_TEST_LOGIN_ENABLED = originalEnabled;
    passwordVariables.forEach((key, index) => {
      const original = originalPasswords[index];
      if (original === undefined) delete process.env[key];
      else process.env[key] = original;
    });
  });
  if (enabled === undefined) delete process.env.QITU_TEST_LOGIN_ENABLED;
  else process.env.QITU_TEST_LOGIN_ENABLED = enabled;
  for (const key of passwordVariables) {
    if (configuredPassword === undefined) delete process.env[key];
    else process.env[key] = configuredPassword;
  }
}

function fixture() {
  const roles = ['student', 'parent', 'teacher', 'admin'] satisfies DirectoryPersonRef['role'][];
  const users: DirectoryPersonRef[] = roles.map(role => ({ userId: `${role}-demo`, role, email: `${role}@example.test`, displayName: role }));
  const directory = {
    allowsDemoLogin: () => false,
    findUser: async (id: string) => users.find(user => user.userId === id) ?? null,
    findCredentialByEmail: async (email: string) => {
      const user = users.find(user => user.email === email);
      return user ? { user, passwordHash } : null;
    },
  };
  return { auth: new AuthService(directory), directory, users };
}

test('test login is disabled unless both the explicit switch and server password exist', async t => {
  configure(t);
  const { auth, users } = fixture();
  assert.deepEqual(await auth.testLoginOptions(), { accounts: [] });
  await assert.rejects(auth.login(users[0]!.email, password));
  process.env.QITU_TEST_LOGIN_ENABLED = 'true';
  assert.deepEqual(await auth.testLoginOptions(), { accounts: [] });
  await assert.rejects(auth.login(users[0]!.email, password));
});

test('all four existing test identities can fill credentials and authenticate without enabling demo data', async t => {
  configure(t, 'true', password);
  const { auth, directory, users } = fixture();
  const options = await auth.testLoginOptions();
  assert.equal(options.accounts.length, 4);
  for (const account of options.accounts) {
    assert.equal(account.password, password);
    const session = await auth.login(account.email, account.password);
    assert.equal(auth.getSession(session.token).user.role, account.role);
  }
  assert.equal(directory.allowsDemoLogin(), false);
  assert.equal(users.length, 4);
});

test('an enabled shortcut still requires the real directory password', async t => {
  configure(t, 'true', password);
  const { auth, users } = fixture();
  await assert.rejects(auth.login(users[0]!.email, randomUUID()));
});

test('turning off test login immediately invalidates its existing sessions', async t => {
  configure(t, 'true', password);
  const { auth, users } = fixture();
  const session = await auth.login(users[0]!.email, password);
  process.env.QITU_TEST_LOGIN_ENABLED = 'false';
  assert.throws(() => auth.getSession(session.token));
  assert.deepEqual(await auth.testLoginOptions(), { accounts: [] });
});

test('the opt-in cannot authorize other reserved identities or a mismatched role', async t => {
  configure(t, 'true', password);
  const { auth, users } = fixture();
  users.push({ userId: 'other-demo', role: 'admin', email: 'other@example.test', displayName: 'other' });
  await assert.rejects(auth.login('other@example.test', password));
  assert.equal(allowsConfiguredTestLogin({ userId: 'student-demo', role: 'admin' }), false);
});

test('shortcuts omit missing accounts, changed roles and credentials that do not match the server configuration', async t => {
  configure(t, 'true', randomUUID());
  const { auth, users } = fixture();
  assert.deepEqual(await auth.testLoginOptions(), { accounts: [] });
  for (const key of passwordVariables) process.env[key] = password;
  users.splice(0, 1);
  users.find(user => user.role === 'parent')!.role = 'student';
  assert.deepEqual((await auth.testLoginOptions()).accounts.map(account => account.role), ['teacher', 'admin']);
});
