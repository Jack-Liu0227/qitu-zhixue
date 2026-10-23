'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { KnowledgeBindingMatrix as Matrix } from '@qitu/contracts';
import { VisualBoundIcon } from '../VisualAssetPicker';
import {
  centerRequest,
  createKnowledgeBase,
  type Base,
  type BaseDetail,
  type EngineGroup,
} from '../../api/knowledge-center';
import { createIdempotentRetryKey, newIdempotencyKey } from '../../api/types';
import { KnowledgeEngines } from '../knowledge-engines/KnowledgeEngines';
import { CreateLibraryModal, type LibraryCreation } from './CreateLibraryModal';
import { KnowledgeBindingMatrix } from './KnowledgeBindingMatrix';
import { LibraryWorkspace } from './LibraryWorkspace';
import { RemoteConnectionChecks } from './RemoteConnectionChecks';
import { connectionDiagnostic } from './connection-checks';
import { Glyph, fileBase64, message, statusLabels, time, type ModelOption } from './shared';
import styles from './KnowledgeLibrary.module.css';

export function KnowledgeLibrary() {
  const [tab, setTab] = useState<'bases' | 'engines'>('bases');
  const [bases, setBases] = useState<Base[]>([]);
  const [engines, setEngines] = useState<EngineGroup[]>([]);
  const [models, setModels] = useState<ModelOption[]>([]);
  const [matrix, setMatrix] = useState<Matrix | null>(null);
  const [detail, setDetail] = useState<BaseDetail | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const [online, setOnline] = useState(true);
  const [create, setCreate] = useState(false);
  const [refreshToken, setRefreshToken] = useState(0);
  const generation = useRef(0);
  const detailGeneration = useRef(0);
  const retry = useRef(createIdempotentRetryKey());
  const load = useCallback(async (quiet = false) => {
    const current = ++generation.current;
    if (!quiet) setLoading(true);
    setError('');
    try {
      const [libraries, groups] = await Promise.all([
        centerRequest<Base[]>('knowledge/bases'),
        centerRequest<EngineGroup[]>('knowledge/engines'),
      ]);
      if (current !== generation.current) return;
      setBases(libraries);
      setEngines(groups);
    } catch (e) {
      if (current === generation.current) setError(message(e));
      throw e;
    } finally {
      if (current === generation.current) setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load().catch(() => {});
    const update = () => setOnline(navigator.onLine);
    update();
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      generation.current++;
      detailGeneration.current++;
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, [load]);
  const refreshed = useCallback(async () => {
    await load(true);
    setRefreshToken((token) => token + 1);
  }, [load]);
  const readMatrix = useCallback((value: Matrix) => setMatrix(value), []);
  async function configure(id: string) {
    if (checking) return;
    const token = ++detailGeneration.current;
    setBusy(true);
    setError('');
    setSelectedId(id);
    setDetail(null);
    try {
      const next = await centerRequest<BaseDetail>(`knowledge/bases/${encodeURIComponent(id)}`);
      if (token === detailGeneration.current) setDetail(next);
    } catch (e) {
      if (token === detailGeneration.current) setError(message(e));
    } finally {
      if (token === detailGeneration.current) setBusy(false);
    }
  }
  async function created(creation: LibraryCreation) {
    const base = await createKnowledgeBase(
      creation.request,
      retry.current.keyFor(JSON.stringify(creation.request)),
    );
    retry.current.acknowledge();
    const failures: string[] = [];
    for (const file of creation.files) {
      try {
        await centerRequest(
          `knowledge/bases/${encodeURIComponent(base.id)}/uploads`,
          'POST',
          { fileName: file.name, base64: await fileBase64(file) },
          newIdempotencyKey(),
        );
      } catch (e) {
        failures.push(`${file.name}：${message(e)}`);
      }
    }
    setCreate(false);
    setSelectedId(base.id);
    await refreshed();
    setNotice(
      failures.length
        ? `知识库已创建，部分文档导入失败：${failures.join('；')}`
        : '知识库已创建，可在下方矩阵绑定助手。',
    );
    document.getElementById('knowledge-binding-matrix')?.scrollIntoView({ behavior: 'smooth' });
  }
  const visible = bases.filter(
    (b) =>
      b.kind !== 'project' &&
      b.name.toLowerCase().includes(query.toLowerCase()) &&
      (filter === 'all' ||
        engines
          .find((g) => g.provider === filter)
          ?.instances.some((i) => i.id === b.engine_instance_id)),
  );
  return (
    <div className={`admin-settings-page ${styles.root}`}>
      <div hidden={!!detail}>
        <div className="settings-pagehead">
          <div className="settings-titlebox">
            <h1>知识中心</h1>
            <div className="settings-desc">配置知识库，统一管理助手可使用的教学资料</div>
          </div>
          {tab === 'bases' && (
            <button
              className={styles.primary}
              disabled={!online || loading || busy || checking}
              onClick={async () => {
                setBusy(true);
                setError('');
                try {
                  setModels(await centerRequest<ModelOption[]>('knowledge/engine-models'));
                  setCreate(true);
                } catch (e) {
                  setError(message(e));
                } finally {
                  setBusy(false);
                }
              }}
            >
              <Glyph name="plus" />
              添加知识库
            </button>
          )}
        </div>
        <nav className={styles.mainTabs} aria-label="知识中心视图">
          <button role="tab" aria-selected={tab === 'bases'} onClick={() => setTab('bases')}>
            知识库
          </button>
          <button
            role="tab"
            disabled={checking}
            aria-selected={tab === 'engines'}
            onClick={() => setTab('engines')}
          >
            知识引擎
          </button>
        </nav>
        {error && (
          <div className={styles.error} role="alert">
            {error}
            <button className={styles.textButton} onClick={() => void refreshed().catch(() => {})}>
              重新读取
            </button>
          </div>
        )}
        {notice && (
          <div className={styles.notice} role="status">
            {notice}
          </div>
        )}
        {busy && !detail && <p role="status">正在读取知识库…</p>}
        {!online && <p className={styles.error}>当前离线，可查看已读取配置，恢复网络后再保存。</p>}
        {loading && (
          <div className={styles.empty} role="status">
            正在读取知识库配置…
          </div>
        )}
        <div hidden={tab !== 'engines' || loading}>
          <KnowledgeEngines
            engines={engines}
            online={online}
            onChanged={refreshed}
            onOpenBase={configure}
          />
        </div>
        <div hidden={tab !== 'bases'}>
          <RemoteConnectionChecks
            online={online}
            disabled={loading || busy || !!detail || create}
            onBusyChange={setChecking}
            onChanged={refreshed}
            onConfigure={configure}
          />
          {!loading && (
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
                  {engines
                    .filter((g) => g.instances.length)
                    .map((g) => (
                      <option value={g.provider} key={g.provider}>
                        {g.name}
                      </option>
                    ))}
                </select>
                <span>{error ? '配置读取异常' : `${visible.length} 个知识库`}</span>
              </div>
              {!error && !visible.length && (
                <div className={styles.empty}>
                  <Glyph name="layers" size={32} />
                  <h2>{query ? '没有匹配的知识库' : '先配置知识库，再绑定助手'}</h2>
                  <p>可新建本地索引库，或关联已有的远端知识库。</p>
                </div>
              )}
              <div className={styles.libraryGrid}>
                {visible.map((base) => {
                  const state = matrix?.libraries.find((l) => l.id === base.id);
                  const group = engines.find((g) =>
                    g.instances.some((i) => i.id === base.engine_instance_id),
                  );
                  const stateText = !state
                    ? '状态待核验'
                    : !state.enabled
                      ? '已停用'
                      : state.reasons.length
                        ? state.reasons.join('，')
                        : state.connectionStatus
                          ? connectionDiagnostic(
                              state.connectionStatus,
                              state.lastErrorCode,
                              state.lastCheckedAt,
                            ).label
                          : (statusLabels[state.buildState] ?? state.buildState);
                  return (
                    <article className={styles.libraryCard} key={base.id}>
                      <div className={styles.split}>
                        <VisualBoundIcon owner={{ kind: 'knowledge', id: base.id }} size={34} />
                        <span
                          className={`${styles.badge} ${state?.reasons.length ? styles.bad : ''}`}
                        >
                          {stateText}
                        </span>
                      </div>
                      <h2>{base.name}</h2>
                      <p>{group?.name ?? '未配置引擎'}</p>
                      {state?.connectionStatus && state.lastErrorCode && (
                        <p>
                          {
                            connectionDiagnostic(
                              state.connectionStatus,
                              state.lastErrorCode,
                              state.lastCheckedAt,
                            ).label
                          }{' '}
                          · {state.lastErrorCode}
                        </p>
                      )}
                      <p>
                        最近检查：
                        {state?.connectionStatus ? time(state.lastCheckedAt) : '索引构建后验证'}
                      </p>
                      <div className={styles.cardFooter}>
                        <span>
                          {matrix
                            ? matrix.bindings.filter(
                                (b) => b.knowledgeBaseId === base.id && b.enabled,
                              ).length
                            : '未知'}{' '}
                          位助手已绑定
                        </span>
                        <button
                          className={styles.textButton}
                          disabled={busy || checking}
                          onClick={() => void configure(base.id)}
                        >
                          查看与编辑
                        </button>
                      </div>
                    </article>
                  );
                })}
              </div>
            </>
          )}
          <KnowledgeBindingMatrix
            online={online}
            blocked={checking}
            refreshToken={refreshToken}
            focusLibraryId={selectedId}
            onRead={readMatrix}
          />
          <p>通过「查看与编辑」浏览文件并维护知识库；助手授权在此矩阵统一配置。</p>
        </div>
      </div>
      {create && (
        <CreateLibraryModal
          engines={engines}
          models={models}
          online={online}
          onClose={() => setCreate(false)}
          onChanged={refreshed}
          onCreate={created}
        />
      )}
      {detail && (
        <LibraryWorkspace
          key={detail.id}
          detail={detail}
          engines={engines}
          online={online}
          onBack={() => {
            detailGeneration.current++;
            setDetail(null);
          }}
          onBindings={() => {
            setDetail(null);
            setTab('bases');
            requestAnimationFrame(() =>
              document
                .getElementById('knowledge-binding-matrix')
                ?.scrollIntoView({ behavior: 'smooth' }),
            );
          }}
          onChanged={refreshed}
        />
      )}
    </div>
  );
}
