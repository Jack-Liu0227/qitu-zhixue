'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Badge, Button, ProgressBar, SectionCard, TagChips } from '@qitu/ui';
import type {
  ParentVersionStep,
  ParentWorkGrowth,
  ParentWorkItem,
  ParentWorkStatus,
} from '@qitu/contracts';
import {
  parentApi,
  ParentOfflineError,
  ParentPermissionError,
  type ChildRef,
  type ParentProgressPageData,
} from '../../../features/parentApi';
import { ChildPicker, DataState, PageFrame } from '../../../features/ParentDataPage';
import { ParentGrowthPage } from '../../../features/growth';
import { ProjectVisual } from '../../../features/ProjectVisual';
import { StageTimeline, type StageTimelineStep } from '../../../features/StageTimeline';
import { formatShortDate, parentWorkStatusLabel } from '../../../features/parentFormat';

/**
 * 学习进展（参考稿 `学习进展.png`）。
 *
 * 三个 Tab 各自是**真的**不同内容，不是同一份列表换标题：
 *  - 项目进度：以当前作品为中心，看它背后的成长与版本演进
 *  - 成长记录：直接复用学生端同一份服务端成长记录（`ParentGrowthPage`）
 *  - 作品成果：全部作品的画廊视图，带状态筛选与搜索；焦点作品带
 *    「作品背后的成长 / 版本成长 / 给孩子一句鼓励」，其余作品列在下方
 */

type Tab = 'project' | 'growth' | 'works';
type StatusFilter = ParentWorkStatus | 'all';

const TABS: ReadonlyArray<{ id: Tab; label: string }> = [
  { id: 'project', label: '项目进度' },
  { id: 'growth', label: '成长记录' },
  { id: 'works', label: '作品成果' },
];

const WORK_TONE: Record<ParentWorkStatus, 'completed' | 'primary' | 'neutral'> = {
  completed: 'completed',
  in_progress: 'primary',
  draft: 'neutral',
};

function FocusWorkCard({
  work,
  onViewProcess,
}: {
  work: ParentWorkItem;
  onViewProcess: () => void;
}) {
  return (
    <article className="work-card">
      <ProjectVisual />
      <div>
        <h2>{work.title}</h2>
        <Badge tone={WORK_TONE[work.status]}>{parentWorkStatusLabel(work.status)}</Badge>
        {work.versionLabel ? (
          <span className="version-label">当前版本：{work.versionLabel}</span>
        ) : null}
        <p>{work.summary}</p>
        <ProgressBar percent={work.progressPercent} label={`项目进度 ${work.progressPercent}%`} />
        <TagChips tags={work.tags} />
        <div className="work-actions">
          <Button variant="secondary" onClick={onViewProcess}>
            查看项目过程
          </Button>
        </div>
      </div>
    </article>
  );
}

function GrowthPanel({ growth }: { growth: ParentWorkGrowth | null }) {
  return (
    <SectionCard title="作品背后的成长">
      {growth ? (
        <>
          {[
            ['孩子独立完成', growth.independently],
            ['AI协助完成', growth.withAiHelp],
            ['下一步计划', growth.nextPlan],
          ].map(([label, items]) => (
            <div className="growth-block" key={String(label)}>
              <h3>{label}</h3>
              {(items as string[]).map((item) => (
                <p key={item}>• {item}</p>
              ))}
            </div>
          ))}
        </>
      ) : (
        <p>暂无成长摘要</p>
      )}
    </SectionCard>
  );
}

function VersionTimelinePanel({ versions }: { versions: ParentVersionStep[] }) {
  const steps: StageTimelineStep[] = versions.map((v, i, arr) => ({
    id: v.id,
    label: v.title,
    detail: formatShortDate(v.at),
    status: i === arr.length - 1 ? 'current' : 'done',
    note: v.note,
  }));
  return (
    <SectionCard title="版本成长">
      {steps.length ? (
        <StageTimeline steps={steps} detailed />
      ) : (
        <p>还没有版本记录。</p>
      )}
    </SectionCard>
  );
}

const PRESET_ENCOURAGEMENTS = [
  '认真修改的过程，比一次就做到完美更重要！',
  '今天独立完成了挑战，为你骄傲！',
  '保持好奇心，遇到困难我们一起想办法！',
  '看到你的专注和探索精神，继续加油！',
] as const;

function EncouragementCard({ childId }: { childId: string }) {
  const [text, setText] = useState('');
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const pending = useRef<{ childId: string; message: string; key: string } | null>(null);

  async function send() {
    const message = text.trim();
    if (message.length === 0 || message.length > 200 || state === 'sending') return;
    setState('sending');
    if (pending.current?.childId !== childId || pending.current.message !== message) {
      pending.current = { childId, message, key: crypto.randomUUID() };
    }
    try {
      await parentApi.post(
        `/api/v1/parent/children/${encodeURIComponent(childId)}/encouragements`,
        { message },
        { idempotencyKey: pending.current.key },
      );
      pending.current = null;
      setState('sent');
      setText('');
    } catch {
      setState('error');
    }
  }

  const selectPreset = (preset: string) => {
    setText(preset);
    if (state !== 'sending') setState('idle');
  };

  return (
    <SectionCard title="给孩子一句鼓励">
      <div className="encourage-presets">
        <span className="presets-label">快捷灵感：</span>
        <div className="presets-chips">
          {PRESET_ENCOURAGEMENTS.map((p) => (
            <button
              type="button"
              className="preset-chip"
              key={p}
              onClick={() => selectPreset(p)}
            >
              {p}
            </button>
          ))}
        </div>
      </div>
      <textarea
        className="encourage-input"
        value={text}
        onChange={(e) => {
          const next = e.target.value;
          setText(next);
          if (pending.current && pending.current.message !== next.trim()) pending.current = null;
          if (state !== 'sending') setState('idle');
        }}
        maxLength={200}
        rows={3}
        placeholder="写下你想对孩子说的话..."
        aria-label="鼓励内容"
      />
      <div className="feedback-actions">
        <small className="char-counter">{text.trim().length} / 200</small>
        <Button
          onClick={send}
          loading={state === 'sending'}
          disabled={text.trim().length === 0 || state === 'sending'}
        >
          {state === 'sending' ? '发送中…' : '发送鼓励'}
        </Button>
      </div>
      {state === 'sent' ? (
        <p className="feedback-done">✓ 鼓励已记录，会在合适的契机呈现给孩子。</p>
      ) : null}
      {state === 'error' ? <p className="inline-error">发送失败，请稍后重试。</p> : null}
    </SectionCard>
  );
}

export default function ProgressPage() {
  const [children, setChildren] = useState<ChildRef[]>([]);
  const [childId, setChildId] = useState('');
  const [data, setData] = useState<ParentProgressPageData | null>(null);
  const [state, setState] = useState('loading');
  const [tab, setTab] = useState<Tab>('project');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [search, setSearch] = useState('');

  const load = useCallback((id: string) => {
    setState('loading');
    void parentApi
      .progress(id)
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

  const works = data?.works ?? [];
  const focus = data?.focusWork ?? null;

  // 其余作品（不含焦点作品），并套用状态筛选与搜索。
  const otherWorks = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return works.filter(
      (w) =>
        w.artifactRef !== focus?.artifactRef &&
        (statusFilter === 'all' || w.status === statusFilter) &&
        (needle.length === 0 ||
          `${w.title} ${w.tags.join(' ')}`.toLowerCase().includes(needle)),
    );
  }, [works, focus, statusFilter, search]);

  // 切孩子时清掉筛选，否则会出现「上一个孩子筛出来的空列表」这种假空状态。
  const selectChild = (id: string) => {
    setChildId(id);
    setStatusFilter('all');
    setSearch('');
    load(id);
  };

  const statusCount = (status: StatusFilter) =>
    status === 'all' ? works.length : works.filter((w) => w.status === status).length;

  return (
    <PageFrame
      title="学习进展"
      subtitle="看见孩子从想法到作品的每一步"
      source={data?.dataSource}
    >
      <div className="progress-head">
        <ChildPicker children={children} value={childId} onChange={selectChild} />
        <div className="tabs">
          {TABS.map((t) => (
            <button
              type="button"
              className={tab === t.id ? 'selected' : ''}
              key={t.id}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <DataState
        state={{ status }}
        reload={() => childId && load(childId)}
        emptyTitle="还没有绑定孩子"
      >
        {tab === 'growth' ? (
          <ParentGrowthPage key={childId} childId={childId || null} />
        ) : tab === 'project' ? (
          focus ? (
            <div className="progress-layout">
              <div className="works-main">
                <FocusWorkCard work={focus} onViewProcess={() => setTab('works')} />
                <VersionTimelinePanel versions={data?.focusVersions ?? []} />
              </div>
              <aside className="progress-side">
                <GrowthPanel growth={data?.focusGrowth ?? null} />
                <EncouragementCard childId={childId} />
              </aside>
            </div>
          ) : (
            <p className="empty-inline">孩子确认学习意图并开始制作后，项目进度会显示在这里。</p>
          )
        ) : (
          <>
            <div className="filter-row">
              <button
                type="button"
                className={statusFilter === 'all' ? 'selected' : ''}
                onClick={() => setStatusFilter('all')}
              >
                全部作品（{statusCount('all')}）
              </button>
              <button
                type="button"
                className={statusFilter === 'in_progress' ? 'selected' : ''}
                onClick={() => setStatusFilter('in_progress')}
              >
                进行中（{statusCount('in_progress')}）
              </button>
              <button
                type="button"
                className={statusFilter === 'completed' ? 'selected' : ''}
                onClick={() => setStatusFilter('completed')}
              >
                已完成（{statusCount('completed')}）
              </button>
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="搜索作品名称、关键词…"
                aria-label="搜索作品"
              />
            </div>

            {focus ? (
              <div className="progress-layout">
                <div className="works-main">
                  <FocusWorkCard work={focus} onViewProcess={() => setTab('project')} />
                  <VersionTimelinePanel versions={data?.focusVersions ?? []} />
                </div>
                <aside className="progress-side">
                  <GrowthPanel growth={data?.focusGrowth ?? null} />
                  <EncouragementCard childId={childId} />
                </aside>
              </div>
            ) : null}

            <div className="work-list">
              {otherWorks.length ? (
                otherWorks.map((work) => (
                  <article className="work-card" key={work.artifactRef}>
                    <ProjectVisual compact />
                    <div>
                      <h2>{work.title}</h2>
                      <Badge tone={WORK_TONE[work.status]}>
                        {parentWorkStatusLabel(work.status)}
                      </Badge>
                      <p>{work.summary}</p>
                      <ProgressBar
                        percent={work.progressPercent}
                        label={`进度 ${work.progressPercent}%`}
                      />
                      <TagChips tags={work.tags} />
                      <small className="work-updated">最近更新：{formatShortDate(work.updatedAt)}</small>
                    </div>
                  </article>
                ))
              ) : (
                <p className="empty-inline">没有符合当前筛选的作品。</p>
              )}
            </div>
          </>
        )}
      </DataState>
    </PageFrame>
  );
}
