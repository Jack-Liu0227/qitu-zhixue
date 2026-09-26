'use client';

import { useMemo, useState } from 'react';
import { parentMessages, type ParentMessage } from './data';

const filters = ['全部', '学习动态', '建议关注', '员工回复', '已解决'] as const;
type MessageFilter = (typeof filters)[number];

function statusTone(status: ParentMessage['status']): string {
  if (status === '已解决' || status === '无需处理') return 'is-completed';
  if (status === '建议关注') return 'is-attention';
  return 'is-primary';
}

export function ParentMessagesPage() {
  const [filter, setFilter] = useState<MessageFilter>('全部');
  const [selectedId, setSelectedId] = useState(parentMessages[0]?.id ?? '');
  const [feedback, setFeedback] = useState('');
  const [submittedFor, setSubmittedFor] = useState<string | null>(null);
  const visibleMessages = useMemo(
    () => parentMessages.filter((message) => filter === '全部' || message.category === filter),
    [filter],
  );
  const selected = parentMessages.find((message) => message.id === selectedId) ?? visibleMessages[0];

  function chooseFilter(next: MessageFilter) {
    setFilter(next);
    const first = parentMessages.find((message) => next === '全部' || message.category === next);
    if (first) setSelectedId(first.id);
  }

  function submitFeedback(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected || feedback.trim().length === 0) return;
    setSubmittedFor(selected.id);
    setFeedback('');
  }

  return (
    <div className="parent-messages-page">
      <div className="parent-message-filters" role="tablist" aria-label="消息筛选">
        {filters.map((item) => (
          <button type="button" role="tab" aria-selected={filter === item} className={filter === item ? 'is-active' : undefined} onClick={() => chooseFilter(item)} key={item}>
            {item}{item === '全部' ? <span>4</span> : null}
          </button>
        ))}
      </div>

      <div className="parent-message-workspace">
        <section className="parent-message-list" aria-label="消息列表">
          <header><h2>{filter === '全部' ? '全部消息' : filter}</h2><span>{visibleMessages.length} 条</span></header>
          {visibleMessages.map((message) => (
            <button type="button" className={`${message.id === selected?.id ? 'is-selected' : ''} ${message.unread ? 'is-unread' : ''}`} onClick={() => setSelectedId(message.id)} key={message.id}>
              <span className={`parent-message-category is-${message.category}`}>{message.category}</span>
              <time>{message.time}</time>
              <strong>{message.title}</strong>
              <p>{message.summary}</p>
              {message.unread ? <i aria-label="未读" /> : null}
            </button>
          ))}
        </section>

        {selected ? (
          <article className="parent-panel parent-message-detail">
            <header className="parent-message-detail-header">
              <div><span className="parent-kicker">{selected.category} · {selected.time}</span><h2>{selected.title}</h2></div>
              <span className={`parent-status-badge ${statusTone(selected.status)}`}>{selected.status}</span>
            </header>
            <dl className="parent-message-meta"><div><dt>关联项目</dt><dd>{selected.project}</dd></div><div><dt>消息编号</dt><dd>{selected.id.toUpperCase()}</dd></div></dl>
            <section><h3>当前情况</h3><p>{selected.detail}</p></section>
            <section className="parent-ai-help-box"><span className="parent-insight-icon is-teal">AI</span><div><h3>AI 已提供的帮助</h3><ul>{selected.aiHelp.map((item) => <li key={item}>{item}</li>)}</ul></div></section>
            {selected.reply ? <section className="parent-staff-reply"><span>班主任回复</span><blockquote>{selected.reply}</blockquote></section> : null}
            <form className="parent-feedback-form" onSubmit={submitFeedback}>
              <label htmlFor="parent-feedback"><span>补充反馈</span><small>你的反馈会生成班主任工单，不会直接改写孩子的学习状态。</small></label>
              <textarea id="parent-feedback" value={feedback} onChange={(event) => setFeedback(event.target.value)} placeholder="例如：他回家后提到最困惑的地方是……" rows={4} />
              <div><span>{submittedFor === selected.id ? '反馈已提交，班主任将在这里回复。' : '请避免填写不必要的敏感信息。'}</span><button type="submit" disabled={feedback.trim().length === 0}>提交反馈</button></div>
            </form>
          </article>
        ) : (
          <div className="parent-panel parent-message-empty"><strong>没有符合条件的消息</strong><p>新的学习动态和回复会出现在这里。</p></div>
        )}
      </div>
    </div>
  );
}
