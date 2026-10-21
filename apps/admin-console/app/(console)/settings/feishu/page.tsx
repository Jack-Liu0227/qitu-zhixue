'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import qrcode from 'qrcode-generator';
import { fetchAdminAssistantConfigs } from '../../../../lib/api/assistants';
import {
  deliverFeishuReport,
  fetchFeishuIntegration,
  fetchFeishuBridgeStatus,
  fetchFeishuQrStatus,
  startFeishuQrLogin,
  updateFeishuIntegration,
  type FeishuConnectionStatus,
  type FeishuIntegrationConfig,
  type FeishuQrStatusResponse,
} from '../../../../lib/api/feishu';
import { AdminStateViews } from '../../../../lib/components/AdminStateViews';
import { applyFeishuQrStatus, pollFeishuQrSession, shouldRefreshFeishuQr } from '../../../../lib/api/feishu-qr';
import { AdminOfflineError, AdminPermissionError, createIdempotentRetryKey } from '../../../../lib/api/types';
import type { AdminAssistantConfig, FeishuBridgeStatus } from '@qitu/contracts';
import './feishu.css';

const EMPTY: FeishuIntegrationConfig = {
  enabled: false,
  inboundEnabled: false,
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
  connected: 'Authorization configured',
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
  const selectedAssistantRef = useRef('feishu-reporting-assistant');
  const configurationRequestId = useRef(0);
  const [bridge, setBridge] = useState<FeishuBridgeStatus | null>(null);
  const [bridgeError, setBridgeError] = useState('');
  const saveRetry = useRef(createIdempotentRetryKey());
  const qrRetry = useRef(createIdempotentRetryKey());
  const deliverRetry = useRef(createIdempotentRetryKey());

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
    if (status.status === 'bound') {
      const requestId = configurationRequestId.current;
      void fetchFeishuIntegration(selectedAssistantRef.current).then((value) => {
        if (requestId === configurationRequestId.current) setConfig({ ...EMPTY, ...value });
      }).catch(() => { if (requestId === configurationRequestId.current) setQrError('授权已完成，配置回读失败。请刷新后确认绑定状态。'); });
    }
  }, [stopPolling]);

  const load = useCallback(async (assistantId = selectedAssistantRef.current) => {
    selectedAssistantRef.current = assistantId;
    const requestId = ++configurationRequestId.current;
    stopPolling();
    setConfig({ ...EMPTY, reportAssistantId: assistantId });
    setBridge(null);
    setBridgeError('');
    setNotice('');
    setQrError('');
    setQrLoading(false);
    setSaving(false);
    setDelivering(false);
    setLoading(true);
    setError(null);
    setAssistantError(null);
    await Promise.all([fetchFeishuIntegration(assistantId).then((value) => {
      if (requestId !== configurationRequestId.current) return;
      setConfig({ ...EMPTY, ...value });
      setRemainingSeconds(secondsUntil(value.expiresAt));
    }).catch((err) => { if (requestId === configurationRequestId.current) setError(err instanceof Error ? err : new Error('Failed to load Feishu settings')); }),
    fetchAdminAssistantConfigs().then((list) => {
      if (requestId !== configurationRequestId.current) return;
      setAssistants(list);
      if (!list.some((item) => item.id === assistantId)) setError(new Error('所选助手不存在，请从助手目录重新进入飞书绑定。'));
    }).catch((err) => {
      if (requestId !== configurationRequestId.current) return;
      setAssistants([]);
      setAssistantError(err instanceof Error ? err : new Error('Failed to load assistants'));
    })]);
    if (requestId === configurationRequestId.current) setLoading(false);
  }, [stopPolling]);

  useEffect(() => {
    const requested = new URLSearchParams(window.location.search).get('assistantId');
    void load(requested || selectedAssistantRef.current);
    const onOnline = () => setOnline(true);
    const onOffline = () => setOnline(false);
    setOnline(typeof navigator === 'undefined' || navigator.onLine);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      stopPolling();
      configurationRequestId.current += 1;
      if (timer.current) clearInterval(timer.current);
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, [load, stopPolling]);

  useEffect(() => {
    if (loading || !online || !config.reportAssistantId) return;
    const controller = new AbortController();
    let stopped = false;
    let next: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const value = await fetchFeishuBridgeStatus(config.reportAssistantId, controller.signal);
        if (!stopped) { setBridge(value); setBridgeError(''); }
      } catch (failure) {
        if (!stopped) { setBridge(null); setBridgeError(failure instanceof Error ? failure.message : '无法读取飞书连接状态'); }
      }
      if (!stopped) next = setTimeout(() => void poll(), 5_000);
    };
    void poll();
    return () => { stopped = true; controller.abort(); clearTimeout(next); };
  }, [loading, online, config.reportAssistantId]);

  useEffect(() => {
    if (timer.current) clearInterval(timer.current);
    if (config.status !== 'pending' || !config.expiresAt) return;
    timer.current = setInterval(() => {
      const seconds = secondsUntil(config.expiresAt);
      setRemainingSeconds(seconds);
      // The provider expiry is the source of truth. Keep the current QR visible
      // until it actually expires, then replace it with a fresh provider code.
      if (shouldRefreshFeishuQr(seconds)) {
        stopPolling();
        // Feishu device codes cannot be extended server-side. Immediately ask
        // for a fresh code so the QR stays available instead of disappearing
        // at the expiry boundary (the previous code remains only as a visual
        // placeholder until the replacement arrives).
        setConfig((current) => ({ ...current, status: 'error' }));
        setQrError('Refreshing authorization; generating a new QR code.');
        void restartQrRef.current?.();
      }
    }, 1000);
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [config.status, config.expiresAt, stopPolling]);

  const selected = useMemo(() => assistants.find((item) => item.id === config.reportAssistantId), [assistants, config.reportAssistantId]);
  const setField = <K extends keyof FeishuIntegrationConfig>(key: K, value: FeishuIntegrationConfig[K]) => {
    if (key === 'reportAssistantId' && typeof value === 'string') { void load(value); return; }
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
    const requestId = configurationRequestId.current;
    const signature = JSON.stringify({
      enabled: config.enabled, inboundEnabled: config.inboundEnabled, appId: config.appId, domain: config.domain, reportAssistantId: config.reportAssistantId,
      appSecret: secretFingerprint(config.appSecret), verificationToken: secretFingerprint(config.verificationToken), encryptKey: secretFingerprint(config.encryptKey),
    });
    const idempotencyKey = saveRetry.current.keyFor(signature);
    setSaving(true);
    setNotice('');
    try {
      const value = await updateFeishuIntegration({
        enabled: config.enabled, inboundEnabled: config.inboundEnabled, appId: config.appId, domain: config.domain, reportAssistantId: config.reportAssistantId,
        reportScope: config.reportScope, appSecret: config.appSecret, verificationToken: config.verificationToken, encryptKey: config.encryptKey,
      }, idempotencyKey);
      if (requestId !== configurationRequestId.current) return;
      saveRetry.current.acknowledge();
      setConfig((current) => ({ ...current, ...value, appSecret: '', verificationToken: '', encryptKey: '' }));
      setNotice('Configuration saved. Secrets remain server-side.');
    } catch (err) {
      if (requestId !== configurationRequestId.current) return;
      setNotice(err instanceof Error ? err.message : 'Save failed. Retry without changing the form.');
    } finally {
      if (requestId === configurationRequestId.current) setSaving(false);
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
      // Persist the selected region without clearing the existing App ID or recipients.
      await updateFeishuIntegration({ domain: config.domain, reportAssistantId: config.reportAssistantId }, `${idempotencyKey}-domain`);
      if (requestId !== qrRequestId.current) return;
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
    const requestId = configurationRequestId.current;
    if (!config.reportAssistantId) {
      setNotice('Select a reporting assistant before sending.');
      return;
    }
    setDelivering(true);
    setNotice('');
    try {
      const res = await deliverFeishuReport(config.reportAssistantId, deliverRetry.current.keyFor(config.reportAssistantId));
      if (requestId !== configurationRequestId.current) return;
      if (res.status === 'sent' || res.status === 'already_sent') {
        deliverRetry.current.acknowledge();
        setNotice(`Summary delivered to Feishu bot (${res.recipientCount} recipient(s) reached).`);
      } else if (res.status === 'retryable') {
        setNotice(`发送未完成，请再次点击发送以使用同一请求重试。${res.errorCode ? ` (${res.errorCode})` : ''}`);
      } else {
        setNotice(`发送失败，请检查机器人权限与收件人绑定。${res.errorCode ? ` (${res.errorCode})` : ''}`);
      }
    } catch (err) {
      if (requestId !== configurationRequestId.current) return;
      setNotice(err instanceof Error ? err.message : 'Failed to deliver report.');
    } finally {
      if (requestId === configurationRequestId.current) setDelivering(false);
    }
  };

  const qrExpired = config.status === 'error' && remainingSeconds === 0;
  return (
    <div className="feishu-settings-page">
      <div className="settings-pagehead"><div className="settings-titlebox"><span className="settings-eyebrow">FEISHU / LARK INTEGRATION</span><h1>Feishu manager bot</h1><div className="settings-desc">Bind a reporting assistant for manager summaries of students, parents and teachers.</div></div><div className="settings-page-actions"><button type="button" className="settings-action-btn" disabled={delivering || loading || !!error || saving || !online || !!assistantError || !selected?.enabled || !config.enabled || !config.credentialConfigured || config.reportAssistantId !== 'feishu-reporting-assistant'} onClick={() => void sendTestReport()}>{delivering ? 'Sending summary...' : 'Send issue summary to bot'}</button><Link href="/settings/assistants?action=create" className="settings-action-btn">New assistant</Link><button type="button" className="settings-action-btn is-primary" disabled={saving || loading || !!error || qrLoading || !online || !!assistantError || !selected?.enabled} onClick={() => void save()}>{saving ? 'Saving...' : 'Save settings'}</button></div></div>
      {!online && <div className="feishu-offline" role="status">You are offline. Settings are read-only until the connection returns.</div>}
      <AdminStateViews loading={loading} error={error} onRetry={() => void load()} />
      {!loading && !error && <><div className="feishu-notice" role="status">{notice || `${STATUS[config.status]}${config.credentialConfigured ? ' - server credentials configured' : ''}`}</div><section className="feishu-hero-card"><div><div className="feishu-kicker">MANAGER BRIEFING BOT</div><h2>{config.botName}</h2><p>Only permission-filtered summaries are sent. Raw minor conversations never leave the server.</p></div><span className={`feishu-status-pill is-${config.status}`}><span className="feishu-status-dot" />{STATUS[config.status]}</span></section><section className="feishu-card" aria-label="飞书消息连接状态">
          <h2>消息连接</h2>
          <p role="status">{bridgeError || (bridge ? ({ stopped: '长连接未启动', starting: '正在连接飞书', connected: '飞书长连接已连接', reconnecting: '正在重新连接飞书', error: '飞书连接失败' }[bridge.state]) : '正在读取长连接状态')}</p>
          {bridge?.errorCode && <p className="feishu-inline-error">{bridge.errorCode}</p>}
          {bridge?.lastReceivedAt && <p>最近接收：{new Date(bridge.lastReceivedAt).toLocaleString()}</p>}
          {bridge?.lastReplyAt && <p>最近回复：{new Date(bridge.lastReplyAt).toLocaleString()}</p>}
          <p className="feishu-inline-hint">{config.reportAssistantId === 'feishu-reporting-assistant' ? '保存并开启消息接收后，已绑定的管理员可私聊机器人发送“汇报”或“问题总结”。汇总只回复发起请求的管理员。' : '此助手可独立绑定机器人；业务消息处理尚未接入，私聊会返回功能提示。'}</p>
          <p className="feishu-inline-hint">飞书开放平台需启用机器人、发布应用，并用长连接订阅 im.message.receive_v1，开通接收单聊和以机器人发送消息权限。</p>
        </section><div className="feishu-grid"><section className="feishu-card"><div className="feishu-card-head"><h2>Application and assistant</h2><p>Secrets are accepted only by the backend and are never returned.</p></div><label className="feishu-field"><span>Enabled</span><input type="checkbox" checked={config.enabled} disabled={!online} onChange={(event) => setField('enabled', event.target.checked)} /></label><label className="feishu-field"><span>接收飞书私聊消息</span><input type="checkbox" checked={config.inboundEnabled} disabled={!online} onChange={(event) => setField('inboundEnabled', event.target.checked)} /></label><label className="feishu-field"><span>App ID</span><input value={config.appId} disabled={!online} onChange={(event) => setField('appId', event.target.value)} placeholder="cli_xxx" /></label><label className="feishu-field"><span>App secret <small>write-only</small></span><input type="password" value={config.appSecret ?? ''} disabled={!online} onChange={(event) => setField('appSecret', event.target.value)} autoComplete="new-password" /></label><label className="feishu-field"><span>Verification token <small>write-only</small></span><input type="password" value={config.verificationToken ?? ''} disabled={!online} onChange={(event) => setField('verificationToken', event.target.value)} autoComplete="new-password" /></label><label className="feishu-field"><span>Encrypt key <small>write-only</small></span><input type="password" value={config.encryptKey ?? ''} disabled={!online} onChange={(event) => setField('encryptKey', event.target.value)} autoComplete="new-password" /></label><label className="feishu-field"><span>Domain</span><select aria-label="Domain" value={config.domain} disabled={!online} onChange={(event) => setField('domain', event.target.value as 'feishu' | 'lark')}><option value="feishu">Feishu</option><option value="lark">Lark</option></select></label><label className="feishu-field"><span>Assistant / 独立机器人绑定</span><select aria-label="Assistant" value={config.reportAssistantId} disabled={!online || assistants.length === 0} onChange={(event) => setField('reportAssistantId', event.target.value)}><option value="">Select assistant</option>{assistants.map((assistant) => <option key={assistant.id} value={assistant.id}>{assistant.name}</option>)}</select></label>{assistantError instanceof AdminPermissionError && <div className="feishu-inline-error" role="alert">{assistantError.message}</div>}{assistantError instanceof AdminOfflineError && <div className="feishu-inline-error" role="alert">Assistant directory is unavailable while offline.</div>}{assistantError && !(assistantError instanceof AdminPermissionError) && !(assistantError instanceof AdminOfflineError) && <div className="feishu-inline-error" role="alert">Could not load the assistant directory. <button type="button" onClick={() => void load()}>Retry</button></div>}{!assistantError && assistants.length === 0 && <div className="feishu-empty">No assistants yet. <Link href="/settings/assistants?action=create">Create one</Link>.</div>}{selected && <div className="feishu-binding">Bound assistant: <strong>{selected.name}</strong></div>}<div className="feishu-field"><span>Report scope (server policy)</span><div className="feishu-scope-list">{SCOPES.map((scope) => <label key={scope}><input type="checkbox" disabled checked={config.reportScope.includes(scope)} onChange={(event) => setField('reportScope', event.target.checked ? [...new Set([...config.reportScope, scope])] : config.reportScope.filter((item) => item !== scope))} />{scope}</label>)}</div></div></section><section className="feishu-card feishu-qr-card"><div className="feishu-card-head"><h2>Phone QR binding</h2><p>Generate a one-time authorization URL and scan it in the Feishu mobile app.</p></div><div className="feishu-qr-content">{config.qrCodeDataUrl ? <img src={config.qrCodeDataUrl} alt="Feishu authorization QR code" className="feishu-qr-image" /> : <div className="feishu-qr-placeholder" aria-label="QR code not generated"><span>QR</span><small>Not generated</small></div>}<div className="feishu-qr-copy"><strong>{config.status === 'pending' ? 'Scan and confirm on your phone' : config.status === 'connected' ? 'Phone binding complete' : 'No token copy/paste required'}</strong>{config.status === 'pending' && <div className="feishu-countdown" role="timer">Expires in {formatCountdown(remainingSeconds)}</div>}{config.qrCodeUrl && <a href={config.qrCodeUrl} target="_blank" rel="noreferrer">Open authorization link</a>}<p>The server keeps credentials and records binding audit events.</p><div className="feishu-btn-row"><button type="button" className="settings-action-btn is-primary" disabled={qrLoading || saving || !online || !!assistantError || !selected?.enabled || config.status === 'pending'} onClick={() => void startQr()}>{qrLoading ? 'Generating...' : qrExpired ? 'Start a new authorization' : config.status === 'pending' ? 'Authorization pending' : 'Get QR authorization'}</button>{config.status === 'connected' && config.reportAssistantId === 'feishu-reporting-assistant' && <button type="button" className="settings-action-btn" disabled={delivering || !online} onClick={() => void sendTestReport()}>{delivering ? 'Sending...' : 'Test send summary to bot'}</button>}</div>{!config.reportAssistantId && <div className="feishu-inline-hint">Select an assistant first.</div>}{qrError && <div className="feishu-inline-error" role="alert">{qrError}</div>}</div></div></section></div></>}
    </div>
  );
}
