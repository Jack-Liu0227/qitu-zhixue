'use client';

import type { FeedbackAttachmentInfo, ParentFeedbackStatus, ParentFeedbackTicket, TeacherFeedbackListPageData } from '@qitu/contracts';
import { ApiError, createIdempotencyKey, uploadFeedbackAttachment, removeFeedbackAttachment } from '@qitu/api-client';
import { FeedbackAttachmentLinks, FeedbackAttachmentPicker, ResizablePanels } from '@qitu/ui';
import { useCallback, useEffect, useRef, useState } from 'react';
import { teacherApi, TeacherOfflineError, TeacherPermissionError } from '../lib/teacherApi';

export const feedbackStatusLabels: Record<ParentFeedbackStatus, string> = {
  processing: '待回复', replied: '已回复，等待家长确认', resolved: '已解决', reopened: '家长继续询问',
};
function failureMessage(error: unknown) {
  return error instanceof TeacherPermissionError ? '当前账号无权读取或回复这条家长反馈。'
    : error instanceof TeacherOfflineError ? '网络已断开，恢复连接后可以重试。' : '家长反馈暂时无法读取，请重试。';
}
type FeedbackState = { status: 'ready'; data: TeacherFeedbackListPageData } | { status: 'loading' } | { status: 'error'; message: string };
export function useTeacherFeedback() {
  const [state, setState] = useState<FeedbackState>({ status: 'loading' });
  const identity = useRef(0);
  const refresh = useCallback(async () => {
    const request = ++identity.current;
    try {
      const response = await teacherApi.feedback();
      if (identity.current === request) setState({ status: 'ready', data: response.data });
    } catch (error: unknown) {
      if (identity.current === request) setState({ status: 'error', message: failureMessage(error) });
    }
  }, []);
  useEffect(() => { void refresh(); return () => { identity.current++; }; }, [refresh]);
  return { state, refresh };
}

function FeedbackDetail({ ticketId, refresh }: { ticketId: string; refresh: () => Promise<void> }) {
  const [ticket, setTicket] = useState<ParentFeedbackTicket | null>(null);
  const [error, setError] = useState('');
  const [content, setContent] = useState('');
  const [sending, setSending] = useState(false);
  const [files, setFiles] = useState<FeedbackAttachmentInfo[]>([]);
  const [attachmentsBlocked, setAttachmentsBlocked] = useState(false);
  const key = useRef<string | null>(null);
  const identity = useRef(0);
  const read = useCallback(() => {
    const request = ++identity.current;
    setError('');
    void teacherApi.feedbackDetail(ticketId).then(response => {
      if (request === identity.current) setTicket(response.data.ticket);
    }).catch((cause: unknown) => { if (request === identity.current) setError(failureMessage(cause)); });
  }, [ticketId]);
  useEffect(() => { read(); return () => { identity.current++; }; }, [read]);
  async function send() {
    if (sending || attachmentsBlocked || !content.trim()) return;
    const request = ++identity.current;
    setSending(true); setError('');
    try {
      key.current ??= createIdempotencyKey();
      const response = await teacherApi.replyFeedback(ticketId, { content: content.trim(), attachmentRefs: files.map(file => file.id) }, key.current);
      if (request !== identity.current) return;
      setTicket(response.data.ticket); setContent(''); setFiles([]); key.current = null;
      await refresh();
    } catch (cause: unknown) {
      if (request === identity.current) setError(cause instanceof TeacherOfflineError || cause instanceof TeacherPermissionError
        ? failureMessage(cause) : cause instanceof ApiError ? cause.message : '回复尚未确认保存，请重试。');
    } finally { if (request === identity.current) setSending(false); }
  }
  return <div className="qtx-feedback-detail">
    {error && <p role="alert">{error} <button type="button" className="qtx-btn" onClick={read} disabled={sending}>重新读取</button></p>}
    {!ticket ? !error && <p role="status">正在读取反馈内容…</p> : <>
      <header className="qtx-feedback-detail-heading"><div><span className="qtx-feedback-eyebrow">家校沟通</span><h3>{ticket.childDisplayName}</h3></div>
        <span className={`qtx-feedback-status is-${ticket.status}`}>{feedbackStatusLabels[ticket.status]}</span></header>
      {ticket.projectTitle && <p className="qtx-muted">关联项目：{ticket.projectTitle}</p>}
      <ol className="qtx-feedback-conversation">
        {ticket.entries.map(entry => <li key={entry.id}>
          <div className="qtx-feedback-message-heading"><strong>{entry.authorDisplayName}</strong><time dateTime={entry.createdAt}>{new Date(entry.createdAt).toLocaleString('zh-CN')}</time></div>
          <p>{entry.content}</p>
          <FeedbackAttachmentLinks files={entry.attachments} />
        </li>)}
      </ol>
      {ticket.status === 'resolved' || ticket.status === 'replied' ? <p className="qtx-muted">{ticket.status === 'resolved'
        ? '家长已确认解决；有新的问题时可由家长继续发起沟通。' : '已回复，等待家长确认或补充问题。'}</p> : <form onSubmit={event => { event.preventDefault(); void send(); }}>
        <label htmlFor="family-feedback-reply">回复家长</label>
        <textarea id="family-feedback-reply" value={content} maxLength={2000} disabled={sending}
          onChange={event => { setContent(event.target.value); key.current = null; }}
          style={{ display: 'block', width: '100%', boxSizing: 'border-box', minHeight: 100, margin: '8px 0', padding: 12, borderRadius: 10, border: '1px solid #cbd5e1', font: 'inherit' }} />
        {ticket.childId && <FeedbackAttachmentPicker value={files} onChange={next => { setFiles(next); key.current = null; }}
          upload={file => uploadFeedbackAttachment(file, ticket.childId ?? '')} remove={removeFeedbackAttachment}
          disabled={sending} onBlockedChange={setAttachmentsBlocked} />}
        <button type="submit" className="qtx-btn qtx-btn-primary" disabled={sending || attachmentsBlocked || !content.trim()}>{sending ? '正在保存…' : '发送回复'}</button>
        <span className="qtx-muted" style={{ marginLeft: 12, fontSize: 12 }}>回复后由家长确认是否解决。</span>
      </form>}
    </>}
  </div>;
}

export function TeacherFeedbackPanel({ state, refresh }: ReturnType<typeof useTeacherFeedback>) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<'all' | 'processing' | 'replied' | 'resolved'>('all');
  const items = state.status === 'ready' ? state.data.items : [];

  const filteredItems = items.filter(item => {
    if (statusFilter === 'all') return true;
    if (statusFilter === 'processing') return item.status === 'processing' || item.status === 'reopened';
    if (statusFilter === 'replied') return item.status === 'replied';
    if (statusFilter === 'resolved') return item.status === 'resolved';
    return true;
  });

  const selected = filteredItems.find(item => item.ticketId === selectedId) ?? filteredItems[0];

  return <section id="family-feedback" className="qtx-card qtx-panel" aria-label="家长反馈沟通">
    <div className="qtx-panel-header">
      <h2 className="qtx-panel-title">家长反馈</h2>
      <button type="button" className="qtx-btn" onClick={() => { void refresh(); }}>刷新</button>
    </div>
    {state.status === 'loading' ? <p role="status">正在读取家长反馈…</p>
      : state.status === 'error' ? <p role="alert">{state.message}</p>
      : !items.length ? <p className="qtx-muted">当前没有家长反馈，新的沟通请求会显示在这里。</p> : <>
        <div className="qtx-feedback-filters" style={{ display: 'flex', gap: 8, margin: '12px 0 16px', flexWrap: 'wrap' }}>
          <button
            type="button"
            className={`qtx-btn ${statusFilter === 'all' ? 'qtx-btn-primary' : 'qtx-btn-ghost-blue'}`}
            onClick={() => setStatusFilter('all')}
            style={{ borderRadius: 20, padding: '4px 14px', fontSize: 13 }}
          >
            全部 ({items.length})
          </button>
          <button
            type="button"
            className={`qtx-btn ${statusFilter === 'processing' ? 'qtx-btn-primary' : 'qtx-btn-ghost-blue'}`}
            onClick={() => setStatusFilter('processing')}
            style={{ borderRadius: 20, padding: '4px 14px', fontSize: 13 }}
          >
            待回复 ({state.data.totals.processing})
          </button>
          <button
            type="button"
            className={`qtx-btn ${statusFilter === 'replied' ? 'qtx-btn-primary' : 'qtx-btn-ghost-blue'}`}
            onClick={() => setStatusFilter('replied')}
            style={{ borderRadius: 20, padding: '4px 14px', fontSize: 13 }}
          >
            已回复 ({state.data.totals.replied})
          </button>
          <button
            type="button"
            className={`qtx-btn ${statusFilter === 'resolved' ? 'qtx-btn-primary' : 'qtx-btn-ghost-blue'}`}
            onClick={() => setStatusFilter('resolved')}
            style={{ borderRadius: 20, padding: '4px 14px', fontSize: 13 }}
          >
            已解决 ({state.data.totals.resolved})
          </button>
        </div>

        {filteredItems.length === 0 ? (
          <p className="qtx-muted" style={{ padding: '24px 0', textAlign: 'center' }}>当前分类暂无家长反馈记录</p>
        ) : (
          <ResizablePanels storageKey="teacher-family-feedback" initialSizes={[30, 70]} minWidths={[260, 360]} labels={['反馈列表', '沟通详情']}>
            <nav className="qtx-feedback-list" aria-label="选择家长反馈">
              {filteredItems.map(item => <button type="button" key={item.ticketId} aria-pressed={selected?.ticketId === item.ticketId}
                className="qtx-feedback-item" onClick={() => setSelectedId(item.ticketId)}>
                <span className="qtx-feedback-item-title"><strong>{item.studentDisplayName}</strong><span className={`qtx-feedback-status is-${item.status}`}>{feedbackStatusLabels[item.status]}</span></span>
                <span className="qtx-feedback-preview">{item.problem}</span>
              </button>)}
            </nav>
            {selected && <FeedbackDetail key={selected.ticketId} ticketId={selected.ticketId} refresh={refresh} />}
          </ResizablePanels>
        )}
      </>}
  </section>;
}
