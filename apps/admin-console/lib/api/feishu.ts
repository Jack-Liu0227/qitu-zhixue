import type { AdminFeishuSettings, FeishuQrSession } from '@qitu/contracts';
import { newIdempotencyKey } from './modelRegistry';
import { AdminOfflineError, AdminPermissionError } from './types';

export type FeishuConnectionStatus = 'disconnected' | 'pending' | 'connected' | 'error';

/** UI-friendly projection of the server contract. Secrets are never included. */
export interface FeishuIntegrationConfig {
  enabled: boolean;
  appId: string;
  domain: 'feishu' | 'lark';
  botName: string;
  reportAssistantId: string;
  reportScope: string[];
  status: FeishuConnectionStatus;
  statusMessage?: string;
  credentialConfigured: boolean;
  /** Write-only fields; never populated from a GET response. */
  appSecret?: string;
  verificationToken?: string;
  encryptKey?: string;
  qrBinding?: { supported: boolean; callbackPath: string };
  qrSessionId?: string;
  qrCodeUrl?: string;
  expiresAt?: string;
  lastSyncedAt?: string;
}

export interface FeishuQrResponse {
  sessionId: string;
  status: FeishuQrSession['status'];
  authorizationUrl: string;
  expiresAt: string;
}

function mapSettings(value: AdminFeishuSettings): FeishuIntegrationConfig {
  return {
    enabled: value.enabled,
    appId: value.appId ?? '',
    domain: value.domain,
    botName: value.domain === 'lark' ? 'Lark 汇报助手' : '飞书汇报助手',
    reportAssistantId: value.reportAssistantId ?? '',
    reportScope: ['student', 'parent', 'teacher'],
    status: value.connected ? 'connected' : 'disconnected',
    credentialConfigured: value.credentialConfigured,
    qrBinding: value.qrBinding,
    lastSyncedAt: value.updatedAt ?? undefined,
  };
}

function mapQr(value: FeishuQrSession): FeishuQrResponse {
  return { sessionId: value.id, status: value.status, authorizationUrl: value.authorizationUrl, expiresAt: value.expiresAt };
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, { credentials: 'include', ...init });
  } catch {
    throw new AdminOfflineError();
  }
  if (response.status === 401 || response.status === 403) throw new AdminPermissionError();
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { message?: string } | null;
    const error = new Error(payload?.message ?? `飞书配置请求失败（HTTP ${response.status}）`);
    (error as Error & { status?: number }).status = response.status;
    throw error;
  }
  const payload = (await response.json()) as { data: T };
  return payload.data;
}

export function fetchFeishuIntegration(): Promise<FeishuIntegrationConfig> {
  return request<AdminFeishuSettings>('/api/v1/admin/integrations/feishu').then(mapSettings);
}

export function updateFeishuIntegration(input: Partial<FeishuIntegrationConfig>): Promise<FeishuIntegrationConfig> {
  const body = {
    enabled: input.enabled,
    appId: input.appId?.trim() || null,
    domain: input.domain,
    reportAssistantId: input.reportAssistantId || null,
    // Report categories are assistant policy, not Feishu recipient identities.
    // Never overwrite the server-owned allowlist when an admin saves this form.
  };
  if (input.appSecret?.trim()) Object.assign(body, { appSecret: input.appSecret.trim() });
  if (input.verificationToken?.trim()) Object.assign(body, { verificationToken: input.verificationToken.trim() });
  if (input.encryptKey?.trim()) Object.assign(body, { encryptKey: input.encryptKey.trim() });
  return request<AdminFeishuSettings>('/api/v1/admin/integrations/feishu', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', 'Idempotency-Key': newIdempotencyKey() },
    body: JSON.stringify(body),
  }).then(mapSettings);
}

export function startFeishuQrLogin(): Promise<FeishuQrResponse> {
  return request<FeishuQrSession>('/api/v1/admin/integrations/feishu/qr-sessions', {
    method: 'POST',
    headers: { 'Idempotency-Key': newIdempotencyKey() },
  }).then(mapQr);
}

export function fetchFeishuQrStatus(sessionId: string): Promise<FeishuIntegrationConfig> {
  return request<FeishuQrSession>(`/api/v1/admin/integrations/feishu/qr-sessions/${encodeURIComponent(sessionId)}`).then((session) => ({
    enabled: true,
    appId: '',
    domain: 'feishu',
    botName: '飞书汇报助手',
    reportAssistantId: '',
    reportScope: [],
    status: session.status === 'bound' ? 'connected' : session.status === 'expired' || session.status === 'cancelled' ? 'error' : 'pending',
    credentialConfigured: session.status === 'bound',
    qrSessionId: session.id,
    qrCodeUrl: session.authorizationUrl,
    expiresAt: session.expiresAt,
  }));
}
