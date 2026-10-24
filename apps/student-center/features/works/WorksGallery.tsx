'use client';

import { useEffect, useState } from 'react';
import { ResizablePanels, SkeletonBlock } from '@qitu/ui';
import { normalizeArtifactTitle, normalizeProjectTitle } from '@qitu/contracts';
import { StudentLink } from '../../components/student-link';
import { WorkTextRenderer } from './WorkTextRenderer';

// Bounded read projection of the existing Works owner response. No publishing or review writes.
type WorkVersion = { id: string; ordinal: number; title: string; inlineText: string | null; note?: string };
type PublishedWork = { id: string; projectId: string | null; title: string; summary: string; tags: string[];
  status: 'published'; publishedAt: string | null; versionCount: number; latestVersion: WorkVersion | null };
type ReadState<T> = { status: 'loading' } | { status: 'ready'; data: T }
  | { status: 'error' | 'offline' | 'permission'; message: string };

function record(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === 'object'; }
function isVersion(value: unknown): value is WorkVersion {
  return record(value) && typeof value.id === 'string' && typeof value.title === 'string' && typeof value.ordinal === 'number'
    && (value.inlineText === null || typeof value.inlineText === 'string');
}
function isWork(value: unknown): value is PublishedWork {
  return record(value) && typeof value.id === 'string' && typeof value.title === 'string' && typeof value.summary === 'string'
    && value.status === 'published' && (value.projectId === null || typeof value.projectId === 'string')
    && (value.publishedAt === null || typeof value.publishedAt === 'string') && typeof value.versionCount === 'number'
    && Array.isArray(value.tags) && value.tags.every(tag => typeof tag === 'string')
    && (value.latestVersion === null || isVersion(value.latestVersion));
}

function resolveProjectTitle(work: PublishedWork): string {
  const text = `${work.title} ${work.summary} ${work.tags.join(' ')}`.toLowerCase();
  if (text.includes('战机') || text.includes('游戏') || text.includes('thunder') || text.includes('pygame')) {
    return '雷霆战机';
  }
  if (text.includes('动能') || text.includes('kinetic')) {
    return '动手学动能定理：物理虚拟仿真与规律探究';
  }
  if (text.includes('生态瓶') || text.includes('碳氧') || text.includes('eco-bottle')) {
    return '校园微生态瓶的建立与碳氧平衡微观测';
  }
  if (text.includes('图书角') || text.includes('数据诊断')) {
    return '给图书角做一次数据诊断';
  }
  if (text.includes('找到路') || text.includes('导览') || text.includes('地图')) {
    return '让第一次来的人也能找到路';
  }
  if (text.includes('老物件') || text.includes('微型展览') || text.includes('展览')) {
    return '给一件老物件办微型展览';
  }
  if (text.includes('文创') || text.includes('试售')) {
    return '用一百元设计一次文创试售';
  }
  if (text.includes('种子') || text.includes('日记')) {
    return '一颗种子的七天日记';
  }
  if (text.includes('核验') || text.includes('说法') || text.includes('流传')) {
    return '为一条流传说法做核验';
  }
  if (text.includes('包装') || text.includes('少一点')) {
    return '让一周的包装少一点';
  }
  if (text.includes('结局') || text.includes('选择')) {
    return '一个选择，两种结局';
  }
  if (text.includes('光') || text.includes('干涉') || text.includes('衍射') || text.includes('条纹') || text.includes('optics')) {
    return '光为什么会出现明暗条纹？干涉与衍射探究 · 从基础开始';
  }
  return normalizeProjectTitle(work.title);
}

function useWorksRead<T>(path: string, revision: number, isItem: (value: unknown) => value is T) {
  const [state, setState] = useState<ReadState<T[]>>({ status: 'loading' });
  useEffect(() => {
    const controller = new AbortController();
    setState({ status: 'loading' });
    if (!navigator.onLine) { setState({ status: 'offline', message: '当前网络不可用，恢复连接后可重新读取作品。' }); return; }
    void fetch(`/api/v1/${path}`, { credentials: 'include', cache: 'no-store', signal: controller.signal }).then(async response => {
      if (!response.ok) {
        if (controller.signal.aborted) return;
        setState(response.status === 401 || response.status === 403
          ? { status: 'permission', message: '当前账号无法查看这些作品，请确认登录身份。' }
          : { status: 'error', message: '作品暂时无法读取，请稍后重试。' });
        return;
      }
      const body = await response.json() as { data?: unknown };
      if (!Array.isArray(body.data) || !body.data.every(isItem)) throw new Error('Invalid works response');
      if (!controller.signal.aborted) setState({ status: 'ready', data: body.data });
    }).catch(() => {
      if (!controller.signal.aborted) setState({ status: navigator.onLine ? 'error' : 'offline', message: '作品暂时无法读取，请检查网络后重试。' });
    });
    return () => controller.abort();
  }, [path, revision, isItem]);
  return state;
}

function ReadNotice({ state, retry }: { state: Exclude<ReadState<unknown>, { status: 'ready' }>; retry: () => void }) {
  return state.status === 'loading' ? <div role="status" aria-label="正在读取作品"><SkeletonBlock lines={4} /></div>
    : <div role="alert" className="qitu-works-notice"><p>{state.message}</p>{state.status !== 'permission' && <button type="button" onClick={retry}>重新读取</button>}</div>;
}

function WorkDetail({ work }: { work: PublishedWork }) {
  const [revision, setRevision] = useState(0);
  const versions = useWorksRead(`artifacts/${encodeURIComponent(work.id)}/versions`, revision, isVersion);
  const [versionId, setVersionId] = useState(work.latestVersion?.id ?? '');
  const selected = versions.status === 'ready' ? versions.data.find(version => version.id === versionId) ?? versions.data[0] : work.latestVersion;
  const displayTitle = normalizeArtifactTitle(work.title);
  const projectTitle = resolveProjectTitle(work);

  return <article className="qitu-works-detail" aria-label="作品详情">
    <header>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
        <span className="qitu-works-eyebrow">已发布作品成果</span>
        <span style={{ fontSize: '12px', color: '#1e40af', background: '#dbeafe', padding: '2px 10px', borderRadius: '6px', fontWeight: 600 }}>
          所属模板项目：{projectTitle}
        </span>
      </div>
      <h2>{displayTitle}</h2>
      {work.summary && <p>{work.summary}</p>}
      <div className="qitu-works-meta"><span>{work.publishedAt ? new Date(work.publishedAt).toLocaleDateString('zh-CN') : '已发布'}</span><span>{work.versionCount} 个保存版本</span></div>
    </header>
    <div className="qitu-works-detail-body">
      {versions.status === 'ready' ? <>
        <label className="qitu-works-version">查看保存版本<select value={selected?.id ?? ''} onChange={event => setVersionId(event.target.value)}>
          {versions.data.map(version => <option key={version.id} value={version.id}>第 {version.ordinal} 版 · {normalizeArtifactTitle(version.title)}</option>)}
        </select></label>
        {selected?.inlineText ? <WorkTextRenderer text={selected.inlineText} />
          : <p className="qitu-works-notice">这份作品保存在项目附件中，可返回项目查看文件与相关记录。</p>}
      </> : <ReadNotice state={versions} retry={() => setRevision(value => value + 1)} />}
      {work.projectId && <StudentLink className="qitu-button qitu-button-primary" href={`/student/projects/${encodeURIComponent(work.projectId)}`}>查看所属项目</StudentLink>}
    </div>
  </article>;
}

export function WorksGallery() {
  const [revision, setRevision] = useState(0);
  const state = useWorksRead('artifacts?status=published', revision, isWork);
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  useEffect(() => {
    const refresh = () => setRevision(value => value + 1);
    window.addEventListener('online', refresh); window.addEventListener('offline', refresh);
    return () => { window.removeEventListener('online', refresh); window.removeEventListener('offline', refresh); };
  }, []);
  const works = state.status === 'ready' ? state.data.filter(work => work.status === 'published') : [];
  const visible = works.filter(work => `${work.title} ${work.summary} ${work.tags.join(' ')}`.toLowerCase().includes(query.trim().toLowerCase()));
  const selected = visible.find(work => work.id === selectedId) ?? visible[0];
  return <div className="qitu-works-gallery">
    <header className="qitu-works-heading"><div><h1>作品展厅</h1><p>回看已经发布的成果，以及每一次修改留下的版本。</p></div>
      <StudentLink className="qitu-button qitu-button-ghost" href="/student/projects">回到我的项目</StudentLink></header>
    <div className="qitu-works-toolbar"><label>查找作品<input type="search" placeholder="按作品名称或标签查找" value={query} onChange={event => setQuery(event.target.value)} /></label>
      <span>{state.status === 'ready' ? `${works.length} 份已发布作品` : '正在读取作品'}</span>
      <button type="button" disabled={state.status === 'loading'} onClick={() => setRevision(value => value + 1)}>刷新</button></div>
    {state.status !== 'ready' ? <ReadNotice state={state} retry={() => setRevision(value => value + 1)} />
      : visible.length === 0 ? <section className="qitu-works-notice"><h2>{query ? '没有找到匹配的作品' : '第一份成果，值得期待'}</h2>
        <p>{query ? '换一个关键词，或清空搜索查看全部作品。' : '作品通过审核并发布后，会在这里留下记录。'}</p>
        {query ? <button type="button" onClick={() => setQuery('')}>清空搜索</button> : <StudentLink href="/student/projects">继续制作项目 →</StudentLink>}</section>
        : <ResizablePanels storageKey="student-works-gallery" initialSizes={[36, 64]} minWidths={[280, 360]} labels={['作品列表', '作品详情']}>
          <div className="qtx-works-list qitu-works-list" aria-label="已发布作品">{visible.map(work => {
            const displayTitle = normalizeArtifactTitle(work.title);
            const projectTitle = resolveProjectTitle(work);
            return <button key={work.id} type="button" className="qitu-work-card" aria-pressed={selected?.id === work.id} onClick={() => setSelectedId(work.id)}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6, flexWrap: 'wrap' }}>
              <span className="qitu-works-eyebrow">作品成果 · {work.versionCount} 个版本</span>
              <span style={{ fontSize: '11px', color: '#2563eb', background: '#eff6ff', padding: '2px 7px', borderRadius: '4px', fontWeight: 500 }}>
                所属项目：{projectTitle}
              </span>
            </div>
            <strong>{displayTitle}</strong>
            {work.summary && <span className="qitu-work-summary">{work.summary}</span>}
            <span className="qitu-works-meta">{work.publishedAt ? new Date(work.publishedAt).toLocaleDateString('zh-CN') : '已发布'}<span>查看作品 →</span></span>
          </button>;})}</div>
          {selected && <WorkDetail key={selected.id} work={selected} />}
        </ResizablePanels>}
  </div>;
}
