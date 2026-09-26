'use client';

import { useCallback, useEffect, useState } from 'react';
import { Badge, Button, SectionCard } from '@qitu/ui';
import {
  parentApi,
  ParentOfflineError,
  ParentPermissionError,
  type ChildRef,
  type ParentMessagesPageData,
} from '../../../features/parentApi';
import { ChildPicker, DataState, PageFrame } from '../../../features/ParentDataPage';
import {
  formatDayTime,
  parentMessageStatusLabel,
  parentTicketStatusLabel,
} from '../../../features/parentFormat';

/**
 * 消息与反馈（参考稿 `消息与反馈.png`）。
 *
 * 「提交反馈」与「就此问题反馈」走同一个入口，只有 `source` 不同，
 * 这样服务端只需要一条工单链路。反馈用页面内的表单收集，不用
 * `window.prompt`/`alert`：原生弹窗会阻塞页面、无法做长度校验与错误展示，
 * 也不能在提交中禁用按钮（重复点击会开出两张工单）。
 */

type FeedbackSource = 'general' | 'message';

export default function MessagesPage() {
  const [children, setChildren] = useState<ChildRef[]>([]);
  const [childId, setChildId] = useState('');
  const [data, setData] = useState<ParentMessagesPageData | null>(null);
  const [state, setState] = useState('loading');
  const [selected, setSelected] = useState('');

  const [feedbackOpen, setFeedbackOpen] = useState<FeedbackSource | null>(null);
  const [feedbackContent, setFeedbackContent] = useState('');
  const [feedbackState, setFeedbackState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [acting, setActing] = useState(false);

  const load = useCallback((id: string) => {
    setState('loading');
    void parentApi
      .messages(id)
      .then((r) => {
        setData(r.data);
        setSelected(r.data.messages[0]?.id ?? '');
        setState('ready');
      })
      .catch((e) =>
        setState(
          e instanceof ParentPermissionError
            ? 'permission'
            : e instanceof ParentOfflineError
              ? 'offline'
              : 'error',
        ),
      );
  }, []);

  useEffect(() => {
    void parentApi
      .children()
      .then((r) => {
        setChildren(r.data);
        const id = r.data[0]?.childId ?? '';
        setChildId(id);
        if (id) load(id);
        else setState('empty');
      })
      .catch(() => setState('error'));
  }, [load]);

  const focus = data?.messages.find((m) => m.id === selected)?.focus ?? null;

  const selectChild = (id: string) => {
    setChildId(id);
    setFeedbackOpen(null);
    setFeedbackContent('');
    setFeedbackState('idle');
    load(id);
  };

  const act = async (action: 'read' | 'mute') => {
    if (!childId || !selected || acting) return;
    setActing(true);
    try {
      await parentApi.post(
        `/api/v1/parent/children/${encodeURIComponent(childId)}/messages/${encodeURIComponent(selected)}/ack`,
        { action },
      );
      load(childId);
    } catch (e) {
      setState(
        e instanceof Error &&
          'code' in e &&
          (e as { code?: string }).code === 'MESSAGE_ACTION_NOT_APPLICABLE'
          ? 'action-error'
          : 'error',
      );
    } finally {
      setActing(false);
    }
  };

  const submitFeedback = async () => {
    const content = feedbackContent.trim();
    if (content.length === 0 || content.length > 500 || feedbackState === 'sending') return;
    setFeedbackState('sending');
    try {
      await parentApi.post('/api/v1/parent/feedback', {
        source: feedbackOpen === 'message' ? 'message' : 'general',
        content,
        messageId: feedbackOpen === 'message' ? selected : null,
        projectId: null,
      });
      setFeedbackState('sent');
      setFeedbackContent('');
      load(childId);
    } catch {
      setFeedbackState('error');
    }
  };

  const openFeedback = (source: FeedbackSource) => {
    setFeedbackOpen(source);
    setFeedbackState('idle');
  };

  return (
    <PageFrame
      title="消息与反馈"
      subtitle="及时了解重要动态，遇到问题可以随时联系我们"
      source={data?.dataSource}
    >
      <div className="messages-toolbar">
        <ChildPicker children={children} value={childId} onChange={selectChild} />
        <Button onClick={() => openFeedback('general')}>提交反馈</Button>
      </div>

      {feedbackOpen ? (
        <SectionCard title={feedbackOpen === 'message' ? '就此问题反馈' : '提交反馈'}>
          <div className="feedback-form">
            <textarea
              value={feedbackContent}
              onChange={(e) => {
                setFeedbackContent(e.target.value);
                if (feedbackState !== 'sending') setFeedbackState('idle');
              }}
              maxLength={500}
              rows={3}
              placeholder="请描述您遇到的问题或疑问（1-500 字）…"
              aria-label="反馈内容"
            />
            <div className="feedback-actions">
              <small>{feedbackContent.trim().length}/500</small>
              <Button
                onClick={submitFeedback}
                loading={feedbackState === 'sending'}
                disabled={feedbackContent.trim().length === 0 || feedbackState === 'sending'}
              >
                提交
              </Button>
              <Button variant="ghost" onClick={() => setFeedbackOpen(null)}>
                取消
              </Button>
            </div>
            {feedbackState === 'sent' ? (
              <p className="feedback-done">反馈已记录，服务团队会继续处理。</p>
            ) : null}
            {feedbackState === 'error' ? (
              <p className="inline-error">反馈没能提交，请稍后重试。</p>
            ) : null}
          </div>
        </SectionCard>
      ) : null}

      <DataState state={{ status }} reload={() => childId && load(childId)} emptyTitle="暂无消息">
        {data ? (
          <>
            <div className="message-summary">
              {[
                ['全部消息', data.summary.total],
                ['待您确认', data.summary.pendingConfirm],
                ['处理中', data.summary.processing],
                ['已解决', data.summary.resolved],
              ].map(([label, value]) => (
                <div key={String(label)}>
                  <span>{label}</span>
                  <strong>{String(value)}</strong>
                </div>
              ))}
            </div>
            <div className="messages-grid">
              <section className="message-list">
                {data.messages.map((m) => (
                  <button
                    className={m.id === selected ? 'message-row selected' : 'message-row'}
                    key={m.id}
                    onClick={() => setSelected(m.id)}
                  >
                    <span className="message-icon" aria-hidden="true">
                      {m.kind === 'attention' ? '!' : '◈'}
                    </span>
                    <span>
                      <strong>{m.title}</strong>
                      <small>{m.summary}</small>
                    </span>
                    <time dateTime={m.occurredAt}>{formatDayTime(m.occurredAt)}</time>
                    <Badge
                      tone={
                        m.status === 'resolved'
                          ? 'completed'
                          : m.status === 'pending_confirm'
                            ? 'attention'
                            : 'primary'
                      }
                    >
                      {parentMessageStatusLabel(m.status)}
                    </Badge>
                  </button>
                ))}
              </section>
              <SectionCard title={focus?.headline ?? '选择一条消息'}>
                {focus ? (
                  <>
                    <div className="focus-meta">
                      <span>{formatDayTime(focus.occurredAt)}</span>
                      {focus.projectTitle ? (
                        <span>· 关联项目：{focus.projectTitle}</span>
                      ) : null}
                    </div>
                    <div className="focus-grid">
                      <div>
                        <h3>发生了什么</h3>
                        <p>{focus.whatHappened}</p>
                      </div>
                      <div>
                        <h3>系统已经做了什么</h3>
                        <p>{focus.whatSystemDid}</p>
                      </div>
                      <div>
                        <h3>是否需要家长介入</h3>
                        <p>
                          {focus.needParent
                            ? focus.needParentNote
                            : '暂时不需要立即处理，可以等待孩子继续尝试'}
                        </p>
                      </div>
                      <div>
                        <h3>您可以提供的支持</h3>
                        <p>{focus.howYouCanHelp}</p>
                      </div>
                    </div>
                    <h3>处理时间线</h3>
                    <div className="message-timeline">
                      {focus.timeline.map((t) => (
                        <div key={t.label} className={t.state}>
                          <strong>{t.label}</strong>
                          <small>{t.at ? formatDayTime(t.at) : '待发生'}</small>
                        </div>
                      ))}
                    </div>
                    <div className="action-row">
                      <Button onClick={() => act('read')} disabled={acting} loading={acting}>
                        标记已读
                      </Button>
                      <Button variant="ghost" onClick={() => act('mute')} disabled={acting}>
                        暂不提醒
                      </Button>
                      <Button variant="ghost" onClick={() => openFeedback('message')}>
                        就此问题反馈
                      </Button>
                    </div>
                    {state === 'action-error' ? (
                      <p className="inline-error">这条消息当前不适用该操作，状态可能已经更新。</p>
                    ) : null}
                  </>
                ) : (
                  <p>请选择左侧消息查看详情。</p>
                )}
              </SectionCard>
            </div>
            <SectionCard title="最近服务工单">
              <div className="ticket-table">
                <div className="ticket-head">
                  <span>工单编号</span>
                  <span>问题描述</span>
                  <span>关联项目</span>
                  <span>负责人</span>
                  <span>状态</span>
                  <span>处理时间</span>
                  <span>操作</span>
                </div>
                {data.tickets.length ? (
                  data.tickets.map((t) => (
                    <div key={t.id}>
                      <strong>{t.id}</strong>
                      <span>{t.problem}</span>
                      <span>{t.projectTitle ?? '—'}</span>
                      <span>{t.owner}</span>
                      <Badge tone={t.status === 'resolved' ? 'completed' : 'primary'}>
                        {parentTicketStatusLabel(t.status)}
                      </Badge>
                      <span>{t.handledIn}</span>
                      <button
                        type="button"
                        className="ticket-detail"
                        title="处理记录查看即将上线"
                      >
                        查看处理记录 →
                      </button>
                    </div>
                  ))
                ) : (
                  <p className="empty-inline">还没有服务工单。</p>
                )}
              </div>
            </SectionCard>
          </>
        ) : null}
      </DataState>
    </PageFrame>
  );
}
