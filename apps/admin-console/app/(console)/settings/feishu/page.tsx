'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import qrcode from 'qrcode-generator';
import { fetchAdminAssistantConfigs } from '../../../../lib/api/assistants';
import {
  deliverFeishuReport,
  fetchFeishuIntegration,
  fetchFeishuQrStatus,
  startFeishuQrLogin,
  updateFeishuIntegration,
  type FeishuConnectionStatus,
  type FeishuIntegrationConfig,
  type FeishuQrStatusResponse,
} from '../../../../lib/api/feishu';
import { AdminStateViews } from '../../../../lib/components/AdminStateViews';
import { applyFeishuQrStatus, pollFeishuQrSession } from '../../../../lib/api/feishu-qr';
import { AdminOfflineError, AdminPermissionError, createIdempotentRetryKey } from '../../../../lib/api/types';
import type { AdminAssistantConfig } from '@qitu/contracts';
import './feishu.css';

const EMPTY: FeishuIntegrationConfig = {
  enabled: false,
  appId: '',
  domain: 'feishu',
  botName: 'Qitu Manager Briefing Bot',
  reportAssistantId: '',
  reportScope: ['student', 'parent', 'teacher'],
  status: 'disconnected',
  credentialConfigured: false,
};

const STATUS: Record<FeishuConnectionStatus, string> = {
  disconnected: 'Not connected',
  pending: 'Waiting for phone scan',
  connected: 'Connected',
  error: 'Connection error',
};
const SCOPES = ['student', 'parent', 'teacher'] as const;

function secondsUntil(expiresAt?: string): number | null {
  if (!expiresAt) return null;
  const value = Math.ceil((Date.parse(expiresAt) - Date.now()) / 1000);
  return Number.isFinite(value) ? Math.max(0, value) : null;
}

function formatCountdown(seconds: number | null): string {
  if (seconds === null) return '';
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

function encodeAuthorizationQr(url?: string): string | undefined {
  if (!url) return undefined;
  try {
    const code = qrcode(0, 'M');
    code.addData(url, 'Byte');
    code.make();
    return code.createDataURL(6, 2);
  } catch {
    return undefined;
  }
}

/** Stable, non-reversible fingerprint for idempotency signatures (never logs raw secrets). */
function secretFingerprint(value: string | undefined): string {
  if (!value) return '';
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `${value.length}:${(hash >>> 0).toString(16)}`;
}

export default function FeishuSettingsPage() {
  const [config, setConfig] = useState<FeishuIntegrationConfig>(EMPTY);
  const [assistants, setAssistants] = useState<AdminAssistantConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [assistantError, setAssistantError] = useState<Error | null>(null);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState('');
  const [delivering, setDelivering] = useState(false);
  const [qrLoading, setQrLoading] = useState(false);
  const [qrError, setQrError] = useState('');
  const [remainingSeconds, setRemainingSeconds] = useState<number | null>(null);
  const [online, setOnline] = useState(true);
  const cancelPolling = useRef<(() => void) | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const restartQrRef = useRef<(() => void) | null>(null);
  const activeSessionId = useRef<string | null>(null);
  const qrRequestId = useRef(0);
  const saveRetry = useRef(createIdempotentRetryKey());
  const qrRetry = useRef(createIdempotentRetryKey());

  const stopPolling = useCallback(() => {
    cancelPolling.current?.();
    cancelPolling.current = null;
    activeSessionId.current = null;
    qrRequestId.current += 1;
  }, []);

  const applyQrStatus = useCallback((status: FeishuQrStatusResponse) => {
    if (activeSessionId.current !== status.id) return;
    setConfig((current) => {
      const next = applyFeishuQrStatus(current, status);
      if (status.status === 'pending') next.qrCodeDataUrl ??= encodeAuthorizationQr(next.qrCodeUrl);
      return next;
    });
    setQrError(status.status === 'expired' ? 'This authorization session expired. Start a new session to try again.'
      : status.status === 'cancelled' ? 'Authorization was cancelled. Start a new session to try again.' : '');
    setRemainingSeconds(secondsUntil(status.expiresAt));
    if (status.status !== 'pending') stopPolling();
  }, [stopPolling]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setAssistantError(null);
    await fetchFeishuIntegration().then((value) => {
      setConfig({ ...EMPTY, ...value });
      setRemainingSeconds(secondsUntil(value.expiresAt));
    }).catch((err) => setError(err instanceof Error ? err : new Error('Failed to load Feishu settings')));
    await fetchAdminAssistantConfigs().then((list) => {
      setAssistants(list);
      setConfig((cur) => {
        if (cur.reportAssistantId) return cur;
        const preferred = list.find((a) => a.id === 'feishu-reporting-assistant') ?? list[0];
        return preferred ? { ...cur, reportAssistantId: preferred.id } : cur;
      });
    }).catch((err) => {
      setAssistants([]);
      setAssistantError(err instanceof Error ? err : new Error('Failed to load assistants'));
    });
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
    const onOnline = () => setOnline(true);
    const onOffline = () => setOnline(false);
    setOnline(typeof navigator === 'undefined' || navigator.onLine);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      stopPolling();
      if (timer.current) clearInterval(timer.current);
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, [load, stopPolling]);

  useEffect(() => {
    if (timer.current) clearInterval(timer.current);
    if (config.status !== 'pending' || !config.expiresAt) return;
    timer.current = setInterval(() => {
      const seconds = secondsUntil(config.expiresAt);
      setRemainingSeconds(seconds);
      if (seconds === 0) {
        stopPolling();
        // Feishu device codes cannot be extended server-side. Immediately ask
        // for a fresh code so the QR stays available instead of disappearing
        // at the expiry boundary (the previous code remains only as a visual
        // placeholder until the replacement arrives).
        setConfig((current) => ({ ...current, status: 'error' }));
        setQrError('Refreshing the authorization code…');
        void restartQrRef.current?.();
      }
    }, 1000);
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [config.status, config.expiresAt, stopPolling]);

  const selected = useMemo(() => assistants.find((item) => item.id === config.reportAssistantId), [assistants, config.reportAssistantId]);
  const setField = <K extends keyof FeishuIntegrationConfig>(key: K, value: FeishuIntegrationConfig[K]) => {
    if (key === 'reportAssistantId' || key === 'domain') {
      setRemainingSeconds(null);
      stopPolling();
      setQrLoading(false);
      setQrError('');
    }
    setConfig((current) => {
      const next = { ...current, [key]: value };
      // A QR session is scoped to both the assistant and the Feishu/Lark domain.
      // Never display a session created for the previous selection.
      if (key === 'reportAssistantId' || key === 'domain') {
        next.status = 'disconnected';
        next.credentialConfigured = false;
        next.qrSessionId = undefined;
        next.qrCodeUrl = undefined;
        next.qrCodeDataUrl = undefined;
        next.expiresAt = undefined;
      }
      return next;
    });
    setNotice('');
  };

  const save = async () => {
    const signature = JSON.stringify({
      enabled: config.enabled, appId: config.appId, domain: config.domain, reportAssistantId: config.reportAssistantId,
      appSecret: secretFingerprint(config.appSecret), verificationToken: secretFingerprint(config.verificationToken), encryptKey: secretFingerprint(config.encryptKey),
    });
    const idempotencyKey = saveRetry.current.keyFor(signature);
    setSaving(true);
    setNotice('');
    try {
      const value = await updateFeishuIntegration({
        enabled: config.enabled, appId: config.appId, domain: config.domain, reportAssistantId: config.reportAssistantId,
        reportScope: config.reportScope, appSecret: config.appSecret, verificationToken: config.verificationToken, encryptKey: config.encryptKey,
      }, idempotencyKey);
      saveRetry.current.acknowledge();
      setConfig((current) => ({ ...current, ...value, appSecret: '', verificationToken: '', encryptKey: '' }));
      setNotice('Configuration saved. Secrets remain server-side.');
    } catch (err) {
      setNotice(err instanceof Error ? err.message : 'Save failed. Retry without changing the form.');
    } finally {
      setSaving(false);
    }
  };

  const startQr = async () => {
    if (!config.reportAssistantId) {
      setQrError('Select a reporting assistant before starting authorization.');
      return;
    }
    if (config.status === 'pending' && secondsUntil(config.expiresAt) !== 0) {
      setQrError('An authorization session is already pending for this assistant.');
      return;
    }
    const idempotencyKey = qrRetry.current.keyFor(`${config.domain}:${config.reportAssistantId}`);
    setQrLoading(true);
    setQrError('');
    stopPolling();
    const requestId = qrRequestId.current;
    try {
      const qr = await startFeishuQrLogin(config.reportAssistantId, idempotencyKey);
      if (requestId !== qrRequestId.current) return;
      qrRetry.current.acknowledge();
      setConfig((current) => ({ ...current, status: 'pending', qrSessionId: qr.sessionId, qrCodeUrl: qr.authorizationUrl, qrCodeDataUrl: qr.qrCodeDataUrl ?? encodeAuthorizationQr(qr.authorizationUrl), expiresAt: qr.expiresAt }));
      setRemainingSeconds(secondsUntil(qr.expiresAt));
      activeSessionId.current = qr.sessionId;
      cancelPolling.current = pollFeishuQrSession({
        sessionId: qr.sessionId,
        pollIntervalSeconds: qr.pollIntervalSeconds,
        poll: fetchFeishuQrStatus,
        onStatus: applyQrStatus,
        onError: (err) => {
          if (err instanceof AdminOfflineError) setQrError('Network unavailable. Polling will resume automatically.');
          else if (err instanceof AdminPermissionError) { setQrError(err.message); stopPolling(); return false; }
          else setQrError('Could not check authorization status. Retrying automatically; you can still scan the QR code.');
          return true;
        },
      });
    } catch (err) {
      if (requestId !== qrRequestId.current) return;
      setQrError(err instanceof Error ? err.message : 'QR session failed. Retry without changing the form.');
    } finally {
      if (requestId === qrRequestId.current) setQrLoading(false);
    }
  };
  restartQrRef.current = startQr;

  const sendTestReport = async () => {
    if (!config.reportAssistantId) {
      setNotice('Select a reporting assistant before sending.');
      return;
    }
    setDelivering(true);
    setNotice('');
    try {
      const res = await deliverFeishuReport(config.reportAssistantId);
      if (res.status === 'sent' || res.status === 'already_sent') {
        setNotice(`Summary delivered to Feishu bot (${res.recipientCount} recipient(s) reached).`);
      } else if (res.status === 'retryable') {
        setNotice('Report delivery queued for background retry.');
      } else {
        setNotice('Delivery failed. Verify the bot is enabled and has scanned recipients.');
      }
    } catch (err) {
      setNotice(err instanceof Error ? err.message : 'Failed to deliver report.');
    } finally {
      setDelivering(false);
    }
  };

  const qrExpired = config.status === 'error' && remainingSeconds === 0;
  return (
    <div className="feishu-settings-page">
      <div className="settings-pagehead"><div className="settings-titlebox"><span className="settings-eyebrow">FEISHU / LARK INTEGRATION</span><h1>Feishu manager bot</h1><div className="settings-desc">Bind a reporting assistant for manager summaries of students, parents and teachers.</div></div><div className="settings-page-actions"><button type="button" className="settings-action-btn" disabled={delivering || loading || !online || !config.reportAssistantId} onClick={() => void sendTestReport()}>{delivering ? 'Sending summary...' : 'Send issue summary to bot'}</button><Link href="/settings/assistants?action=create" className="settings-action-btn">New assistant</Link><button type="button" className="settings-action-btn is-primary" disabled={saving || loading || !online} onClick={() => void save()}>{saving ? 'Saving...' : 'Save settings'}</button></div></div>
      {!online && <div className="feishu-offline" role="status">You are offline. Settings are read-only until the connection returns.</div>}
      <AdminStateViews loading={loading} error={error} onRetry={() => void load()} />
      {!loading && !error && <><div className="feishu-notice" role="status">{notice || `${STATUS[config.status]}${config.credentialConfigured ? ' - server credentials configured' : ''}`}</div><section className="feishu-hero-card"><div><div className="feishu-kicker">MANAGER BRIEFING BOT</div><h2>{config.botName}</h2><p>Only permission-filtered summaries are sent. Raw minor conversations never leave the server.</p></div><span className={`feishu-status-pill is-${config.status}`}><span className="feishu-status-dot" />{STATUS[config.status]}</span></section><div className="feishu-grid"><section className="feishu-card"><div className="feishu-card-head"><h2>Application and assistant</h2><p>Secrets are accepted only by the backend and are never returned.</p></div><label className="feishu-field"><span>Enabled</span><input type="checkbox" checked={config.enabled} disabled={!online} onChange={(event) => setField('enabled', event.target.checked)} /></label><label className="feishu-field"><span>App ID</span><input value={config.appId} disabled={!online} onChange={(event) => setField('appId', event.target.value)} placeholder="cli_xxx" /></label><label className="feishu-field"><span>App secret <small>write-only</small></span><input type="password" value={config.appSecret ?? ''} disabled={!online} onChange={(event) => setField('appSecret', event.target.value)} autoComplete="new-password" /></label><label className="feishu-field"><span>Verification token <small>write-only</small></span><input type="password" value={config.verificationToken ?? ''} disabled={!online} onChange={(event) => setField('verificationToken', event.target.value)} autoComplete="new-password" /></label><label className="feishu-field"><span>Encrypt key <small>write-only</small></span><input type="password" value={config.encryptKey ?? ''} disabled={!online} onChange={(event) => setField('encryptKey', event.target.value)} autoComplete="new-password" /></label><label className="feishu-field"><span>Domain</span><select value={config.domain} disabled={!online} onChange={(event) => setField('domain', event.target.value as 'feishu' | 'lark')}><option value="feishu">Feishu</option><option value="lark">Lark</option></select></label><label className="feishu-field"><span>Reporting assistant</span><select value={config.reportAssistantId} disabled={!online || assistants.length === 0} onChange={(event) => setField('reportAssistantId', event.target.value)}><option value="">Select assistant</option>{assistants.map((assistant) => <option key={assistant.id} value={assistant.id}>{assistant.name}</option>)}</select></label>{assistantError instanceof AdminPermissionError && <div className="feishu-inline-error" role="alert">{assistantError.message}</div>}{assistantError instanceof AdminOfflineError && <div className="feishu-inline-error" role="alert">Assistant directory is unavailable while offline.</div>}{assistantError && !(assistantError instanceof AdminPermissionError) && !(assistantError instanceof AdminOfflineError) && <div className="feishu-inline-error" role="alert">Could not load the assistant directory. <button type="button" onClick={() => void load()}>Retry</button></div>}{!assistantError && assistants.length === 0 && <div className="feishu-empty">No assistants yet. <Link href="/settings/assistants?action=create">Create one</Link>.</div>}{selected && <div className="feishu-binding">Bound assistant: <strong>{selected.name}</strong></div>}<div className="feishu-field"><span>Report scope</span><div className="feishu-scope-list">{SCOPES.map((scope) => <label key={scope}><input type="checkbox" disabled={!online} checked={config.reportScope.includes(scope)} onChange={(event) => setField('reportScope', event.target.checked ? [...new Set([...config.reportScope, scope])] : config.reportScope.filter((item) => item !== scope))} />{scope}</label>)}</div></div></section><section className="feishu-card feishu-qr-card"><div className="feishu-card-head"><h2>Phone QR binding</h2><p>Generate a one-time authorization URL and scan it in the Feishu mobile app.</p></div><div className="feishu-qr-content">{config.qrCodeDataUrl ? <img src={config.qrCodeDataUrl} alt="Feishu authorization QR code" className="feishu-qr-image" /> : <div className="feishu-qr-placeholder" aria-label="QR code not generated"><span>QR</span><small>Not generated</small></div>}<div className="feishu-qr-copy"><strong>{config.status === 'pending' ? 'Scan and confirm on your phone' : config.status === 'connected' ? 'Phone binding complete' : 'No token copy/paste required'}</strong>{config.status === 'pending' && <div className="feishu-countdown" role="timer">Expires in {formatCountdown(remainingSeconds)}</div>}{config.qrCodeUrl && <a href={config.qrCodeUrl} target="_blank" rel="noreferrer">Open authorization link</a>}<p>The server keeps credentials and records binding audit events.</p><div className="feishu-btn-row"><button type="button" className="settings-action-btn is-primary" disabled={qrLoading || !online || !config.reportAssistantId || config.status === 'pending'} onClick={() => void startQr()}>{qrLoading ? 'Generating...' : qrExpired ? 'Start a new authorization' : config.status === 'pending' ? 'Authorization pending' : 'Get QR authorization'}</button>{config.status === 'connected' && <button type="button" className="settings-action-btn" disabled={delivering || !online} onClick={() => void sendTestReport()}>{delivering ? 'Sending...' : 'Test send summary to bot'}</button>}</div>{!config.reportAssistantId && <div className="feishu-inline-hint">Select an assistant first.</div>}{qrError && <div className="feishu-inline-error" role="alert">{qrError}</div>}</div></div></section></div></>}
    </div>
  );
}
