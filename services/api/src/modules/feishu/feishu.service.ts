import { BadRequestException, Inject, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import type { AdminFeishuSettings, AdminFeishuSettingsPatch, CurrentUser, FeishuQrSession } from '@qitu/contracts';
import { adminAssistants, feishuBots, feishuQrSessions, type Database, withTransaction } from '@qitu/database';
import { and, eq, gt } from 'drizzle-orm';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { DATABASE_TOKEN } from '../../database';
import { AuditWriter } from '../../common/audit/audit.service';
import { decryptModelSecret, encryptModelSecret, readModelSecretKey } from '../../common/secrets/model-secret';

export const FEISHU_BOT_ID = 'admin-reporting' as const;

function string(value: unknown, max: number): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string' || value.length > max) throw new BadRequestException('飞书配置字段无效');
  return value.trim() || null;
}

export function parseFeishuPatch(body: unknown): AdminFeishuSettingsPatch {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new BadRequestException('飞书配置须为对象');
  const value = body as Record<string, unknown>;
  const allowed = ['enabled', 'appId', 'appSecret', 'verificationToken', 'encryptKey', 'domain', 'reportAssistantId', 'reportRecipients'];
  if (Object.keys(value).some((key) => !allowed.includes(key)) || !Object.keys(value).length) throw new BadRequestException('飞书配置字段不受支持');
  if ('enabled' in value && typeof value.enabled !== 'boolean') throw new BadRequestException('enabled 须为布尔值');
  if ('domain' in value && value.domain !== 'feishu' && value.domain !== 'lark') throw new BadRequestException('domain 须为 feishu 或 lark');
  for (const key of ['appId', 'appSecret', 'verificationToken', 'encryptKey', 'reportAssistantId']) if (key in value) string(value[key], 512);
  if ('reportRecipients' in value) {
    if (!Array.isArray(value.reportRecipients) || value.reportRecipients.length > 500) throw new BadRequestException('reportRecipients 无效');
    const seen = new Set<string>();
    for (const item of value.reportRecipients) {
      const id = string(item, 256);
      if (!id || seen.has(id)) throw new BadRequestException('reportRecipients 必须为唯一非空字符串');
      seen.add(id);
    }
  }
  return value as AdminFeishuSettingsPatch;
}

@Injectable()
export class FeishuService {
  constructor(@Inject(DATABASE_TOKEN) private readonly db: Database | null, private readonly audit: AuditWriter) {}

  private database(): Database {
    if (!this.db) throw new ServiceUnavailableException('飞书配置存储不可用');
    return this.db;
  }

  async getSettings(): Promise<AdminFeishuSettings> {
    const db = this.database();
    const [rows] = await Promise.all([db.select().from(feishuBots).where(eq(feishuBots.id, FEISHU_BOT_ID))]);
    const row = rows[0];
    return {
      id: FEISHU_BOT_ID,
      enabled: row?.enabled ?? false,
      connected: !!(row?.enabled && row?.appId && row?.appSecretEncrypted && row?.verificationTokenEncrypted && row?.encryptKeyEncrypted && (row.reportRecipients?.length ?? 0) > 0),
      appId: row?.appId ?? null,
      domain: row?.domain === 'lark' ? 'lark' : 'feishu',
      reportAssistantId: row?.reportAssistantId ?? null,
      reportRecipients: row?.reportRecipients ?? [],
      credentialConfigured: !!(row?.appSecretEncrypted && row?.verificationTokenEncrypted && row?.encryptKeyEncrypted),
      qrBinding: { supported: true, callbackPath: '/api/v1/integrations/feishu/oauth/callback' },
      updatedAt: row?.updatedAt?.toISOString() ?? null,
    };
  }

  async update(actor: CurrentUser, input: AdminFeishuSettingsPatch): Promise<AdminFeishuSettings> {
    const patch = parseFeishuPatch(input);
    const db = this.database();
    let key: Buffer | null = null;
    try { key = readModelSecretKey(); } catch { throw new ServiceUnavailableException('飞书密钥加密配置无效'); }
    const encrypt = (value: string | null | undefined): string | null | undefined => {
      if (value === undefined) return undefined;
      if (value === null) return null;
      if (!key) throw new ServiceUnavailableException('未配置 QITU_MODEL_SECRET_KEY，无法保存飞书密钥');
      return encryptModelSecret(value, key);
    };
    await withTransaction(db, async (tx) => {
      if (patch.reportAssistantId) {
        const [assistant] = await tx.select({ id: adminAssistants.id, enabled: adminAssistants.enabled }).from(adminAssistants).where(eq(adminAssistants.id, patch.reportAssistantId));
        if (!assistant) throw new NotFoundException('汇报助手不存在');
        if (!assistant.enabled) throw new BadRequestException('汇报助手已停用');
      }
      const [existing] = await tx.select().from(feishuBots).where(eq(feishuBots.id, FEISHU_BOT_ID)).for('update');
      const now = new Date();
      const values = {
        id: FEISHU_BOT_ID,
        enabled: patch.enabled ?? existing?.enabled ?? false,
        appId: patch.appId !== undefined ? patch.appId : existing?.appId ?? null,
        appSecretEncrypted: patch.appSecret === undefined ? existing?.appSecretEncrypted ?? null : encrypt(patch.appSecret) ?? null,
        verificationTokenEncrypted: patch.verificationToken === undefined ? existing?.verificationTokenEncrypted ?? null : encrypt(patch.verificationToken) ?? null,
        encryptKeyEncrypted: patch.encryptKey === undefined ? existing?.encryptKeyEncrypted ?? null : encrypt(patch.encryptKey) ?? null,
        domain: patch.domain ?? existing?.domain ?? 'feishu',
        reportAssistantId: patch.reportAssistantId !== undefined ? patch.reportAssistantId : existing?.reportAssistantId ?? null,
        reportRecipients: patch.reportRecipients ? [...patch.reportRecipients] : existing?.reportRecipients ?? [],
        updatedBy: actor.id,
        updatedAt: now,
      };
      if (existing) await tx.update(feishuBots).set(values).where(eq(feishuBots.id, FEISHU_BOT_ID));
      else await tx.insert(feishuBots).values(values);
      await this.audit.write({ actorId: actor.id, actorRole: actor.role, action: 'admin.feishu.update', targetType: 'feishu_bot', targetId: FEISHU_BOT_ID,
        detail: { enabled: values.enabled, appId: values.appId, domain: values.domain, reportAssistantId: values.reportAssistantId, recipientCount: values.reportRecipients.length } }, tx);
    });
    return this.getSettings();
  }

  async createQrSession(actor: CurrentUser): Promise<FeishuQrSession> {
    const db = this.database();
    const [bot] = await db.select().from(feishuBots).where(eq(feishuBots.id, FEISHU_BOT_ID));
    if (!bot?.appId) throw new BadRequestException('请先配置飞书 App ID');
    const id = randomUUID();
    const state = randomBytes(24).toString('base64url');
    const expiresAt = new Date(Date.now() + 10 * 60_000);
    await db.insert(feishuQrSessions).values({ id, botId: FEISHU_BOT_ID, state, status: 'pending', expiresAt, updatedAt: new Date() });
    await this.audit.write({ actorId: actor.id, actorRole: actor.role, action: 'admin.feishu.qr.create', targetType: 'feishu_qr_session', targetId: id, detail: {} });
    const redirect = absoluteRedirectUri();
    const authorizationUrl = `https://${bot.domain === 'lark' ? 'open.larksuite.com' : 'open.feishu.cn'}/open-apis/authen/v1/authorize?app_id=${encodeURIComponent(bot.appId)}&redirect_uri=${encodeURIComponent(redirect)}&state=${encodeURIComponent(state)}`;
    return { id, status: 'pending', authorizationUrl, expiresAt: expiresAt.toISOString() };
  }

  async getQrSession(id: string): Promise<FeishuQrSession> {
    const db = this.database();
    const [row] = await db.select().from(feishuQrSessions).where(eq(feishuQrSessions.id, id));
    if (!row) throw new NotFoundException('二维码会话不存在');
    const status = row.status === 'pending' && row.expiresAt.getTime() <= Date.now() ? 'expired' : row.status as FeishuQrSession['status'];
    if (status !== row.status) await db.update(feishuQrSessions).set({ status, updatedAt: new Date() }).where(eq(feishuQrSessions.id, id));
    const [bot] = await db.select().from(feishuBots).where(eq(feishuBots.id, row.botId));
    const host = bot?.domain === 'lark' ? 'open.larksuite.com' : 'open.feishu.cn';
    const appId = bot?.appId;
    const authorizationUrl = appId ? `https://${host}/open-apis/authen/v1/authorize?app_id=${encodeURIComponent(appId)}&redirect_uri=${encodeURIComponent(absoluteRedirectUri())}&state=${encodeURIComponent(row.state)}` : '';
    return { id: row.id, status, authorizationUrl, expiresAt: row.expiresAt.toISOString() };
  }

  async completeQrSession(state: string, code: string): Promise<void> {
    if (!state || !code || state.length > 256 || code.length > 4096) throw new BadRequestException('OAuth 参数无效');
    const db = this.database();
    const [row] = await db.select().from(feishuQrSessions).where(and(eq(feishuQrSessions.state, state), gt(feishuQrSessions.expiresAt, new Date())));
    if (!row) throw new NotFoundException('二维码会话已过期或不存在');
    const [bot] = await db.select().from(feishuBots).where(eq(feishuBots.id, row.botId));
    if (!bot?.appId || !bot.appSecretEncrypted) throw new BadRequestException('飞书应用凭证尚未配置');
    let key: Buffer | null;
    try { key = readModelSecretKey(); } catch { throw new ServiceUnavailableException('飞书密钥加密配置无效'); }
    if (!key) throw new ServiceUnavailableException('未配置 QITU_MODEL_SECRET_KEY');
    let appSecret: string;
    try { appSecret = decryptModelSecret(bot.appSecretEncrypted, key); } catch { throw new ServiceUnavailableException('飞书应用凭证无法解密'); }
    const host = bot.domain === 'lark' ? 'open.larksuite.com' : 'open.feishu.cn';
    let response: Response;
    try {
      const appTokenResponse = await fetch(`https://${host}/open-apis/auth/v3/app_access_token/internal`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ app_id: bot.appId, app_secret: appSecret }),
        signal: AbortSignal.timeout(10_000),
      });
      const appTokenPayload = await appTokenResponse.json().catch(() => ({})) as { app_access_token?: string; tenant_access_token?: string; data?: { app_access_token?: string; tenant_access_token?: string } };
      const appAccessToken = appTokenPayload.app_access_token ?? appTokenPayload.data?.app_access_token ?? appTokenPayload.tenant_access_token ?? appTokenPayload.data?.tenant_access_token;
      if (!appTokenResponse.ok || !appAccessToken) throw new Error('FEISHU_APP_TOKEN_FAILED');
      response = await fetch(`https://${host}/open-apis/authen/v1/access_token`, {
        method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${appAccessToken}` },
        body: JSON.stringify({ grant_type: 'authorization_code', code }),
        signal: AbortSignal.timeout(10_000),
      });
    } catch { throw new ServiceUnavailableException('飞书授权交换失败'); }
    if (!response.ok) throw new BadRequestException('飞书授权码无效或已过期');
    const payload = await response.json().catch(() => ({})) as { data?: { open_id?: string }; open_id?: string };
    const openId = payload.data?.open_id ?? payload.open_id;
    if (!openId || typeof openId !== 'string' || openId.length > 256) throw new BadRequestException('飞书未返回有效用户标识');
    const openIdHash = createHash('sha256').update(openId).digest('hex').slice(0, 24);
    await withTransaction(db, async (tx) => {
      const [currentBot] = await tx.select().from(feishuBots).where(eq(feishuBots.id, row.botId)).for('update');
      const recipients = currentBot?.reportRecipients ?? [];
      const nextRecipients = recipients.includes(openId) ? recipients : [...recipients, openId];
      await tx.update(feishuQrSessions).set({ status: 'bound', boundOpenId: openIdHash, updatedAt: new Date() }).where(eq(feishuQrSessions.id, row.id));
      await tx.update(feishuBots).set({ reportRecipients: nextRecipients, updatedAt: new Date() }).where(eq(feishuBots.id, row.botId));
      await this.audit.write({ actorId: null, actorRole: null, action: 'admin.feishu.qr.bound', targetType: 'feishu_qr_session', targetId: row.id,
        detail: { recipientAdded: !recipients.includes(openId), recipientHash: openIdHash } }, tx);
    });
  }
}

function absoluteRedirectUri(): string {
  const value = (process.env.QITU_FEISHU_REDIRECT_URI ?? '').trim();
  let parsed: URL;
  try { parsed = new URL(value); } catch { throw new ServiceUnavailableException('QITU_FEISHU_REDIRECT_URI 必须是绝对 HTTPS 地址'); }
  if (parsed.protocol !== 'https:' && parsed.hostname !== 'localhost' && parsed.hostname !== '127.0.0.1') {
    throw new ServiceUnavailableException('QITU_FEISHU_REDIRECT_URI 必须使用 HTTPS');
  }
  return parsed.toString();
}
