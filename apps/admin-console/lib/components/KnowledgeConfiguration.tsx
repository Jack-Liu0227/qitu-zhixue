'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { AdminRuntimeSnapshot } from '@qitu/contracts';
import {
  centerRequest,
  fetchCenterConfig,
  fetchToolCatalog,
  saveCenterConfig,
  type CenterConfig,
  type Engine,
  type EngineGroup,
  type ToolCatalog,
} from '../api/knowledge-center';
import { fetchRuntimeSnapshot } from '../api/runtime';
import { fetchAdminAssistantConfigs } from '../api/assistants';
import { createIdempotentRetryKey } from '../api/types';
import { ToolParameters } from './ToolParameters';
import styles from './KnowledgeConfiguration.module.css';
const PROJECT = 'platformTools/project-knowledge';
const providers = [
  'llamaindex',
  'pageindex-oss',
  'graphrag',
  'lightrag',
  'lightrag-server',
  'pageindex',
  'ima',
  'weknora',
  'obsidian',
  'marginnote',
  'kiwix',
];
const healthLabels: Record<string, string> = {
  connected: '连接正常',
  disconnected: '未连接',
  error: '连接异常',
  not_configured: '未配置',
  unknown: '未检查',
  ready: '可用',
  healthy: '检查通过',
  degraded: '能力受限',
  unavailable: '不可用',
};
const message = (e: unknown) => (e instanceof Error ? e.message : '请求失败，请重试');
const json = (value: unknown) => JSON.stringify(value, null, 2);
function valueAt(state: CenterConfig, target: string): unknown {
  const [section, id] = target.split('/');
  if (target === 'global')
    return {
      ...state.config,
      knowledgeEngines: Object.fromEntries(
        Object.keys(state.config.knowledgeEngines).map((id) => [
          id,
          valueAt(state, `knowledgeEngines/${id}`),
        ]),
      ),
    };
  if (section === 'knowledgeEngines') {
    const engine = state.config.knowledgeEngines[id!];
    if (engine && ['lightrag-server', 'pageindex', 'ima', 'weknora'].includes(engine.provider))
      return {
        ...engine,
        config: {
          server_url:
            engine.provider === 'ima'
              ? 'https://ima.qq.com'
              : engine.provider === 'pageindex'
                ? 'https://api.pageindex.ai'
                : '',
          apiKey: '',
          ...(engine.provider === 'ima' ? { clientId: '' } : {}),
          ...(engine.provider === 'weknora' ? { remoteKnowledgeBaseId: '' } : {}),
          ...engine.config,
        },
      };
    return engine;
  }
  if (section === 'mcpServers') return state.config.mcpServers[id!];
  return state.config.platformTools['project-knowledge'];
}
export function KnowledgeConfiguration({
  preview = false,
  onMode,
}: {
  preview?: boolean;
  onMode: (mode: 'matrix' | 'edit' | 'preview') => void;
}) {
  const [snapshot, setSnapshot] = useState<CenterConfig | null>(null);
  const snapshotRef = useRef<CenterConfig | null>(null);
  const [runtime, setRuntime] = useState<AdminRuntimeSnapshot | null>(null);
  const [assistants, setAssistants] = useState<Record<string, string>>({});
  const [groups, setGroups] = useState<EngineGroup[]>([]);
  const [target, setTarget] = useState('global');
  const [draft, setDraft] = useState('');
  const [baseline, setBaseline] = useState('');
  const [staged, setStaged] = useState<{ id: string; engine: Engine } | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [catalogs, setCatalogs] = useState<Record<string, ToolCatalog>>({});
  const [catalogPending, setCatalogPending] = useState<Record<string, boolean>>({});
  const [catalogErrors, setCatalogErrors] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [metadataError, setMetadataError] = useState('');
  const [nextAction, setNextAction] = useState<(() => void) | null>(null);
  const [dialog, setDialog] = useState<'engine' | 'mcp' | null>(null);
  const [provider, setProvider] = useState('llamaindex');
  const [newId, setNewId] = useState('');
  const retry = useRef(createIdempotentRetryKey());
  const catalogRequests = useRef(new Set<string>());
  const dirty = draft !== baseline || staged !== null;
  const loadMetadata = useCallback(async () => {
    const [r, a, e] = await Promise.allSettled([
      fetchRuntimeSnapshot(),
      fetchAdminAssistantConfigs(),
      centerRequest<EngineGroup[]>('knowledge/engines'),
    ]);
    if (r.status === 'fulfilled') setRuntime(r.value);
    if (a.status === 'fulfilled')
      setAssistants(Object.fromEntries(a.value.map((item) => [item.id, item.name])));
    if (e.status === 'fulfilled') setGroups(e.value);
    setMetadataError(
      [r, a, e].some((result) => result.status === 'rejected')
        ? '部分状态读取失败，未读取的状态显示为未知。可重新读取。'
        : '',
    );
  }, []);
  const load = useCallback(
    async (initial = false) => {
      setPending(true);
      setError('');
      try {
        const state = await fetchCenterConfig();
        const engine = initial
          ? new URLSearchParams(window.location.search).get('knowledgeEngine')
          : null;
        const selected =
          engine && state.config.knowledgeEngines[engine] ? `knowledgeEngines/${engine}` : 'global';
        snapshotRef.current = state;
        setSnapshot(state);
        setTarget(selected);
        setDraft(json(valueAt(state, selected)));
        setBaseline(json(valueAt(state, selected)));
        setStaged(null);
        setCatalogs({});
        if (engine) setExpanded((old) => ({ ...old, [PROJECT]: true }));
        await loadMetadata();
      } catch (e) {
        setError(message(e));
      } finally {
        setPending(false);
      }
    },
    [loadMetadata],
  );
  useEffect(() => {
    void load(true);
  }, [load]);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (dirty) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
  // Deep links expand the parent as well as reading its real tool definitions.
  useEffect(() => {
    if (
      snapshot &&
      expanded[PROJECT] &&
      !catalogs[PROJECT] &&
      !catalogPending[PROJECT] &&
      !catalogErrors[PROJECT]
    )
      void fetchCatalog(PROJECT);
  });
  function guard(action: () => void) {
    if (dirty) setNextAction(() => action);
    else action();
  }
  function select(key: string) {
    if (key === target || !snapshot || pending) return;
    guard(() => {
      const state = snapshotRef.current!;
      setStaged(null);
      setTarget(key);
      const text = json(valueAt(state, key));
      setDraft(text);
      setBaseline(text);
      setError('');
      setNotice('');
    });
  }
  async function save(): Promise<boolean> {
    if (!snapshot) return false;
    setPending(true);
    setError('');
    try {
      const parsed: unknown = JSON.parse(draft);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
        throw new Error('配置必须是 JSON 对象');
      const config = structuredClone(snapshot.config);
      const [section, id] = target.split('/');
      if (section === 'knowledgeEngines') config.knowledgeEngines[id!] = parsed as Engine;
      else if (section === 'mcpServers') config.mcpServers[id!] = parsed as Record<string, unknown>;
      else if (target !== 'global')
        config.platformTools['project-knowledge'] =
          parsed as CenterConfig['config']['platformTools']['project-knowledge'];
      const body = {
        expectedRevision: snapshot.revision,
        config: target === 'global' ? (parsed as CenterConfig['config']) : config,
      };
      const state = await saveCenterConfig(body, retry.current.keyFor(JSON.stringify(body)));
      snapshotRef.current = state;
      setSnapshot(state);
      setStaged(null);
      const text = json(valueAt(state, target));
      setDraft(text);
      setBaseline(text);
      retry.current.acknowledge();
      setNotice(`配置已保存 · 修订 ${state.revision}`);
      window.dispatchEvent(new Event('qitu-configuration-changed'));
      void loadMetadata();
      return true;
    } catch (e) {
      setError(message(e));
      return false;
    } finally {
      setPending(false);
    }
  }
  async function fetchCatalog(key: string, refresh = false) {
    if (catalogRequests.current.has(key) || key === `knowledgeEngines/${staged?.id}`) return;
    catalogRequests.current.add(key);
    setCatalogPending((old) => ({ ...old, [key]: true }));
    setCatalogErrors((old) => ({ ...old, [key]: '' }));
    try {
      const result = await fetchToolCatalog(key, refresh);
      setCatalogs((old) => ({ ...old, [key]: result }));
    } catch (e) {
      setCatalogErrors((old) => ({ ...old, [key]: message(e) }));
      setCatalogs((old) => (old[key] ? { ...old, [key]: { ...old[key]!, stale: true } } : old));
    } finally {
      catalogRequests.current.delete(key);
      setCatalogPending((old) => ({ ...old, [key]: false }));
    }
  }
  function expand(key: string) {
    setExpanded((old) => ({ ...old, [key]: !old[key] }));
    if (!expanded[key] && !catalogs[key]) void fetchCatalog(key);
  }
  const toolList = (key: string) => (
    <ToolParameters
      catalog={catalogs[key]}
      pending={catalogPending[key]}
      error={catalogErrors[key]}
      onRefresh={() => void fetchCatalog(key, true)}
    />
  );
  function format() {
    try {
      setDraft(json(JSON.parse(draft)));
      setError('');
    } catch {
      setError('JSON 格式不正确，请检查后重试。');
    }
  }
  function addEngine() {
    const state = snapshotRef.current;
    if (!state) return;
    if (
      !/^[a-z][a-z0-9-]{0,79}$/.test(newId) ||
      Object.hasOwn(state.config.knowledgeEngines, newId)
    ) {
      setError('引擎 ID 须使用小写字母、数字和连字符，且不能重复。');
      return;
    }
    const engine: Engine = {
      name: provider,
      description: '',
      provider,
      enabled: false,
      config: {},
    };
    setStaged({ id: newId, engine });
    setTarget(`knowledgeEngines/${newId}`);
    setDraft(json(engine));
    setBaseline('');
    setExpanded((old) => ({ ...old, [PROJECT]: true }));
    setDialog(null);
    setError('');
    setNotice('新引擎尚未保存，请在右侧补充配置并保存。');
  }
  async function check() {
    if (dirty) {
      setError('请先保存当前配置，再检查连接与依赖。');
      return;
    }
    setPending(true);
    setError('');
    try {
      const result = await centerRequest<{ ok: boolean; errorCode?: string }>(
        `knowledge/engines/${encodeURIComponent(target.split('/')[1]!)}/check`,
        'POST',
        {},
        retry.current.keyFor(`check:${target}:${Date.now()}`),
      );
      setNotice(result.ok ? '引擎预检通过' : `预检未通过：${result.errorCode ?? '未知状态'}`);
      await loadMetadata();
    } catch (e) {
      setError(message(e));
    } finally {
      setPending(false);
    }
  }
  const engines = {
    ...snapshot?.config.knowledgeEngines,
    ...(staged ? { [staged.id]: staged.engine } : {}),
  };
  const current = snapshot
    ? staged && target === `knowledgeEngines/${staged.id}`
      ? staged.engine
      : valueAt(snapshot, target)
    : null;
  const currentObject = current as Record<string, unknown> | null;
  let draftEnabled: boolean | null = null;
  try {
    const parsed = JSON.parse(draft);
    if (typeof parsed?.enabled === 'boolean') draftEnabled = parsed.enabled;
  } catch {
    /* Invalid drafts remain editable. */
  }
  const projectBindings = snapshot?.config.platformTools['project-knowledge'].boundAssistants ?? [];
  const bound = target.startsWith('mcpServers/')
    ? (runtime?.agents
        .filter((a) => a.mcpServerIds.includes(target.split('/')[1]!))
        .map((a) => ({ id: a.id, name: a.label })) ?? [])
    : projectBindings.map((id) => ({ id, name: assistants[id] ?? id }));
  const title =
    target === 'global'
      ? '总配置（mcpServers 全局）'
      : `${String(currentObject?.name ?? target.split('/')[1])}.json（单独配置）`;
  const engineHealth = (id: string) => {
    const instance = groups.flatMap((g) => g.instances).find((e) => e.id === id);
    const status =
      instance && instance.revision === snapshot?.revision ? instance.health?.health_status : null;
    return status ? (healthLabels[status] ?? status) : '未检查';
  };
  return (
    <div className={`${styles.page} admin-tools-page-view`}>
      <header className={styles.header}>
        <h1>工具与 MCP 配置中心</h1>
        <p>
          支持智能体授权矩阵、总的 mcpServers 全局配置与任意单个 MCP 的独立 JSON
          设置。编辑与预览自由切换。
        </p>
        <div className={styles.actions}>
          <div className={styles.tabs} role="tablist" aria-label="配置视图">
            <button
              type="button"
              role="tab"
              aria-selected={false}
              onClick={() => guard(() => onMode('matrix'))}
            >
              📊 智能体授权矩阵
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={!preview}
              onClick={() => onMode('edit')}
            >
              📝 JSON 配置编辑
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={preview}
              onClick={() => onMode('preview')}
            >
              👁️ JSON 实时预览
            </button>
          </div>
          <button
            type="button"
            className={`${styles.button} ${styles.primary}`}
            onClick={() => guard(() => setDialog('mcp'))}
          >
            ＋ 添加 MCP
          </button>
        </div>
      </header>
      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className={styles.notice}>
          {notice}
        </p>
      )}
      {metadataError && (
        <p role="status" className={styles.warning}>
          {metadataError}
        </p>
      )}
      {!snapshot ? (
        <section className={styles.card}>
          <p role="status">{pending ? '正在读取服务器配置…' : '服务器配置未读取。'}</p>
          {!pending && (
            <button className={styles.button} onClick={() => void load(true)}>
              重新读取
            </button>
          )}
        </section>
      ) : (
        <div className={styles.workspace} aria-busy={pending}>
          <aside className={styles.card} aria-label="配置目标与清单">
            <div className={styles.cardHeading}>
              <strong>配置目标与清单</strong>
              <span>切换编辑对象</span>
            </div>
            <button
              type="button"
              className={`${styles.target} ${target === 'global' ? styles.selected : ''}`}
              onClick={() => select('global')}
            >
              <strong>🌐 总配置（mcpServers 全局）</strong>
              <span>全局</span>
              <p>
                统一管理 {Object.keys(snapshot.config.mcpServers).length} 个 MCP
                服务及知识引擎、知识库工具扩展。
              </p>
            </button>
            <h3 className={styles.sectionTitle}>单个 MCP 独立设置（点击单独配置）</h3>
            {Object.entries(snapshot.config.mcpServers).map(([id, server]) => {
              const key = `mcpServers/${id}`;
              const live = runtime?.mcpServers.find((m) => m.id === id);
              const count = Array.isArray(server.tools) ? server.tools.length : 0;
              return (
                <div
                  className={`${styles.target} ${target === key ? styles.selected : ''}`}
                  key={key}
                >
                  <div className={styles.targetHeading}>
                    <button
                      type="button"
                      className={styles.arrow}
                      aria-label={`展开 ${String(server.name)} 子工具`}
                      aria-expanded={!!expanded[key]}
                      onClick={() => expand(key)}
                    >
                      {expanded[key] ? '▾' : '▸'}
                    </button>
                    <button type="button" className={styles.targetName} onClick={() => select(key)}>
                      {String(server.name)}
                    </button>
                    <span className={styles.badge}>
                      {live ? (healthLabels[live.status] ?? live.status) : '状态未知'}
                    </span>
                  </div>
                  <p>
                    {server.enabled ? '允许调用' : '已停用'} · {count} 个工具 ·{' '}
                    {runtime
                      ? runtime.agents.filter((a) => a.mcpServerIds.includes(id)).length
                      : '未知'}{' '}
                    个智能体绑定
                  </p>
                  {expanded[key] && toolList(key)}
                </div>
              );
            })}
            <div className={`${styles.target} ${target === PROJECT ? styles.selected : ''}`}>
              <div className={styles.targetHeading}>
                <button
                  type="button"
                  className={styles.arrow}
                  aria-label="展开知识库"
                  aria-expanded={!!expanded[PROJECT]}
                  onClick={() => expand(PROJECT)}
                >
                  {expanded[PROJECT] ? '▾' : '▸'}
                </button>
                <button
                  type="button"
                  className={styles.targetName}
                  onClick={() => {
                    select(PROJECT);
                    if (!expanded[PROJECT]) expand(PROJECT);
                  }}
                >
                  知识库
                </button>
                <span className={styles.badge}>
                  {snapshot.config.platformTools['project-knowledge'].enabled
                    ? '允许调用'
                    : '已停用'}
                </span>
              </div>
              <p>
                {projectBindings.length} 个智能体绑定 · {Object.keys(engines).length} 个知识引擎
              </p>
              {expanded[PROJECT] && (
                <div className={styles.children}>
                  {toolList(PROJECT)}
                  <h3 className={styles.sectionTitle}>知识引擎</h3>
                  {Object.entries(engines).map(([id, engine]) => {
                    const key = `knowledgeEngines/${id}`;
                    return (
                      <div
                        key={key}
                        className={`${styles.engine} ${target === key ? styles.selected : ''}`}
                      >
                        <div className={styles.targetHeading}>
                          <button
                            type="button"
                            className={styles.arrow}
                            aria-label={`展开 ${engine.name} 子工具`}
                            aria-expanded={!!expanded[key]}
                            onClick={() => expand(key)}
                          >
                            {expanded[key] ? '▾' : '▸'}
                          </button>
                          <button
                            type="button"
                            className={styles.targetName}
                            onClick={() => select(key)}
                          >
                            {engine.name}
                          </button>
                        </div>
                        <small>
                          {id} · {engine.provider}
                        </small>
                        <p>
                          {staged?.id === id
                            ? '未保存草稿'
                            : `${engine.enabled ? '已启用' : '已停用'} · ${engineHealth(id)}`}
                        </p>
                        {expanded[key] &&
                          (staged?.id === id ? (
                            <p className={styles.hint}>保存后可读取工具目录。</p>
                          ) : (
                            toolList(key)
                          ))}
                      </div>
                    );
                  })}
                  {!preview && (
                    <button
                      type="button"
                      className={styles.link}
                      onClick={() =>
                        guard(() => {
                          setNewId('');
                          setDialog('engine');
                        })
                      }
                    >
                      ＋ 添加知识引擎
                    </button>
                  )}
                </div>
              )}
            </div>
          </aside>
          <section className={`${styles.card} ${styles.editorCard}`} aria-label="JSON 配置工作区">
            <div className={styles.cardHeading}>
              <div>
                <strong>⚙️ {title}</strong>
                <small>
                  {preview ? '当前处于 JSON 只读预览态' : '当前处于 JSON 源码编辑态'} · 修订{' '}
                  {snapshot.revision}
                  {dirty ? ' · 未保存' : ''}
                </small>
              </div>
              <div className={styles.actions}>
                {draftEnabled !== null && (
                  <label className={styles.switch}>
                    <input
                      type="checkbox"
                      checked={draftEnabled}
                      disabled={preview || pending}
                      onChange={(e) => {
                        try {
                          setDraft(json({ ...JSON.parse(draft), enabled: e.target.checked }));
                        } catch {
                          setError('请先修复 JSON 格式');
                        }
                      }}
                    />
                    允许调用
                  </label>
                )}
                {target.startsWith('knowledgeEngines/') && (
                  <button
                    type="button"
                    className={styles.button}
                    disabled={pending || !!staged}
                    onClick={() => void check()}
                  >
                    检查连接
                  </button>
                )}
                <button
                  type="button"
                  className={styles.button}
                  disabled={pending}
                  onClick={() => guard(() => void load())}
                >
                  重新读取
                </button>
                {!preview && (
                  <>
                    <button
                      type="button"
                      className={styles.button}
                      disabled={pending}
                      onClick={format}
                    >
                      ✨ 格式化 JSON
                    </button>
                    <button
                      type="button"
                      className={`${styles.button} ${styles.primary}`}
                      disabled={pending}
                      onClick={() => void save()}
                    >
                      ▣ 保存配置
                    </button>
                  </>
                )}
              </div>
            </div>
            <p className={styles.hint}>
              {target === 'global'
                ? '全局包含 mcpServers、knowledgeEngines、platformTools；修改后统一校验并保存。'
                : target.startsWith('knowledgeEngines/')
                  ? '配置此知识引擎实例；URL 使用 server_url，账户 ID 使用 clientId，API Key 使用 apiKey。与知识中心表单同步。'
                  : target === PROJECT
                    ? '修改 enabled 与 boundAssistants（助手 ID）。仅检索管理员授权的知识库，无需为项目单独建库。'
                    : '编辑已注册服务的名称、开关与授权工具；连接地址和凭证由服务器管理。'}
            </p>
            <textarea
              aria-label="平台 JSON 配置"
              className={styles.editor}
              value={draft}
              spellCheck={false}
              readOnly={preview || pending}
              onChange={(e) => setDraft(e.target.value)}
            />
            {target !== 'global' && (
              <div className={styles.bindings}>
                <strong>
                  {target.startsWith('knowledgeEngines/')
                    ? '知识库共用的智能体授权'
                    : '已授权使用的智能体'}
                </strong>
                <p>
                  {target.startsWith('knowledgeEngines/')
                    ? '引擎用于手动建库与检索，对话使用统一知识库授权。'
                    : '授权状态与智能体授权矩阵共用。'}
                </p>
                <div className={styles.tags}>
                  {bound.map((a) => (
                    <span key={a.id}>✓ {a.name}</span>
                  ))}
                  {!bound.length && <small>暂无已读取的授权绑定。</small>}
                </div>
                <button
                  type="button"
                  className={styles.link}
                  onClick={() => guard(() => onMode('matrix'))}
                >
                  前往智能体授权矩阵
                </button>
              </div>
            )}
          </section>
        </div>
      )}
      {nextAction && (
        <div className={styles.backdrop}>
          <section
            className={styles.dialog}
            role="dialog"
            aria-modal="true"
            aria-labelledby="unsaved-title"
          >
            <h2 id="unsaved-title">当前配置尚未保存</h2>
            <p>保存后继续，或放弃本次修改。</p>
            <div className={styles.actions}>
              <button className={styles.button} onClick={() => setNextAction(null)}>
                取消
              </button>
              <button
                className={styles.button}
                disabled={pending}
                onClick={() => {
                  const action = nextAction;
                  setNextAction(null);
                  setStaged(null);
                  const state = snapshotRef.current!;
                  const key = staged ? 'global' : target;
                  const text = json(valueAt(state, key));
                  setTarget(key);
                  setDraft(text);
                  setBaseline(text);
                  action();
                }}
              >
                放弃修改
              </button>
              <button
                className={`${styles.button} ${styles.primary}`}
                disabled={pending}
                onClick={async () => {
                  const action = nextAction;
                  if (await save()) {
                    setNextAction(null);
                    action();
                  }
                }}
              >
                保存后继续
              </button>
            </div>
          </section>
        </div>
      )}
      {dialog && (
        <div className={styles.backdrop}>
          <section
            className={styles.dialog}
            role="dialog"
            aria-modal="true"
            aria-labelledby="add-title"
          >
            <h2 id="add-title">{dialog === 'engine' ? '添加知识引擎' : '添加 MCP'}</h2>
            {dialog === 'engine' ? (
              <>
                <label>
                  引擎类型
                  <select
                    aria-label="引擎类型"
                    value={provider}
                    onChange={(e) => setProvider(e.target.value)}
                  >
                    {providers.map((p) => (
                      <option key={p}>{p}</option>
                    ))}
                  </select>
                </label>
                <label>
                  实例 ID
                  <input
                    aria-label="引擎实例 ID"
                    value={newId}
                    onChange={(e) => setNewId(e.target.value)}
                    placeholder={`${provider}-main`}
                  />
                </label>
                <p>新实例默认关闭。配置保存与连接预检分别显示状态。</p>
                {error && (
                  <p role="alert" className={styles.error}>
                    {error}
                  </p>
                )}
              </>
            ) : (
              <p>
                当前环境支持编辑已注册的
                MCP。新增服务须先在服务器登记连接与工具定义；登记后重新读取即可配置和授权。知识引擎请从“知识库”中添加。
              </p>
            )}
            <div className={styles.actions}>
              <button className={styles.button} onClick={() => setDialog(null)}>
                取消
              </button>
              {dialog === 'engine' && (
                <button className={`${styles.button} ${styles.primary}`} onClick={addEngine}>
                  生成配置草稿
                </button>
              )}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
