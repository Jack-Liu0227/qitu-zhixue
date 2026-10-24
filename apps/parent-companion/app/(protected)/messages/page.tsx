'use client';
import { ResizablePanels } from '@qitu/ui';

import { RobotMascot } from '@qitu/ui';
import { ParentFeedbackDetail } from '../../../features/feedback/ParentFeedbackDetail';
import { createIdempotencyKey } from '@qitu/api-client';

import { useCallback, useEffect, useRef, useState } from 'react';
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
 * 「提交反馈」与「就此问题反馈」都打开 AppShell 右下角的统一反馈窗口，
 * 历史页只负责展示消息/工单状态，不维护第二套表单。
 */

export default function MessagesPage() {
  const [children, setChildren] = useState<ChildRef[]>([]);
  const [childId, setChildId] = useState('');
  const [data, setData] = useState<ParentMessagesPageData | null>(null);
  const [state, setState] = useState('loading');
  const [selected, setSelected] = useState('');
  const [selectedTicket, setSelectedTicket] = useState<string | null>(null);

  const [acting, setActing] = useState(false);
  const pendingAction = useRef<{ key: string; resource: string; action: 'read' | 'mute' } | null>(null);
  const latestLoad = useRef(0);
  const activeChildId = useRef('');

  const load = useCallback((id: string) => {
    const requestId = ++latestLoad.current;
    setData(null);
    setSelected('');
    setState('loading');
    void parentApi
      .messages(id)
      .then((r) => {
        if (requestId !== latestLoad.current) return;
        setData(r.data);
        setSelected(r.data.messages[0]?.id ?? '');
        setState('ready');
      })
      .catch((e) => {
        if (requestId !== latestLoad.current) return;
        setState(
          e instanceof ParentPermissionError
            ? 'permission'
            : e instanceof ParentOfflineError
              ? 'offline'
              : 'error',
        );
      });
  }, []);

  useEffect(() => {
    void parentApi
      .children()
      .then((r) => {
        setChildren(r.data);
        const id = r.data[0]?.childId ?? '';
        setChildId(id);
        activeChildId.current = id;
        if (id) load(id);
        else setState('empty');
      })
      .catch(() => setState('error'));
  }, [load]);

  const focus = data?.messages.find((m) => m.id === selected)?.focus ?? null;

  const selectChild = (id: string) => {
    setChildId(id);
    activeChildId.current = id;
    setActing(false);
    pendingAction.current = null;
    load(id);
  };

  const act = async (action: 'read' | 'mute') => {
    if (!childId || !selected || acting) return;
    const actionChildId = childId;
    const actionGeneration = latestLoad.current;
    setActing(true);
    const resource = `${actionChildId}:${selected}`;
    if (pendingAction.current?.resource !== resource || pendingAction.current.action !== action) {
      pendingAction.current = { key: createIdempotencyKey(), resource, action };
    }
    const actionKey = pendingAction.current.key;
    try {
      await parentApi.post(
        `/api/v1/parent/children/${encodeURIComponent(actionChildId)}/messages/${encodeURIComponent(selected)}/ack`,
        { action },
        { idempotencyKey: actionKey },
      );
      if (pendingAction.current?.key === actionKey) pendingAction.current = null;
      if (activeChildId.current === actionChildId && latestLoad.current === actionGeneration) { setActing(false); load(actionChildId); }
    } catch (e) {
      if (activeChildId.current === actionChildId && latestLoad.current === actionGeneration) {
        setState(
          e instanceof Error &&
            'code' in e &&
            (e as { code?: string }).code === 'MESSAGE_ACTION_NOT_APPLICABLE'
            ? 'action-error'
            : 'error',
        );
      }
    } finally {
      if (activeChildId.current === actionChildId && latestLoad.current === actionGeneration) setActing(false);
    }
  };

  const openFeedback = () => {
    window.dispatchEvent(new CustomEvent('qitu:open-parent-feedback'));
  };

  return (
    <PageFrame
      title="消息与反馈"
      subtitle="及时了解重要动态，遇到问题可以随时联系我们"
      source={data?.dataSource}
    >
      <div className="messages-toolbar">
        <ChildPicker children={children} value={childId} onChange={selectChild} />
        <Button onClick={openFeedback}>提交反馈</Button>
      </div>

      <DataState state={{ status: state }} reload={() => childId && load(childId)} emptyTitle="还没有绑定孩子">
        {data ? (
          <>
            {data.messagesAvailable === false && <p role="status">学习消息通道暂未接入，反馈工单仍可正常查看和提交。</p>}
            <div className="message-summary">
              {[
                { label: '全部消息', value: data.messagesAvailable === false ? '—' : data.summary.total, icon: '📬', tone: 'neutral' },
                { label: '待您确认', value: data.messagesAvailable === false ? '—' : data.summary.pendingConfirm, icon: '⚠️', tone: 'amber' },
                { label: '处理中', value: data.messagesAvailable === false ? '—' : data.summary.processing, icon: '⏳', tone: 'blue' },
                { label: '已解决', value: data.messagesAvailable === false ? '—' : data.summary.resolved, icon: '✅', tone: 'green' },
              ].map(({ label, value, icon, tone }) => (
                <div className={`summary-card tone-${tone}`} key={label}>
                  <div className="summary-card-head">
                    <span>{label}</span>
                    <span className="summary-icon" aria-hidden="true">{icon}</span>
                  </div>
                  <strong>{String(value)}</strong>
                </div>
              ))}
            </div>
            <ResizablePanels storageKey="parent-messages" initialSizes={[55, 45]} minWidths={[300, 280]} className="messages-grid">
              <section className="message-list">
                {data.messages.map((m) => {
                  const icon =
                    m.kind === 'attention'
                      ? '⚠️'
                      : m.kind === 'stage_update'
                        ? '🚀'
                        : m.kind === 'artifact'
                          ? '🎨'
                          : m.kind === 'resolved'
                            ? '✅'
                            : '◈';
                  return (
                    <button
                      type="button"
                      className={m.id === selected ? 'message-row selected' : 'message-row'}
                      key={m.id}
                      onClick={() => setSelected(m.id)}
                    >
                      <span className="message-icon" aria-hidden="true">
                        {icon}
                      </span>
                      <span className="message-main-col">
                        <strong className="message-title">{m.title}</strong>
                        <small className="message-snippet">{m.summary}</small>
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
                  );
                })}
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
                      <div className="focus-quadrant">
                        <h3>📌 发生了什么</h3>
                        <p>{focus.whatHappened}</p>
                      </div>
                      <div className="focus-quadrant">
                        <h3><RobotMascot size={20} decorative /> 系统已经做了什么</h3>
                        <p>{focus.whatSystemDid}</p>
                      </div>
                      <div className="focus-quadrant">
                        <h3>👨‍👩‍👧 是否需要家长介入</h3>
                        <p>
                          {focus.needParent
                            ? focus.needParentNote
                            : '暂时不需要立即处理，可以等待孩子继续尝试'}
                        </p>
                      </div>
                      <div className="focus-quadrant">
                        <h3>💡 您可以提供的支持</h3>
                        <p>{focus.howYouCanHelp}</p>
                      </div>
                    </div>
                    <h3 className="timeline-section-title">处理时间线</h3>
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
                      <Button variant="ghost" onClick={openFeedback}>
                        就此问题反馈
                      </Button>
                    </div>
                    {state === 'action-error' ? (
                      <p className="inline-error">这条消息当前不适用该操作，状态可能已经更新。</p>
                    ) : null}
                  </>
                ) : (
                  <p>请选择一条消息查看详情。</p>
                )}
              </SectionCard>
            </ResizablePanels>
            <SectionCard title="最近服务工单">
              <div className="ticket-table">
                <div className="ticket-head">
                  <span>工单编号</span>
                  <span>问题描述</span>
                  <span>关联项目</span>
                  <span>负责人</span>
                  <span>状态</span>
                  <span>处理时间</span>
                </div>
                {data.tickets.length ? (
                  data.tickets.map((t) => (
                    <div key={t.id}>
                      <button type="button" onClick={() => setSelectedTicket(t.id)} aria-label={`查看反馈：${t.problem}`}>{t.id}</button>
                      <span>{t.problem}</span>
                      <span>{t.projectTitle ?? '—'}</span>
                      <span>{t.owner}</span>
                      <Badge tone={t.status === 'resolved' ? 'completed' : 'primary'}>
                        {parentTicketStatusLabel(t.status)}
                      </Badge>
                      <span>{t.handledIn}</span>
                    </div>
                  ))
                ) : (
                  <p className="empty-inline">还没有服务工单。</p>
                )}
              </div>
            </SectionCard>
            {selectedTicket && data.tickets.some(ticket => ticket.id === selectedTicket) && <ParentFeedbackDetail
              key={`${childId}:${selectedTicket}`} ticketId={selectedTicket} childId={childId} />}
          </>
        ) : null}
      </DataState>
    </PageFrame>
  );
}
