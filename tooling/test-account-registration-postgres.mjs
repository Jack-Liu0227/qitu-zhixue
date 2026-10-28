import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';

export async function verifyAccountRegistration({
  db,
  client,
  audit,
  idempotency,
  directory,
  load,
  check,
}) {
  const { AccountRegistrationService } = await load('directory/account-registration.service.js');
  const { AuthService } = await load('identity-auth/auth.service.js');
  const { AuthSessionPersistence } = await load('identity-auth/auth-session.persistence.js');
  const registration = new AccountRegistrationService(db, audit, idempotency);
  const key = () => randomBytes(16).toString('hex');
  const register = (requestKey, input) => registration.register(requestKey, input, key());
  const requestKey = key();
  let body;
  await check(
    'individual registration creates one account without invitations, purchases, projects or guardian links',
    async () => {
      const saved = (await client.query('SELECT * FROM business_settings')).rows;
      await client.query('DELETE FROM business_settings');
      const before = (
        await client.query(
          'SELECT (SELECT count(*) FROM users)::int AS users, (SELECT count(*) FROM guardian_links)::int AS links, (SELECT count(*) FROM projects)::int AS projects',
        )
      ).rows[0];
      try {
        const policy = await registration.policy();
        assert.equal(policy.phoneRegistration.available, false);
        body = {
          method: 'email',
          role: 'student',
          email: 'Self-Student@example.test',
          displayName: '测试学生',
          password: 'fixture-student-password ',
          policyVersion: policy.version,
          acceptedTerms: true,
          ageConsent: true,
        };
        assert.deepEqual(await register(requestKey, body), {
          login: 'self-student@example.test',
          role: 'student',
        });
        const after = (
          await client.query(
            'SELECT (SELECT count(*) FROM users)::int AS users, (SELECT count(*) FROM guardian_links)::int AS links, (SELECT count(*) FROM projects)::int AS projects',
          )
        ).rows[0];
        assert.deepEqual(after, { ...before, users: before.users + 1 });
        const [account] = (
          await client.query("SELECT * FROM users WHERE email='self-student@example.test'")
        ).rows;
        assert.equal(account.role, 'student');
        assert.ok(account.password_hash.startsWith('scrypt$'));
        const rows = (
          await client.query(
            "SELECT detail FROM audit_logs WHERE action='directory.account_registration.create' AND target_id=$1",
            [account.id],
          )
        ).rows;
        assert.equal(rows.length, 1);
        assert.equal(rows[0].detail.emailVerified, false);
        assert.equal(JSON.stringify(rows).includes(body.password), false);
      } finally {
        for (const row of saved)
          await client.query(
            'INSERT INTO business_settings(id,revision,content,updated_at) VALUES ($1,$2,$3,$4)',
            [row.id, row.revision, row.content, row.updated_at],
          );
      }
    },
  );
  await check(
    'registration replay and lost idempotency receipt do not duplicate accounts',
    async () => {
      const expected = await register(requestKey, body);
      await assert.rejects(() => register(requestKey, { ...body, role: 'parent' }));
      await client.query('DELETE FROM idempotency_keys WHERE scope=$1 AND key=$2', [
        'directory.account-registration',
        requestKey,
      ]);
      assert.deepEqual(await register(requestKey, body), expected);
      assert.equal(
        (
          await client.query(
            "SELECT count(*)::int AS count FROM users WHERE email='self-student@example.test'",
          )
        ).rows[0].count,
        1,
      );
    },
  );
  await check(
    'independent parent and student authenticate; sessions survive restart and revoke on logout',
    async () => {
      const policy = await registration.policy();
      await register(key(), {
        ...body,
        role: 'parent',
        email: 'self-parent@example.test',
        policyVersion: policy.version,
      });
      for (const role of ['parent', 'student']) {
        const persistence = new AuthSessionPersistence(db),
          first = new AuthService(directory, persistence);
        const login = await first.login(`self-${role}@example.test`, body.password);
        assert.equal(login.user.role, role);
        if (role === 'parent')
          assert.equal((await directory.childrenOfParent(login.user.id)).length, 0);
        const restarted = new AuthService(directory, persistence);
        await restarted.onModuleInit();
        assert.equal(restarted.getSession(login.token).user.role, role);
        await restarted.logoutPersisted(login.token);
        const again = new AuthService(directory, persistence);
        await again.onModuleInit();
        assert.throws(() => again.getSession(login.token));
      }
    },
  );
  await check(
    'existing accounts, privileged roles, family injection and stale policy cannot create or change users',
    async () => {
      const before = (await client.query('SELECT count(*)::int AS count FROM users')).rows[0].count;
      const policy = await registration.policy(),
        fresh = { ...body, policyVersion: policy.version, email: 'new-person@example.test' };
      for (const extra of [
        { email: 'student@example.test' },
        { role: 'teacher' },
        { role: 'admin' },
        { studentId: 'student' },
        { parentEmail: 'parent@example.test' },
        { ageConsent: false },
        { policyVersion: 'old' },
      ])
        await assert.rejects(() => register(key(), { ...fresh, ...extra }));
      assert.equal(
        (await client.query('SELECT count(*)::int AS count FROM users')).rows[0].count,
        before,
      );
    },
  );
  await check('concurrent registrations sharing an email have one atomic winner', async () => {
    const policy = await registration.policy();
    const results = await Promise.allSettled(
      ['parent', 'student'].map((role) =>
        register(key(), {
          ...body,
          policyVersion: policy.version,
          email: 'concurrent-person@example.test',
          role,
        }),
      ),
    );
    assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
    assert.equal(
      (
        await client.query(
          "SELECT count(*)::int AS count FROM users WHERE email='concurrent-person@example.test'",
        )
      ).rows[0].count,
      1,
    );
  });
}
