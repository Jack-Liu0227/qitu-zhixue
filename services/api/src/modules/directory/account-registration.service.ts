import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { eq, or, sql } from 'drizzle-orm';
import { auditLogs, businessSettings, users, type Database } from '@qitu/database';
import type { AccountRegistrationPolicy, AccountRegistrationResult } from '@qitu/contracts';
import { DATABASE_TOKEN } from '../../database';
import { AuditWriter } from '../../common/audit/audit.service';
import { IdempotencyStore } from '../../common/idempotency/idempotency.service';
import { throwHttpForIdempotencyError } from '../../common/idempotency/idempotency.errors';
import {
  deriveAccountSecret,
  hashAccountPassword,
  matchesAccountPassword,
} from './account-password';
import { RegistrationSmsService } from './registration-sms.service';
import { objectInput, textInput } from '../business/business.validation';
import {
  AccountRegistrationLimiter,
  parseAccountRegistration,
} from './account-registration.validation';

const NOTICE =
  '注册仅创建您自己的学生或家长账号，保存称呼、登录邮箱或手机号与密码摘要，用于登录和学习服务。未成年人使用前须取得监护人同意。手机号注册会将手机号和验证码交给阿里云用于发送短信。家长仅可查看完成监护关系核验后的孩子信息。注册不会自动绑定他人、购买课程或创建学习项目。请勿填写身份证号、家庭住址等非必要信息。';
type RegistrationDatabase = Database | Parameters<Parameters<Database['transaction']>[0]>[0];
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const conflict = () =>
  new ConflictException({
    code: 'ACCOUNT_REGISTRATION_CONFLICT',
    message: '此登录账号不可用于注册，请更换登录信息或登录已有账号',
  });
const changed = () =>
  new ConflictException({
    code: 'ACCOUNT_REGISTRATION_POLICY_CHANGED',
    message: '注册说明已更新，请重新读取并确认',
  });

@Injectable()
export class AccountRegistrationService {
  private readonly limiter = new AccountRegistrationLimiter();
  constructor(
    @Inject(DATABASE_TOKEN) private readonly db: Database | null,
    private readonly audit: AuditWriter,
    private readonly idempotency: IdempotencyStore,
    @Optional() private readonly sms?: RegistrationSmsService,
  ) {}
  private database() {
    if (!this.db)
      throw new ServiceUnavailableException({
        code: 'ACCOUNT_REGISTRATION_UNAVAILABLE',
        message: '注册服务暂不可用，请稍后重试',
      });
    return this.db;
  }
  async policy(
    executor: RegistrationDatabase = this.database(),
  ): Promise<AccountRegistrationPolicy> {
    const [settings] = await executor
      .select()
      .from(businessSettings)
      .where(eq(businessSettings.id, 'platform'))
      .for('share');
    const content = {
      notice: NOTICE,
      operatorName: settings?.content.operatorName ?? '',
      supportEmail: settings?.content.supportEmail ?? '',
      termsText: settings?.content.termsText ?? '',
      privacyText: settings?.content.privacyText ?? '',
    };
    return {
      ...content,
      version: digest(JSON.stringify(['account-registration.v1', content])),
      phoneRegistration: this.sms?.status() ?? {
        available: false,
        reason: '短信服务尚未配置，可先使用邮箱注册',
      },
    };
  }
  async sendCode(key: string, body: unknown, client: string) {
    const v = objectInput(body, ['phone', 'policyVersion', 'acceptedSmsTerms']),
      policy = await this.policy();
    if (v.policyVersion !== policy.version) throw changed();
    if (v.acceptedSmsTerms !== true) throw new BadRequestException('请读取并同意当前短信注册说明');
    if (!this.sms) throw new ServiceUnavailableException('短信服务尚未配置，可先使用邮箱注册');
    return this.sms.send(key, textInput(v.phone, '手机号', 20), client);
  }
  async register(key: string, body: unknown, client: string): Promise<AccountRegistrationResult> {
    const release = this.limiter.enter(client);
    try {
      if (!/^[a-f0-9]{32}$/.test(key ?? ''))
        throw new BadRequestException({
          code: 'IDEMPOTENCY_KEY_REQUIRED',
          message: '请刷新注册页面后重试',
        });
      const input = parseAccountRegistration(body),
        email = input.method === 'email' ? input.email : '',
        phone = input.method === 'phone' ? input.phone : null;
      const response: AccountRegistrationResult = { login: phone ?? email, role: input.role };
      const scope = 'directory.account-registration',
        userId = `self-user-${digest(key)}`;
      // Slow salted fingerprint; neither the password nor SMS code is persisted in request logs.
      const requestHash = (await deriveAccountSecret(JSON.stringify(input), key)).toString('hex');
      const result = await this.idempotency.execute(scope, key, requestHash, async () => {
        if (input.method === 'phone') {
          if (!this.sms) throw new ServiceUnavailableException('短信服务尚未配置');
          await this.sms.verify(input.phone, input.challengeId, input.code, userId);
        }
        const value = await this.database().transaction(async (tx) => {
          await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${scope + key}, 0))`);
          const [recovered] = await tx.select().from(users).where(eq(users.id, userId));
          if (recovered) {
            const receipts = await tx
              .select({ detail: auditLogs.detail })
              .from(auditLogs)
              .where(eq(auditLogs.targetId, userId));
            if (
              !receipts.some(
                ({ detail }) =>
                  detail &&
                  typeof detail === 'object' &&
                  'policyVersion' in detail &&
                  detail.policyVersion === input.policyVersion,
              ) ||
              recovered.disabledAt ||
              recovered.role !== input.role ||
              recovered.email !== email ||
              recovered.phone !== phone ||
              recovered.displayName !== input.displayName ||
              !(await matchesAccountPassword(input.password, recovered.passwordHash))
            )
              throw conflict();
            return response;
          }
          const policy = await this.policy(tx);
          if (input.policyVersion !== policy.version) throw changed();
          const existing = await tx
            .select({ id: users.id })
            .from(users)
            .where(
              or(
                email ? eq(sql`lower(${users.email})`, email) : undefined,
                phone ? eq(users.phone, phone) : undefined,
              ),
            );
          if (existing.length) throw conflict();
          await tx
            .insert(users)
            .values({
              id: userId,
              email,
              phone,
              phoneVerifiedAt: phone ? new Date() : null,
              displayName: input.displayName,
              role: input.role,
              passwordHash: await hashAccountPassword(input.password),
            });
          if (input.method === 'phone') {
            if (!this.sms) throw new ServiceUnavailableException('短信服务尚未配置');
            await this.sms.consume(tx, input.phone, input.challengeId, userId);
          }
          await this.audit.write(
            {
              actorId: userId,
              actorRole: input.role,
              action: 'directory.account_registration.create',
              targetType: 'user',
              targetId: userId,
              detail: {
                policyVersion: policy.version,
                acceptedTerms: true,
                ageConsent: true,
                source: 'self-registration',
                emailVerified: false,
                phoneVerified: input.method === 'phone',
              },
            },
            tx,
          );
          return response;
        });
        return { status: 201, body: value };
      });
      return result.body;
    } catch (error) {
      let cause: unknown = error;
      for (let depth = 0; depth < 4 && cause && typeof cause === 'object'; depth++) {
        if ('code' in cause && cause.code === '23505') throw conflict();
        cause = 'cause' in cause ? cause.cause : undefined;
      }
      throwHttpForIdempotencyError(error);
    } finally {
      release();
    }
  }
}
