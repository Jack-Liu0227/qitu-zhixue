import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { createHmac, randomUUID, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { eq, inArray, sql } from 'drizzle-orm';
import {
  businessSettings,
  familyInvitations,
  guardianLinks,
  users,
  type Database,
} from '@qitu/database';
import type { CurrentUser } from '@qitu/contracts';
import { DATABASE_TOKEN } from '../../database';
import { AuditWriter } from '../../common/audit/audit.service';
import { IdempotencyStore } from '../../common/idempotency/idempotency.service';
import { hashIdempotentInput } from '../../common/idempotency/idempotency.hash';
import { throwHttpForIdempotencyError } from '../../common/idempotency/idempotency.errors';
import { assertSalesSettings, objectInput, textInput } from '../business/business.validation';

export function hashFamilyPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  return `scrypt$${salt}$${scryptSync(password, salt, 32).toString('hex')}`;
}

/** Invitations provision identities and guardian links, never formal learning projects. */
@Injectable()
export class FamilyInvitationService {
  constructor(
    @Inject(DATABASE_TOKEN) private readonly db: Database | null,
    private readonly audit: AuditWriter,
    private readonly idempotency: IdempotencyStore,
  ) {}
  private database() {
    if (!this.db) throw new ServiceUnavailableException('邀请存储不可用');
    return this.db;
  }
  private secret() {
    const key = process.env.QITU_INVITATION_SIGNING_KEY;
    if (!key || key.length < 32)
      throw new ServiceUnavailableException({
        code: 'FAMILY_INVITATION_UNAVAILABLE',
        message: '家庭邀请尚未配置',
      });
    return key;
  }
  private signature(id: string) {
    return createHmac('sha256', this.secret())
      .update(`qitu-family-invitation:v1:${id}`)
      .digest('hex');
  }
  private invitationId(token: string) {
    const match = /^([a-f0-9-]{36})\.([a-f0-9]{64})$/.exec(token);
    if (
      !match?.[1] ||
      !match[2] ||
      !timingSafeEqual(Buffer.from(match[2], 'hex'), Buffer.from(this.signature(match[1]), 'hex'))
    )
      throw new UnauthorizedException('邀请链接无效');
    return match[1];
  }

  async create(actor: CurrentUser, key: string, body: unknown) {
    this.secret();
    const v = objectInput(body, ['parentEmail', 'parentName', 'studentEmail', 'studentName']);
    const email = (value: unknown) => {
      const s = textInput(value, '邮箱', 150).toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) throw new ConflictException('邮箱格式不正确');
      return s;
    };
    const input = {
      parentEmail: email(v.parentEmail),
      parentName: textInput(v.parentName, '家长称呼', 60),
      studentEmail: email(v.studentEmail),
      studentName: textInput(v.studentName, '学生称呼', 60),
    };
    if (input.parentEmail === input.studentEmail)
      throw new ConflictException('家长与学生须使用不同的登录邮箱');
    const scope = `directory.family-invite:${actor.id}`;
    try {
      const result = await this.idempotency.execute(
        scope,
        key,
        hashIdempotentInput(scope, {}, input),
        async () => ({
          status: 201,
          body: await this.database().transaction(async (tx) => {
            const exists = await tx
              .select({ id: users.id })
              .from(users)
              .where(inArray(sql`lower(${users.email})`, [input.parentEmail, input.studentEmail]));
            if (exists.length)
              throw new ConflictException('邮箱已存在，请使用现有账号和关系绑定入口');
            const id = randomUUID();
            const expiresAt = new Date(Date.now() + 72 * 3_600_000);
            await tx.insert(familyInvitations).values({ ...input, id, expiresAt });
            await this.audit.write(
              {
                actorId: actor.id,
                actorRole: actor.role,
                action: 'directory.family_invitation.create',
                targetType: 'family_invitation',
                targetId: id,
                detail: { expiresAt: expiresAt.toISOString() },
              },
              tx,
            );
            return { id, expiresAt: expiresAt.toISOString() };
          }),
        }),
      );
      return { ...result.body, token: `${result.body.id}.${this.signature(result.body.id)}` };
    } catch (error) {
      throwHttpForIdempotencyError(error);
    }
  }

  async inspect(token: string) {
    const id = this.invitationId(token);
    const [invite] = await this.database()
      .select()
      .from(familyInvitations)
      .where(eq(familyInvitations.id, id));
    if (!invite || invite.expiresAt <= new Date())
      throw new NotFoundException('邀请已过期，请联系平台重新获取');
    const [settings] = await this.database()
      .select()
      .from(businessSettings)
      .where(eq(businessSettings.id, 'platform'));
    if (!settings) throw new ServiceUnavailableException('服务条款尚未准备完成');
    assertSalesSettings(settings.content);
    const { operatorName, supportEmail, termsText, privacyText, refundText, revision } =
      settings.content;
    return {
      parentEmail: invite.parentEmail,
      studentEmail: invite.studentEmail,
      accepted: invite.acceptedAt !== null,
      operatorName,
      supportEmail,
      termsText,
      privacyText,
      refundText,
      revision,
    };
  }

  async accept(body: unknown) {
    const v = objectInput(body, [
      'token',
      'parentPassword',
      'studentPassword',
      'policyRevision',
      'guardianConsent',
    ]);
    const token = textInput(v.token, '邀请', 200);
    const id = this.invitationId(token);
    const parentPassword = textInput(v.parentPassword, '家长密码', 128);
    const studentPassword = textInput(v.studentPassword, '学生密码', 128);
    if (
      parentPassword.length < 12 ||
      studentPassword.length < 12 ||
      parentPassword === studentPassword ||
      v.guardianConsent !== true
    )
      throw new ConflictException('请分别设置至少 12 位的家长和学生密码，并确认监护人授权');
    const acceptedHash = createHmac('sha256', this.secret())
      .update(JSON.stringify({ id, parentPassword, studentPassword, revision: v.policyRevision }))
      .digest('hex');
    return this.database().transaction(async (tx) => {
      const [invite] = await tx
        .select()
        .from(familyInvitations)
        .where(eq(familyInvitations.id, id))
        .for('update');
      if (!invite || invite.expiresAt <= new Date()) throw new NotFoundException('邀请已过期');
      if (invite.acceptedAt) {
        if (invite.acceptedHash !== acceptedHash)
          throw new ConflictException('该邀请已经使用，请直接登录');
        return { parentEmail: invite.parentEmail };
      }
      const [settings] = await tx
        .select()
        .from(businessSettings)
        .where(eq(businessSettings.id, 'platform'))
        .for('share');
      if (!settings || settings.revision !== v.policyRevision)
        throw new ConflictException('条款已更新，请重新阅读后确认');
      assertSalesSettings(settings.content);
      const parentId = randomUUID();
      const studentId = randomUUID();
      await tx.insert(users).values([
        {
          id: parentId,
          email: invite.parentEmail,
          displayName: invite.parentName,
          role: 'parent',
          passwordHash: hashFamilyPassword(parentPassword),
        },
        {
          id: studentId,
          email: invite.studentEmail,
          displayName: invite.studentName,
          role: 'student',
          passwordHash: hashFamilyPassword(studentPassword),
        },
      ]);
      await tx
        .insert(guardianLinks)
        .values({
          id: randomUUID(),
          parentUserId: parentId,
          studentUserId: studentId,
          relationship: 'guardian',
          status: 'active',
        });
      await tx
        .update(familyInvitations)
        .set({ parentId, acceptedAt: new Date(), acceptedHash, policyRevision: settings.revision })
        .where(eq(familyInvitations.id, id));
      await this.audit.write(
        {
          actorId: parentId,
          actorRole: 'parent',
          action: 'directory.family_invitation.accept',
          targetType: 'family_invitation',
          targetId: id,
          detail: { policyRevision: settings.revision, guardianConsent: true },
        },
        tx,
      );
      return { parentEmail: invite.parentEmail };
    });
  }
}
