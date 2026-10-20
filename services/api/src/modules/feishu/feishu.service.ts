import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import type { AdminFeishuSettings, AdminFeishuSettingsPatch, CurrentUser, FeishuDeviceAuthorization, FeishuQrSession, FeishuReportDocument } from '@qitu/contracts';
import { adminAssistants, feishuAdminBindings, feishuBots, feishuQrSessions, type Database, withTransaction } from '@qitu/database';
import { and, eq, gt } from 'drizzle-orm';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { DATABASE_TOKEN } from '../../database';
import { AuditWriter } from '../../common/audit/audit.service';
import { decryptModelSecret, encryptModelSecret, readModelSecretKey } from '../../common/secrets/model-secret';
import { decryptDeviceAuthorization, encryptDeviceAuthorization } from './device-authorization';

export const FEISHU_BOT_ID = 'admin-reporting' as const;
export const DEFAULT_FEISHU_ASSISTANT_ID = 'feishu-reporting-assistant' as const;
/** Refresh device QR sessions before the provider's short-lived code expires. */
const DEVICE_QR_REFRESH_LEAD_MS = 45_000;

function requireSecretKey(): Buffer {
  try {
    const key = readModelSecretKey();
    if (!key) throw new Error('MISSING_SECRET_KEY');
    return key;
  } catch {
    throw new ServiceUnavailableException('QITU_MODEL_SECRET_KEY is required and must be a valid 32-byte key');
  }
}

function string(value: unknown, max: number): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string' || value.length > max) throw new BadRequestException('椋炰功閰嶇疆瀛楁鏃犳晥');
  return value.trim() || null;
}

export function parseFeishuPatch(body: unknown): AdminFeishuSettingsPatch {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new BadRequestException('椋炰功閰嶇疆椤讳负瀵硅薄');
  const value = body as Record<string, unknown>;
  const allowed = ['enabled', 'appId', 'appSecret', 'verificationToken', 'encryptKey', 'domain', 'reportAssistantId', 'reportRecipients'];
  if (Object.keys(value).some((key) => !allowed.includes(key)) || !Object.keys(value).length) throw new BadRequestException('椋炰功閰嶇疆瀛楁涓嶅彈鏀寔');
  if ('enabled' in value && typeof value.enabled !== 'boolean') throw new BadRequestException('enabled must be boolean');
  if ('domain' in value && value.domain !== 'feishu' && value.domain !== 'lark') throw new BadRequestException('domain must be feishu or lark');
  for (const key of ['appId', 'appSecret', 'verificationToken', 'encryptKey', 'reportAssistantId']) if (key in value) string(value[key], 512);
  if ('reportRecipients' in value) {
    if (!Array.isArray(value.reportRecipients) || value.reportRecipients.length > 500) throw new BadRequestException('reportRecipients 鏃犳晥');
    const seen = new Set<string>();
    for (const item of value.reportRecipients) {
      const id = string(item, 256);
      if (!id || seen.has(id)) throw new BadRequestException('reportRecipients must be unique non-empty strings');
      seen.add(id);
    }
  }
  return value as AdminFeishuSettingsPatch;
}

@Injectable()
export class FeishuService {
  constructor(@Inject(DATABASE_TOKEN) private readonly db: Database | null, private readonly audit: AuditWriter) {}

  private database(): Database {
    if (!this.db) throw new ServiceUnavailableException('Feishu configuration storage unavailable');
    return this.db;
  }

  async getSettings(assistantId: string = DEFAULT_FEISHU_ASSISTANT_ID): Promise<AdminFeishuSettings> {
    const db = this.database();
    const rows = await db.select().from(feishuBots).where(eq(feishuBots.assistantId, assistantId));
    const row = rows[0] ?? (assistantId === DEFAULT_FEISHU_ASSISTANT_ID ? (await db.select().from(feishuBots).where(eq(feishuBots.id, FEISHU_BOT_ID)))[0] : undefined);
    return {
      id: (row?.id as 'admin-reporting' | undefined) ?? FEISHU_BOT_ID,
      enabled: row?.enabled ?? false,
      connected: !!(row?.enabled && row?.appId && row?.appSecretEncrypted && (row.reportRecipients?.length ?? 0) > 0),
      appId: row?.appId ?? null,
      domain: row?.domain === 'lark' ? 'lark' : 'feishu',
      reportAssistantId: row?.reportAssistantId ?? null,
      reportRecipients: row?.reportRecipients ?? [],
      credentialConfigured: !!row?.appSecretEncrypted,
      qrBinding: { supported: true, callbackPath: '/api/v1/integrations/feishu/oauth/callback' },
      updatedAt: row?.updatedAt?.toISOString() ?? null,
    };
  }

  async update(actor: CurrentUser, input: AdminFeishuSettingsPatch, assistantId: string = DEFAULT_FEISHU_ASSISTANT_ID): Promise<AdminFeishuSettings> {
    const patch = parseFeishuPatch(input);
    const db = this.database();
    const key = requireSecretKey();
    const encrypt = (value: string | null | undefined): string | null | undefined => {
      if (value === undefined) return undefined;
      if (value === null) return null;
      return encryptModelSecret(value, key);
    };
    await withTransaction(db, async (tx) => {
      if (patch.reportAssistantId) {
        const [assistant] = await tx.select({ id: adminAssistants.id, enabled: adminAssistants.enabled }).from(adminAssistants).where(eq(adminAssistants.id, patch.reportAssistantId));
        if (!assistant) throw new NotFoundException('reporting assistant not found');
        if (!assistant.enabled) throw new BadRequestException('reporting assistant is disabled');
      }
      const existingRows = await tx.select().from(feishuBots).where(eq(feishuBots.assistantId, assistantId)).for('update');
      const existing = existingRows[0] ?? (assistantId === DEFAULT_FEISHU_ASSISTANT_ID ? (await tx.select().from(feishuBots).where(eq(feishuBots.id, FEISHU_BOT_ID)).for('update'))[0] : undefined);
      const now = new Date();
      const values = {
        id: existing?.id ?? (assistantId === DEFAULT_FEISHU_ASSISTANT_ID ? FEISHU_BOT_ID : `feishu-${assistantId}`),
        assistantId,
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
      if (existing) await tx.update(feishuBots).set(values).where(eq(feishuBots.id, existing.id));
      else await tx.insert(feishuBots).values(values);
      await this.audit.write({ actorId: actor.id, actorRole: actor.role, action: 'admin.feishu.update', targetType: 'feishu_bot', targetId: values.id,
        detail: { enabled: values.enabled, appId: values.appId, domain: values.domain, reportAssistantId: values.reportAssistantId, recipientCount: values.reportRecipients.length } }, tx);
    });
    return this.getSettings(assistantId);
  }

  async createQrSession(actor: CurrentUser, assistantId: string = DEFAULT_FEISHU_ASSISTANT_ID): Promise<FeishuQrSession> {
    const db = this.database();
    const [bot] = await db.select().from(feishuBots).where(eq(feishuBots.assistantId, assistantId));
    if (!bot?.appId) throw new BadRequestException('璇峰厛閰嶇疆椋炰功 App ID');
    const existing = await db.select().from(feishuQrSessions).where(and(eq(feishuQrSessions.botId, bot.id), eq(feishuQrSessions.status, 'pending'), gt(feishuQrSessions.expiresAt, new Date())));
    if (existing[0]) return this.getQrSession(existing[0].id, actor);
    const id = randomUUID();
    const state = randomBytes(24).toString('base64url');
    const expiresAt = new Date(Date.now() + 10 * 60_000);
    await db.insert(feishuQrSessions).values({ id, botId: bot.id, state, status: 'pending', expiresAt, createdBy: actor.id, updatedAt: new Date() });
    await this.audit.write({ actorId: actor.id, actorRole: actor.role, action: 'admin.feishu.qr.create', targetType: 'feishu_qr_session', targetId: id, detail: {} });
    const redirect = absoluteRedirectUri();
    const authorizationUrl = `https://${bot.domain === 'lark' ? 'open.larksuite.com' : 'open.feishu.cn'}/open-apis/authen/v1/authorize?app_id=${encodeURIComponent(bot.appId)}&redirect_uri=${encodeURIComponent(redirect)}&state=${encodeURIComponent(state)}`;
    return { id, status: 'pending', authorizationUrl, expiresAt: expiresAt.toISOString(), pollIntervalSeconds: 5 };
  }

  async getQrSession(id: string, actor?: CurrentUser): Promise<FeishuQrSession> {
    const db = this.database();
    const [row] = await db.select().from(feishuQrSessions).where(eq(feishuQrSessions.id, id));
    if (!row) throw new NotFoundException('浜岀淮鐮佷細璇濅笉瀛樺湪');
    if (actor && row.createdBy !== actor.id) throw new ForbiddenException('Forbidden QR session');
    const status = row.status === 'pending' && row.expiresAt.getTime() <= Date.now() ? 'expired' : row.status as FeishuQrSession['status'];
    if (status !== row.status) await db.update(feishuQrSessions).set({ status, updatedAt: new Date() }).where(eq(feishuQrSessions.id, id));
    if (status !== 'pending') return { id: row.id, status, authorizationUrl: '', expiresAt: row.expiresAt.toISOString(), pollIntervalSeconds: row.pollIntervalSeconds };
    if (row.deviceCodeEncrypted) {
      const authorizationUrl = decryptDeviceAuthorization(row.deviceCodeEncrypted, requireSecretKey()).verificationUriComplete ?? '';
      return { id: row.id, status, authorizationUrl, expiresAt: row.expiresAt.toISOString(), pollIntervalSeconds: row.pollIntervalSeconds };
    }
    const [bot] = await db.select().from(feishuBots).where(eq(feishuBots.id, row.botId));
    const host = bot?.domain === 'lark' ? 'open.larksuite.com' : 'open.feishu.cn';
    const appId = bot?.appId;
    const authorizationUrl = appId ? `https://${host}/open-apis/authen/v1/authorize?app_id=${encodeURIComponent(appId)}&redirect_uri=${encodeURIComponent(absoluteRedirectUri())}&state=${encodeURIComponent(row.state)}` : '';
    return { id: row.id, status, authorizationUrl, expiresAt: row.expiresAt.toISOString(), pollIntervalSeconds: row.pollIntervalSeconds };
  }

  /** Start Feishu/Lark's server-side device registration flow (no pre-created App ID required). */
  async beginDeviceAuthorization(actor: CurrentUser, assistantId: string = DEFAULT_FEISHU_ASSISTANT_ID): Promise<FeishuDeviceAuthorization> {
    if (actor.role !== 'admin') throw new ForbiddenException('Feishu binding requires an administrator');
    const db = this.database();
    let domain: 'feishu' | 'lark' = 'feishu';
    const [configured] = await db.select().from(feishuBots).where(eq(feishuBots.assistantId, assistantId));
    if (configured?.domain === 'lark') domain = 'lark';
    if (configured) {
      const [active] = await db.select().from(feishuQrSessions).where(and(eq(feishuQrSessions.botId, configured.id), eq(feishuQrSessions.status, 'pending'), gt(feishuQrSessions.expiresAt, new Date())));
      if (active) {
        const remainingMs = active.expiresAt.getTime() - Date.now();
        // A device code cannot be extended. Retire an almost-expired session
        // created by this admin so the UI can rotate the QR without waiting
        // for a stale provider code to time out.
        if (active.createdBy === actor.id && active.deviceCodeEncrypted && remainingMs <= DEVICE_QR_REFRESH_LEAD_MS) {
          await withTransaction(db, async (tx) => {
            const retired = await tx.update(feishuQrSessions).set({ status: 'expired', deviceCodeEncrypted: null, updatedAt: new Date() })
              .where(and(eq(feishuQrSessions.id, active.id), eq(feishuQrSessions.status, 'pending')))
              .returning({ id: feishuQrSessions.id });
            if (retired.length) {
              await this.audit.write({ actorId: actor.id, actorRole: actor.role, action: 'admin.feishu.device.cancel', targetType: 'feishu_qr_session', targetId: active.id, detail: { reason: 'refresh_before_expiry', assistantId } }, tx);
            }
          });
        } else if (active.createdBy !== actor.id || !active.deviceCodeEncrypted) {
          throw new BadRequestException({ code: 'FEISHU_QR_ALREADY_ACTIVE', message: 'An authorization is already active. Return to the administrator session that started it, or wait for it to expire.' });
        } else {
          const session = decryptDeviceAuthorization(active.deviceCodeEncrypted, requireSecretKey());
          if (session.verificationUriComplete) {
            return { id: active.id, status: 'pending', verificationUriComplete: session.verificationUriComplete, expiresAt: active.expiresAt.toISOString(), pollIntervalSeconds: active.pollIntervalSeconds };
          }
          // Pre-fix sessions did not retain the QR URL. Retire only this admin's unrecoverable session.
          await withTransaction(db, async (tx) => {
            const retired = await tx.update(feishuQrSessions).set({ status: 'cancelled', deviceCodeEncrypted: null, updatedAt: new Date() })
              .where(and(eq(feishuQrSessions.id, active.id), eq(feishuQrSessions.status, 'pending'), eq(feishuQrSessions.createdBy, actor.id)))
              .returning({ id: feishuQrSessions.id });
            if (!retired.length) throw new ConflictException({ code: 'FEISHU_QR_SESSION_CHANGED', message: 'Authorization changed while restarting. Refresh its status before trying again.' });
            await this.audit.write({ actorId: actor.id, actorRole: actor.role, action: 'admin.feishu.device.cancel', targetType: 'feishu_qr_session', targetId: active.id, detail: { reason: 'verification_url_unavailable', assistantId } }, tx);
          });
        }
      }
    }
    const accounts = domain === 'lark' ? 'https://accounts.larksuite.com' : 'https://accounts.feishu.cn';
    let begin: Record<string, unknown>;
    try {
      const initResponse = await fetch(`${accounts}/oauth/v1/app/registration`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'action=init', signal: AbortSignal.timeout(10_000) });
      const init = await initResponse.json().catch(() => ({})) as Record<string, unknown>;
      if (!initResponse.ok || !Array.isArray(init.supported_auth_methods) || !init.supported_auth_methods.includes('client_secret')) throw new Error('FEISHU_DEVICE_UNSUPPORTED');
      const response = await fetch(`${accounts}/oauth/v1/app/registration`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'action=begin&archetype=PersonalAgent&auth_method=client_secret&request_user_info=open_id', signal: AbortSignal.timeout(10_000) });
      begin = await response.json().catch(() => ({})) as Record<string, unknown>;
      if (!response.ok) throw new Error('FEISHU_DEVICE_BEGIN_FAILED');
    } catch { throw new ServiceUnavailableException('椋炰功璁惧鎺堟潈鏈嶅姟鏆備笉鍙敤'); }
    const deviceCode = String(begin.device_code ?? '');
    const verificationUriComplete = String(begin.verification_uri_complete ?? begin.verification_uri ?? '');
    if (!deviceCode || !verificationUriComplete) throw new ServiceUnavailableException('Feishu returned invalid device authorization data');
    // The provider owns the device-code lifetime. Do not fabricate a fallback
    // expiry when the response omits it: the UI must not advertise a QR beyond
    // the lifetime Feishu actually granted.
    const lifetime = Number(begin.expire_in);
    const pollIntervalSeconds = Number(begin.interval ?? 5);
    const expiresAt = new Date(Date.now() + lifetime * 1000);
    if (!Number.isSafeInteger(lifetime) || lifetime <= 0 || !Number.isFinite(expiresAt.getTime())
      || !Number.isSafeInteger(pollIntervalSeconds) || pollIntervalSeconds < 1 || pollIntervalSeconds > 2_147_483) {
      throw new ServiceUnavailableException('Feishu returned invalid device authorization timing');
    }
    const key = requireSecretKey();
    const botId = configured?.id ?? (assistantId === DEFAULT_FEISHU_ASSISTANT_ID ? FEISHU_BOT_ID : `feishu-${assistantId}`);
    if (!configured) await db.insert(feishuBots).values({ id: botId, assistantId, domain, enabled: false, reportRecipients: [], updatedAt: new Date() });
    const id = randomUUID();
    const state = randomBytes(24).toString('base64url');
    await db.insert(feishuQrSessions).values({ id, botId, state, status: 'pending', expiresAt, createdBy: actor.id, deviceCodeEncrypted: encryptDeviceAuthorization({ deviceCode, verificationUriComplete }, key), pollIntervalSeconds, updatedAt: new Date() });
    await this.audit.write({ actorId: actor.id, actorRole: actor.role, action: 'admin.feishu.device.begin', targetType: 'feishu_qr_session', targetId: id, detail: { assistantId, domain, expiresAt: expiresAt.toISOString() } });
    // The admin client encodes this URL locally; no third-party QR service sees it.
    return { id, status: 'pending', verificationUriComplete, expiresAt: expiresAt.toISOString(), pollIntervalSeconds };
  }

  /** Poll a server-owned device code and apply credentials only to its assistant. */
  async pollDeviceAuthorization(id: string, actor?: CurrentUser): Promise<FeishuQrSession> {
    const db = this.database();
    const [row] = await db.select().from(feishuQrSessions).where(eq(feishuQrSessions.id, id));
    if (!row) throw new NotFoundException('浜岀淮鐮佷細璇濅笉瀛樺湪');
    if (actor && actor.id !== row.createdBy) throw new ForbiddenException('Forbidden QR session');
    if (row.status !== 'pending') return this.getQrSession(id);
    if (row.expiresAt.getTime() <= Date.now()) { await db.update(feishuQrSessions).set({ status: 'expired', updatedAt: new Date() }).where(eq(feishuQrSessions.id, id)); return this.getQrSession(id); }
    const [bot] = await db.select().from(feishuBots).where(eq(feishuBots.id, row.botId));
    const key = requireSecretKey();
    if (!row.deviceCodeEncrypted) throw new BadRequestException('璁惧鎺堟潈浼氳瘽鏃犳晥');
    const { deviceCode } = decryptDeviceAuthorization(row.deviceCodeEncrypted, key);
    const accounts = bot?.domain === 'lark' ? 'https://accounts.larksuite.com' : 'https://accounts.feishu.cn';
    let result: Record<string, unknown>;
    try {
      const response = await fetch(`${accounts}/oauth/v1/app/registration`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: `action=poll&device_code=${encodeURIComponent(deviceCode)}&tp=ob_app`, signal: AbortSignal.timeout(10_000) });
      result = await response.json().catch(() => ({})) as Record<string, unknown>;
      if (!response.ok && !result.error) throw new Error('FEISHU_DEVICE_POLL_FAILED');
    } catch { throw new ServiceUnavailableException('椋炰功璁惧鎺堟潈杞澶辫触'); }
    const error = String(result.error ?? '');
    if (error === 'authorization_pending') return this.getQrSession(id);
    if (error === 'slow_down') { await db.update(feishuQrSessions).set({ pollIntervalSeconds: row.pollIntervalSeconds + 5, updatedAt: new Date() }).where(eq(feishuQrSessions.id, id)); return this.getQrSession(id); }
    if (error === 'access_denied') { await db.update(feishuQrSessions).set({ status: 'cancelled', updatedAt: new Date() }).where(eq(feishuQrSessions.id, id)); return this.getQrSession(id); }
    if (error === 'expired_token') { await db.update(feishuQrSessions).set({ status: 'expired', updatedAt: new Date() }).where(eq(feishuQrSessions.id, id)); return this.getQrSession(id); }
    const userInfo = (result.user_info && typeof result.user_info === 'object' ? result.user_info : {}) as Record<string, unknown>;
    const appId = String(result.client_id ?? '');
    const appSecret = String(result.client_secret ?? '');
    const openId = String(userInfo.open_id ?? '');
    if (!appId || !appSecret || !openId) throw new BadRequestException('椋炰功鎺堟潈鍝嶅簲缂哄皯蹇呰瀛楁');
    if (!row.createdBy) throw new ForbiddenException('Device session is not bound to an authenticated admin');
    const openIdHash = createHash('sha256').update(openId).digest('hex').slice(0, 24);
    await withTransaction(db, async (tx) => {
      const [currentBot] = await tx.select().from(feishuBots).where(eq(feishuBots.id, row.botId)).for('update');
      const secretKey = requireSecretKey();
      const recipients = currentBot?.reportRecipients ?? [];
      const assistantId = currentBot?.assistantId ?? DEFAULT_FEISHU_ASSISTANT_ID;
      const bindingInsert = (tx.insert(feishuAdminBindings) as any).values({ id: randomUUID(), assistantId, openIdHash, adminUserId: row.createdBy }) as any;
      await (bindingInsert && typeof bindingInsert.onConflictDoNothing === 'function' ? bindingInsert.onConflictDoNothing() : bindingInsert);
      await tx.update(feishuBots).set({ enabled: true, appId, appSecretEncrypted: encryptModelSecret(appSecret, secretKey), domain: userInfo.tenant_brand === 'lark' ? 'lark' : currentBot?.domain ?? 'feishu', reportRecipients: recipients.includes(openId) ? recipients : [...recipients, openId], updatedAt: new Date() }).where(eq(feishuBots.id, row.botId));
      await tx.update(feishuQrSessions).set({ status: 'bound', boundOpenId: openIdHash, boundAdminId: row.createdBy, deviceCodeEncrypted: null, updatedAt: new Date() }).where(eq(feishuQrSessions.id, id));
      await this.audit.write({ actorId: row.createdBy ?? null, actorRole: 'admin', action: 'admin.feishu.device.bound', targetType: 'feishu_qr_session', targetId: id, detail: { recipientHash: openIdHash, assistantId: currentBot?.assistantId } }, tx);
    });
    return this.getQrSession(id);
  }

  async getRecipientHashes(assistantId: string = DEFAULT_FEISHU_ASSISTANT_ID): Promise<readonly string[]> {
    const db = this.database();
    const [bot] = await db.select().from(feishuBots).where(eq(feishuBots.assistantId, assistantId));
    return bot?.reportRecipients ?? [];
  }

  /** Minimal Feishu message sender; report text is generated from already-redacted facts. */
  async sendReport(report: FeishuReportDocument, assistantId: string = DEFAULT_FEISHU_ASSISTANT_ID): Promise<{ requestId?: string }> {
    const db = this.database();
    const [bot] = await db.select().from(feishuBots).where(eq(feishuBots.assistantId, assistantId));
    if (!bot?.enabled || !bot.appId || !bot.appSecretEncrypted) throw new BadRequestException('飞书机器人未连接，请先配置或通过二维码扫码绑定');
    const key = requireSecretKey();
    const secret = decryptModelSecret(bot.appSecretEncrypted, key);
    const host = bot.domain === 'lark' ? 'open.larksuite.com' : 'open.feishu.cn';
    const tokenResponse = await fetch(`https://${host}/open-apis/auth/v3/app_access_token/internal`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ app_id: bot.appId, app_secret: secret }), signal: AbortSignal.timeout(10_000) });
    const tokenPayload = await tokenResponse.json().catch(() => ({})) as Record<string, unknown>;
    const token = String(tokenPayload.app_access_token ?? tokenPayload.tenant_access_token ?? '');
    if (!tokenResponse.ok || !token) throw new ServiceUnavailableException('飞书令牌服务暂不可用');
    const text = report.issueSummary?.formattedText ?? JSON.stringify({ summary: report.summary, range: report.range, redacted: true });
    let requestId: string | undefined;
    for (const recipient of bot.reportRecipients ?? []) {
      const response = await fetch(`https://${host}/open-apis/im/v1/messages?receive_id_type=open_id`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify({ receive_id: recipient, msg_type: 'text', content: JSON.stringify({ text }) }), signal: AbortSignal.timeout(10_000) });
      const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
      if (!response.ok) throw new ServiceUnavailableException('Feishu message delivery failed');
      requestId = String(response.headers.get('x-request-id') ?? payload.request_id ?? requestId ?? '') || undefined;
    }
    return { requestId };
  }

  async completeQrSession(state: string, code: string): Promise<void> {
    if (!state || !code || state.length > 256 || code.length > 4096) throw new BadRequestException('OAuth 鍙傛暟鏃犳晥');
    const db = this.database();
    const [row] = await db.select().from(feishuQrSessions).where(and(eq(feishuQrSessions.state, state), eq(feishuQrSessions.status, 'pending'), gt(feishuQrSessions.expiresAt, new Date())));
    if (!row) throw new NotFoundException('浜岀淮鐮佷細璇濆凡杩囨湡鎴栦笉瀛樺湪');
    const [bot] = await db.select().from(feishuBots).where(eq(feishuBots.id, row.botId));
    if (!bot?.appId || !bot.appSecretEncrypted) throw new BadRequestException('椋炰功搴旂敤鍑瘉灏氭湭閰嶇疆');
    const key = requireSecretKey();
    let appSecret: string;
    try { appSecret = decryptModelSecret(bot.appSecretEncrypted, key); } catch { throw new ServiceUnavailableException('椋炰功搴旂敤鍑瘉鏃犳硶瑙ｅ瘑'); }
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
    } catch { throw new ServiceUnavailableException('椋炰功鎺堟潈浜ゆ崲澶辫触'); }
    if (!response.ok) throw new BadRequestException('Feishu authorization code is invalid or expired');
    const payload = await response.json().catch(() => ({})) as { data?: { open_id?: string }; open_id?: string };
    const openId = payload.data?.open_id ?? payload.open_id;
    if (!openId || typeof openId !== 'string' || openId.length > 256) throw new BadRequestException('Feishu returned an invalid user identifier');
    if (!row.createdBy) throw new ForbiddenException('Device session is not bound to an authenticated admin');
    const openIdHash = createHash('sha256').update(openId).digest('hex').slice(0, 24);
    await withTransaction(db, async (tx) => {
      const [currentBot] = await tx.select().from(feishuBots).where(eq(feishuBots.id, row.botId)).for('update');
      const recipients = currentBot?.reportRecipients ?? [];
      const assistantId = currentBot?.assistantId ?? DEFAULT_FEISHU_ASSISTANT_ID;
      const bindingInsert = (tx.insert(feishuAdminBindings) as any).values({ id: randomUUID(), assistantId, openIdHash, adminUserId: row.createdBy }) as any;
      await (bindingInsert && typeof bindingInsert.onConflictDoNothing === 'function' ? bindingInsert.onConflictDoNothing() : bindingInsert);
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
  try { parsed = new URL(value); } catch { throw new ServiceUnavailableException('QITU_FEISHU_REDIRECT_URI 蹇呴』鏄粷瀵?HTTPS 鍦板潃'); }
  if (parsed.protocol !== 'https:' && parsed.hostname !== 'localhost' && parsed.hostname !== '127.0.0.1') {
    throw new ServiceUnavailableException('QITU_FEISHU_REDIRECT_URI 蹇呴』浣跨敤 HTTPS');
  }
  return parsed.toString();
}


