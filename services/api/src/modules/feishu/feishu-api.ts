import { createHash } from 'node:crypto';
import type { FeishuDomain, FeishuReportDocument } from '@qitu/contracts';

export class FeishuApiError extends Error {
  constructor(readonly code: string, readonly retryable = false) { super(code); }
}

export function recipientHash(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 24);
}

export function messageUuid(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 32);
}

export function formatFeishuReport(report: FeishuReportDocument): string {
  return report.issueSummary?.formattedText ?? [
    '启途智学 · 学生、家长与教师汇报',
    `统计区间：${report.range.from} 至 ${report.range.to}`,
    `学生 ${report.summary.studentCount} 人，家长 ${report.summary.parentCount} 人，教师 ${report.summary.teacherCount} 人。`,
    `项目 ${report.summary.projectCount} 个，停滞学生 ${report.summary.stalledStudentCount} 人，待处理干预 ${report.summary.pendingInterventionCount} 项。`,
    `生成时间：${report.generatedAt}。仅包含脱敏汇总。`,
  ].join('\n');
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new FeishuApiError('FEISHU_RESPONSE_INVALID');
  return Object.fromEntries(Object.entries(value));
}

async function call(url: string, body: object, token?: string): Promise<Record<string, unknown>> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST', headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(body), signal: AbortSignal.timeout(10_000),
    });
  } catch { throw new FeishuApiError('FEISHU_NETWORK_UNAVAILABLE', true); }
  if (!response.ok) throw new FeishuApiError(`FEISHU_HTTP_${response.status}`, response.status === 429 || response.status >= 500);
  const payload = record(await response.json().catch(() => null));
  if (payload.code !== 0) {
    const code = typeof payload.code === 'number' ? payload.code : 'INVALID';
    throw new FeishuApiError(`FEISHU_API_${code}`, [99991400, 99991401, 99991402, 99991663, 99991664, 99991668].includes(Number(code)));
  }
  return payload;
}

/** Only tenant tokens may be used to send messages as this bot. */
export async function sendFeishuText(input: {
  appId: string; appSecret: string; domain: FeishuDomain; recipient: string; text: string; uuid: string;
  recipientType?: 'open_id' | 'chat_id';
}): Promise<{ messageId: string; requestId?: string }> {
  if (!input.text.trim() || Buffer.byteLength(input.text, 'utf8') > 20_000) throw new FeishuApiError('FEISHU_MESSAGE_SIZE_INVALID');
  const base = `https://${input.domain === 'lark' ? 'open.larksuite.com' : 'open.feishu.cn'}/open-apis`;
  const auth = await call(`${base}/auth/v3/tenant_access_token/internal`, { app_id: input.appId, app_secret: input.appSecret });
  if (typeof auth.tenant_access_token !== 'string' || !auth.tenant_access_token) throw new FeishuApiError('FEISHU_TENANT_TOKEN_MISSING');
  const payload = await call(`${base}/im/v1/messages?receive_id_type=${input.recipientType ?? 'open_id'}`, {
    receive_id: input.recipient, msg_type: 'text', content: JSON.stringify({ text: input.text }), uuid: input.uuid,
  }, auth.tenant_access_token);
  const data = record(payload.data);
  if (typeof data.message_id !== 'string' || !data.message_id || data.message_id.length > 256) throw new FeishuApiError('FEISHU_MESSAGE_RECEIPT_MISSING');
  return { messageId: data.message_id, ...(typeof payload.request_id === 'string' ? { requestId: payload.request_id } : {}) };
}
