'use client';

import { useEffect, useRef, useState } from 'react';
import type { TutorTeamHistoryEntry, TutorTeamHistoryPage } from '@qitu/contracts';
import { TutorDataError } from '../data/dataSource';
import { ToolCallTimeline } from './ToolCallTimeline';

export type LoadTeamHistory = (assistantId: string, cursor?: string) => Promise<TutorTeamHistoryPage>;

export function AgentHistory({ assistantId, load }: { assistantId: string; load: LoadTeamHistory }) {
  const [items, setItems] = useState<TutorTeamHistoryEntry[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [cursor, setCursor] = useState<string | undefined>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const identity = useRef(0);

  useEffect(() => { setCursor(undefined); setItems([]); setNext(null); }, [assistantId, load]);
  useEffect(() => {
    const current = ++identity.current;
    setLoading(true); setError(null);
    load(assistantId, cursor).then(page => {
      if (current !== identity.current) return;
      setItems(previous => [...new Map([...(cursor ? previous : []), ...page.items].map(item => [item.id, item])).values()]);
      setNext(page.nextCursor);
    }).catch(reason => {
      if (current !== identity.current) return;
      setError(reason instanceof TutorDataError && (reason.status === 401 || reason.status === 403)
        ? '当前账号没有查看这些历史记录的权限。'
        : reason instanceof TutorDataError && reason.code === 'NETWORK_OFFLINE' ? '网络已断开，请联网后重试。'
          : '历史记录暂时无法读取，请重试。');
    }).finally(() => { if (current === identity.current) setLoading(false); });
    return () => { identity.current++; };
  }, [assistantId, load, cursor, retry]);

  return <section aria-label="成员历史记录">
    <h4>历史记录</h4>
    {loading && <p role="status">正在读取历史记录…</p>}
    {error && <div role="alert"><p>{error}</p><button type="button" onClick={() => setRetry(value => value + 1)}>重试历史读取</button></div>}
    {!loading && !error && items.length === 0 && <p className="qitu-tutor-muted">{next ? '本页没有该成员的可见记录，可继续读取更早记录。' : '暂无已保存的对话或协作记录。'}</p>}
    <ol className="qitu-tutor-agent-messages">{items.map(item => <li key={item.id}>
      <time dateTime={item.occurredAt}>{new Date(item.occurredAt).toLocaleString('zh-CN')}</time>
      <p>{item.summary}</p>
      {item.toolCalls.length > 0 && <ToolCallTimeline calls={item.toolCalls.map(call => ({
        callId: call.callId, name: call.name, label: call.label, status: call.status, result: call.summary ?? undefined,
      }))} />}
    </li>)}</ol>
    {!loading && !error && next && <button type="button" onClick={() => setCursor(next)}>读取更早记录</button>}
  </section>;
}
