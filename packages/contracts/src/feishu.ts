export type FeishuDomain = 'feishu' | 'lark';

export interface AdminFeishuSettings {
  id: 'admin-reporting';
  enabled: boolean;
  connected: boolean;
  appId: string | null;
  domain: FeishuDomain;
  reportAssistantId: string | null;
  reportRecipients: readonly string[];
  credentialConfigured: boolean;
  qrBinding: { supported: boolean; callbackPath: string };
  updatedAt: string | null;
}

export interface AdminFeishuSettingsPatch {
  enabled?: boolean;
  appId?: string | null;
  /** Secrets are accepted only on write and are never returned. */
  appSecret?: string | null;
  verificationToken?: string | null;
  encryptKey?: string | null;
  domain?: FeishuDomain;
  reportAssistantId?: string | null;
  reportRecipients?: readonly string[];
}

export interface FeishuQrSession {
  id: string;
  status: 'pending' | 'bound' | 'expired' | 'cancelled';
  authorizationUrl: string;
  expiresAt: string;
}
