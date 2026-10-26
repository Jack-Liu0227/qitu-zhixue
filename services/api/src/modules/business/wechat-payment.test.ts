import assert from 'node:assert/strict';
import { createCipheriv, generateKeyPairSync, sign } from 'node:crypto';
import { mkdtempSync, writeFileSync, unlinkSync, rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { verifyWechatMessage, WechatPayment } from './wechat-payment';

test('WeChat signatures bind exact raw bytes, key identity and a fresh timestamp', () => {
  const pair = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const publicKey = pair.publicKey.export({ type: 'spki', format: 'pem' }).toString();
  const now = Date.now();
  const timestamp = String(Math.floor(now / 1000));
  const nonce = 'fixture-nonce';
  const raw = '{"amount":100}';
  const signature = sign(
    'RSA-SHA256',
    Buffer.from(`${timestamp}\n${nonce}\n${raw}\n`),
    pair.privateKey,
  ).toString('base64');
  const input = { raw, timestamp, nonce, signature, serial: 'fixture-public-key' };
  const config = { publicKeyId: 'fixture-public-key', publicKey };
  assert.doesNotThrow(() => verifyWechatMessage(input, config, now));
  assert.throws(() => verifyWechatMessage({ ...input, raw: '{"amount":1}' }, config, now));
  assert.throws(() => verifyWechatMessage({ ...input, serial: 'different-key' }, config, now));
  assert.throws(() => verifyWechatMessage(input, config, now + 301_000));
});

test('missing merchant configuration is explicitly unavailable', () => {
  const before = process.env.QITU_PAYMENT_PUBLIC_ORIGIN;
  delete process.env.QITU_PAYMENT_PUBLIC_ORIGIN;
  try {
    assert.equal(new WechatPayment().status().configured, false);
  } finally {
    if (before === undefined) delete process.env.QITU_PAYMENT_PUBLIC_ORIGIN;
    else process.env.QITU_PAYMENT_PUBLIC_ORIGIN = before;
  }
});

test('encrypted notifications and signed gateway replies enforce identity and authenticated content', async () => {
  const pair = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const folder = mkdtempSync(join(tmpdir(), 'qitu-wechat-test-'));
  const privateFile = join(folder, 'merchant.pem');
  const publicFile = join(folder, 'wechat.pem');
  writeFileSync(privateFile, pair.privateKey.export({ type: 'pkcs8', format: 'pem' }));
  writeFileSync(publicFile, pair.publicKey.export({ type: 'spki', format: 'pem' }));
  const fixture = {
    QITU_PAYMENT_PUBLIC_ORIGIN: 'https://fixture.example.test',
    QITU_WECHAT_APP_ID: 'fixture-app',
    QITU_WECHAT_MERCHANT_ID: 'fixture-merchant',
    QITU_WECHAT_CERT_SERIAL: 'fixture-cert',
    QITU_WECHAT_PRIVATE_KEY_FILE: privateFile,
    QITU_WECHAT_PUBLIC_KEY_ID: 'fixture-public-key',
    QITU_WECHAT_PUBLIC_KEY_FILE: publicFile,
    QITU_WECHAT_API_V3_KEY: '12345678901234567890123456789012',
  };
  const before = Object.fromEntries(Object.keys(fixture).map((key) => [key, process.env[key]]));
  const originalFetch = globalThis.fetch;
  Object.assign(process.env, fixture);
  const envelope = (plain: object, event: string) => {
    const cipher = createCipheriv(
      'aes-256-gcm',
      Buffer.from(fixture.QITU_WECHAT_API_V3_KEY),
      Buffer.from('fixture12345'),
    );
    cipher.setAAD(Buffer.from('transaction'));
    const encrypted = Buffer.concat([
      cipher.update(JSON.stringify(plain)),
      cipher.final(),
      cipher.getAuthTag(),
    ]);
    const raw = JSON.stringify({
      event_type: event,
      resource: {
        algorithm: 'AEAD_AES_256_GCM',
        nonce: 'fixture12345',
        associated_data: 'transaction',
        ciphertext: encrypted.toString('base64'),
      },
    });
    const timestamp = String(Math.floor(Date.now() / 1000));
    const nonce = 'envelope-fixture';
    return {
      raw,
      headers: {
        'wechatpay-timestamp': timestamp,
        'wechatpay-nonce': nonce,
        'wechatpay-serial': fixture.QITU_WECHAT_PUBLIC_KEY_ID,
        'wechatpay-signature': sign(
          'RSA-SHA256',
          Buffer.from(`${timestamp}\n${nonce}\n${raw}\n`),
          pair.privateKey,
        ).toString('base64'),
      },
    };
  };
  try {
    const payment = new WechatPayment();
    assert.equal(payment.status().configured, true);
    const plain = {
      appid: 'fixture-app',
      mchid: 'fixture-merchant',
      trade_state: 'SUCCESS',
      out_trade_no: 'fixture-order',
      transaction_id: 'fixture-trade',
      success_time: new Date().toISOString(),
      amount: { total: 19900, currency: 'CNY' },
    };
    const valid = envelope(plain, 'TRANSACTION.SUCCESS');
    assert.deepEqual(payment.notification(valid.raw, valid.headers), {
      kind: 'payment',
      fact: {
        orderId: 'fixture-order',
        transactionId: 'fixture-trade',
        amountFen: 19900,
        paidAt: plain.success_time,
      },
    });
    for (const invalid of [
      { ...plain, mchid: 'different' },
      { ...plain, appid: 'different' },
      { ...plain, amount: { total: 19900, currency: 'USD' } },
    ]) {
      const packet = envelope(invalid, 'TRANSACTION.SUCCESS');
      assert.throws(() => payment.notification(packet.raw, packet.headers));
    }
    assert.throws(() => payment.notification(`${valid.raw} `, valid.headers));
    const refund = envelope(
      {
        mchid: 'fixture-merchant',
        out_trade_no: 'fixture-order',
        out_refund_no: 'fixture-refund',
        refund_status: 'SUCCESS',
        amount: { refund: 19900, currency: 'CNY' },
      },
      'REFUND.SUCCESS',
    );
    assert.equal(payment.notification(refund.raw, refund.headers).kind, 'refund');
    const reply = (status: number, value?: object) => {
      const raw = value ? JSON.stringify(value) : '';
      const timestamp = String(Math.floor(Date.now() / 1000));
      const nonce = 'response-fixture';
      return new Response(status === 204 ? null : raw, {
        status,
        headers: {
          'Wechatpay-Timestamp': timestamp,
          'Wechatpay-Nonce': nonce,
          'Wechatpay-Serial': fixture.QITU_WECHAT_PUBLIC_KEY_ID,
          'Wechatpay-Signature': sign(
            'RSA-SHA256',
            Buffer.from(`${timestamp}\n${nonce}\n${raw}\n`),
            pair.privateKey,
          ).toString('base64'),
        },
      });
    };
    globalThis.fetch = async (url, init) => {
      assert.match(String(url), /^https:\/\/api\.mch\.weixin\.qq\.com\//);
      assert.equal(
        new Headers(init?.headers).get('Wechatpay-Serial'),
        fixture.QITU_WECHAT_PUBLIC_KEY_ID,
      );
      return init?.method === 'POST' ? reply(204) : reply(404, { code: 'ORDER_NOT_EXIST' });
    };
    assert.equal(await payment.query('fixture-order'), null);
    await payment.close('fixture-order');
    globalThis.fetch = async () =>
      new Response(JSON.stringify({ code: 'ORDER_NOT_EXIST' }), { status: 404 });
    await assert.rejects(() => payment.query('fixture-order'));
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key, value] of Object.entries(before)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    unlinkSync(privateFile);
    unlinkSync(publicFile);
    rmdirSync(folder);
  }
});
