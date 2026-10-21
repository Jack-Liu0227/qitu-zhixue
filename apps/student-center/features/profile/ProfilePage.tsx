'use client';

import { OfflineBanner, SectionCard } from '@qitu/ui';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useCurrentUser } from '@qitu/auth';
import { StudentLink } from '../../components/student-link';
import { DeviceManagement } from './DeviceManagement';
import { CompetencyRadar } from './CompetencyRadar';
import { loadStudentProfile, ProfileOfflineError, ProfilePermissionError } from './api';
import type { StudentProfileProjection } from './types';
import { AnalysisStatus } from '../growth/components/AnalysisStatus';
import { useAnalysisRefresh } from '../growth/useAnalysisRefresh';
import styles from './Profile.module.css';

type PageState =
  | { status: 'loading' }
  | { status: 'ready'; data: StudentProfileProjection }
  | { status: 'offline'; data: StudentProfileProjection | null }
  | { status: 'permission' }
  | { status: 'error'; data: StudentProfileProjection | null };

function formatDate(value: string | null): string {
  const date = value ? new Date(value) : null;
  return date && Number.isFinite(date.getTime())
    ? new Intl.DateTimeFormat('zh-CN', { month: 'short', day: 'numeric' }).format(date) : '暂无更新时间';
}

function ListBlock({ title, values }: { title: string; values: readonly string[] }) {
  if (!values.length) return null;
  return <div className={styles.listBlock}><h3>{title}</h3><div className={styles.chips}>
    {values.map((value) => <span className={styles.chip} key={value}>{value}</span>)}
  </div></div>;
}

export function ProfilePage() {
  const [state, setState] = useState<PageState>({ status: 'loading' });
  const [reloadToken, setReloadToken] = useState(0);
  const identity = useRef(0);
  const lastData = useRef<StudentProfileProjection | null>(null);
  const reload = useCallback(() => setReloadToken((token) => token + 1), []);
  useAnalysisRefresh(reload);

  useEffect(() => {
    const requestId = ++identity.current;
    void loadStudentProfile().then((data) => {
      if (requestId !== identity.current) return;
      lastData.current = data;
      setState({ status: 'ready', data });
    }).catch((error: unknown) => {
      if (requestId !== identity.current) return;
      if (error instanceof ProfilePermissionError) {
        lastData.current = null;
        setState({ status: 'permission' });
      } else if (error instanceof ProfileOfflineError) setState({ status: 'offline', data: lastData.current });
      else setState({ status: 'error', data: lastData.current });
    });
    return () => { identity.current++; };
  }, [reloadToken]);

  useEffect(() => {
    const offline = () => { identity.current++; setState({ status: 'offline', data: lastData.current }); };
    window.addEventListener('offline', offline);
    window.addEventListener('online', reload);
    return () => { window.removeEventListener('offline', offline); window.removeEventListener('online', reload); };
  }, [reload]);

  const pageClass = `qitu-profile-page ${styles.page}`;
  if (state.status === 'loading') return <div className={pageClass}><div className={styles.loading} role="status" aria-live="polite"><h1>正在打开你的学习画像</h1><p>读取已确认的学习记录与六维观察状态。</p></div></div>;
  if (state.status === 'permission') return <div className={pageClass}><SectionCard title="暂时无法查看学习画像"><p>请使用自己的学生账号登录后再查看。</p></SectionCard></div>;
  if (state.status === 'error' && !state.data) return <div className={pageClass}><SectionCard title="学习画像暂时没有加载出来"><p>学习记录仍会保留，可以稍后重新读取。</p><button type="button" className="qitu-button qitu-button-primary" onClick={reload}>重新加载</button></SectionCard></div>;
  if (state.status === 'offline' && !state.data) return <div className={pageClass}><OfflineBanner readOnly onRetry={reload} /><SectionCard title="网络暂时断开"><p>连接网络后，就可以查看已确认的画像与学习记录。</p></SectionCard></div>;
  const data = state.data;
  return <div className={pageClass}>
    {state.status === 'offline' && <OfflineBanner readOnly onRetry={reload} />}
    {state.status === 'error' && <p className={styles.notice} role="alert">暂时无法更新，正在显示上次读取的学习画像。<button type="button" className={styles.retry} onClick={reload}>重新读取</button></p>}
    {data && <ProfileContent data={data} />}
  </div>;
}

function ProfileContent({ data }: { data: StudentProfileProjection }) {
  const user = useCurrentUser();
  const hasInterests = data.interests.length + data.preferences.length + data.strengths.length > 0;
  return <>
    <header className={styles.pageHeader}>
      <div><h1>我的学习画像</h1><p>{user?.displayName ? `${user.displayName}，` : ''}每一点变化，都有学习证据。</p></div>
      <details className={styles.help}><summary>了解六维画像</summary><p>六个维度帮助你回看探究过程。只有经过确认的评价才会显示在图中；待观察不代表零分。兴趣、学习记录和项目数量不会直接变成能力等级。</p></details>
    </header>
    <CompetencyRadar overview={data.competencyOverview ?? null} />
    <div className={styles.supportGrid}>
      <section className={styles.section} aria-labelledby="profile-interests-title">
        <div className={styles.sectionHeader}><h2 id="profile-interests-title">我的兴趣与学习方式</h2><StudentLink className={styles.textLink} href="/student/inspiration">去探索 →</StudentLink></div>
        <AnalysisStatus analysis={data.analysis} />
        {hasInterests ? <>
          <ListBlock title="我感兴趣的方向" values={data.interests} />
          <ListBlock title="适合我的学习方式" values={data.preferences} />
          <ListBlock title="学习中已确认的优势" values={data.strengths} />
        </> : <div className={styles.emptyNote}><strong>从一个感兴趣的问题开始</strong><p>在探索中说出你的想法和偏好，已确认的兴趣与学习方式会出现在这里。</p><StudentLink href="/student/inspiration" className={styles.textLink}>寻找一个想探究的问题 →</StudentLink></div>}
        {data.nextQuestions.length > 0 && <div className={styles.trajectory}><h3>继续探究的问题</h3><ol className={styles.questions}>{data.nextQuestions.map((question) => <li key={question}>{question}</li>)}</ol></div>}
        {(data.priorKnowledge || data.targetLevel || data.timeBudgetMinutesPerWeek !== null) && <div className={styles.trajectory}><h3>我的学习安排</h3>
          {data.priorKnowledge && <p>已有基础：{data.priorKnowledge}</p>}{data.targetLevel && <p>学习目标：{data.targetLevel}</p>}
          {data.timeBudgetMinutesPerWeek !== null && <p>每周计划投入 {data.timeBudgetMinutesPerWeek} 分钟。</p>}</div>}
        {data.updatedAt && <p className={styles.muted}>最近更新于 {formatDate(data.updatedAt)}</p>}
      </section>
      <section className={styles.section} aria-labelledby="profile-growth-title">
        <div className={styles.sectionHeader}><h2 id="profile-growth-title">成长中的变化</h2><StudentLink className={styles.textLink} href="/student/growth">查看成长轨迹 →</StudentLink></div>
        {data.recentGrowth.length > 0 ? <>
          <ul className={styles.recentList}>{data.recentGrowth.map((entry) => <li key={entry.id}><span className={styles.recordDot} aria-hidden="true" /><div>
            <time dateTime={entry.occurredAt}>{formatDate(entry.occurredAt)}</time><strong>{entry.title}</strong><p>{entry.summaryStudent}</p>
          </div></li>)}</ul>
          <p className={styles.muted}>这些记录是成长的线索，出现记录本身不代表维度已被评价。</p>
        </> : <div className={styles.emptyNote}><strong>让一次探究成为可回看的经历</strong><p>已确认的项目进展、作品与反思会记录在这里。记录本身不会直接变成六维评价。</p><StudentLink href="/student/inspiration" className={styles.textLink}>开始一次探索 →</StudentLink></div>}
        <div className={styles.trajectory}><h3>最近的成长归纳</h3><AnalysisStatus analysis={data.growthAnalysis} />
          {data.trajectory ? <><p>{data.trajectory.studentSummary ?? '已有已确认的阶段记录。'}</p>
            <ListBlock title="已记录的里程碑" values={data.trajectory.milestones} />
            <ListBlock title="成长中发现的优势" values={data.trajectory.strengths} />
            {data.trajectory.nextQuestions.length > 0 && <ol className={styles.questions}>{data.trajectory.nextQuestions.map((question) => <li key={question}>{question}</li>)}</ol>}
          </> : <p className={styles.muted}>目前还没有已确认的成长归纳。已有记录可以在成长轨迹中继续查看。</p>}
        </div>
      </section>
    </div>
    <DeviceManagement />
  </>;
}
