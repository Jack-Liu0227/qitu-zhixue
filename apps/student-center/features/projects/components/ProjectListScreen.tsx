'use client';

import { useRef, useState } from 'react';
import type { ProjectHistoryPage, ProjectDisplayChange } from '@qitu/contracts';
import { projectsDataSource } from '../data';
import { SkeletonBlock, ResizablePanels } from '@qitu/ui';
import { StudentLink } from '../../../components/student-link';
import { CreateProjectEntry } from './CreateProjectEntry';
import { NextStepCard } from './NextStepCard';
import { ProjectList } from './ProjectList';
import { ProjectSearch } from './ProjectSearch';
import { ProjectTabs } from './ProjectTabs';
import { ScreenState } from './StateViews';
import { useProjectsResource, useProjectNextStep } from '../hooks/useProjectsData';
import type { ScreenScenario } from '../lib/loadable';
import { createIdempotencyKey } from '../lib/idempotency';
import type { ProjectTab, ProjectListItem } from '../types';

export interface ProjectListScreenProps {
  mode?: 'projects' | 'explorations';
  initialTab?: ProjectTab;
  initialQuery?: string;
  /** 五态演示入口；Wave 4 从路由 query 注入。 */
  scenario?: ScreenScenario;
}

/** 正式项目与灵感空间的探索记录共用历史读取、分页和对象操作。 */
export function ProjectListScreen({
  mode = 'projects',
  initialTab = 'active',
  initialQuery = '',
  scenario,
}: ProjectListScreenProps) {
  const explorations = mode === 'explorations';
  const [tab, setTab] = useState<ProjectTab>(explorations ? 'draft' : initialTab === 'done' ? 'done' : 'active');
  const [query, setQuery] = useState(initialQuery);
  const [includeCollected, setIncludeCollected] = useState(false);
  const [cursors, setCursors] = useState<Array<string | undefined>>([undefined]);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState('');
  const [reload, setReload] = useState(0);
  const [selected, setSelected] = useState<string[]>([]);
  const inFlight = useRef(false);
  const writeKeys = useRef(new Map<string,string>());
  const cursor = cursors.at(-1);
  const list = useProjectsResource<ProjectHistoryPage>(async () => {
    if (projectsDataSource.queryProjects) return projectsDataSource.queryProjects({ tab,q:query,includeCollected,cursor });
    const items = await projectsDataSource.listProjects({ tab,q:query });
    return { items:items.map(item => ({ ...item,kind:'project' as const,createdAt:item.createdAt ?? '',lastLearningActivityAt:null,collectedAt:null,isCurrent:item.isCurrent === true })),
      nextCursor:null,counts:{ active:items.length,draft:0,done:0 },revision:'fixture',preferenceVersion:0,currentProjectId:items.find(item => item.isCurrent)?.id ?? null,selectionSource:'none' };
  },[tab,query,includeCollected,cursor,reload],{ scenario,isEmpty:() => false });
  const page = list.state.status === 'ready' || list.state.status === 'offline' ? list.state.data : null;
  const nextStep = useProjectNextStep(page?.currentProjectId ?? undefined,{ scenario });
  const entryKey = (item: Pick<ProjectListItem, 'kind' | 'id'>) => `${item.kind ?? 'project'}:${item.id}`;
  const removeEntries = async (items: Array<Pick<ProjectListItem, 'kind' | 'id' | 'title'>>) => {
    if (!items.length || !projectsDataSource.deleteHistory || inFlight.current) return;
    const includesProject = items.some(item => !item.kind || item.kind === 'project');
    if (!window.confirm(`永久删除所选 ${items.length} 条记录？${includesProject ? '正式项目的计划、对话、作品和相关学习记录将一起删除。' : '探索记录及相关对话将一起删除。'}此操作无法恢复。\n${items.slice(0, 3).map(item => item.title).join('\n')}`)) return;
    inFlight.current = true; setSaving(true); setNotice('');
    let deleted = 0;
    let failure = '';
    try {
      for (const item of items) {
        const fingerprint = `delete:${entryKey(item)}`;
        try {
          const key = writeKeys.current.get(fingerprint) ?? createIdempotencyKey();
          writeKeys.current.set(fingerprint, key);
          await projectsDataSource.deleteHistory(item.kind ?? 'project', item.id, key);
          writeKeys.current.delete(fingerprint); deleted += 1;
        } catch (error) { failure = error instanceof Error ? error.message : '删除失败'; break; }
      }
      setNotice(failure ? `已永久删除 ${deleted} 条，其他记录未确认删除：${failure}` : `已永久删除 ${deleted} 条记录。`);
      setSelected([]); setCursors([undefined]); setReload(value => value + 1);
    } finally { inFlight.current = false; setSaving(false); }
  };
  const change = async (projectId:string | null, input:Omit<ProjectDisplayChange,'expectedVersion'>) => {
    if (!page || !projectsDataSource.changeProjectDisplay || inFlight.current) return;
    inFlight.current = true;
    setSaving(true); setNotice('');
    const fingerprint = JSON.stringify([projectId,input,page.preferenceVersion]);
    try {
      const key = writeKeys.current.get(fingerprint) ?? createIdempotencyKey();
      writeKeys.current.set(fingerprint,key);
      const receipt = await projectsDataSource.changeProjectDisplay(projectId,{ ...input,expectedVersion:page.preferenceVersion },key);
      writeKeys.current.delete(fingerprint);
      setNotice(receipt.superseded ? '其他设备已修改显示偏好，已重新读取。' : '显示偏好已保存。');
      setCursors([undefined]); setReload(value => value + 1);
    } catch (error) { setNotice(error instanceof Error ? error.message : '保存失败，请重试'); }
    finally { inFlight.current = false; setSaving(false); }
  };

  return (
    <div className="qitu-projects-list-screen">
      <div className="qitu-screen-toolbar">
        {explorations ? <h2>探索记录</h2> : <h1>我的项目</h1>}
        {!explorations && <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <StudentLink className="qitu-button" href="/student/growth">查看成长轨迹</StudentLink>
          <CreateProjectEntry />
        </div>}
      </div>
      <div className="qitu-project-filters">
        {!explorations && <ProjectTabs active={tab} onChange={value => { setTab(value); setSelected([]); setCursors([undefined]); }} />}
        <ProjectSearch value={query} placeholder={explorations ? '搜索探索记录' : '搜索我的项目'} onChange={value => { setQuery(value); setSelected([]); setCursors([undefined]); }} />
        {!explorations && <label className="qitu-project-collected"><input type="checkbox" checked={includeCollected} onChange={event => { setIncludeCollected(event.target.checked); setCursors([undefined]); }} />包含已收纳</label>}
      </div>
      <p className="qitu-project-history-hint">{explorations ? '继续之前的兴趣讨论，或查看待确认的学习计划。明确确认后，项目会出现在“我的项目”中。' : '这里保留你已确认的项目。收纳可保留记录，永久删除会清除项目及相关学习记录。'}</p>
      {page ? <p>{explorations ? `探索记录 ${page.counts.draft}` : `进行中 ${page.counts.active} · 已完成 ${page.counts.done}`}</p> : null}
      {notice ? <p role="status">{notice}</p> : null}
      <ScreenState
        state={list.state}
        onRetry={() => { setCursors([undefined]); list.retry(); }}
        retrying={list.retrying}
        loading={<SkeletonBlock lines={6} />}
        emptyTitle="还没有项目"
        emptyDescription="去灵感空间找一找，想做的事会变成正式项目。"
        emptyAction={<CreateProjectEntry />}
        render={(result, offline) => {
          const hasAside = !explorations && (nextStep.state.status === 'ready' || nextStep.state.status === 'offline') && Boolean(nextStep.state.data);
          const mainContent = (
            <div className="qitu-projects-main">
              {projectsDataSource.deleteHistory && result.items.length ? (
                <div className="qitu-project-actions" style={{ marginBottom: 14 }}>
                  <button className="qitu-button qitu-button-ghost" disabled={offline || saving} onClick={() => setSelected(result.items.map(entryKey))}>全选本页</button>
                  {selected.length > 0 && (
                    <>
                      <button className="qitu-button qitu-button-ghost" disabled={offline || saving} onClick={() => setSelected([])}>取消选择</button>
                      <button className="qitu-button qitu-button-ghost qitu-project-delete" disabled={offline || saving}
                        onClick={() => void removeEntries(result.items.filter(item => selected.includes(entryKey(item))))}>删除所选（{selected.length}）</button>
                    </>
                  )}
                </div>
              ) : null}
              <ProjectList projects={result.items} readOnly={offline} renderActions={item => (
                <div className="qitu-project-actions">
                  {projectsDataSource.deleteHistory ? (
                    <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
                      <input type="checkbox" aria-label={`选择清理：${item.title}`} checked={selected.includes(entryKey(item))} disabled={offline || saving}
                        onChange={event => setSelected(values => event.target.checked ? [...values, entryKey(item)] : values.filter(value => value !== entryKey(item)))} />选择
                    </label>
                  ) : null}
                  {item.kind === 'project' && projectsDataSource.changeProjectDisplay ? (
                    <>
                      {!item.collectedAt && !['completed','published','exploration'].includes(item.status) ? (
                        <button className="qitu-button qitu-button-ghost" disabled={offline || saving || item.isCurrent} onClick={() => void change(null,{ currentProjectId:item.id })}>
                          {item.isCurrent ? '当前继续学习项目' : '设为继续学习项目'}
                        </button>
                      ) : null}
                      <button className="qitu-button qitu-button-ghost" disabled={offline || saving} onClick={() => void change(item.id,{ collected:!item.collectedAt,...(item.isCurrent && !item.collectedAt ? { currentProjectId:null } : {}) })}>
                        {item.collectedAt ? '恢复显示' : item.isCurrent ? '收纳并清空当前选择' : '收纳'}
                      </button>
                    </>
                  ) : null}
                  {projectsDataSource.deleteHistory ? (
                    <button className="qitu-button qitu-button-ghost" disabled={offline || saving} aria-label={`永久删除：${item.title}`} onClick={() => void removeEntries([item])}>永久删除</button>
                  ) : null}
                </div>
              )} />
              {result.items.length === 0 ? <p style={{ padding: '24px 0', textAlign: 'center', color: 'var(--qitu-muted)' }}>暂无匹配记录</p> : null}
              <nav className="qitu-project-pagination" aria-label="项目分页">
                <button className="qitu-button qitu-button-ghost" disabled={offline || saving || cursors.length < 2} onClick={() => { setSelected([]); setCursors(values => values.slice(0,-1)); }}>上一页</button>
                <span>第 {cursors.length} 页</span>
                <button className="qitu-button qitu-button-ghost" disabled={offline || saving || !result.nextCursor} onClick={() => { setSelected([]); setCursors(values => [...values,result.nextCursor ?? undefined]); }}>下一页</button>
              </nav>
            </div>
          );

          if (!hasAside) {
            return (
              <div className="qitu-projects-layout is-full-width">
                {mainContent}
              </div>
            );
          }

          return (
            <ResizablePanels storageKey="student-project-list" initialSizes={[74, 26]} minWidths={[420, 260]} className="qitu-projects-layout">
              {mainContent}
              <aside><NextStepCard nextStep={nextStep.state.data!} disabled={offline} /></aside>
            </ResizablePanels>
          );
        }}
      />
    </div>
  );
}
