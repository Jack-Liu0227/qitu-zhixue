import {
  BadRequestException,
  ConflictException,
  HttpException,
  Inject,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { createHmac, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import { and, eq, gt, lt, sql } from 'drizzle-orm';
import { registrationSms, type Database } from '@qitu/database';
import { normalizeRegistrationPhone, type RegistrationSmsReceipt } from '@qitu/contracts';
import { DATABASE_TOKEN } from '../../database';
import { AliyunRegistrationSms } from './aliyun-registration-sms';

type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];
const invalid = () =>
  new BadRequestException({
    code: 'REGISTRATION_SMS_INVALID',
    message: '验证码无效或已过期，请重新获取',
  });
const unavailable = () =>
  new ServiceUnavailableException({
    code: 'REGISTRATION_SMS_UNAVAILABLE',
    message: '短信注册暂不可用，请选择邮箱注册',
  });
const limited = () =>
  new HttpException(
    { code: 'REGISTRATION_SMS_RATE_LIMITED', message: '验证码请求较多，请稍后再试' },
    429,
  );

@Injectable()
export class RegistrationSmsService {
  constructor(
    @Inject(DATABASE_TOKEN) private readonly db: Database | null,
    private readonly provider: AliyunRegistrationSms,
  ) {}
  private database() {
    if (!this.db) throw unavailable();
    return this.db;
  }
  private digest(value: string) {
    const key = process.env.QITU_SMS_VERIFICATION_KEY;
    if (!key || key.length < 32) throw unavailable();
    return createHmac('sha256', key).update(value).digest('hex');
  }
  status() {
    try {
      this.digest('readiness');
      return this.provider.status();
    } catch {
      return { available: false, reason: '短信服务尚未配置，可先使用邮箱注册' };
    }
  }
  async send(key: string, value: string, client: string): Promise<RegistrationSmsReceipt> {
    const phone = normalizeRegistrationPhone(value);
    if (!phone || !/^[a-f0-9]{32}$/.test(key)) throw invalid();
    if (!this.status().available) throw unavailable();
    const phoneHash = this.digest(`phone:${phone}`),
      clientHash = this.digest(`client:${client}`);
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0'),
      id = randomUUID(),
      now = new Date();
    const result = await this.database().transaction(async (tx) => {
      // Serialize the small registration send budget, including retries across processes.
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended('registration-sms-send',0))`,
      );
      await tx
        .delete(registrationSms)
        .where(lt(registrationSms.createdAt, new Date(now.getTime() - 7 * 86400_000)));
      const [replay] = await tx
        .select()
        .from(registrationSms)
        .where(eq(registrationSms.requestKey, key));
      if (replay) {
        if (replay.phoneHash !== phoneHash)
          throw new ConflictException('此验证码请求已用于其他手机号');
        if (replay.status !== 'sent' || replay.expiresAt <= now) throw invalid();
        return { row: replay, replayed: true };
      }
      const recent = await tx
        .select()
        .from(registrationSms)
        .where(gt(registrationSms.createdAt, new Date(now.getTime() - 86400_000)));
      const samePhone = recent.filter((row) => row.phoneHash === phoneHash);
      if (
        recent.length >= 500 ||
        samePhone.length >= 5 ||
        samePhone.some((row) => now.getTime() - row.createdAt.getTime() < 60_000) ||
        recent.filter(
          (row) =>
            row.clientHash === clientHash && now.getTime() - row.createdAt.getTime() < 3600_000,
        ).length >= 20
      )
        throw limited();
      const row = {
        id,
        requestKey: key,
        phoneHash,
        clientHash,
        codeHash: this.digest(`code:${id}:${phone}:${code}`),
        status: 'sending',
        expiresAt: new Date(now.getTime() + 5 * 60_000),
      };
      await tx.insert(registrationSms).values(row);
      return { row, replayed: false };
    });
    if (!result.replayed) {
      try {
        await this.provider.send(phone, code);
        await this.database()
          .update(registrationSms)
          .set({ status: 'sent' })
          .where(eq(registrationSms.id, id));
      } catch {
        await this.database()
          .update(registrationSms)
          .set({ status: 'failed' })
          .where(eq(registrationSms.id, id));
        throw unavailable();
      }
    }
    return {
      challengeId: result.row.id,
      expiresAt: result.row.expiresAt.toISOString(),
      retryAfterSeconds: Math.max(
        0,
        Math.ceil((result.row.expiresAt.getTime() - 240_000 - Date.now()) / 1000),
      ),
    };
  }
  /** Verification failures commit their attempt count before returning an error. */
  async verify(phone: string, id: string, code: string, owner: string): Promise<void> {
    if (!this.status().available) throw unavailable();
    const expected = this.digest(`code:${id}:${phone}:${code}`),
      phoneHash = this.digest(`phone:${phone}`);
    const valid = await this.database().transaction(async (tx) => {
      const [row] = await tx
        .select()
        .from(registrationSms)
        .where(eq(registrationSms.id, id))
        .for('update');
      if (
        !row ||
        row.phoneHash !== phoneHash ||
        row.attempts >= 5 ||
        (row.usedBy && row.usedBy !== owner)
      )
        return false;
      if (row.status !== 'sent' && !(row.status === 'used' && row.usedBy === owner)) return false;
      if (!row.usedBy && row.expiresAt <= new Date()) return false;
      const matches = timingSafeEqual(
        Buffer.from(row.codeHash, 'hex'),
        Buffer.from(expected, 'hex'),
      );
      if (!matches)
        await tx
          .update(registrationSms)
          .set({ attempts: row.attempts + 1 })
          .where(eq(registrationSms.id, id));
      return matches;
    });
    if (!valid) throw invalid();
  }
  async consume(tx: Transaction, phone: string, id: string, owner: string): Promise<void> {
    const [row] = await tx
      .select()
      .from(registrationSms)
      .where(
        and(
          eq(registrationSms.id, id),
          eq(registrationSms.phoneHash, this.digest(`phone:${phone}`)),
        ),
      )
      .for('update');
    if (
      !row ||
      row.status !== 'sent' ||
      row.usedBy ||
      row.attempts >= 5 ||
      row.expiresAt <= new Date()
    )
      throw invalid();
    await tx
      .update(registrationSms)
      .set({ status: 'used', usedBy: owner })
      .where(eq(registrationSms.id, id));
  }
}
