'use client';
import { ResizablePanels } from '@qitu/ui';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Badge, Button, ProgressBar, VisualAsset, SectionCard } from '@qitu/ui';
import {
  parentApi,
  ParentOfflineError,
  ParentPermissionError,
  type ChildRef,
  type ParentHomePageData,
} from './parentApi';
import { ChildPicker, DataState, PageFrame } from './ParentDataPage';
import { formatShortDate } from './parentFormat';

import { ProjectVisual } from './ProjectVisual';

const KPI_CONFIG: Record<string, { icon: string; tone: string; unitHint?: string }> = {
  weekly_sessions: { icon: '📅', tone: 'blue', unitHint: '学习频次' },
  weekly_minutes: { icon: '⏱️', tone: 'teal', unitHint: '探究投入' },
  current_progress: { icon: '🎯', tone: 'violet', unitHint: '里程碑推进' },
  streak: { icon: '🔥', tone: 'amber', unitHint: '习惯保持' },
};

export default function HomePage() {
  const [children, setChildren] = useState<ChildRef[]>([]);
  const [childId, setChildId] = useState('');
  const [data, setData] = useState<ParentHomePageData | null>(null);
  const [state, setState] = useState('loading');
  const [copiedQuestion, setCopiedQuestion] = useState(false);
  const latestLoad = useRef(0);

  const load = useCallback((id: string) => {
    const requestId = ++latestLoad.current;
    setData(null);
    setState('loading');
    void parentApi
      .home(id)
      .then((r) => {
        if (requestId !== latestLoad.current) return;
        setData(r.data);
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
        if (id) load(id);
        else setState('empty');
      })
      .catch(() => setState('error'));
  }, [load]);

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
        <VisualAsset assetId="support-family-v1" size={48} />
        <div className="home-child">
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

            {!data.currentProject ? (
              <section className="empty-project">
                <h2>{data.hasAnyProject ? '当前项目已告一段落' : '还没有正式学习项目'}</h2>
                <p>{data.hasAnyProject ? '可以到学习进展中回看孩子保存的成果与成长记录。' : '孩子确认学习意图后，项目进度会显示在这里。'}</p>
              </section>
            ) : (
              <ResizablePanels storageKey="parent-home-project" initialSizes={[62, 38]} minWidths={[360, 280]} className="home-grid" labels={['当前项目', '关注提醒']}>
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
                        <h2>{normalizeProjectTitle(data.currentProject?.title)}</h2>
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
                <span className="fact-icon"><VisualAsset assetId="growth-milestone-v1" size={22} /></span>
                          <div>
                            <small>今日任务</small>
                            <span>{data.currentProject?.todayTask ?? '暂无记录'}</span>
                          </div>
                        </div>
                        <div className="fact-item">
                          <span className="fact-icon"><VisualAsset assetId="growth-artifact-v1" size={24} /></span>
                          <div>
                            <small>最近完成</small>
                            <span>{data.currentProject?.lastCompleted ?? '暂无记录'}</span>
                          </div>
                        </div>
                        <div className="fact-item">
                <span className="fact-icon"><VisualAsset assetId="activity-reflection-v1" size={22} /></span>
                          <div>
                            <small>下一步计划</small>
                            <span>{data.currentProject?.nextStep ?? '暂无记录'}</span>
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
                          <strong>暂无已确认的关注提醒</strong>
                          <p>目前没有可展示的提醒。您仍可以主动和孩子聊聊，或联系班主任了解近况。</p>
                        </div>
                      </div>
                    )}
                    {data.suggestedQuestion ? (
                      <div className="question-box">
                        <div className="question-box-head">
                          <span className="question-icon"><VisualAsset assetId="subject-interdisciplinary-v1" size={24} /></span>
                          <strong>餐桌探究对话 · 您可以这样问孩子</strong>
                        </div>
                        <blockquote className="question-content">
                          “{data.suggestedQuestion.text}”
                        </blockquote>
                        <div className="question-actions">
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="btn-copy-question"
                            onClick={copySuggestedQuestion}
                          >
                            {copiedQuestion ? '✓ 已复制到剪贴板' : '📋 复制提问建议'}
                          </Button>
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
              </ResizablePanels>
            )}

            {data.hasAnyProject ? (
              <ResizablePanels storageKey="parent-home-growth" initialSizes={[56, 44]} minWidths={[320, 280]} className="home-grid lower">
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
                          <p className="summary-empty">暂无已确认的本周摘要</p>
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
                        <Link href={{ pathname: '/progress', query: { childId, artifactRef: a.artifactRef } }} className="artifact-tile" key={a.artifactRef}>
                      <div className="artifact-icon-wrap"><VisualAsset assetId="growth-artifact-v1" size={40} /></div>
                          <span className="artifact-title">{a.title}</span>
                          <small className="artifact-date">{formatShortDate(a.createdAt)}</small>
                        </Link>
                      ))}
                    </div>
                  ) : (
                    <p className="empty-inline">孩子发布第一件作品后，这里会显示成果。</p>
                  )}
                </SectionCard>
              </ResizablePanels>
            ) : null}
          </>
        ) : null}
      </DataState>
    </PageFrame>
  );
}
