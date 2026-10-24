'use client';
import type { ParentFeedbackTicket } from '@qitu/contracts';
import { FeedbackAttachmentLinks, SectionCard } from '@qitu/ui';
import { useCallback, useEffect, useRef, useState } from 'react';
import { parentApi, ParentOfflineError, ParentPermissionError } from '../parentApi';

export function ParentFeedbackDetail({ ticketId, childId }: { ticketId: string; childId: string }) {
  const [ticket, setTicket] = useState<ParentFeedbackTicket | null>(null);
  const [error, setError] = useState('');
  const identity = useRef(0);
  const read = useCallback(() => {
    const request = ++identity.current;
    setError('');
    void parentApi.feedbackDetail(ticketId).then(response => {
      if (request !== identity.current) return;
      if (response.data.ticket.childId !== childId) { setError('请选择当前孩子的反馈。'); return; }
      setTicket(response.data.ticket);
    }).catch((cause: unknown) => {
      if (request === identity.current) setError(cause instanceof ParentPermissionError ? '无权查看该反馈，请重新登录确认。'
        : cause instanceof ParentOfflineError ? '网络已断开，恢复连接后可以重试。' : '反馈详情暂时无法读取。');
    });
  }, [ticketId, childId]);
  useEffect(() => { read(); return () => { identity.current++; }; }, [read]);
  return <SectionCard title="反馈沟通详情">
    {error ? <p role="alert">{error} <button type="button" onClick={read}>重新读取</button></p>
      : !ticket ? <p role="status">正在读取反馈…</p> : <>
        <p>{ticket.problem}</p>
        <ol style={{ paddingLeft: 20, overflowWrap: 'anywhere' }}>{ticket.entries.map(entry => <li key={entry.id} style={{ marginBottom: 16 }}>
          <strong>{entry.authorDisplayName}</strong> · <time dateTime={entry.createdAt}>{new Date(entry.createdAt).toLocaleString('zh-CN')}</time>
          <p style={{ whiteSpace: 'pre-wrap' }}>{entry.content}</p><FeedbackAttachmentLinks files={entry.attachments} />
        </li>)}</ol>
      </>}
  </SectionCard>;
}
