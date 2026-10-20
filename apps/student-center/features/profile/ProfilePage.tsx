'use client';

import { OfflineBanner, SectionCard } from '@qitu/ui';
import { useCallback, useEffect, useState } from 'react';
import { DeviceManagement } from './DeviceManagement';
import { loadStudentProfile, ProfileOfflineError, ProfilePermissionError } from './api';
import type { StudentProfileProjection } from './types';
import { AnalysisStatus } from '../growth/components/AnalysisStatus';
import { useCurrentUser } from '@qitu/auth';

type PageState =
  | { status: 'loading' }
  | { status: 'ready'; data: StudentProfileProjection }
  | { status: 'empty'; data: StudentProfileProjection }
  | { status: 'offline'; data: StudentProfileProjection | null }
  | { status: 'permission' }
  | { status: 'error'; message: string };

function formatDate(value: string | null): string {
  if (!value) return '暂无更新时间';
  return new Intl.DateTimeFormat('zh-CN', { month: 'short', day: 'numeric' }).format(new Date(value));
}

function ListBlock({ title, values, empty }: { title: string; values: string[]; empty: string }) {
  return (
    <div className="qitu-profile-list-block">
      <h3>{title}</h3>
      {values.length === 0 ? <p className="qitu-profile-muted">{empty}</p> : (
        <div className="qitu-profile-chip-list">
          {values.map((value) => <span className="qitu-profile-chip" key={value}>{value}</span>)}
        </div>
      )}
    </div>
  );
}

export function ProfilePage() {
  const [state, setState] = useState<PageState>({ status: 'loading' });
  const [reloadToken, setReloadToken] = useState(0);

  const reload = useCallback(() => setReloadToken((token) => token + 1), []);

  useEffect(() => {
    let cancelled = false;
    void loadStudentProfile().then((data) => {
      if (cancelled) return;
      const hasContent = data.strengths.length + data.interests.length + data.preferences.length > 0
        || Boolean(data.priorKnowledge || data.targetLevel || data.timeBudgetMinutesPerWeek !== null)
        || data.recentGrowth.length > 0
        || Boolean(data.trajectory?.studentSummary || data.trajectory?.milestones.length || data.trajectory?.strengths.length);
      setState({ status: hasContent ? 'ready' : 'empty', data });
    }).catch((error: unknown) => {
      if (cancelled) return;
      if (error instanceof ProfilePermissionError) setState({ status: 'permission' });
      else if (error instanceof ProfileOfflineError) setState({ status: 'offline', data: null });
      else setState({ status: 'error', message: error instanceof Error ? error.message : '个人画像暂时无法加载' });
    });
    return () => { cancelled = true; };
  }, [reloadToken]);

  useEffect(() => {
    const offline = () => setState((current) => ({ status: 'offline', data: current.status === 'ready' || current.status === 'empty' ? current.data : null }));
    const online = () => reload();
    window.addEventListener('offline', offline);
    window.addEventListener('online', online);
    return () => { window.removeEventListener('offline', offline); window.removeEventListener('online', online); };
  }, [reload]);

  if (state.status === 'loading') return <div className="qitu-profile-page"><SectionCard title="正在读取你的学习画像"><p className="qitu-profile-muted">正在读取已确认的画像与成长结果……</p></SectionCard></div>;
  if (state.status === 'permission') return <div className="qitu-profile-page"><SectionCard title="无法查看个人画像"><p>当前账号没有查看个人画像的权限。</p></SectionCard></div>;
  if (state.status === 'error') return <div className="qitu-profile-page"><SectionCard title="个人画像加载失败"><p>{state.message}</p><button type="button" className="qitu-button qitu-button-primary" onClick={reload}>重新加载</button></SectionCard></div>;

  if (state.status === 'offline') {
    const data = state.data;
    return <div className="qitu-profile-page"><OfflineBanner readOnly onRetry={reload} />{data ? <ProfileContent data={data} /> : <SectionCard title="暂时离线"><p className="qitu-profile-muted">恢复网络后再查看已确认的个人画像。</p></SectionCard>}</div>;
  }
  const data = state.data;
  return <div className="qitu-profile-page"><ProfileContent data={data} />{state.status === 'empty' ? <SectionCard title="画像正在形成"><p className="qitu-profile-muted">目前还没有足够的已确认证据。完成项目、提交作品或反思后，画像专家会继续整理。</p></SectionCard> : null}</div>;
}

function ProfileContent({ data }: { data: StudentProfileProjection }) {
  const user = useCurrentUser();
  return (
    <>
      {data.freshness === 'unavailable' ? (
        <SectionCard title="专家画像尚未确认">
          <p className="qitu-profile-muted">聊聊你的兴趣、完成一次探究或分享反思，专任助手会依据学习记录继续整理。</p>
        </SectionCard>
      ) : null}
      <div className="qitu-profile-hero-card">
        <div className="qitu-profile-hero-avatar-wrap"><div className="qitu-profile-hero-avatar">我</div><span className="qitu-profile-level-badge">学习画像</span></div>
        <div className="qitu-profile-hero-meta">
          <div className="qitu-profile-hero-title-row"><h1>{user?.displayName ?? '我'}的学习画像</h1><span className="qitu-profile-school-tag">版本 {data.version || '待确认'}</span></div>
          <p className="qitu-profile-hero-motto">这里展示画像专家根据已确认学习证据整理出的当前状态，不是固定标签，也不是成绩排名。</p>
          <div className="qitu-profile-stats-row">
            <div className="qitu-profile-stat-item"><span className="qitu-stat-label">兴趣线索</span><strong className="qitu-stat-value">{data.interests.length}</strong></div>
            <div className="qitu-profile-stat-item"><span className="qitu-stat-label">已识别优势</span><strong className="qitu-stat-value">{data.strengths.length}</strong></div>
            <div className="qitu-profile-stat-item"><span className="qitu-stat-label">作品与掌握记录</span><strong className="qitu-stat-value">{data.summary.artifactsPublished + data.summary.objectivesMastered}</strong></div>
            <div className="qitu-profile-stat-item"><span className="qitu-stat-label">最近更新</span><strong className="qitu-stat-value">{formatDate(data.updatedAt)}</strong></div>
          </div>
        </div>
      </div>
      <div className="qitu-profile-content-grid">
        <div className="qitu-profile-col">
          <SectionCard title="专家整理出的学习特征">
            <AnalysisStatus analysis={data.analysis} />
            <ListBlock title="我的优势" values={data.strengths} empty="暂未形成稳定结论" />
            <ListBlock title="我感兴趣的方向" values={data.interests} empty="完成更多探索后会逐步出现" />
            <ListBlock title="适合我的学习方式" values={data.preferences} empty="暂未记录学习偏好" />
          </SectionCard>
          <SectionCard title="接下来可以继续思考">
            {data.nextQuestions.length === 0 ? <p className="qitu-profile-muted">暂无待探索问题。</p> : <ol className="qitu-profile-question-list">{data.nextQuestions.map((question) => <li key={question}>{question}</li>)}</ol>}
          </SectionCard>
        </div>
        <div className="qitu-profile-col">
          <SectionCard title="最近的成长证据">
            {data.recentGrowth.length === 0 ? <p className="qitu-profile-muted">还没有可展示的成长记录。</p> : <div className="qitu-profile-recent-growth">{data.recentGrowth.map((entry) => <div className="qitu-profile-growth-item" key={entry.id}><span>{formatDate(entry.occurredAt)}</span><strong>{entry.title}</strong><p>{entry.summaryStudent}</p></div>)}</div>}
          </SectionCard>
          <SectionCard title="成长轨迹专家的最新归纳">
            <AnalysisStatus analysis={data.growthAnalysis} />
            {data.trajectory === null ? <p className="qitu-profile-muted">成长轨迹专家还没有返回已确认的阶段总结。</p> : (
              <>
                <p className="qitu-profile-trajectory-summary">{data.trajectory.studentSummary ?? '已形成阶段性成长记录。'}</p>
                <ListBlock title="已识别的里程碑" values={data.trajectory.milestones} empty="暂无里程碑" />
                <ListBlock title="成长中反复出现的优势" values={data.trajectory.strengths} empty="暂无稳定优势结论" />
                <ListBlock title="下一阶段可探索的问题" values={data.trajectory.nextQuestions} empty="暂无后续问题" />
                <small>结论把握：{data.trajectory.confidence === 'high' ? '较充分' : data.trajectory.confidence === 'medium' ? '仍需观察' : data.trajectory.confidence === 'low' ? '初步线索' : '待确认'} · 版本 {data.trajectory.version || '待确认'}</small>
              </>
            )}
          </SectionCard>
          <SectionCard title="数据来源">
            <p className="qitu-profile-muted">个人画像由画像分析专家整理，成长记录由成长轨迹专家整理。页面只展示已返回的服务端投影，不把待审核候选当成事实。</p>
            <small>画像与成长由平台配置的专任助手整理，内容随新的学习证据更新。</small>
          </SectionCard>
        </div>
      </div>
      <DeviceManagement />
    </>
  );
}
