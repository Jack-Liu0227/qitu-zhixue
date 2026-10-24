'use client';
import { ResizablePanels } from '@qitu/ui';

import { useEffect, useRef, useState } from 'react';
import type { CoursewareVersion } from '@qitu/contracts';
import { centerRequest } from '../../api/knowledge-center';
import { newIdempotencyKey } from '../../api/types';
import styles from './CoursewareLibrary.module.css';

const criteria = { scientific: '科学内容正确', teaching: '概念顺序与难度适合', rendering: '图示与公式展示可用', privacy: '已去除学生身份和私人信息', rights: '来源使用范围允许复用' };
type Criteria = keyof typeof criteria;
const blank = (): Record<Criteria, boolean> => ({ scientific: false, teaching: false, rendering: false, privacy: false, rights: false });
export function CoursewareLibrary() {
  const [items, setItems] = useState<CoursewareVersion[]>([]), [selected, setSelected] = useState('');
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [checks, setChecks] = useState(blank), [note, setNote] = useState(''), [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(''), [captions, setCaptions] = useState<string[]>([]), [formulas, setFormulas] = useState<string[]>([]);
  const active = useRef(true), latest = useRef(0), operation = useRef<{ signature: string; key: string } | null>(null);
  const current = items.find(item => item.versionId === selected);
  async function load(select?: string) {
    const request = ++latest.current; setLoading(true); setError('');
    try {
      const data = await centerRequest<CoursewareVersion[]>('knowledge/courseware');
      if (active.current && request === latest.current) { setItems(data); if (select) setSelected(select); }
      return data;
    } catch (cause) { if (active.current && request === latest.current) setError(cause instanceof Error ? cause.message : '课件列表读取失败。'); throw cause; }
    finally { if (active.current && request === latest.current) setLoading(false); }
  }
  useEffect(() => { active.current = true; void load().catch(() => {}); return () => { active.current = false; latest.current++; }; }, []);
  const select = (item: CoursewareVersion) => { setSelected(item.versionId); setChecks(blank()); setNote(''); setNotice(''); setEditing(false); operation.current = null; };
  async function mutate(status?: 'published' | 'withdrawn') {
    if (!current || busy) return;
    const body = status ? { expectedRevision: current.revision, status, review: { ...checks, note } } : {
      content: { title, steps: current.content.steps.map((step, index) => ({ ...step, caption: captions[index],
        ...(formulas[index]?.trim() ? { tex: formulas[index] } : { tex: undefined }) })) },
      objectiveRefs: current.objectiveRefs, sources: current.sources, use: current.use,
      curriculumHash: current.curriculumHash,
      parentVersionId: current.versionId, changeSummary: note,
    };
    const path = status ? `knowledge/courseware/${encodeURIComponent(current.versionId)}` : 'knowledge/courseware';
    const signature = JSON.stringify([path, body]);
    if (operation.current?.signature !== signature) operation.current = { signature, key: newIdempotencyKey() };
    setBusy(true); setError(''); setNotice('');
    try {
      const result = await centerRequest<CoursewareVersion>(path, status ? 'PATCH' : 'POST', body, operation.current.key);
      const fresh = await load(result.versionId);
      const confirmed = fresh.find(item => item.versionId === result.versionId);
      if (!confirmed || confirmed.revision !== result.revision || confirmed.status !== result.status) throw new Error('写入后回读未确认，请刷新核对状态。');
      if (active.current) { setEditing(false); setNotice(status === 'published' ? '已发布。新请求仍会核验项目权限与来源。' : status === 'withdrawn' ? '已撤回，后续复用和展示将被拒绝。' : '新候选版本已保存，审核后方可复用。'); operation.current = null; }
    } catch (cause) { if (active.current) setError(navigator.onLine ? (cause instanceof Error ? cause.message : '操作失败，请重试。') : '网络已断开。恢复后重试会沿用本次操作标识。'); }
    finally { if (active.current) setBusy(false); }
  }
  return <section className={styles.panel} aria-label="教学课件资产">
    <header><div><h2>教学课件资产</h2><p>项目生成的课件先进入候选库。审核后可在适合的课时复用，改编保留版本来源。</p></div>
      <button disabled={busy || loading} onClick={() => void load().catch(() => {})}>刷新</button></header>
    {loading ? <p role="status">正在读取课件…</p> : null}
    {error ? <p role="alert">{error}</p> : null}{notice ? <p role="status">{notice}</p> : null}
    {!loading && !items.length && !error ? <p>暂无课件。启用零基础教学的项目生成分步课件后，会在这里出现待审核候选。</p> : null}
    <ResizablePanels storageKey="admin-courseware" className={styles.workspace} initialSizes={[32, 68]} minWidths={[240, 320]} labels={['课件列表', '课件内容']}>
      <ul>{items.map(item => <li key={item.versionId}><button disabled={busy} aria-pressed={selected === item.versionId} onClick={() => select(item)}>
        {item.content.title}<small>{({ candidate: '待审核', published: '已发布', withdrawn: '已撤回' })[item.status]} · {item.objectiveRefs.join('、')}</small>
      </button></li>)}</ul>
      {current ? <article>
        <h3>{current.content.title}</h3><p>{current.changeSummary}</p><p>来源：{current.sources.map(s => s.title).join('、')}</p>
        {current.feedbackCounts ? <p>使用反馈（次数）：{Object.entries(current.feedbackCounts).map(([kind, count]) =>
          `${({ science: '科学内容疑问', match: '目标不匹配', understanding: '理解困难', rendering: '展示问题', suggestion: '改进建议' })[kind as 'science']} ${count}`).join('；')}</p> : null}
        {current.parentVersionId ? <p>改编自：{items.find(v => v.versionId === current.parentVersionId)?.content.title ?? current.parentVersionId}</p> : null}
        {editing ? <label>课件标题<input value={title} maxLength={100} onChange={e => setTitle(e.target.value)} /></label> : null}
        {current.content.steps.map((step, index) => <section key={index} className={styles.step}>
          <strong>第 {index + 1} 步</strong>
          {editing ? <><label>讲解<textarea maxLength={300} value={captions[index]} onChange={e => setCaptions(v => v.map((s, i) => i === index ? e.target.value : s))} /></label>
            <label>公式<input maxLength={500} value={formulas[index]} onChange={e => setFormulas(v => v.map((s, i) => i === index ? e.target.value : s))} /></label></> : <p>{step.caption}</p>}
          {step.nodes ? <div className={styles.nodes}>{step.nodes.map(node => <span key={node.id}>{node.label}</span>)}</div> : null}
          {step.edges?.length ? <p>{step.edges.map(edge => `${step.nodes?.find(v => v.id === edge.from)?.label} → ${step.nodes?.find(v => v.id === edge.to)?.label}`).join('；')}</p> : null}
          {step.tex ? <code>{step.tex}</code> : null}
        </section>)}
        {!editing ? <button disabled={busy} onClick={() => { setEditing(true); setTitle(current.content.title); setCaptions(current.content.steps.map(s => s.caption)); setFormulas(current.content.steps.map(s => s.tex ?? '')); setNote(''); }}>修订为新版本</button> : null}
        <label>{editing ? '修订说明' : '审核说明'}<textarea value={note} maxLength={1000} onChange={e => setNote(e.target.value)} /></label>
        {editing ? <button disabled={busy || !note.trim() || note.length > 500 || !title.trim()} onClick={() => void mutate()}>保存候选版本</button> : <>
          {current.status === 'candidate' ? <fieldset disabled={busy}><legend>发布前逐项核验</legend>{(Object.keys(criteria) as Criteria[]).map(key => <label key={key}>
            <input type="checkbox" checked={checks[key]} onChange={e => setChecks(v => ({ ...v, [key]: e.target.checked }))} />{criteria[key]}</label>)}</fieldset> : null}
          {current.status === 'candidate' ? <button disabled={busy || !note.trim() || Object.values(checks).some(v => !v)} onClick={() => void mutate('published')}>审核通过并发布</button> : null}
          {current.status !== 'withdrawn' ? <button disabled={busy || !note.trim()} onClick={() => void mutate('withdrawn')}>撤回此版本</button> : null}
        </>}
      </article> : items.length ? <p>选择一份课件查看内容、修订和审核。</p> : null}
    </ResizablePanels>
  </section>;
}
