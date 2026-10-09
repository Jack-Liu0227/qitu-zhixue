'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Badge, Button, ProgressBar, SectionCard } from '@qitu/ui';
import { useCurrentUser } from '@qitu/auth';
import {
  parentApi,
  ParentOfflineError,
  ParentPermissionError,
  type ChildRef,
  type ParentHomePageData,
} from './parentApi';
import { ChildPicker, DataState, HeroMascot, PageFrame } from './ParentDataPage';
import { formatShortDate, greeting } from './parentFormat';

/**
 * 首页（参考稿 `首页.png`）。
 *
 * 称呼与问候都取当前登录家长和当前时刻，不写死在文案里——演示库里有两个
 * 家长账号（演示家长 / 演示家长二），写死会让第二个账号看到别人的名字。
 */
import { ProjectVisual } from './ProjectVisual';

const KPI_CONFIG: Record<string, { icon: string; tone: string; unitHint?: string }> = {
  weekly_sessions: { icon: '📅', tone: 'blue', unitHint: '学习频次' },
  weekly_minutes: { icon: '⏱️', tone: 'teal', unitHint: '探究投入' },
  current_progress: { icon: '🎯', tone: 'violet', unitHint: '里程碑推进' },
  streak: { icon: '🔥', tone: 'amber', unitHint: '习惯保持' },
};

export default function HomePage() {
  const user = useCurrentUser();
  const [children, setChildren] = useState<ChildRef[]>([]);
  const [childId, setChildId] = useState('');
  const [data, setData] = useState<ParentHomePageData | null>(null);
  const [state, setState] = useState('loading');
  const [copiedQuestion, setCopiedQuestion] = useState(false);

  const load = useCallback((id: string) => {
    setState('loading');
    void parentApi
      .home(id)
      .then((r) => {
        setData(r.data);
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

  const childName = data?.childDisplayName ?? '';
  const parentName = user?.displayName ?? user?.email ?? '家长';

  const copySuggestedQuestion = () => {
    if (!data?.suggestedQuestion?.text) return;
    navigator.clipboard?.writeText(data.suggestedQuestion.text).then(() => {
      setCopiedQuestion(true);
      setTimeout(() => setCopiedQuestion(false), 2000);
    }).catch(() => {});
  };

  return (
    <PageFrame title="首页" subtitle="了解今天的学习状态，在需要时给予恰当支持" source={data?.dataSource}>
      <div className="home-welcome">
        <div className="welcome-text-wrap">
          <span className="welcome-badge">今日学情速览</span>
          <h2>
            {greeting()}
            {parentName ? `，${parentName}` : ''}
          </h2>
          <p>
            {childName
              ? `了解 ${childName} 今天的探究学习状态，在关键节点给予鼓励与支持`
              : '了解孩子今天的探究学习状态，在关键节点给予鼓励与支持'}
          </p>
        </div>
        <div className="home-child">
          <HeroMascot />
          <span className="home-child-label">当前关注孩子</span>
          <ChildPicker
            children={children}
            value={childId}
            onChange={(id) => {
              setChildId(id);
              load(id);
            }}
          />
        </div>
      </div>

      <DataState state={{ status: state }} reload={() => childId && load(childId)} emptyTitle="还没有绑定孩子">
        {data ? (
          <>
            <div className="kpi-grid">
              {data.kpis.map((k) => {
                const conf = KPI_CONFIG[k.id] ?? { icon: '📊', tone: 'blue', unitHint: '' };
                return (
                  <article className={`kpi-card tone-${conf.tone}`} key={k.id}>
                    <div className="kpi-header">
                      <span className="kpi-label">{k.label}</span>
                      <span className="kpi-icon-pill" aria-hidden="true">{conf.icon}</span>
                    </div>
                    <strong className="kpi-value">{k.value}</strong>
                    <div className="kpi-footer">
                      <small className="kpi-hint">
                        {k.hint ?? conf.unitHint}
                        {k.trend === 'up' ? (
                          <span className="trend-mark up" title="较此前有所提升">↑</span>
                        ) : k.trend === 'down' ? (
                          <span className="trend-mark down" title="较此前有所调整">↓</span>
                        ) : null}
                      </small>
                    </div>
                  </article>
                );
              })}
            </div>

            {!data.hasAnyProject ? (
              <section className="empty-project">
                <h2>还没有正式学习项目</h2>
                <p>孩子确认学习意图后，项目进度会显示在这里。</p>
              </section>
            ) : (
              <div className="home-grid">
                <SectionCard title="当前学习项目">
                  <div className="project-panel">
                    <div className="project-visual-wrapper">
                      <ProjectVisual />
                      {data.currentProject?.stageLabel && (
                        <span className="floating-stage-tag">{data.currentProject.stageLabel}</span>
                      )}
                    </div>
                    <div className="project-details">
                      <div className="project-title-row">
                        <h2>{data.currentProject?.title}</h2>
                        {data.currentProject && (
                          <Badge tone="primary">{data.currentProject.stageLabel}</Badge>
                        )}
                      </div>
                      <p className="project-summary-text">{data.currentProject?.summary}</p>
                      <div className="project-progress-box">
                        <ProgressBar
                          percent={data.currentProject?.progressPercent ?? 0}
                          label={`项目进度 ${data.currentProject?.progressPercent ?? 0}%`}
                        />
                      </div>
                      <div className="project-facts-grid">
                        <div className="fact-item">
                          <span className="fact-icon">📅</span>
                          <div>
                            <small>今日任务</small>
                            <span>{data.currentProject?.todayTask ?? '自主探究推进中'}</span>
                          </div>
                        </div>
                        <div className="fact-item">
                          <span className="fact-icon">🏆</span>
                          <div>
                            <small>最近完成</small>
                            <span>{data.currentProject?.lastCompleted ?? '阶段性成果'}</span>
                          </div>
                        </div>
                        <div className="fact-item">
                          <span className="fact-icon">🧭</span>
                          <div>
                            <small>下一步计划</small>
                            <span>{data.currentProject?.nextStep ?? '深化实验验证'}</span>
                          </div>
                        </div>
                      </div>
                      <Link className="qitu-button qitu-button-primary project-cta" href="/progress">
                        查看完整项目进度 →
                      </Link>
                    </div>
                  </div>
                </SectionCard>

                <SectionCard title="需要您关注">
                  <div className="attention-list">
                    {data.attention.length ? (
                      data.attention.map((item) => (
                        <div className={`attention-item ${item.level}`} key={item.id}>
                          <div className="attention-item-header">
                            <span className="attention-dot" />
                            <strong>{item.title}</strong>
                          </div>
                          <p>{item.detail}</p>
                        </div>
                      ))
                    ) : (
                      <div className="attention-ok-card">
                        <span className="ok-icon">✨</span>
                        <div>
                          <strong>状态良好</strong>
                          <p>孩子目前探究节奏平稳，没有需要特别协助的问题。</p>
                        </div>
                      </div>
                    )}
                    {data.suggestedQuestion ? (
                      <div className="question-box">
                        <div className="question-box-head">
                          <span className="question-icon">💡</span>
                          <strong>餐桌探究对话 · 您可以这样问孩子</strong>
                        </div>
                        <blockquote className="question-content">
                          “{data.suggestedQuestion.text}”
                        </blockquote>
                        <div className="question-actions">
                          <button
                            type="button"
                            className="btn-copy-question"
                            onClick={copySuggestedQuestion}
                          >
                            {copiedQuestion ? '✓ 已复制到剪贴板' : '📋 复制提问建议'}
                          </button>
                        </div>
                      </div>
                    ) : null}
                    <div className="attention-actions">
                      <Link className="qitu-button qitu-button-secondary" href="/progress">
                        查看详情
                      </Link>
                      {data.currentProject ? (
                        <Button
                          variant="ghost"
                          onClick={() => window.dispatchEvent(new CustomEvent('qitu:open-parent-feedback'))}
                        >
                          我有疑问
                        </Button>
                      ) : null}
                    </div>
                  </div>
                </SectionCard>
              </div>
            )}

            {data.hasAnyProject ? (
              <div className="home-grid lower">
                <SectionCard title="本周成长摘要">
                  <div className="summary-columns">
                    {[
                      { label: '完成了什么', icon: '🚀', items: data.weeklySummary.completed },
                      { label: '值得肯定', icon: '⭐', items: data.weeklySummary.praised },
                      { label: '正在成长', icon: '🌱', items: data.weeklySummary.growing },
                    ].map(({ label, icon, items }) => (
                      <div className="summary-box" key={label}>
                        <h3>
                          <span aria-hidden="true">{icon}</span> {label}
                        </h3>
                        {items.length ? (
                          <ul className="summary-items">
                            {items.map((i) => (
                              <li key={i}>{i}</li>
                            ))}
                          </ul>
                        ) : (
                          <p className="summary-empty">保持节奏，蓄势待发</p>
                        )}
                      </div>
                    ))}
                  </div>
                </SectionCard>
                <SectionCard
                  title="最近成果"
                  action={<Link href="/progress">查看全部作品 →</Link>}
                >
                  {data.recentArtifacts.length ? (
                    <div className="artifact-grid">
                      {data.recentArtifacts.map((a) => (
                        <Link href="/progress" className="artifact-tile" key={a.artifactRef}>
                          <div className="artifact-icon-wrap">🎨</div>
                          <span className="artifact-title">{a.title}</span>
                          <small className="artifact-date">{formatShortDate(a.createdAt)}</small>
                        </Link>
                      ))}
                    </div>
                  ) : (
                    <p className="empty-inline">孩子发布第一件作品后，这里会显示成果。</p>
                  )}
                </SectionCard>
              </div>
            ) : null}
          </>
        ) : null}
      </DataState>
    </PageFrame>
  );
}
