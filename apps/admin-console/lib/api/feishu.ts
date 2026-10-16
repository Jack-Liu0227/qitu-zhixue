import type { AdminFeishuSettings, FeishuDeviceAuthorization, FeishuQrSession } from '@qitu/contracts';
import { AdminOfflineError, AdminPermissionError, newIdempotencyKey } from './types';

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
  /** Optional server-generated QR image (data URL). Never use a third-party QR proxy. */
  qrCodeDataUrl?: string;
  expiresAt?: string;
  lastSyncedAt?: string;
}

export interface FeishuQrResponse {
  sessionId: string;
  status: FeishuQrSession['status'];
  authorizationUrl: string;
  expiresAt: string;
  qrCodeDataUrl?: string;
}

export interface FeishuQrStatusResponse {
  id: string;
  status: FeishuQrSession['status'];
  authorizationUrl: string;
  expiresAt: string;
  credentialConfigured: boolean;
  qrCodeDataUrl?: string;
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

function mapQr(value: FeishuQrSession | FeishuDeviceAuthorization): FeishuQrResponse {
  const candidate = value as (FeishuQrSession | FeishuDeviceAuthorization) & { qrCodeDataUrl?: unknown; qrCode?: unknown; verificationUriComplete?: unknown };
  const authorizationUrl = 'verificationUriComplete' in value && typeof value.verificationUriComplete === 'string'
    ? value.verificationUriComplete
    : 'authorizationUrl' in value ? value.authorizationUrl : '';
  const qrCodeDataUrl = typeof candidate.qrCodeDataUrl === 'string' && candidate.qrCodeDataUrl.startsWith('data:image/')
    ? candidate.qrCodeDataUrl
    : typeof candidate.qrCode === 'string' && candidate.qrCode.startsWith('data:image/')
      ? candidate.qrCode
      : undefined;
  return { sessionId: value.id, status: value.status, authorizationUrl, expiresAt: value.expiresAt, qrCodeDataUrl };
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

export function fetchFeishuIntegration(assistantId?: string): Promise<FeishuIntegrationConfig> {
  const query = assistantId ? `?assistantId=${encodeURIComponent(assistantId)}` : '';
  return request<AdminFeishuSettings>(`/api/v1/admin/integrations/feishu${query}`).then(mapSettings);
}

export function updateFeishuIntegration(input: Partial<FeishuIntegrationConfig>, idempotencyKey = newIdempotencyKey()): Promise<FeishuIntegrationConfig> {
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
  const assistantQuery = input.reportAssistantId ? `?assistantId=${encodeURIComponent(input.reportAssistantId)}` : '';
  return request<AdminFeishuSettings>(`/api/v1/admin/integrations/feishu${assistantQuery}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', 'Idempotency-Key': idempotencyKey },
    body: JSON.stringify(body),
  }).then(mapSettings);
}

export function startFeishuQrLogin(assistantId?: string, idempotencyKey = newIdempotencyKey()): Promise<FeishuQrResponse> {
  return request<FeishuDeviceAuthorization>('/api/v1/admin/integrations/feishu/device-sessions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'Idempotency-Key': idempotencyKey },
    body: assistantId ? JSON.stringify({ assistantId }) : undefined,
  }).then(mapQr);
}

export function fetchFeishuQrStatus(sessionId: string): Promise<FeishuQrStatusResponse> {
  return request<FeishuQrSession>(`/api/v1/admin/integrations/feishu/device-sessions/${encodeURIComponent(sessionId)}/poll`, { method: 'POST' }).then((session) => {
    const candidate = session as FeishuQrSession & { credentialConfigured?: unknown; qrCodeDataUrl?: unknown; qrCode?: unknown };
    const qrCodeDataUrl = typeof candidate.qrCodeDataUrl === 'string' && candidate.qrCodeDataUrl.startsWith('data:image/')
      ? candidate.qrCodeDataUrl
      : typeof candidate.qrCode === 'string' && candidate.qrCode.startsWith('data:image/')
        ? candidate.qrCode
        : undefined;
    return {
      id: session.id,
      status: session.status,
      authorizationUrl: session.authorizationUrl ?? '',
      expiresAt: session.expiresAt,
      credentialConfigured: session.status === 'bound' || candidate.credentialConfigured === true,
      qrCodeDataUrl,
    };
  });
}
