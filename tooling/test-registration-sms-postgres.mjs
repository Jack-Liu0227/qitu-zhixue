import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';

/** Only instantiated by the disposable, loopback-only fixture runner. Never sends an SMS. */
export class FixtureRegistrationSms {
  codes = new Map();
  calls = 0;
  fail = false;
  status() {
    return { available: true, reason: '隔离测试短信（不会实际发送）' };
  }
  async send(phone, code) {
    this.calls++;
    if (this.fail) throw new Error('synthetic provider failure');
    this.codes.set(phone, code);
  }
}

export async function verifyRegistrationSms({
  db,
  client,
  audit,
  idempotency,
  directory,
  load,
  check,
}) {
  const previous = process.env.QITU_SMS_VERIFICATION_KEY;
  process.env.QITU_SMS_VERIFICATION_KEY = randomBytes(32).toString('hex');
  try {
    const { RegistrationSmsService } = await load('directory/registration-sms.service.js');
    const { AccountRegistrationService } = await load('directory/account-registration.service.js');
    const { AuthService } = await load('identity-auth/auth.service.js');
    const provider = new FixtureRegistrationSms();
    const sms = new RegistrationSmsService(db, provider);
    const registration = new AccountRegistrationService(db, audit, idempotency, sms);
    const key = () => randomBytes(16).toString('hex');
    const policy = await registration.policy();
    const send = (phone, requestKey = key()) =>
      registration.sendCode(
        requestKey,
        { phone, policyVersion: policy.version, acceptedSmsTerms: true },
        'fixture-client',
      );
    const body = (phone, receipt) => ({
      method: 'phone',
      phone,
      challengeId: receipt.challengeId,
      code: provider.codes.get(phone),
      displayName: '手机号测试家长',
      role: 'parent',
      password: 'phone-parent-fixture-password',
      policyVersion: policy.version,
      acceptedTerms: true,
      ageConsent: true,
    });
    await check('SMS replay sends once, binds number, and enforces shared cooldown', async () => {
      const requestKey = key(),
        phone = '+8613800000101';
      const first = await send(phone, requestKey),
        before = provider.calls;
      assert.equal((await send(phone, requestKey)).challengeId, first.challengeId);
      assert.equal(provider.calls, before);
      await assert.rejects(() => send('+8613800000102', requestKey));
      await assert.rejects(
        () => send(phone),
        (error) => error.getStatus() === 429,
      );
      await assert.rejects(() =>
        registration.sendCode(
          key(),
          { phone, policyVersion: policy.version, acceptedSmsTerms: false },
          'fixture',
        ),
      );
    });
    await check(
      'five wrong codes persist across service restarts; expired and mismatched codes fail',
      async () => {
        const phone = '+8613800000103',
          receipt = await send(phone);
        const wrong = provider.codes.get(phone) === '000000' ? '111111' : '000000';
        for (let i = 0; i < 5; i++)
          await assert.rejects(() => sms.verify(phone, receipt.challengeId, wrong, 'owner'));
        const restarted = new RegistrationSmsService(db, provider);
        await assert.rejects(() =>
          restarted.verify(phone, receipt.challengeId, provider.codes.get(phone), 'owner'),
        );
        assert.equal(
          (
            await client.query('SELECT attempts FROM registration_sms WHERE id=$1', [
              receipt.challengeId,
            ])
          ).rows[0].attempts,
          5,
        );
        const freshPhone = '+8613800000104',
          fresh = await send(freshPhone);
        await assert.rejects(() =>
          sms.verify(phone, fresh.challengeId, provider.codes.get(freshPhone), 'owner'),
        );
        await client.query(
          "UPDATE registration_sms SET expires_at=now()-interval '1 second' WHERE id=$1",
          [fresh.challengeId],
        );
        await assert.rejects(() =>
          sms.verify(freshPhone, fresh.challengeId, provider.codes.get(freshPhone), 'owner'),
        );
      },
    );
    await check(
      'phone registration is atomic, authenticates both number formats and hides directory phones',
      async () => {
        const phone = '+8613800000105',
          receipt = await send(phone),
          input = body(phone, receipt),
          registrationKey = key();
        const register = () => registration.register(registrationKey, input, key());
        const result = await register();
        assert.equal(result.login, phone);
        assert.deepEqual(await register(), result);
        await client.query('DELETE FROM idempotency_keys WHERE scope=$1 AND key=$2', [
          'directory.account-registration',
          registrationKey,
        ]);
        assert.deepEqual(await register(), result);
        const parent = (await client.query('SELECT * FROM users WHERE phone=$1', [phone])).rows[0];
        assert.equal(parent.email, '');
        assert.ok(parent.phone_verified_at);
        assert.equal(
          (
            await client.query('SELECT status,used_by FROM registration_sms WHERE id=$1', [
              receipt.challengeId,
            ])
          ).rows[0].used_by,
          parent.id,
        );
        assert.equal(JSON.stringify(await directory.findUser(parent.id)).includes(phone), false);
        for (const identifier of [phone, phone.slice(3)]) {
          const auth = new AuthService(directory);
          assert.equal((await auth.login(identifier, input.password)).user.role, 'parent');
        }
        assert.equal(await directory.findCredentialByEmail(''), null);
        await assert.rejects(() =>
          registration.register(key(), { ...input, role: 'student' }, key()),
        );
        assert.equal(
          (await client.query('SELECT count(*)::int AS count FROM users WHERE phone=$1', [phone]))
            .rows[0].count,
          1,
        );
      },
    );
    await check(
      'audit failure rolls back user and SMS consumption; concurrent code reuse creates one account',
      async () => {
        const phone = '+8613800000106',
          receipt = await send(phone),
          input = body(phone, receipt);
        const failing = new AccountRegistrationService(db, { write: async () => { throw new Error('synthetic audit failure'); } }, idempotency, sms);
        await assert.rejects(() =>
          failing.register(key(), input, key()),
        );
        assert.equal(
          (
            await client.query('SELECT status FROM registration_sms WHERE id=$1', [
              receipt.challengeId,
            ])
          ).rows[0].status,
          'sent',
        );
        const results = await Promise.allSettled(
          [0, 1].map((i) =>
            registration.register(
              key(),
              { ...input, role: i ? 'parent' : 'student' },
              key(),
            ),
          ),
        );
        assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
        assert.equal(
          (await client.query('SELECT count(*)::int AS count FROM users WHERE phone=$1', [phone]))
            .rows[0].count,
          1,
        );
      },
    );
    await check(
      'provider failure never reports success or retries sending with the same key',
      async () => {
        const phone = '+8613800000107',
          requestKey = key();
        provider.fail = true;
        await assert.rejects(
          () => send(phone, requestKey),
          (error) => error.getStatus() === 503,
        );
        const before = provider.calls;
        provider.fail = false;
        await assert.rejects(() => send(phone, requestKey));
        assert.equal(provider.calls, before);
        delete process.env.QITU_SMS_VERIFICATION_KEY;
        assert.equal((await registration.policy()).phoneRegistration.available, false);
        await assert.rejects(() => send('+8613800000108'));
      },
    );
  } finally {
    if (previous === undefined) delete process.env.QITU_SMS_VERIFICATION_KEY;
    else process.env.QITU_SMS_VERIFICATION_KEY = previous;
  }
}
