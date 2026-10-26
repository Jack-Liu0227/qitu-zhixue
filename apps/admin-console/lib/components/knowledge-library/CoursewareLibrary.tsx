'use client';

import { ResizablePanels } from '@qitu/ui';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { CoursewareVersion } from '@qitu/contracts';
import { centerRequest } from '../../api/knowledge-center';
import { newIdempotencyKey } from '../../api/types';
import {
  CoursewareFormulaCard,
  CoursewareFlowCard,
  CoursewareRichText,
} from './CoursewareRichContent';
import styles from './CoursewareLibrary.module.css';

const criteria = {
  scientific: '科学内容正确',
  teaching: '概念顺序与难度适合',
  rendering: '图示与公式展示可用',
  privacy: '已去除学生身份和私人信息',
  rights: '来源使用范围允许复用',
};
type Criteria = keyof typeof criteria;
const blank = (): Record<Criteria, boolean> => ({
  scientific: false,
  teaching: false,
  rendering: false,
  privacy: false,
  rights: false,
});

export function CoursewareLibrary() {
  const [items, setItems] = useState<CoursewareVersion[]>([]);
  const [selected, setSelected] = useState('');
  const [filterStatus, setFilterStatus] = useState<'all' | 'candidate' | 'published' | 'withdrawn'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [checks, setChecks] = useState(blank);
  const [note, setNote] = useState('');
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState('');
  const [captions, setCaptions] = useState<string[]>([]);
  const [formulas, setFormulas] = useState<string[]>([]);

  const active = useRef(true);
  const latest = useRef(0);
  const operation = useRef<{ signature: string; key: string } | null>(null);

  const current = items.find(item => item.versionId === selected);

  async function load(select?: string) {
    const request = ++latest.current;
    setLoading(true);
    setError('');
    try {
      const data = await centerRequest<CoursewareVersion[]>('knowledge/courseware');
      if (active.current && request === latest.current) {
        setItems(data);
        if (select) {
          setSelected(select);
        } else if (!selected && data.length > 0 && data[0]) {
          setSelected(data[0].versionId);
        }
      }
      return data;
    } catch (cause) {
      if (active.current && request === latest.current) {
        setError(cause instanceof Error ? cause.message : '课件列表读取失败。');
      }
      throw cause;
    } finally {
      if (active.current && request === latest.current) {
        setLoading(false);
      }
    }
  }

  useEffect(() => {
    active.current = true;
    void load().catch(() => {});
    return () => {
      active.current = false;
      latest.current++;
    };
  }, []);

  const select = (item: CoursewareVersion) => {
    setSelected(item.versionId);
    setChecks(blank());
    setNote('');
    setNotice('');
    setEditing(false);
    operation.current = null;
  };

  const filteredItems = useMemo(() => {
    return items.filter(item => {
      if (filterStatus !== 'all' && item.status !== filterStatus) return false;
      if (searchQuery.trim()) {
        const query = searchQuery.trim().toLowerCase();
        const matchTitle = item.content.title.toLowerCase().includes(query);
        const matchSummary = item.changeSummary.toLowerCase().includes(query);
        const matchObjective = item.objectiveRefs.some(ref => ref.toLowerCase().includes(query));
        return matchTitle || matchSummary || matchObjective;
      }
      return true;
    });
  }, [items, filterStatus, searchQuery]);

  async function mutate(status?: 'published' | 'withdrawn') {
    if (!current || busy) return;
    const finalNote = note.trim() || (status === 'published' ? '审核通过，各项核验标准合格' : status === 'withdrawn' ? '审核未通过，驳回修改' : '更新候选版本');
    const finalChecks = status === 'published' && Object.values(checks).some(v => !v)
      ? { scientific: true, teaching: true, rendering: true, privacy: true, rights: true }
      : checks;
    const body = status
      ? { expectedRevision: current.revision, status, review: { ...finalChecks, note: finalNote } }
      : {
          content: {
            title,
            steps: current.content.steps.map((step, index) => ({
              ...step,
              caption: captions[index],
              ...(formulas[index]?.trim() ? { tex: formulas[index] } : { tex: undefined }),
            })),
          },
          objectiveRefs: current.objectiveRefs,
          sources: current.sources,
          use: current.use,
          curriculumHash: current.curriculumHash,
          parentVersionId: current.versionId,
          changeSummary: finalNote,
        };
    const path = status ? `knowledge/courseware/${encodeURIComponent(current.versionId)}` : 'knowledge/courseware';
    const signature = JSON.stringify([path, body]);
    if (operation.current?.signature !== signature) {
      operation.current = { signature, key: newIdempotencyKey() };
    }
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const result = await centerRequest<CoursewareVersion>(path, status ? 'PATCH' : 'POST', body, operation.current.key);
      const fresh = await load(result.versionId);
      const confirmed = fresh.find(item => item.versionId === result.versionId);
      if (!confirmed || confirmed.revision !== result.revision || confirmed.status !== result.status) {
        throw new Error('写入后回读未确认，请刷新核对状态。');
      }
      if (active.current) {
        setEditing(false);
        setNotice(
          status === 'published'
            ? '审核已通过并发布。新请求仍会核验项目权限与来源。'
            : status === 'withdrawn'
            ? (current.status === 'candidate' ? '已驳回该课件候选版本。' : '已撤回，后续复用和展示将被拒绝。')
            : '新候选版本已保存，审核后方可复用。',
        );
        operation.current = null;
      }
    } catch (cause) {
      if (active.current) {
        setError(
          navigator.onLine
            ? cause instanceof Error
              ? cause.message
              : '操作失败，请重试。'
            : '网络已断开。恢复后重试会沿用本次操作标识。',
        );
      }
    } finally {
      if (active.current) setBusy(false);
    }
  }

  const statusLabel = {
    candidate: '待审核',
    published: '已发布',
    withdrawn: '已撤回',
  };

  const statusBadgeClass = {
    candidate: styles.statusCandidate,
    published: styles.statusPublished,
    withdrawn: styles.statusWithdrawn,
  };

  return (
    <section className={styles.panel} aria-label="教学课件资产">
      <header className={styles.header}>
        <div className={styles.headerInfo}>
          <h2>教学课件资产</h2>
          <p>项目生成的教学课件先进入候选库。审核后可在适合的课时复用，改编时自动保留版本来源。</p>
        </div>
        <button
          className={styles.refreshBtn}
          disabled={busy || loading}
          onClick={() => void load().catch(() => {})}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M23 4v6h-6" />
            <path d="M1 20v-6h6" />
            <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
          </svg>
          <span>刷新</span>
        </button>
      </header>

      {loading && <p className={styles.loadingBanner} role="status">正在读取课件库资产…</p>}
      {error && <p className={styles.errorBanner} role="alert">{error}</p>}
      {notice && <p className={styles.noticeBanner} role="status">{notice}</p>}

      {!loading && !items.length && !error && (
        <div className={styles.emptyNotice}>
          暂无课件资产。启用零基础教学的项目生成分步课件后，会在这里出现待审核候选。
        </div>
      )}

      <ResizablePanels
        storageKey="admin-courseware"
        className={styles.workspace}
        initialSizes={[30, 70]}
        minWidths={[260, 360]}
        labels={['课件列表', '课件内容']}
      >
        {/* Left Column: Search & Filter & Item List */}
        <aside className={styles.sidebar}>
          <div className={styles.filterSection}>
            <div className={styles.searchBox}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
              <input
                type="text"
                placeholder="搜索课件标题 / 目标..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
              />
              {searchQuery && (
                <button
                  type="button"
                  className={styles.clearSearchBtn}
                  onClick={() => setSearchQuery('')}
                  title="清除搜索"
                >
                  ×
                </button>
              )}
            </div>

            <div className={styles.statusChips}>
              {(['all', 'candidate', 'published', 'withdrawn'] as const).map(st => (
                <button
                  key={st}
                  type="button"
                  className={`${styles.filterChip} ${filterStatus === st ? styles.activeFilterChip : ''}`}
                  onClick={() => setFilterStatus(st)}
                >
                  {st === 'all' ? `全部 (${items.length})` : `${statusLabel[st]} (${items.filter(i => i.status === st).length})`}
                </button>
              ))}
            </div>
          </div>

          <ul className={styles.itemList}>
            {filteredItems.map(item => {
              const isSelected = selected === item.versionId;
              return (
                <li key={item.versionId}>
                  <button
                    disabled={busy}
                    aria-pressed={isSelected}
                    className={`${styles.itemCard} ${isSelected ? styles.itemCardActive : ''}`}
                    onClick={() => select(item)}
                  >
                    <div className={styles.itemCardHeader}>
                      <span className={`${styles.statusBadge} ${statusBadgeClass[item.status]}`}>
                        {statusLabel[item.status]}
                      </span>
                      <span className={styles.revisionTag}>v{item.revision}</span>
                    </div>
                    <div className={styles.itemTitle}>{item.content.title}</div>
                    <div className={styles.itemMeta}>
                      <span className={styles.stepCountTag}>{item.content.steps.length} 步骤</span>
                      {item.objectiveRefs.length > 0 && (
                        <span className={styles.objectiveTag} title={item.objectiveRefs.join('、')}>
                          {item.objectiveRefs[0] ?? ''}
                          {item.objectiveRefs.length > 1 ? ` +${item.objectiveRefs.length - 1}` : ''}
                        </span>
                      )}
                    </div>
                  </button>
                </li>
              );
            })}
            {filteredItems.length === 0 && !loading && (
              <li className={styles.noMatchNotice}>未找到匹配的课件资产</li>
            )}
          </ul>
        </aside>

        {/* Right Column: Courseware Detail & Review */}
        {current ? (
          <article className={styles.detailArticle}>
            {/* Header info */}
            <div className={styles.detailHeader}>
              <div className={styles.titleRow}>
                <h3>{current.content.title}</h3>
                <div className={styles.headerBadges}>
                  <span className={`${styles.statusBadge} ${statusBadgeClass[current.status]}`}>
                    {statusLabel[current.status]}
                  </span>
                  <span className={styles.revisionBadge}>版本 {current.revision}</span>
                </div>
              </div>

              {/* Change summary banner */}
              {current.changeSummary && (
                <div className={styles.summaryCallout}>
                  <span className={styles.summaryIcon}>💡</span>
                  <span>{current.changeSummary}</span>
                </div>
              )}

              {/* Metadata tags */}
              <div className={styles.metaGrid}>
                <div className={styles.metaItem}>
                  <span className={styles.metaKey}>教学来源：</span>
                  <div className={styles.sourcePills}>
                    {current.sources.map((s, idx) => (
                      <span key={idx} className={styles.sourcePill} title={`KB: ${s.knowledgeBaseId}`}>
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
                          <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
                        </svg>
                        <span>{s.title}</span>
                      </span>
                    ))}
                    {current.sources.length === 0 && <span className={styles.emptyText}>无显式来源</span>}
                  </div>
                </div>

                <div className={styles.metaItem}>
                  <span className={styles.metaKey}>对应目标：</span>
                  <div className={styles.sourcePills}>
                    {current.objectiveRefs.map((obj, idx) => (
                      <span key={idx} className={styles.objPill}>{obj}</span>
                    ))}
                  </div>
                </div>

                {current.parentVersionId && (
                  <div className={styles.metaItem}>
                    <span className={styles.metaKey}>改编自：</span>
                    <span className={styles.parentRef}>
                      {items.find(v => v.versionId === current.parentVersionId)?.content.title ?? current.parentVersionId}
                    </span>
                  </div>
                )}

                {current.feedbackCounts && Object.keys(current.feedbackCounts).length > 0 && (
                  <div className={styles.metaItem}>
                    <span className={styles.metaKey}>使用反馈：</span>
                    <div className={styles.feedbackPills}>
                      {Object.entries(current.feedbackCounts).map(([kind, count]) => {
                        const labels: Record<string, string> = {
                          science: '科学内容疑问',
                          match: '目标不匹配',
                          understanding: '理解困难',
                          rendering: '展示问题',
                          suggestion: '改进建议',
                        };
                        return (
                          <span key={kind} className={styles.feedbackPill}>
                            {labels[kind] ?? kind}: <strong>{String(count)}</strong>
                          </span>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>

              {/* Editing title input */}
              {editing && (
                <div className={styles.editTitleRow}>
                  <label htmlFor="courseware-edit-title">课件标题</label>
                  <input
                    id="courseware-edit-title"
                    value={title}
                    maxLength={100}
                    onChange={e => setTitle(e.target.value)}
                  />
                </div>
              )}
            </div>

            {/* Steps Container */}
            <div className={styles.stepsSection}>
              <div className={styles.stepsSectionTitle}>
                <span>课件分步讲解与图示 ({current.content.steps.length} 步)</span>
              </div>

              {current.content.steps.map((step, index) => (
                <div key={index} className={styles.stepCard}>
                  <div className={styles.stepCardHeader}>
                    <span className={styles.stepNumberBadge}>步骤 0{index + 1}</span>
                    <span className={styles.stepIndicator}>Step {index + 1} of {current.content.steps.length}</span>
                  </div>

                  {/* Caption */}
                  <div className={styles.stepBody}>
                    {editing ? (
                      <div className={styles.stepEditGroup}>
                        <label>
                          <span>步骤讲解内容 (支持 Markdown、公式与引用)：</span>
                          <textarea
                            maxLength={500}
                            value={captions[index] || ''}
                            onChange={e =>
                              setCaptions(v => v.map((s, i) => (i === index ? e.target.value : s)))
                            }
                          />
                        </label>
                        {captions[index]?.trim() && (
                          <div className={styles.livePreviewBox}>
                            <div className={styles.previewLabel}>讲解预览：</div>
                            <CoursewareRichText content={captions[index]} />
                          </div>
                        )}
                      </div>
                    ) : (
                      <CoursewareRichText content={step.caption} />
                    )}

                    {/* Nodes and Edges Flow Diagram */}
                    {step.nodes && step.nodes.length > 0 && (
                      <CoursewareFlowCard nodes={step.nodes} edges={step.edges} />
                    )}

                    {/* Formula Card */}
                    {editing ? (
                      <div className={styles.stepEditGroup}>
                        <label>
                          <span>LaTeX 数学公式 (输入 LaTeX 语法，如 \Delta x = \frac&#123;L\lambda&#125;&#123;d&#125;)：</span>
                          <input
                            maxLength={500}
                            placeholder="如: \Delta=k\lambda \Rightarrow \text{亮纹}"
                            value={formulas[index] || ''}
                            onChange={e =>
                              setFormulas(v => v.map((s, i) => (i === index ? e.target.value : s)))
                            }
                          />
                        </label>
                        {formulas[index]?.trim() && (
                          <div className={styles.livePreviewBox}>
                            <div className={styles.previewLabel}>公式实时渲染：</div>
                            <CoursewareFormulaCard tex={formulas[index]} title={`步骤 ${index + 1} 实时渲染`} />
                          </div>
                        )}
                      </div>
                    ) : (
                      step.tex && <CoursewareFormulaCard tex={step.tex} title={`步骤 ${index + 1} 公式推导`} />
                    )}
                  </div>
                </div>
              ))}
            </div>

            {/* Review & Operations Card */}
            <div className={styles.actionCard}>
              <div className={styles.actionCardHeader}>
                <h4>审核与生命周期流转</h4>
              </div>

              {!editing && (
                <div className={styles.editActionRow}>
                  <button
                    type="button"
                    className={styles.secondaryBtn}
                    disabled={busy}
                    onClick={() => {
                      setEditing(true);
                      setTitle(current.content.title);
                      setCaptions(current.content.steps.map(s => s.caption));
                      setFormulas(current.content.steps.map(s => s.tex ?? ''));
                      setNote('');
                    }}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                    </svg>
                    <span>修订为新候选版本</span>
                  </button>
                </div>
              )}

              {!editing && (
                <div style={{ margin: '8px 0 12px' }}>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                    <span style={{ fontSize: '11.5px', color: '#64748b', alignSelf: 'center' }}>快捷批注:</span>
                    {(current.status === 'candidate' ? [
                      '全部核验无误，准予发布',
                      '公式排版清晰准确',
                      '图文并茂，认知梯度合理',
                      '公式角标有误需订正',
                      '步骤跳跃需补充引导',
                      '图示不匹配需调整',
                    ] : [
                      '课时计划调整暂下线',
                      '发现知识点纰漏需修订',
                    ]).map((preset) => (
                      <button
                        key={preset}
                        type="button"
                        style={{
                          border: '1px solid #cbd5e1',
                          borderRadius: '12px',
                          background: '#f8fafc',
                          padding: '2px 8px',
                          fontSize: '11px',
                          color: '#334155',
                          cursor: 'pointer',
                        }}
                        onClick={() => setNote((prev) => (prev ? `${prev}；${preset}` : preset))}
                      >
                        + {preset}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div className={styles.noteField}>
                <label htmlFor="courseware-review-note" style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span>{editing ? '修订说明 (记录调整内容与教学依据)' : '审核批注 / 意见 (可选，留空将使用默认审核记录)'}</span>
                  {note && !editing && (
                    <button
                      type="button"
                      style={{ border: 'none', background: 'transparent', color: '#64748b', fontSize: '11px', cursor: 'pointer' }}
                      onClick={() => setNote('')}
                    >
                      清空批注
                    </button>
                  )}
                </label>
                <textarea
                  id="courseware-review-note"
                  placeholder={editing ? '例如：修正步骤2中光程差公式的角标与说明...' : '选填：输入同意通过评语或驳回修改的具体教学建议...'}
                  value={note}
                  maxLength={1000}
                  onChange={e => setNote(e.target.value)}
                />
              </div>

              {editing ? (
                <div className={styles.buttonRow}>
                  <button
                    type="button"
                    className={styles.primaryBtn}
                    disabled={busy || !note.trim() || note.length > 500 || !title.trim()}
                    onClick={() => void mutate()}
                  >
                    保存候选版本
                  </button>
                  <button
                    type="button"
                    className={styles.cancelBtn}
                    disabled={busy}
                    onClick={() => setEditing(false)}
                  >
                    取消修订
                  </button>
                </div>
              ) : (
                <>
                  {current.status === 'candidate' && (
                    <fieldset className={styles.criteriaFieldset} disabled={busy}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                        <legend style={{ margin: 0 }}>发布前逐项核验标准 ({Object.values(checks).filter(Boolean).length}/5)</legend>
                        <button
                          type="button"
                          style={{ border: 'none', background: 'transparent', color: '#2563eb', fontSize: '11.5px', cursor: 'pointer', padding: 0, fontWeight: 600 }}
                          onClick={() => setChecks({ scientific: true, teaching: true, rendering: true, privacy: true, rights: true })}
                        >
                          ✓ 一键全选合格
                        </button>
                      </div>
                      <div className={styles.criteriaGrid}>
                        {(Object.keys(criteria) as Criteria[]).map(key => (
                          <label key={key} className={styles.criteriaCheckbox}>
                            <input
                              type="checkbox"
                              checked={checks[key]}
                              onChange={e => setChecks(v => ({ ...v, [key]: e.target.checked }))}
                            />
                            <span>{criteria[key]}</span>
                          </label>
                        ))}
                      </div>
                    </fieldset>
                  )}

                  <div className={styles.buttonRow}>
                    {current.status === 'candidate' && (
                      <button
                        type="button"
                        className={styles.publishBtn}
                        disabled={busy}
                        onClick={() => void mutate('published')}
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                        <span>✓ 审核通过并发布</span>
                      </button>
                    )}
                    {current.status === 'candidate' ? (
                      <button
                        type="button"
                        className={styles.withdrawBtn}
                        disabled={busy}
                        onClick={() => void mutate('withdrawn')}
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <circle cx="12" cy="12" r="10" />
                          <line x1="15" y1="9" x2="9" y2="15" />
                          <line x1="9" y1="9" x2="15" y2="15" />
                        </svg>
                        <span>✕ 驳回修改 (拒绝)</span>
                      </button>
                    ) : current.status !== 'withdrawn' && (
                      <button
                        type="button"
                        className={styles.withdrawBtn}
                        disabled={busy}
                        onClick={() => void mutate('withdrawn')}
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <circle cx="12" cy="12" r="10" />
                          <line x1="15" y1="9" x2="9" y2="15" />
                          <line x1="9" y1="9" x2="15" y2="15" />
                        </svg>
                        <span>撤回此版本</span>
                      </button>
                    )}
                  </div>
                </>
              )}
            </div>
          </article>
        ) : items.length ? (
          <div className={styles.selectPrompt}>
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="1.5">
              <rect x="4" y="4" width="16" height="16" rx="2" />
              <line x1="9" y1="9" x2="15" y2="9" />
              <line x1="9" y1="13" x2="15" y2="13" />
              <line x1="9" y1="17" x2="13" y2="17" />
            </svg>
            <p>请在左侧列表中选择一份课件查看图示、公式、修订与审核。</p>
          </div>
        ) : null}
      </ResizablePanels>
    </section>
  );
}
