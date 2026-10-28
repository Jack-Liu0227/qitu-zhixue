import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import {
  companyChannels,
  companyMembers,
  companyMessages,
  companyWork,
  feishuBots,
  users,
} from '@qitu/database';
import { COMPANY_DEPARTMENTS, type CurrentUser } from '@qitu/contracts';
import { BusinessStore } from '../business/business.store';
import { objectInput, textInput } from '../business/business.validation';
import { FeishuInboxService } from '../feishu/feishu-inbox.service';
import { FeishuService } from '../feishu/feishu.service';
import { FeishuBridgeService } from '../feishu/feishu-bridge.service';
import { messageUuid, recipientHash } from '../feishu/feishu-api';
import { CompanyAccess } from './company.access';
import { AuditWriter } from '../../common/audit/audit.service';
import { companyDepartment, CompanyWorkService } from './company.work';

function object(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v)
    ? Object.fromEntries(Object.entries(v))
    : {};
}
export function parseCompanyMessage(payload: unknown, appId: string) {
  const root = object(payload),
    header = object(root.header),
    event = object(root.event ?? root),
    sender = object(event.sender),
    message = object(event.message);
  if (
    (header.app_id && header.app_id !== appId) ||
    sender.sender_type !== 'user' ||
    message.chat_type !== 'group' ||
    message.message_type !== 'text'
  )
    return null;
  const senderOpenId = object(sender.sender_id).open_id;
  if (
    ![senderOpenId, message.chat_id, message.message_id].every(
      (v) => typeof v === 'string' && v.length > 0 && v.length <= 256,
    ) ||
    typeof message.content !== 'string' ||
    message.content.length > 16000
  )
    return null;
  let content: Record<string, unknown>;
  try {
    content = object(JSON.parse(message.content));
  } catch {
    return null;
  }
  if (typeof content.text !== 'string') return null;
  const text = content.text.replace(/@_user_\d+/g, '').trim();
  const match = /^\/company\s+([a-z]+)\s+([\s\S]{1,4000})$/.exec(text);
  const department = COMPANY_DEPARTMENTS.find((d) => d.id === match?.[1]);
  if (!match || !department) return null;
  return {
    senderOpenId: senderOpenId as string,
    chatId: message.chat_id as string,
    messageId: message.message_id as string,
    department: department.id,
    brief: match[2]!,
  };
}

@Injectable()
export class CompanyIntegrations implements OnModuleInit, OnModuleDestroy {
  private timer?: ReturnType<typeof setInterval>;
  private busy = false;
  private readonly logger = new Logger(CompanyIntegrations.name);
  constructor(
    private readonly store: BusinessStore,
    private readonly access: CompanyAccess,
    private readonly work: CompanyWorkService,
    private readonly inbox: FeishuInboxService,
    private readonly feishu: FeishuService,
    private readonly bridge: FeishuBridgeService,
    private readonly audit: AuditWriter,
  ) {}
  onModuleInit() {
    this.inbox.registerCompanyReceiver((assistantId, appId, payload) =>
      this.receive(assistantId, appId, payload),
    );
    this.timer = setInterval(
      () => void this.deliver().catch(() => this.logger.warn('Company delivery unavailable')),
      5000,
    );
    this.timer.unref();
  }
  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }
  async list(actor: CurrentUser) {
    await this.access.require(actor, 'manage');
    const db = this.store.database();
    const [channels, bots] = await Promise.all([
      db.select().from(companyChannels),
      db
        .select({
          assistantId: feishuBots.assistantId,
          appId: feishuBots.appId,
          enabled: feishuBots.enabled,
          inboundEnabled: feishuBots.inboundEnabled,
        })
        .from(feishuBots),
    ]);
    const members = await db
      .select({
        userId: companyMembers.userId,
        role: companyMembers.role,
        active: companyMembers.active,
        name: users.displayName,
      })
      .from(companyMembers)
      .innerJoin(users, eq(users.id, companyMembers.userId));
    return {
      channels,
      members,
      bots: await Promise.all(
        bots.map(async (bot) => ({ ...bot, bridge: await this.bridge.status(bot.assistantId) })),
      ),
    };
  }
  async bind(actor: CurrentUser, key: string, body: unknown) {
    await this.access.require(actor, 'manage');
    const v = objectInput(body, [
      'assistantId',
      'appId',
      'chatId',
      'senderOpenId',
      'userId',
      'department',
      'active',
    ]);
    const assistantId = textInput(v.assistantId, '助手', 150),
      appId = textInput(v.appId, '飞书应用', 150),
      chatId = textInput(v.chatId, '群标识', 256),
      senderHash = recipientHash(textInput(v.senderOpenId, '飞书用户 Open ID', 256)),
      userId = textInput(v.userId, '公司用户', 100),
      department = companyDepartment(v.department);
    if (typeof v.active !== 'boolean') throw new BadRequestException('绑定开关无效');
    const [user] = await this.store
      .database()
      .select({
        id: users.id,
        role: users.role,
        email: users.email,
        displayName: users.displayName,
      })
      .from(users)
      .where(and(eq(users.id, userId), isNull(users.disabledAt)));
    if (!user) throw new BadRequestException('用户不存在');
    await this.access.require(user as CurrentUser, 'operate');
    return this.store.mutate(
      actor,
      key,
      'company.feishu.bind',
      {
        assistantId,
        appId,
        chatIdHash: recipientHash(chatId),
        senderHash,
        userId,
        department,
        active: v.active,
      },
      async (tx) => {
        const [bot] = await tx
          .select()
          .from(feishuBots)
          .where(and(eq(feishuBots.assistantId, assistantId), eq(feishuBots.appId, appId)));
        if (!bot) throw new ConflictException('先在 Admin 为助手配置此飞书应用');
        const value = {
          assistantId,
          appId,
          chatId,
          senderHash,
          userId,
          department,
          active: v.active as boolean,
        };
        const [saved] = await tx
          .insert(companyChannels)
          .values({ id: randomUUID(), ...value })
          .onConflictDoUpdate({
            target: [
              companyChannels.assistantId,
              companyChannels.appId,
              companyChannels.chatId,
              companyChannels.senderHash,
              companyChannels.department,
            ],
            set: value,
          })
          .returning();
        return saved;
      },
    );
  }
  async receive(assistantId: string, appId: string, payload: unknown) {
    const message = parseCompanyMessage(payload, appId);
    if (!message) return false;
    const db = this.store.database();
    const [bot] = await db
      .select()
      .from(feishuBots)
      .where(
        and(
          eq(feishuBots.assistantId, assistantId),
          eq(feishuBots.appId, appId),
          eq(feishuBots.enabled, true),
          eq(feishuBots.inboundEnabled, true),
        ),
      );
    if (!bot) return false;
    const [channel] = await db
      .select()
      .from(companyChannels)
      .where(
        and(
          eq(companyChannels.assistantId, assistantId),
          eq(companyChannels.appId, appId),
          eq(companyChannels.chatId, message.chatId),
          eq(companyChannels.senderHash, recipientHash(message.senderOpenId)),
          eq(companyChannels.department, message.department),
          eq(companyChannels.active, true),
        ),
      );
    if (!channel) return false;
    const [user] = await db
      .select({
        id: users.id,
        role: users.role,
        displayName: users.displayName,
        email: users.email,
      })
      .from(users)
      .where(and(eq(users.id, channel.userId), isNull(users.disabledAt)));
    if (!user) return false;
    const id = messageUuid(`company:${assistantId}:${appId}:${message.messageId}`);
    const work = await this.work.create(user as CurrentUser, id, {
      department: channel.department,
      title: '飞书群委派任务',
      brief: message.brief,
    });
    await db
      .insert(companyMessages)
      .values({ id, channelId: channel.id, workId: work.id, delivery: { status: 'pending' } })
      .onConflictDoNothing();
    return true;
  }
  async deliver() {
    if (this.busy) return;
    this.busy = true;
    try {
      const db = this.store.database();
      const rows = await db
        .select({ message: companyMessages, work: companyWork })
        .from(companyMessages)
        .innerJoin(companyWork, eq(companyWork.id, companyMessages.workId))
        .where(
          and(
            sql`${companyMessages.delivery}->>'status' = 'pending'`,
            sql`${companyWork.status} in ('succeeded','failed','cancelled')`,
          ),
        )
        .limit(20);
      for (const row of rows) {
        try {
          // Groups receive status only. Work contents remain behind Company authorization.
          const receipt = await this.feishu.sendCompanyStatus(
            row.message.channelId,
            `启途智学 Company\n任务 ${row.work.id}\n状态：${({ succeeded: '已完成', failed: '执行失败', cancelled: '已取消' } as Record<string, string>)[row.work.status]}\n请登录公司工作区 /company/work 查看结果。`,
            row.message.id,
          );
          await db.transaction(async (tx) => {
            await tx
              .update(companyMessages)
              .set({ delivery: { status: 'sent', messageId: receipt.messageId } })
              .where(eq(companyMessages.id, row.message.id));
            await this.audit.write(
              {
                actorId: row.work.createdBy,
                action: 'company.feishu.delivered',
                targetType: 'company_message',
                targetId: row.message.id,
                detail: {
                  workId: row.work.id,
                  messageId: receipt.messageId,
                  projection: 'status-only',
                },
              },
              tx,
            );
          });
        } catch {
          await db
            .update(companyMessages)
            .set({ delivery: { status: 'failed' } })
            .where(eq(companyMessages.id, row.message.id));
        }
      }
    } finally {
      this.busy = false;
    }
  }
}
