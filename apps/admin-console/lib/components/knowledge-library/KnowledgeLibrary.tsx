'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  centerRequest,
  createKnowledgeBase,
  fetchAssistantBindings,
  saveBaseBindings,
  type AssistantBindings,
  type Base,
  type BaseDetail,
  type EngineGroup,
} from '../../api/knowledge-center';
import { createIdempotentRetryKey, newIdempotencyKey } from '../../api/types';
import { KnowledgeEngines } from '../knowledge-engines/KnowledgeEngines';
import { CreateLibraryModal, type LibraryCreation } from './CreateLibraryModal';
import { LibraryDetail } from './LibraryDetail';
import { LibraryAssistantBindings } from './LibraryAssistantBindings';
import {
  EngineIcon,
  fileBase64,
  Glyph,
  message,
  statusLabels,
  time,
  type ModelOption,
} from './shared';
import styles from './KnowledgeLibrary.module.css';

export function KnowledgeLibrary() {
  const [tab, setTab] = useState<'bases' | 'engines'>('bases');
  const [bases, setBases] = useState<Base[]>([]);
  const [engines, setEngines] = useState<EngineGroup[]>([]);
  const [models, setModels] = useState<ModelOption[]>([]);
  const [assistants, setAssistants] = useState<AssistantBindings | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const [detail, setDetail] = useState<BaseDetail | null>(null);
  const [create, setCreate] = useState(false);
  const [busy, setBusy] = useState(false);
  const [online, setOnline] = useState(true);
  const retry = useRef(createIdempotentRetryKey());
  const bindingContainer = useRef<HTMLDivElement>(null);
  const [bindingHeight, setBindingHeight] = useState(0);
  useEffect(() => {
    const container = bindingContainer.current;
    if (!container) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry)
        setBindingHeight((height) => Math.max(height, Math.ceil(entry.contentRect.height)));
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, [loading, tab, Boolean(detail)]);
  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    setError('');
    try {
      const [libraries, groups, catalog, options] = await Promise.all([
        centerRequest<Base[]>('knowledge/bases'),
        centerRequest<EngineGroup[]>('knowledge/engines'),
        fetchAssistantBindings(),
        centerRequest<ModelOption[]>('knowledge/engine-models'),
      ]);
      setBases(libraries);
      setEngines(groups);
      setAssistants(catalog);
      setModels(options);
    } catch (e) {
      setError(message(e));
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load();
    const update = () => setOnline(navigator.onLine);
    update();
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, [load]);
  const open = async (id: string) => {
    setSelectedId(id);
    setBusy(true);
    setError('');
    try {
      setDetail(await centerRequest<BaseDetail>(`knowledge/bases/${encodeURIComponent(id)}`));
      setTab('bases');
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  };
  const refreshDetail = useCallback(async () => {
    const id = detail?.id;
    if (!id) throw new Error('未选择知识库');
    const next = await centerRequest<BaseDetail>(`knowledge/bases/${encodeURIComponent(id)}`);
    setDetail(next);
    return next;
  }, [detail?.id]);
  async function created(creation: LibraryCreation) {
    const base = await createKnowledgeBase(
      creation.request,
      retry.current.keyFor('create:' + JSON.stringify(creation.request)),
    );
    retry.current.acknowledge();
    const errors: string[] = [];
    if (creation.assistantIds.length)
      try {
        await saveBaseBindings(
          base.id,
          {
            expectedRevision: base.revision ?? 1,
            bindings: creation.assistantIds.map((agentId) => ({
              agentKind: 'admin_assistant',
              agentId,
              mode: 'retrieve',
              enabled: true,
            })),
          },
          newIdempotencyKey(),
        );
      } catch (e) {
        errors.push('绑定助手：' + message(e));
      }
    for (const file of creation.files)
      try {
        await centerRequest(
          `knowledge/bases/${base.id}/uploads`,
          'POST',
          { fileName: file.name, base64: await fileBase64(file) },
          newIdempotencyKey(),
        );
      } catch (e) {
        errors.push(file.name + '：' + message(e));
      }
    setCreate(false);
    await load(true);
    await open(base.id);
    setNotice(
      errors.length
        ? '知识库已创建，以下操作未完成，可在详情页重试：' + errors.join('；')
        : '知识库已创建',
    );
  }
  const groups = engines.filter((g) => g.instances.length);
  const visible = bases.filter(
    (b) =>
      b.name.toLowerCase().includes(query.toLowerCase()) &&
      (filter === 'all' ||
        engines
          .find((g) => g.provider === filter)
          ?.instances.some((i) => i.id === b.engine_instance_id)),
  );
  const selectedBase = visible.find((base) => base.id === selectedId);
  return (
    <div className={`admin-settings-page ${styles.root}`}>
      {!detail && (
        <>
          <div className="settings-pagehead">
            <div className="settings-titlebox">
              <h1>知识中心</h1>
              <div className="settings-desc">整理教学资料，为 AI 助手连接可信的知识。</div>
            </div>
            {tab === 'bases' && (
              <button
                className={styles.primary}
                disabled={!online || loading || busy}
                onClick={() => setCreate(true)}
              >
                <Glyph name="plus" />
                创建知识库
              </button>
            )}
          </div>
          <nav className={styles.mainTabs}>
            <button role="tab" aria-selected={tab === 'bases'} onClick={() => setTab('bases')}>
              知识库
            </button>
            <button role="tab" aria-selected={tab === 'engines'} onClick={() => setTab('engines')}>
              知识引擎
            </button>
          </nav>
        </>
      )}
      {error && (
        <div className={styles.error} role="alert">
          {error}
          <button className={styles.textButton} onClick={() => void load()}>
            重新读取
          </button>
        </div>
      )}
      {notice && (
        <div className={styles.notice} role="status">
          {notice}
          <button className={styles.iconButton} aria-label="关闭提示" onClick={() => setNotice('')}>
            <Glyph name="close" size={14} />
          </button>
        </div>
      )}
      {!online && (
        <p className={styles.error}>当前离线，可查看已读取内容；恢复连接后可继续保存。</p>
      )}
      {loading ? (
        <div className={styles.empty}>正在读取知识中心…</div>
      ) : detail ? (
        <LibraryDetail
          key={detail.id}
          detail={detail}
          engines={engines}
          online={online}
          onRefresh={refreshDetail}
          onBack={() => {
            setDetail(null);
            setNotice('');
            void load(true);
          }}
          onDeleted={async () => {
            setDetail(null);
            setNotice('知识库已删除');
            await load(true);
          }}
        />
      ) : tab === 'engines' ? (
        <KnowledgeEngines
          engines={engines}
          online={online}
          onChanged={() => load(true)}
          onOpenBase={open}
        />
      ) : (
        <>
          <div className={styles.listToolbar}>
            <label className={styles.search}>
              <Glyph name="search" />
              <input
                aria-label="搜索知识库"
                placeholder="搜索知识库…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </label>
            <select
              aria-label="筛选知识引擎"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            >
              <option value="all">全部引擎</option>
              {groups.map((g) => (
                <option key={g.provider} value={g.provider}>
                  {g.name}
                </option>
              ))}
            </select>
            <span>{visible.length} 个知识库 · 单击选择，双击打开</span>
          </div>
          {visible.length === 0 ? (
            <div className={styles.empty}>
              <span className={styles.emptyGlyph}>
                <Glyph name="layers" size={36} />
              </span>
              <h2>{query ? '没有匹配的知识库' : '创建你的第一个知识库'}</h2>
              <p>上传教学文档，或关联已有知识库，再将它绑定到 AI 助手。</p>
              <button className={styles.primary} disabled={!online} onClick={() => setCreate(true)}>
                <Glyph name="plus" />
                创建知识库
              </button>
            </div>
          ) : (
            <div className={styles.libraryGrid}>
              {visible.map((base) => {
                const group = engines.find((g) =>
                  g.instances.some((i) => i.id === base.engine_instance_id),
                );
                return (
                  <button
                    className={`${styles.libraryCard} ${selectedId === base.id ? styles.librarySelected : ''}`}
                    aria-label={base.name}
                    aria-pressed={selectedId === base.id}
                    aria-describedby="library-selection-hint"
                    key={base.id}
                    disabled={busy}
                    onClick={() => setSelectedId(base.id)}
                    onDoubleClick={() => void open(base.id)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault();
                        void open(base.id);
                      }
                    }}
                  >
                    <span className={styles.selectionBox} aria-hidden="true">
                      {selectedId === base.id ? '✓' : ''}
                    </span>
                    <div className={styles.split}>
                      <EngineIcon group={group} size={36} />
                      <span
                        className={`${styles.badge} ${base.build_state === 'failed' ? styles.bad : ''}`}
                      >
                        {statusLabels[base.build_state] ?? base.build_state}
                      </span>
                    </div>
                    <h2>
                      {base.name}
                      {base.library_settings?.isDefault && <Glyph name="star" size={16} />}
                    </h2>
                    <p>
                      {group?.name ?? '历史资料库'} · {base.document_count} 份文档
                    </p>
                    <div className={styles.cardFooter}>
                      <span>{base.assistant_count ?? 0} 位助手</span>
                      <small>更新于 {time(base.updated_at)}</small>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
          <p id="library-selection-hint" className={styles.selectionHint}>
            单击知识库查看助手绑定，双击打开详情；键盘空格选择，Enter 打开。
          </p>
          <div
            ref={bindingContainer}
            className={styles.bindingContainer}
            style={{ minHeight: bindingHeight || undefined }}
          >
            {selectedBase ? (
              <LibraryAssistantBindings
                key={selectedBase.id}
                base={selectedBase}
                online={online}
                onBusyChange={setBusy}
                onSaved={() => load(true)}
              />
            ) : (
              <section className={styles.globalBindings} aria-label="检索助手绑定">
                <h2 className={styles.bindingTitle}>
                  <Glyph name="assistant" /> 检索助手绑定
                </h2>
                <p>请先选择一个知识库，查看和管理它绑定的 AI 助手。</p>
              </section>
            )}
          </div>
        </>
      )}
      {create && (
        <CreateLibraryModal
          engines={engines}
          assistants={assistants}
          models={models}
          online={online}
          onClose={() => setCreate(false)}
          onChanged={() => load(true)}
          onCreate={created}
        />
      )}
    </div>
  );
}
