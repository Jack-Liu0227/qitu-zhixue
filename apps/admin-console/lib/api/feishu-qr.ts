import type { FeishuIntegrationConfig, FeishuQrStatusResponse } from './feishu';

/**
 * Refresh only after the provider's advertised expiry. A client-side lead time
 * would hide a still-scannable QR and can shorten providers with short TTLs.
 */
export function shouldRefreshFeishuQr(remainingSeconds: number | null): boolean {
  return remainingSeconds === 0;
}

export function applyFeishuQrStatus(current: FeishuIntegrationConfig, status: FeishuQrStatusResponse): FeishuIntegrationConfig {
  const pending = status.status === 'pending';
  return {
    ...current,
    status: status.status === 'bound' ? 'connected' : pending ? 'pending' : 'error',
    credentialConfigured: status.credentialConfigured,
    qrSessionId: status.id,
    // Polling changes status, not the QR target. Older servers may return an empty or legacy OAuth URL.
    qrCodeUrl: pending ? current.qrCodeUrl || status.authorizationUrl : undefined,
    qrCodeDataUrl: pending ? current.qrCodeDataUrl || status.qrCodeDataUrl : undefined,
    expiresAt: status.expiresAt,
  };
}

interface PollOptions {
  sessionId: string;
  pollIntervalSeconds?: number;
  poll: (sessionId: string) => Promise<FeishuQrStatusResponse>;
  onStatus: (status: FeishuQrStatusResponse) => void;
  /** Return false for non-retryable failures such as a permission denial. */
  onError: (error: unknown) => boolean;
}

export function pollFeishuQrSession(options: PollOptions): () => void {
  let stopped = false;
  let interval = pollInterval(options.pollIntervalSeconds);
  let timer: ReturnType<typeof setTimeout>;
  const schedule = () => { timer = setTimeout(() => void tick(), interval * 1000); };
  const tick = async () => {
    try {
      const status = await options.poll(options.sessionId);
      if (stopped) return;
      if (status.id !== options.sessionId) throw new Error('Unexpected Feishu QR session');
      interval = pollInterval(status.pollIntervalSeconds ?? interval);
      options.onStatus(status);
      if (status.status !== 'pending') stopped = true;
    } catch (error) {
      if (stopped) return;
      if (!options.onError(error)) stopped = true;
    }
    // Wait after completion: requests cannot overlap, even on a slow network.
    if (!stopped) schedule();
  };
  schedule();
  return () => { stopped = true; clearTimeout(timer); };
}

function pollInterval(value?: number): number {
  return value !== undefined && Number.isFinite(value) && value >= 1 ? value : 5;
}
