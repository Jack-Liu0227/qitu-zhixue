/** Parse only the private text protocol supported by the server-owned handlers. */
export interface FeishuInboundMessage {
  messageId: string;
  senderOpenId: string;
  command: 'report' | 'help';
}

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? Object.fromEntries(Object.entries(value)) : null;
}

function identifier(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 256;
}

export function parseInboundMessage(payload: unknown, appId: string): FeishuInboundMessage | null {
  const root = object(payload);
  const header = object(root?.header);
  if (header?.app_id !== undefined && header.app_id !== appId) return null;
  const event = object(root?.event) ?? root;
  const message = object(event?.message);
  const sender = object(event?.sender);
  const senderId = object(sender?.sender_id);
  // Group membership does not grant access to a management report.
  if (!message || message.chat_type !== 'p2p' || message.message_type !== 'text'
    || sender?.sender_type !== 'user' || !identifier(senderId?.open_id) || !identifier(message.message_id)) return null;
  if (typeof message.content !== 'string' || message.content.length > 16_000) return null;
  let content: Record<string, unknown> | null;
  try { content = object(JSON.parse(message.content)); } catch { return null; }
  if (typeof content?.text !== 'string' || !content.text.trim() || content.text.length > 12_000) return null;
  const text = content.text.trim().toLowerCase();
  return {
    messageId: message.message_id, senderOpenId: senderId.open_id,
    command: /^(?:\/?report|汇报|学情汇报|问题总结|总结|报告|生成汇报|生成报告|发送汇报|发送报告)[。！!\s]*$/.test(text) ? 'report' : 'help',
  };
}
