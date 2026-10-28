import { Injectable, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import {
  createDecipheriv,
  createPrivateKey,
  createPublicKey,
  randomBytes,
  sign,
  verify,
} from 'node:crypto';
import { readFileSync } from 'node:fs';
import { textInput } from './business.validation';

interface WechatConfig {
  appId: string;
  merchantId: string;
  serial: string;
  privateKey: string;
  publicKeyId: string;
  publicKey: string;
  apiKey: string;
  notifyOrigin: string;
}
export interface PaymentFact {
  orderId: string;
  transactionId: string;
  amountFen: number;
  paidAt: string;
}
export interface RefundFact {
  orderId: string;
  refundId: string;
  amountFen: number;
  status: 'SUCCESS' | 'PROCESSING' | 'CLOSED' | 'ABNORMAL';
}

export function verifyWechatMessage(
  input: { raw: string; timestamp: string; nonce: string; signature: string; serial: string },
  config: Pick<WechatConfig, 'publicKeyId' | 'publicKey'>,
  now = Date.now(),
): void {
  if (
    !/^\d{10}$/.test(input.timestamp) ||
    Math.abs(now / 1000 - Number(input.timestamp)) > 300 ||
    input.nonce.length > 128 ||
    input.serial !== config.publicKeyId ||
    !verify(
      'RSA-SHA256',
      Buffer.from(`${input.timestamp}\n${input.nonce}\n${input.raw}\n`),
      config.publicKey,
      Buffer.from(input.signature, 'base64'),
    )
  ) {
    throw new UnauthorizedException({
      code: 'PAYMENT_SIGNATURE_INVALID',
      message: '支付消息签名无效',
    });
  }
}

function readObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw unavailable();
  return Object.fromEntries(Object.entries(value));
}

function readAmount(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) throw unavailable();
  return value;
}

/** WeChat API v3 public-key mode. No browser-provided routes or credentials. */
@Injectable()
export class WechatPayment {
  private readConfig(): WechatConfig {
    try {
      const env = process.env;
      const required = (name: string) => {
        const value = env[name]?.trim();
        if (!value) throw unavailable();
        return value;
      };
      const notifyOrigin = required('QITU_PAYMENT_PUBLIC_ORIGIN');
      const url = new URL(notifyOrigin);
      if (
        url.protocol !== 'https:' ||
        url.username ||
        url.password ||
        url.pathname !== '/' ||
        url.search ||
        url.hash
      )
        throw unavailable();
      const config = {
        appId: required('QITU_WECHAT_APP_ID'),
        merchantId: required('QITU_WECHAT_MERCHANT_ID'),
        serial: required('QITU_WECHAT_CERT_SERIAL'),
        privateKey: readFileSync(required('QITU_WECHAT_PRIVATE_KEY_FILE'), 'utf8'),
        publicKeyId: required('QITU_WECHAT_PUBLIC_KEY_ID'),
        publicKey: readFileSync(required('QITU_WECHAT_PUBLIC_KEY_FILE'), 'utf8'),
        apiKey: required('QITU_WECHAT_API_V3_KEY'),
        notifyOrigin: url.origin,
      };
      if (Buffer.byteLength(config.apiKey) !== 32) throw unavailable();
      const privateKey = createPrivateKey(config.privateKey);
      const publicKey = createPublicKey(config.publicKey);
      if (
        privateKey.asymmetricKeyType !== 'rsa' ||
        publicKey.asymmetricKeyType !== 'rsa' ||
        (privateKey.asymmetricKeyDetails?.modulusLength ?? 0) < 2048 ||
        (publicKey.asymmetricKeyDetails?.modulusLength ?? 0) < 2048
      )
        throw unavailable();
      return config;
    } catch {
      throw unavailable();
    }
  }

  status() {
    try {
      this.readConfig();
      return {
        configured: true,
        provider: 'wechat-native' as const,
        reason: '商户参数已配置，真实交易需完成商户联调',
      };
    } catch {
      return {
        configured: false,
        provider: 'wechat-native' as const,
        reason: '微信支付商户尚未配置完整',
      };
    }
  }

  async create(order: {
    id: string;
    amountFen: number;
    title: string;
    expiresAt: Date;
  }): Promise<string> {
    const c = this.readConfig();
    const data = readObject(
      await this.request(
        'POST',
        '/v3/pay/transactions/native',
        {
          appid: c.appId,
          mchid: c.merchantId,
          description: order.title.slice(0, 40),
          out_trade_no: order.id,
          time_expire: order.expiresAt.toISOString().replace(/\.\d{3}Z$/, '+00:00'),
          notify_url: `${c.notifyOrigin}/api/v1/business/payments/wechat`,
          amount: { total: order.amountFen, currency: 'CNY' },
        },
        c,
      ),
    );
    if (typeof data.code_url !== 'string' || !data.code_url.startsWith('weixin://wxpay/'))
      throw unavailable();
    return data.code_url;
  }

  async query(orderId: string): Promise<PaymentFact | null> {
    const c = this.readConfig();
    const data = readObject(
      await this.request(
        'GET',
        `/v3/pay/transactions/out-trade-no/${encodeURIComponent(orderId)}?mchid=${encodeURIComponent(c.merchantId)}`,
        undefined,
        c,
        ['ORDER_NOT_EXIST'],
      ),
    );
    return data.trade_state === 'SUCCESS' ? this.paymentFact(data, c) : null;
  }

  async close(orderId: string): Promise<void> {
    const c = this.readConfig();
    await this.request(
      'POST',
      `/v3/pay/transactions/out-trade-no/${encodeURIComponent(orderId)}/close`,
      { mchid: c.merchantId },
      c,
      ['ORDER_NOT_EXIST', 'ORDER_CLOSED'],
    );
  }

  async refund(order: { id: string; amountFen: number; refundFen?: number; refundId: string }): Promise<RefundFact> {
    const c = this.readConfig();
    const data = readObject(
      await this.request(
        'POST',
        '/v3/refund/domestic/refunds',
        {
          out_trade_no: order.id,
          out_refund_no: order.refundId,
          notify_url: `${c.notifyOrigin}/api/v1/business/payments/wechat`,
          amount: { refund: order.refundFen ?? order.amountFen, total: order.amountFen, currency: 'CNY' },
        },
        c,
      ),
    );
    return this.refundFact(data);
  }

  async queryRefund(refundId: string): Promise<RefundFact> {
    return this.refundFact(
      readObject(
        await this.request(
          'GET',
          `/v3/refund/domestic/refunds/${encodeURIComponent(refundId)}`,
          undefined,
          this.readConfig(),
        ),
      ),
    );
  }

  notification(
    raw: string,
    headers: Record<string, string | string[] | undefined>,
  ): { kind: 'payment'; fact: PaymentFact } | { kind: 'refund'; fact: RefundFact } {
    if (Buffer.byteLength(raw) > 64_000) throw unavailable();
    const c = this.readConfig();
    const header = (name: string) => (typeof headers[name] === 'string' ? headers[name] : '');
    verifyWechatMessage(
      {
        raw,
        timestamp: header('wechatpay-timestamp'),
        nonce: header('wechatpay-nonce'),
        signature: header('wechatpay-signature'),
        serial: header('wechatpay-serial'),
      },
      c,
    );
    const body = readObject(JSON.parse(raw));
    const resource = readObject(body.resource);
    if (
      resource.algorithm !== 'AEAD_AES_256_GCM' ||
      typeof resource.ciphertext !== 'string' ||
      typeof resource.nonce !== 'string'
    )
      throw unavailable();
    const encrypted = Buffer.from(resource.ciphertext, 'base64');
    if (encrypted.length <= 16) throw unavailable();
    const decipher = createDecipheriv(
      'aes-256-gcm',
      Buffer.from(c.apiKey),
      Buffer.from(resource.nonce),
    );
    decipher.setAuthTag(encrypted.subarray(-16));
    decipher.setAAD(
      Buffer.from(typeof resource.associated_data === 'string' ? resource.associated_data : ''),
    );
    const plain = readObject(
      JSON.parse(
        Buffer.concat([decipher.update(encrypted.subarray(0, -16)), decipher.final()]).toString(
          'utf8',
        ),
      ),
    );
    if (body.event_type === 'TRANSACTION.SUCCESS' && plain.trade_state === 'SUCCESS')
      return { kind: 'payment', fact: this.paymentFact(plain, c) };
    if (
      typeof body.event_type === 'string' &&
      ['REFUND.SUCCESS', 'REFUND.CLOSED', 'REFUND.ABNORMAL'].includes(body.event_type)
    ) {
      if (plain.mchid !== c.merchantId) throw unavailable();
      return { kind: 'refund', fact: this.refundFact(plain) };
    }
    throw unavailable();
  }

  private paymentFact(data: Record<string, unknown>, c: WechatConfig): PaymentFact {
    const amount = readObject(data.amount);
    if (data.appid !== c.appId || data.mchid !== c.merchantId || amount.currency !== 'CNY')
      throw unavailable();
    const paidAt = textInput(data.success_time, '支付时间', 50);
    if (!Number.isFinite(Date.parse(paidAt))) throw unavailable();
    return {
      orderId: textInput(data.out_trade_no, '订单', 100),
      transactionId: textInput(data.transaction_id, '交易凭据', 100),
      amountFen: readAmount(amount.total),
      paidAt,
    };
  }

  private refundFact(data: Record<string, unknown>): RefundFact {
    const status = data.status ?? data.refund_status;
    const amount = readObject(data.amount);
    if (
      !['SUCCESS', 'PROCESSING', 'CLOSED', 'ABNORMAL'].includes(String(status)) ||
      (amount.currency !== undefined && amount.currency !== 'CNY')
    )
      throw unavailable();
    if (
      status !== 'SUCCESS' &&
      status !== 'PROCESSING' &&
      status !== 'CLOSED' &&
      status !== 'ABNORMAL'
    )
      throw unavailable();
    return {
      orderId: textInput(data.out_trade_no, '订单', 100),
      refundId: textInput(data.out_refund_no, '退款单', 100),
      amountFen: readAmount(amount.refund),
      status,
    };
  }

  private async request(
    method: 'POST' | 'GET',
    path: string,
    body: unknown,
    c: WechatConfig,
    acceptedErrors: readonly string[] = [],
  ): Promise<unknown> {
    const timestamp = String(Math.floor(Date.now() / 1000));
    const nonce = randomBytes(16).toString('hex');
    const payload = body === undefined ? '' : JSON.stringify(body);
    const signature = sign(
      'RSA-SHA256',
      Buffer.from(`${method}\n${path}\n${timestamp}\n${nonce}\n${payload}\n`),
      c.privateKey,
    ).toString('base64');
    try {
      const response = await fetch(`https://api.mch.weixin.qq.com${path}`, {
        method,
        signal: AbortSignal.timeout(12_000),
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          'Wechatpay-Serial': c.publicKeyId,
          Authorization: `WECHATPAY2-SHA256-RSA2048 mchid="${c.merchantId}",nonce_str="${nonce}",timestamp="${timestamp}",serial_no="${c.serial}",signature="${signature}"`,
        },
        ...(method === 'POST' ? { body: payload } : {}),
      });
      const raw = await response.text();
      if (raw.length > 64_000) throw unavailable();
      verifyWechatMessage(
        {
          raw,
          timestamp: response.headers.get('Wechatpay-Timestamp') ?? '',
          nonce: response.headers.get('Wechatpay-Nonce') ?? '',
          signature: response.headers.get('Wechatpay-Signature') ?? '',
          serial: response.headers.get('Wechatpay-Serial') ?? '',
        },
        c,
      );
      const data: unknown = raw ? JSON.parse(raw) : undefined;
      if (!response.ok) {
        const error = readObject(data);
        if (typeof error.code !== 'string' || !acceptedErrors.includes(error.code))
          throw unavailable();
      }
      return data;
    } catch {
      throw unavailable();
    }
  }
}

function unavailable() {
  return new ServiceUnavailableException({
    code: 'PAYMENT_UNAVAILABLE',
    message: '支付服务暂不可用，请稍后查询订单，不要重复付款',
  });
}
