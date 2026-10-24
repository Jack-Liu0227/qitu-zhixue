'use client';

import { createApiClient, ApiError } from '@qitu/api-client';
import type { LearningActivitySummary, StudentEncouragement } from '@qitu/contracts';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useAnalysisRefresh } from '../growth/useAnalysisRefresh';
import styles from './Profile.module.css';

const client = createApiClient('');
type State = { status: 'ready'; activity: LearningActivitySummary; messages: StudentEncouragement[] }
  | { status: 'loading' | 'error' | 'offline' | 'permission' };

export function FamilyLearningCard() {
  const [state, setState] = useState<State>({ status: 'loading' });
  const identity = useRef(0);
  const read = useCallback(() => {
    const request = ++identity.current;
    void Promise.all([
      client.get<{ data: LearningActivitySummary }>('/api/v1/students/me/learning-activity'),
      client.get<{ data: StudentEncouragement[] }>('/api/v1/students/me/encouragements'),
    ]).then(([activity, messages]) => {
      if (request === identity.current) setState({ status: 'ready', activity: activity.data, messages: messages.data });
    }).catch((error: unknown) => {
      if (request !== identity.current) return;
      setState({ status: error instanceof ApiError && [401, 403].includes(error.status) ? 'permission'
        : !navigator.onLine ? 'offline' : 'error' });
    });
  }, []);
  useAnalysisRefresh(read);
  useEffect(() => { read(); return () => { identity.current++; }; }, [read]);
  return <section className={styles.section} aria-label="本周学习与家人鼓励">
    <h2>本周的学习足迹</h2>
    {state.status === 'ready' ? <>
      <p>已记录 {state.activity.sessionsThisWeek} 次学习，活跃 {state.activity.activeDays} 天，完成 {state.activity.completedSessionsThisWeek} 个课时。</p>
      <p className={styles.muted}>本周学习时长估算为 {state.activity.minutesThisWeek} 分钟。根据相邻学习活动间隔计算，每段最多计 5 分钟。一次记录无法确定持续时间。</p>
      <h3>家人的鼓励</h3>
      {state.messages.length ? <ul className={styles.recentList}>{state.messages.map(message => <li key={message.id}><span className={styles.recordDot} aria-hidden="true" /><div>
        <strong>{message.senderDisplayName}</strong><p>{message.message}</p><time dateTime={message.sentAt}>{new Date(message.sentAt).toLocaleDateString('zh-CN')}</time>
      </div></li>)}</ul> : <p className={styles.muted}>家人发送的鼓励会保存在这里。</p>}
    </> : <p role="status">{state.status === 'loading' ? '正在读取学习记录与家庭消息…'
      : state.status === 'permission' ? '请使用本人的学生账号查看。'
      : state.status === 'offline' ? '网络已断开，恢复连接后可以重试。' : '学习记录与家庭消息暂时无法读取。'}
      {state.status !== 'loading' && state.status !== 'permission' && <button type="button" className={styles.retry} onClick={read}>重新读取</button>}</p>}
  </section>;
}
