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
  botName: '飞书汇报助手',
  reportAssistantId: '',
  reportScope: ['student', 'parent', 'teacher'],
  status: 'disconnected',
  credentialConfigured: false,
};

const STATUS: Record<FeishuConnectionStatus, string> = {
  disconnected: '未连接',
  pending: '等待手机确认授权...',
  connected: '手机已完成授权绑定',
  error: '连接异常',
};

function secondsUntil(expiresAt?: string): number | null {
  if (!expiresAt) return null;
  const value = Math.ceil((Date.parse(expiresAt) - Date.now()) / 1000);
  return Number.isFinite(value) ? Math.max(0, value) : null;
}

function formatCountdown(seconds: number | null): string {
  if (seconds === null) return '';
  const mins = Math.floor(seconds / 60);
  const secs = String(seconds % 60).padStart(2, '0');
  return `${mins}分${secs}秒`;
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

/** 幂等性稳定指纹计算（不泄露真实明文秘钥） */
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

  // 扩展与表单字段
  const [oauthScopes, setOauthScopes] = useState('contact:user.base:readonly offline_access');
  const [recipientId, setRecipientId] = useState('');
  const [recipientType, setRecipientType] = useState<'open_id' | 'chat_id' | 'user_id' | 'email'>('open_id');
  const [selectedProject, setSelectedProject] = useState('');
  const [allowedSenderOpenId, setAllowedSenderOpenId] = useState('');
  const [customWebhookUrl, setCustomWebhookUrl] = useState('');
  const [customWebhookSecret, setCustomWebhookSecret] = useState('');
  const [accordionOpen, setAccordionOpen] = useState(false);

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
    setQrError(status.status === 'expired' ? '当前授权会话已过期，请重新生成二维码。'
      : status.status === 'cancelled' ? '授权已取消，请重新生成会话。' : '');
    setRemainingSeconds(secondsUntil(status.expiresAt));
    if (status.status !== 'pending') stopPolling();
    if (status.status === 'bound') {
      const requestId = configurationRequestId.current;
      void fetchFeishuIntegration(selectedAssistantRef.current).then((value) => {
        if (requestId === configurationRequestId.current) {
          setConfig({ ...EMPTY, ...value });
          if (value.reportRecipients?.[0]) setRecipientId(value.reportRecipients[0]);
        }
      }).catch(() => {
        if (requestId === configurationRequestId.current) setQrError('授权已完成，配置回读失败。请刷新后确认绑定状态。');
      });
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
    await Promise.all([
      fetchFeishuIntegration(assistantId).then((value) => {
        if (requestId !== configurationRequestId.current) return;
        setConfig({ ...EMPTY, ...value });
        setRemainingSeconds(secondsUntil(value.expiresAt));
        if (value.reportRecipients?.[0]) setRecipientId(value.reportRecipients[0]);
      }).catch((err) => {
        if (requestId === configurationRequestId.current) setError(err instanceof Error ? err : new Error('加载飞书设置失败'));
      }),
      fetchAdminAssistantConfigs().then((list) => {
        if (requestId !== configurationRequestId.current) return;
        setAssistants(list);
        if (!list.some((item) => item.id === assistantId)) setError(new Error('所选助手不存在，请从助手目录重新进入飞书绑定。'));
      }).catch((err) => {
        if (requestId !== configurationRequestId.current) return;
        setAssistants([]);
        setAssistantError(err instanceof Error ? err : new Error('加载助手目录失败'));
      }),
    ]);
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
      if (shouldRefreshFeishuQr(seconds)) {
        stopPolling();
        setConfig((current) => ({ ...current, status: 'error' }));
        setQrError('二维码已过期，正在自动刷新生成新的二维码...');
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
      setNotice('配置已保存，密钥由服务端安全保管。');
    } catch (err) {
      if (requestId !== configurationRequestId.current) return;
      setNotice(err instanceof Error ? err.message : '保存失败，请稍后重试。');
    } finally {
      if (requestId === configurationRequestId.current) setSaving(false);
    }
  };

  const startQr = async () => {
    if (!config.reportAssistantId) {
      setQrError('开始授权前请先选择配置助手。');
      return;
    }
    const idempotencyKey = qrRetry.current.keyFor(`${config.domain}:${config.reportAssistantId}`);
    setQrLoading(true);
    setQrError('');
    stopPolling();
    const requestId = qrRequestId.current;
    try {
      await updateFeishuIntegration({ domain: config.domain, reportAssistantId: config.reportAssistantId }, `${idempotencyKey}-domain`);
      if (requestId !== qrRequestId.current) return;
      const qr = await startFeishuQrLogin(config.reportAssistantId, idempotencyKey);
      if (requestId !== qrRequestId.current) return;
      qrRetry.current.acknowledge();
      setConfig((current) => ({
        ...current,
        status: 'pending',
        qrSessionId: qr.sessionId,
        qrCodeUrl: qr.authorizationUrl,
        qrCodeDataUrl: qr.qrCodeDataUrl ?? encodeAuthorizationQr(qr.authorizationUrl),
        expiresAt: qr.expiresAt,
      }));
      setRemainingSeconds(secondsUntil(qr.expiresAt));
      activeSessionId.current = qr.sessionId;
      cancelPolling.current = pollFeishuQrSession({
        sessionId: qr.sessionId,
        pollIntervalSeconds: qr.pollIntervalSeconds,
        poll: fetchFeishuQrStatus,
        onStatus: applyQrStatus,
        onError: (err) => {
          if (err instanceof AdminOfflineError) setQrError('网络离线，连接恢复后将自动继续轮询。');
          else if (err instanceof AdminPermissionError) { setQrError(err.message); stopPolling(); return false; }
          else setQrError('无法检查授权状态，正在自动重试；您仍可继续扫码。');
          return true;
        },
      });
    } catch (err) {
      if (requestId !== qrRequestId.current) return;
      setQrError(err instanceof Error ? err.message : '创建二维码授权会话失败，请重试。');
    } finally {
      if (requestId === qrRequestId.current) setQrLoading(false);
    }
  };
  restartQrRef.current = startQr;

  const cancelSession = () => {
    stopPolling();
    setRemainingSeconds(null);
    setQrLoading(false);
    setQrError('');
    setConfig((current) => ({
      ...current,
      status: 'disconnected',
      qrSessionId: undefined,
      qrCodeUrl: undefined,
      qrCodeDataUrl: undefined,
      expiresAt: undefined,
    }));
    setNotice('已取消当前扫码授权会话。');
  };

  const openOfficialAuth = () => {
    if (config.qrCodeUrl) {
      window.open(config.qrCodeUrl, '_blank', 'noopener,noreferrer');
    } else {
      setNotice('当前未生成授权链接，请先点击“生成扫码授权”或“重新生成二维码”。');
    }
  };

  const refreshStatus = async () => {
    if (!config.reportAssistantId) return;
    setNotice('正在刷新授权与长连接状态...');
    try {
      const [integration, bridgeStatus] = await Promise.all([
        fetchFeishuIntegration(config.reportAssistantId),
        fetchFeishuBridgeStatus(config.reportAssistantId).catch(() => null),
      ]);
      setConfig((curr) => ({ ...curr, ...integration }));
      setRemainingSeconds(secondsUntil(integration.expiresAt));
      if (bridgeStatus) setBridge(bridgeStatus);
      setNotice('授权与连接状态已更新。');
    } catch (err) {
      setNotice(err instanceof Error ? err.message : '刷新授权状态失败');
    }
  };

  const testBridgeConnection = async () => {
    if (!config.reportAssistantId) return;
    setNotice('正在测试长连接...');
    try {
      const status = await fetchFeishuBridgeStatus(config.reportAssistantId);
      setBridge(status);
      setNotice(`长连接状态：${status.state === 'connected' ? '运行中 (running)' : status.state}`);
    } catch (err) {
      setNotice(err instanceof Error ? err.message : '长连接测试失败');
    }
  };

  const sendTestReport = async () => {
    const requestId = configurationRequestId.current;
    if (!config.reportAssistantId) {
      setNotice('发送前请先选择配置助手。');
      return;
    }
    setDelivering(true);
    setNotice('');
    try {
      const res = await deliverFeishuReport(config.reportAssistantId, deliverRetry.current.keyFor(config.reportAssistantId));
      if (requestId !== configurationRequestId.current) return;
      if (res.status === 'sent' || res.status === 'already_sent') {
        deliverRetry.current.acknowledge();
        setNotice(`消息已成功推送到飞书机器人（触达 ${res.recipientCount} 位收件人）。`);
      } else if (res.status === 'retryable') {
        setNotice(`发送未完成，请再次点击发送以使用同一请求重试。${res.errorCode ? ` (${res.errorCode})` : ''}`);
      } else {
        setNotice(`发送失败，请检查机器人权限与收件人绑定。${res.errorCode ? ` (${res.errorCode})` : ''}`);
      }
    } catch (err) {
      if (requestId !== configurationRequestId.current) return;
      setNotice(err instanceof Error ? err.message : '发送测试报告失败。');
    } finally {
      if (requestId === configurationRequestId.current) setDelivering(false);
    }
  };

  const callbackUrl = typeof window !== 'undefined'
    ? `${window.location.origin}${config.qrBinding?.callbackPath || '/api/v1/integrations/feishu/oauth/callback'}`
    : 'http://127.0.0.1:8765/api/feishu/callback';

  const bridgeStateLabel = bridge ? ({
    stopped: '未启动',
    starting: '连接中',
    connected: 'running',
    reconnecting: '重连中',
    error: '连接异常',
  }[bridge.state]) : (bridgeError ? '连接异常' : '未连接');

  const bridgeDotClass = bridge?.state === 'connected' ? 'is-ok' : bridge?.state === 'starting' ? 'is-warn' : 'is-err';
  const qrDotClass = config.status === 'connected' ? 'is-ok' : config.status === 'pending' ? 'is-warn' : '';

  return (
    <div className="feishu-settings-page">
      {/* 1. 顶部页头与动作区 */}
      <div className="feishu-top-header">
        <span className="feishu-eyebrow">ASSISTANT CONNECTION</span>
        <div className="feishu-title-row">
          <div>
            <h1>飞书机器人</h1>
            <p className="feishu-header-desc">
              每个助手独立配置。可使用企业自建应用机器人，也可使用自定义机器人 Webhook。扫码绑定由飞书官方授权页完成，不会自动创建、发布或授予应用权限。
            </p>
          </div>
        </div>
      </div>

      {/* 2. 助手选择器与官方直达链接 */}
      <div className="feishu-assistant-bar">
        <div className="feishu-assistant-selector">
          <label htmlFor="feishu-assistant-select">配置哪个助手</label>
          <select
            id="feishu-assistant-select"
            className="feishu-assistant-select"
            value={config.reportAssistantId}
            disabled={!online || assistants.length === 0}
            onChange={(event) => setField('reportAssistantId', event.target.value)}
          >
            <option value="">请选择助手</option>
            {assistants.map((assistant) => (
              <option key={assistant.id} value={assistant.id}>
                {assistant.name}
              </option>
            ))}
          </select>
          {selected && <span style={{ fontSize: '13px', color: '#166534', fontWeight: 600 }}>当前已选：{selected.name}</span>}
        </div>

        <div className="feishu-quick-links">
          <a href="https://open.feishu.cn/app" target="_blank" rel="noreferrer">
            创建 / 管理飞书应用 ↗
          </a>
          <a href="https://open.feishu.cn/document/common-capabilities/sso/api/obtain-oauth-code" target="_blank" rel="noreferrer">
            官方 OAuth 授权说明 ↗
          </a>
          <a href="https://open.feishu.cn/document/server-docs/im-v1/message/create" target="_blank" rel="noreferrer">
            机器人消息权限 ↗
          </a>
          <a href="https://open.feishu.cn/document/client-docs/bot-v3/add-custom-bot" target="_blank" rel="noreferrer">
            自定义机器人说明 ↗
          </a>
        </div>
      </div>

      {/* 3. 运行状态摘要条 */}
      <div className="feishu-status-strip">
        <div className="feishu-status-items">
          <span className="feishu-status-item">
            <span className={`feishu-dot ${qrDotClass}`} />
            扫码授权：{config.status === 'connected' ? '已绑定' : config.status === 'pending' ? '等待确认' : '未完成'}
          </span>
          <span>·</span>
          <span className="feishu-status-item">
            <span className={`feishu-dot ${customWebhookUrl ? 'is-ok' : ''}`} />
            Webhook：{customWebhookUrl ? '已配置' : '未配置'}
          </span>
          <span>·</span>
          <span className="feishu-status-item">
            <span className={`feishu-dot ${bridgeDotClass}`} />
            接收连线：{bridgeStateLabel}
          </span>
        </div>
        <p>应用机器人需启用、发布，并授予发送消息与接收消息权限；接收事件使用飞书长连接。</p>
      </div>

      {!online && (
        <div className="feishu-offline-banner" role="status">
          当前处于离线状态。网络恢复前配置为只读模式。
        </div>
      )}

      {notice && (
        <div className="feishu-notice-banner" role="status">
          {notice}
        </div>
      )}

      <AdminStateViews loading={loading} error={error} onRetry={() => void load()} />

      {!loading && !error && (
        <>
          {/* 4. 手机扫码绑定助手核心卡片 */}
          <section className="feishu-card" aria-label="手机扫码绑定助手">
            <div className="feishu-card-header">
              <div className="feishu-card-header-main">
                <h2>手机扫码绑定助手</h2>
                <p>
                  使用飞书/Lark 官方 Device Authorization：选择区域后生成一次性二维码，用于手机飞书扫码确认，即可把该账号绑定到当前助手。授权会话仅保存于本机服务器。
                </p>
              </div>
              <div className="feishu-card-actions">
                <button
                  type="button"
                  className="feishu-btn"
                  disabled={qrLoading || saving || !online || !selected?.enabled}
                  onClick={() => void startQr()}
                >
                  {qrLoading ? '正在生成...' : '重新生成二维码'}
                </button>
                <button
                  type="button"
                  className="feishu-btn"
                  disabled={config.status !== 'pending'}
                  onClick={cancelSession}
                >
                  取消会话
                </button>
              </div>
            </div>

            <div style={{ maxWidth: '300px' }}>
              <label className="feishu-form-field">
                <span>区域</span>
                <select
                  aria-label="区域"
                  value={config.domain}
                  disabled={!online}
                  onChange={(event) => setField('domain', event.target.value as 'feishu' | 'lark')}
                >
                  <option value="feishu">飞书（中国大陆）</option>
                  <option value="lark">Lark（海外）</option>
                </select>
              </label>
            </div>

            <div className="feishu-qr-panel">
              <div className="feishu-qr-box">
                {config.qrCodeDataUrl ? (
                  <img src={config.qrCodeDataUrl} alt="飞书扫码授权二维码" className="feishu-qr-img" />
                ) : (
                  <div className="feishu-qr-placeholder">
                    <span className="feishu-qr-placeholder-icon">▦</span>
                    <span>未生成二维码</span>
                  </div>
                )}
              </div>

              <div className="feishu-qr-info">
                <div className="feishu-qr-status-text">
                  {config.status === 'pending'
                    ? '等待手机确认授权...'
                    : config.status === 'connected'
                    ? '手机已完成授权绑定'
                    : config.status === 'error'
                    ? '二维码已失效，请重新生成'
                    : '未生成二维码'}
                </div>

                {config.status === 'pending' && remainingSeconds !== null && (
                  <div className="feishu-qr-countdown">
                    ⏱ 二维码剩余有效期：{formatCountdown(remainingSeconds)}
                  </div>
                )}

                <p className="feishu-qr-hint">
                  如果飞书客户端不支持显示二维码，可点击上方官方链接，在手机浏览器或飞书内完成确认。
                </p>

                {config.qrCodeUrl && (
                  <a
                    href={config.qrCodeUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="feishu-qr-direct-link"
                  >
                    在浏览器打开官方授权页 ↗
                  </a>
                )}

                {qrError && <div className="feishu-inline-error">{qrError}</div>}
              </div>
            </div>
          </section>

          {/* 5. 凭证与连接参数网格（双列排版） */}
          <section className="feishu-card" aria-label="应用与连接参数">
            <div className="feishu-card-header-main">
              <h2>自建应用凭据与路由参数</h2>
              <p>应用秘钥由服务端密文保存，绝不返回前端页面。</p>
            </div>

            <div className="feishu-form-grid">
              {/* Row 1 */}
              <label className="feishu-form-field">
                <span>App ID</span>
                <input
                  value={config.appId}
                  disabled={!online}
                  onChange={(event) => setField('appId', event.target.value)}
                  placeholder="cli_..."
                />
              </label>

              <label className="feishu-form-field">
                <span>
                  App Secret <small>仅写入</small>
                </span>
                <input
                  type="password"
                  value={config.appSecret ?? ''}
                  disabled={!online}
                  onChange={(event) => setField('appSecret', event.target.value)}
                  placeholder="留空保持不变（仅写入）"
                  autoComplete="new-password"
                />
              </label>

              {/* Row 2 */}
              <label className="feishu-form-field">
                <span>OAuth 回调地址（必须登记到飞书安全设置）</span>
                <input
                  type="text"
                  readOnly
                  value={callbackUrl}
                  title="请将此地址复制到飞书开放平台安全设置的重定向 URL 列表中"
                />
              </label>

              <label className="feishu-form-field">
                <span>OAuth Scopes（空格分隔，需应用获批）</span>
                <input
                  type="text"
                  value={oauthScopes}
                  disabled={!online}
                  onChange={(event) => setOauthScopes(event.target.value)}
                  placeholder="contact:user.base:readonly offline_access"
                />
              </label>

              {/* Row 3 */}
              <label className="feishu-form-field">
                <span>默认收件人 / 群聊 ID（扫码后可自动绑定 open_id）</span>
                <input
                  type="text"
                  value={recipientId}
                  disabled={!online}
                  onChange={(event) => setRecipientId(event.target.value)}
                  placeholder="open_id 或 oc_ 开头的群聊 ID"
                />
              </label>

              <label className="feishu-form-field">
                <span>收件人类型</span>
                <select
                  value={recipientType}
                  disabled={!online}
                  onChange={(event) => setRecipientType(event.target.value as typeof recipientType)}
                >
                  <option value="open_id">open_id</option>
                  <option value="chat_id">chat_id</option>
                  <option value="user_id">user_id</option>
                  <option value="email">email</option>
                </select>
              </label>

              {/* Row 4 */}
              <label className="feishu-form-field">
                <span>接收任务的项目</span>
                <select
                  value={selectedProject}
                  disabled={!online}
                  onChange={(event) => setSelectedProject(event.target.value)}
                >
                  <option value="">请选择项目</option>
                  <option value="default">通用项目（默认全部项目）</option>
                  <option value="optics-physical-inquiry">光学科研探究项目</option>
                </select>
              </label>

              <label className="feishu-form-field">
                <span>允许发送任务的用户 open_id</span>
                <input
                  type="text"
                  value={allowedSenderOpenId}
                  disabled={!online}
                  onChange={(event) => setAllowedSenderOpenId(event.target.value)}
                  placeholder="留空时使用扫码绑定的 open_id"
                />
              </label>
            </div>

            {/* 任务接收复选框 */}
            <div style={{ marginTop: '8px' }}>
              <label className="feishu-checkbox-row">
                <input
                  type="checkbox"
                  checked={config.inboundEnabled}
                  disabled={!online}
                  onChange={(event) => setField('inboundEnabled', event.target.checked)}
                />
                <span>接收飞书消息并交由启途专家执行项目任务</span>
              </label>
            </div>

            {/* 可选：自定义机器人折叠面板 */}
            <div className="feishu-accordion">
              <div
                className="feishu-accordion-header"
                onClick={() => setAccordionOpen((prev) => !prev)}
                role="button"
                tabIndex={0}
              >
                <span>{accordionOpen ? '▼' : '▶'} 可选：自定义机器人（不需要扫码；配置后优先使用）</span>
                <small style={{ color: '#64748b' }}>{accordionOpen ? '点击收起' : '点击展开配置'}</small>
              </div>

              {accordionOpen && (
                <div className="feishu-accordion-body">
                  <div className="feishu-form-grid">
                    <label className="feishu-form-field">
                      <span>Webhook 地址</span>
                      <input
                        type="text"
                        value={customWebhookUrl}
                        disabled={!online}
                        onChange={(event) => setCustomWebhookUrl(event.target.value)}
                        placeholder="https://open.feishu.cn/open-apis/bot/v2/hook/..."
                      />
                    </label>

                    <label className="feishu-form-field">
                      <span>签名密钥（Secret，选填）</span>
                      <input
                        type="password"
                        value={customWebhookSecret}
                        disabled={!online}
                        onChange={(event) => setCustomWebhookSecret(event.target.value)}
                        placeholder="自定义机器人安全设置中的签名密钥"
                        autoComplete="new-password"
                      />
                    </label>

                    <label className="feishu-form-field">
                      <span>事件订阅校验 Token <small>仅写入</small></span>
                      <input
                        type="password"
                        value={config.verificationToken ?? ''}
                        disabled={!online}
                        onChange={(event) => setField('verificationToken', event.target.value)}
                        placeholder="留空保持不变"
                        autoComplete="new-password"
                      />
                    </label>

                    <label className="feishu-form-field">
                      <span>消息加解密 Key <small>仅写入</small></span>
                      <input
                        type="password"
                        value={config.encryptKey ?? ''}
                        disabled={!online}
                        onChange={(event) => setField('encryptKey', event.target.value)}
                        placeholder="留空保持不变"
                        autoComplete="new-password"
                      />
                    </label>
                  </div>
                  <p className="feishu-qr-hint">
                    自定义机器人仅支持向群聊单向推送消息；如需私聊对话或专家任务交互，请使用上方的自建应用机器人。
                  </p>
                </div>
              )}
            </div>
          </section>

          {/* 6. 底部操作栏 */}
          <div className="feishu-bottom-bar">
            <div className="feishu-bottom-left">
              <label className="feishu-checkbox-row">
                <input
                  type="checkbox"
                  checked={config.enabled}
                  disabled={!online}
                  onChange={(event) => setField('enabled', event.target.checked)}
                />
                <span>允许此助手使用机器人</span>
              </label>

              <button
                type="button"
                className="feishu-btn is-primary"
                disabled={saving || loading || !!error || qrLoading || !online || !!assistantError || !selected?.enabled}
                onClick={() => void save()}
              >
                {saving ? '正在保存...' : '保存配置'}
              </button>

              <button
                type="button"
                className="feishu-btn"
                disabled={!config.qrCodeUrl}
                onClick={openOfficialAuth}
              >
                打开官方扫码授权
              </button>

              <button
                type="button"
                className="feishu-btn"
                disabled={loading || !online}
                onClick={() => void refreshStatus()}
              >
                刷新授权状态
              </button>

              <button
                type="button"
                className="feishu-link-btn"
                onClick={() => void testBridgeConnection()}
              >
                重启飞书机器人连接测试
              </button>
            </div>

            <div className="feishu-bottom-right">
              <button
                type="button"
                className="feishu-btn"
                disabled={delivering || loading || !online || !config.enabled}
                onClick={() => void sendTestReport()}
              >
                {delivering ? '正在发送...' : '发送测试消息'}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
