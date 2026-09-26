'use client';

import { useCallback, useEffect, useState } from 'react';
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
import { ProjectVisual } from './ProjectVisual';
import { formatShortDate, greeting } from './parentFormat';

/**
 * 首页（参考稿 `首页.png`）。
 *
 * 称呼与问候都取当前登录家长和当前时刻，不写死在文案里——演示库里有两个
 * 家长账号（演示家长 / 演示家长二），写死会让第二个账号看到别人的名字。
 */
export default function HomePage() {
  const user = useCurrentUser();
  const [children, setChildren] = useState<ChildRef[]>([]);
  const [childId, setChildId] = useState('');
  const [data, setData] = useState<ParentHomePageData | null>(null);
  const [state, setState] = useState('loading');
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [feedbackContent, setFeedbackContent] = useState('');
  const [feedbackState, setFeedbackState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');

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

  const submitFeedback = async () => {
    const content = feedbackContent.trim();
    if (
      content.length === 0 ||
      content.length > 500 ||
      !data?.currentProject ||
      feedbackState === 'sending'
    ) {
      return;
    }
    setFeedbackState('sending');
    try {
      await parentApi.post('/api/v1/parent/feedback', {
        source: 'project',
        content,
        messageId: null,
        projectId: data.currentProject.projectId,
      });
      setFeedbackState('sent');
      setFeedbackContent('');
    } catch {
      setFeedbackState('error');
    }
  };

  return (
    <PageFrame title="首页" subtitle="了解今天的学习状态，在需要时给予恰当支持" source={data?.dataSource}>
      <div className="home-welcome">
        <div>
          <h2>
            {greeting()}
            {parentName ? `，${parentName}` : ''}
          </h2>
          <p>
            {childName
              ? `了解${childName}今天的学习状态，在需要时给予恰当支持`
              : '了解孩子今天的学习状态，在需要时给予恰当支持'}
          </p>
        </div>
        <div className="home-child">
          <HeroMascot />
          <span>当前孩子</span>
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
              {data.kpis.map((k) => (
                <article className="kpi-card" key={k.id}>
                  <span>{k.label}</span>
                  <strong>{k.value}</strong>
                  <small>
                    {k.hint ?? '保持良好的学习节奏'}
                    {k.trend === 'up' ? (
                      <span className="trend-mark up">↑</span>
                    ) : k.trend === 'down' ? (
                      <span className="trend-mark down">↓</span>
                    ) : null}
                  </small>
                </article>
              ))}
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
                    <div className="project-placeholder">启途智学</div>
                    <div>
                      <h2>{data.currentProject?.title}</h2>
                      {data.currentProject ? (
                        <Badge tone="primary">{data.currentProject.stageLabel}</Badge>
                      ) : null}
                      <p>{data.currentProject?.summary}</p>
                      <ProgressBar
                        percent={data.currentProject?.progressPercent ?? 0}
                        label={`项目进度 ${data.currentProject?.progressPercent ?? 0}%`}
                      />
                      <div className="project-facts">
                        <span>今日任务：{data.currentProject?.todayTask ?? '暂无'}</span>
                        <span>最近完成：{data.currentProject?.lastCompleted ?? '暂无'}</span>
                        <span>下一步：{data.currentProject?.nextStep ?? '继续尝试'}</span>
                      </div>
                      <a className="qitu-button qitu-button-primary" href="/parent/progress">
                        查看项目进度 →
                      </a>
                    </div>
                  </div>
                </SectionCard>

                <SectionCard title="需要您关注">
                  <div className="attention-list">
                    {data.attention.length ? (
                      data.attention.map((item) => (
                        <div className={`attention-item ${item.level}`} key={item.id}>
                          <strong>{item.title}</strong>
                          <p>{item.detail}</p>
                        </div>
                      ))
                    ) : (
                      <p className="empty-inline">目前没有需要您特别关注的地方。</p>
                    )}
                    {data.suggestedQuestion ? (
                      <div className="question-box">
                        <strong>您可以这样问</strong>
                        <p>{data.suggestedQuestion.text}</p>
                      </div>
                    ) : null}
                    <div className="attention-actions">
                      <a className="qitu-button qitu-button-secondary" href="/parent/progress">
                        查看详情
                      </a>
                      {data.currentProject ? (
                        <Button onClick={() => setFeedbackOpen((v) => !v)}>我有疑问</Button>
                      ) : null}
                    </div>
                    {feedbackOpen ? (
                      <div className="feedback-form">
                        <textarea
                          value={feedbackContent}
                          onChange={(e) => {
                            setFeedbackContent(e.target.value);
                            if (feedbackState !== 'sending') setFeedbackState('idle');
                          }}
                          maxLength={500}
                          rows={3}
                          placeholder="请描述您对当前项目的疑问（1-500 字）…"
                          aria-label="疑问内容"
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
                        </div>
                        {feedbackState === 'sent' ? (
                          <p className="feedback-done">已记录，服务团队会跟进您的问题。</p>
                        ) : null}
                        {feedbackState === 'error' ? (
                          <p className="inline-error">提交失败，请稍后重试。</p>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                </SectionCard>
              </div>
            )}

            {data.hasAnyProject ? (
              <div className="home-grid lower">
                <SectionCard title="本周成长摘要">
                  <div className="summary-columns">
                    {[
                      ['完成了什么', data.weeklySummary.completed],
                      ['值得肯定', data.weeklySummary.praised],
                      ['正在成长', data.weeklySummary.growing],
                    ].map(([label, items]) => (
                      <div key={String(label)}>
                        <h3>{label}</h3>
                        {(items as string[]).length ? (
                          (items as string[]).map((i) => <p key={i}>{i}</p>)
                        ) : (
                          <p>—</p>
                        )}
                      </div>
                    ))}
                  </div>
                </SectionCard>
                <SectionCard
                  title="最近成果"
                  action={<a href="/parent/progress">查看全部作品 →</a>}
                >
                  {data.recentArtifacts.length ? (
                    <div className="artifact-grid">
                      {data.recentArtifacts.map((a) => (
                        <div className="artifact-tile" key={a.artifactRef}>
                          <span>{a.title}</span>
                          <small>{formatShortDate(a.createdAt)}</small>
                        </div>
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
