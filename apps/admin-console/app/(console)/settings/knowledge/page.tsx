'use client';
import Link from 'next/link';
import { KnowledgeEngines } from '../../../../lib/components/knowledge-engines/KnowledgeEngines';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  cancelKnowledgeJob,
  centerRequest,
  createKnowledgeBase,
  createKnowledgeSource,
  fetchAssistantBindings,
  fetchBaseBindings,
  fetchCenterConfig,
  probeLinkedBase,
  saveAssistantBindings,
  saveBaseBindings,
  syncKnowledgeSource,
  type AssistantBindings,
  type Base,
  type BaseDetail,
  type BindingMode,
  type EngineGroup,
  type CenterConfig,
  type KnowledgeBinding,
  type LinkProbeResult,
  type ReadinessStatus,
} from '../../../../lib/api/knowledge-center';
import { createIdempotentRetryKey } from '../../../../lib/api/types';
import { AdminStateViews } from '../../../../lib/components/AdminStateViews';
import { KnowledgeFileUpload } from '../../../../lib/components/KnowledgeFileUpload';
const readinessLabels: Record<string, string> = {
  ready: 'Ready',
  needs_key: 'Needs key',
  needs_setup: 'Needs setup',
  not_installed: 'Not installed',
  unavailable: 'Unavailable',
};
const groupLabels: Record<string, string> = {
  local: '本地引擎',
  server: '服务器引擎',
  cloud: '云服务',
  external: '外部知识源',
  Local: '本地引擎',
  Server: '服务器引擎',
  Cloud: '云服务',
  External: '外部知识源',
};
function engineStatus(instance: EngineGroup['instances'][number]): ReadinessStatus {
  return (instance.health?.status ??
    instance.health?.health_status ??
    'unavailable') as ReadinessStatus;
}
function statusText(status: string) {
  return readinessLabels[status] ?? status;
}
function providerFields(provider: string) {
  if (provider === 'kiwix') return ['serverUrl', 'zimName'];
  if (provider === 'marginnote' || provider === 'marginnote4') return ['deviceId', 'serverUrl'];
  if (provider === 'obsidian' || provider === 'linked') return ['externalPath'];
  if (provider === 'weknora') return ['serverUrl', 'remoteKnowledgeBaseId'];
  if (provider === 'ima') return ['remoteKnowledgeBaseId'];
  if (provider === 'lightrag-server') return ['serverUrl', 'workspace'];
  return [];
}
function fieldLabel(field: string) {
  return (
    (
      {
        externalPath: '服务端允许的索引路径',
        serverUrl: '服务端地址',
        remoteKnowledgeBaseId: '远端知识库 ID',
        zimName: 'ZIM 名称',
        deviceId: '设备 ID',
        workspace: '工作区',
      } as Record<string, string>
    )[field] ?? field
  );
}
const states: Record<string, string> = {
  queued: '等待准备',
  discovering: '发现资料',
  planning: '选择资料',
  collecting: '收集原文',
  parsing: '解析资料',
  indexing: '建立索引',
  validating: '验证索引',
  ready: '可用',
  failed: '准备失败',
  empty: '暂无授权资料',
  unindexed: '尚未建立索引',
  cancelled: '已取消',
};
export default function KnowledgeCenterPage() {
  const [tab, setTab] = useState<'bases' | 'engines'>('bases');
  const [bases, setBases] = useState<Base[]>([]);
  const [engines, setEngines] = useState<EngineGroup[]>([]);
  const [configuration, setConfiguration] = useState<CenterConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState('all');
  const [detail, setDetail] = useState<BaseDetail | null>(null);

  const [newBase, setNewBase] = useState(false);
  const [createStep, setCreateStep] = useState<1 | 2 | 3>(1);
  const [name, setName] = useState('');
  const [engine, setEngine] = useState('');
  const [retrievalMode, setRetrievalMode] = useState('hybrid');
  const [createMode, setCreateMode] = useState<'create_new' | 'link_existing'>('create_new');
  const [connectionFields, setConnectionFields] = useState<Record<string, string>>({});
  const [preflight, setPreflight] = useState<{
    ok: boolean;
    message: string;
    result?: LinkProbeResult;
  } | null>(null);
  const [preflightBusy, setPreflightBusy] = useState(false);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [materialize, setMaterialize] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const retry = useRef(createIdempotentRetryKey());
  const [bindings, setBindings] = useState<AssistantBindings | null>(null);
  const [bindingDraft, setBindingDraft] = useState<string[] | null>(null);
  const [bindingError, setBindingError] = useState<Error | null>(null);
  const [preview, setPreview] = useState<{ title: string; content: string } | null>(null);
  const [jobRecord, setJobRecord] = useState<{
    events: { state: string; detail: Record<string, unknown>; occurred_at: string }[];
  } | null>(null);
  const [online, setOnline] = useState(true);
  const [baseBindings, setBaseBindings] = useState<KnowledgeBinding[] | null>(null);
  const [bindingRevision, setBindingRevision] = useState(0);
  const [baseBindingDraft, setBaseBindingDraft] = useState<KnowledgeBinding[]>([]);
  const [baseBindingError, setBaseBindingError] = useState<Error | null>(null);
  const [sourceKind, setSourceKind] = useState<'folder' | 'github' | 'web'>('folder');
  const [sourceValue, setSourceValue] = useState('');
  useEffect(() => {
    const updateOnline = () => setOnline(navigator.onLine);
    updateOnline();
    window.addEventListener('online', updateOnline);
    window.addEventListener('offline', updateOnline);
    return () => {
      window.removeEventListener('online', updateOnline);
      window.removeEventListener('offline', updateOnline);
    };
  }, []);
  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    setError(null);
    try {
      const [b, e, c, ab] = await Promise.all([
        centerRequest<Base[]>('knowledge/bases'),
        centerRequest<EngineGroup[]>('knowledge/engines'),
        fetchCenterConfig(),
        fetchAssistantBindings().catch(() => null),
      ]);
      setBases(b);
      setEngines(e);
      setConfiguration(c);
      setEngine(Object.keys(c.config.knowledgeEngines)[0] ?? '');
      setBindings(ab);
      setBindingDraft(ab ? [...ab.assistantIds] : null);
      setBindingError(ab ? null : new Error('助手绑定读取失败（权限或存储不可用）'));
    } catch (e) {
      setError(e instanceof Error ? e : new Error('知识中心读取失败'));
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    const refresh = () => void load();
    // Refresh explicitly; focus must not discard an in-progress engine draft.
    window.addEventListener('qitu-configuration-changed', refresh);
    return () => {
      window.removeEventListener('qitu-configuration-changed', refresh);
    };
  }, [load]);
  async function open(id: string) {
    setBusy(true);
    setError(null);
    try {
      const result = await centerRequest<BaseDetail>(`knowledge/bases/${encodeURIComponent(id)}`);
      setDetail(result);
      setBaseBindingError(null);
      try {
        const bindingData = result.bindings ?? (await fetchBaseBindings(id));
        const availableBindings = bindingData.catalog ?? bindingData.bindings ?? [];
        setBaseBindings(availableBindings);
        setBaseBindingDraft(availableBindings);

        setBindingRevision(bindingData.bindingRevision ?? 0);
      } catch (bindingLoadError) {
        setBaseBindings(null);
        setBaseBindingError(
          bindingLoadError instanceof Error ? bindingLoadError : new Error('逐库绑定读取失败'),
        );
      }
    } catch (e) {
      setError(e instanceof Error ? e : new Error('读取失败'));
    } finally {
      setBusy(false);
    }
  }
  async function mutate(path: string, body: unknown) {
    if (!online) {
      setError(new Error('浏览器当前离线，写操作未发送。恢复连接后请手动重试。'));
      return false;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await centerRequest<BaseDetail>(
        path,
        'POST',
        body,
        retry.current.keyFor(path + JSON.stringify(body)),
      );
      retry.current.acknowledge();
      setDetail(result);
      setNotice('操作已保存到服务器');
      await load();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e : new Error('操作失败'));
      return false;
    } finally {
      setBusy(false);
    }
  }
  const view = AdminStateViews({ loading, error, onRetry: load });
  return (
    <div className="admin-settings-page knowledge-center-page">
      <div className="settings-pagehead">
        <div className="settings-titlebox">
          <h1>知识中心</h1>
          <div className="settings-desc">管理教学资料、项目知识库与知识引擎。</div>
        </div>
        <div className="settings-page-actions">
          <button
            className="settings-action-btn"
            onClick={() => void load()}
            disabled={busy || !online}
          >
            刷新
          </button>
          <button
            className="settings-action-btn is-primary"
            onClick={() => {
              setNewBase(true);
              setCreateStep(1);
              setPreflight(null);
            }}
            disabled={!online}
          >
            新建知识库
          </button>
        </div>
      </div>
      <div className="settings-tabs-row" role="tablist" aria-label="知识中心">
        <button
          role="tab"
          aria-selected={tab === 'bases'}
          className={`settings-tab-btn${tab === 'bases' ? ' is-active' : ''}`}
          onClick={() => setTab('bases')}
        >
          知识库
        </button>
        <button
          role="tab"
          aria-selected={tab === 'engines'}
          className={`settings-tab-btn${tab === 'engines' ? ' is-active' : ''}`}
          onClick={() => setTab('engines')}
        >
          知识引擎
        </button>
      </div>
      {view}
      {!online && <p role="status">浏览器当前离线。写操作已禁用，恢复连接后可手动重试读取。</p>}
      {notice && <p role="status">{notice}</p>}

      {!loading && !error && tab === 'bases' && (
        <>
          <div className="settings-page-actions">
            <input
              className="admin-input-text"
              aria-label="搜索知识库"
              placeholder="搜索名称或项目 ID"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <select
              className="admin-select"
              aria-label="知识库范围"
              value={kind}
              onChange={(e) => setKind(e.target.value)}
            >
              <option value="all">全部知识库</option>
              <option value="platform">平台资料</option>
              <option value="school">校本资料</option>
              <option value="project">项目知识库</option>
            </select>
          </div>
          <div className="admin-knowledge-cards-grid">
            {bases
              .filter(
                (b) =>
                  (kind === 'all' || b.kind === kind) &&
                  `${b.name} ${b.project_id ?? ''}`.toLowerCase().includes(query.toLowerCase()),
              )
              .map((b) => (
                <article className="admin-knowledge-item-card" key={b.id}>
                  <h2 style={{ fontSize: 17 }}>{b.name}</h2>
                  <p>
                    {states[b.build_state] ?? b.build_state}
                    {b.kind === 'project' ? ' · 项目自动生成' : ''}
                  </p>
                  <p>
                    资料：{b.document_count} 份 · 引擎：{b.engine_instance_id ?? '未绑定'}
                  </p>
                  {b.project_id && <p style={{ overflowWrap: 'anywhere' }}>项目：{b.project_id}</p>}
                  <p>
                    有效索引：{b.active_index_version_id ? '已有版本' : '尚无'}
                    {b.active_index_version_id && b.build_state !== 'ready' ? ' · 旧版保留' : ''}
                    {b.connection?.status && ` · 连接：${b.connection.status}`}
                  </p>
                  <button
                    className="settings-action-btn"
                    disabled={busy}
                    onClick={() => void open(b.id)}
                  >
                    查看资料与准备记录
                  </button>
                </article>
              ))}
          </div>
          {bases.length === 0 && <p>暂无知识库。新建资料库后可添加真实资料。</p>}
        </>
      )}
      {!loading && !error && tab === 'engines' && (
        <>
          <KnowledgeEngines
            engines={engines}
            online={online}
            onChanged={() => load(true)}
            onOpenBase={open}
          />
          <section
            aria-label="检索助手绑定"
            style={{ marginTop: 32, borderTop: '1px solid var(--border, #e4ecf7)', paddingTop: 16 }}
          >
            <h2 style={{ fontSize: 17 }}>检索助手绑定</h2>
            <p style={{ color: '#64748b', fontSize: 13 }}>
              「项目知识库检索」工具当前绑定的助手；每轮对话由服务端重新解析（canRetrieve），未绑定或停用的助手不会检索项目知识库。
            </p>
            {bindingError ? (
              <p role="alert" style={{ color: '#b42318' }}>
                {bindingError.message}
              </p>
            ) : !bindings || bindingDraft === null ? (
              <p>正在读取助手绑定…</p>
            ) : bindings.catalog.filter((a) => a.enabled).length === 0 ? (
              <p>暂无可绑定的启用助手。</p>
            ) : (
              <>
                <div className="admin-knowledge-cards-grid">
                  {bindings.catalog
                    .filter((a) => a.enabled)
                    .map((a) => (
                      <label
                        key={a.id}
                        className="admin-knowledge-item-card"
                        style={{ display: 'flex', gap: 8, alignItems: 'center' }}
                      >
                        <input
                          type="checkbox"
                          checked={bindingDraft.includes(a.id)}
                          onChange={(event) => {
                            setBindingDraft(
                              event.target.checked
                                ? [...bindingDraft, a.id]
                                : bindingDraft.filter((id) => id !== a.id),
                            );
                          }}
                        />
                        <span>
                          {a.avatar ? `${a.avatar} ` : ''}
                          {a.name}
                        </span>
                      </label>
                    ))}
                </div>
                <button
                  className="settings-action-btn"
                  disabled={busy}
                  onClick={async () => {
                    if (!bindings || bindingDraft === null) return;
                    setBusy(true);
                    try {
                      await saveAssistantBindings(
                        bindings.revision,
                        bindingDraft,
                        retry.current.keyFor('bindings:' + bindingDraft.join(',')),
                      );
                      retry.current.acknowledge();
                      setNotice('助手绑定已保存');
                      await load();
                    } catch (e) {
                      setError(e instanceof Error ? e : new Error('助手绑定保存失败'));
                      await load();
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  保存助手绑定（配置修订 {bindings.revision}）
                </button>
              </>
            )}
          </section>
        </>
      )}
      {newBase && (
        <div className="admin-modal-overlay">
          <section
            role="dialog"
            aria-modal="true"
            aria-label="新建知识库"
            className="admin-modal-card"
            style={{ width: 'min(94vw,600px)' }}
          >
            <div className="admin-modal-header">
              <h2>新建知识库</h2>
              <button onClick={() => setNewBase(false)} aria-label="关闭">
                ×
              </button>
            </div>
            <div className="admin-modal-body">
              <p>步骤 {createStep} / 3</p>
              {createStep === 1 && (
                <>
                  <p>
                    选择知识库语义。Create new 由启途智学拥有索引生命周期；Link existing
                    只保存外部指针并就地检索。
                  </p>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {(['create_new', 'link_existing'] as const).map((mode) => (
                      <button
                        key={mode}
                        className={`settings-action-btn${createMode === mode ? ' is-primary' : ''}`}
                        onClick={() => {
                          setCreateMode(mode);
                          setPreflight(null);
                        }}
                      >
                        {mode === 'create_new' ? 'Create new' : 'Link existing'}
                      </button>
                    ))}
                  </div>
                </>
              )}
              {createStep === 2 && (
                <>
                  <label>
                    名称
                    <input
                      className="admin-input-text"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      maxLength={160}
                    />
                  </label>
                  <label>
                    引擎
                    <select
                      className="admin-select"
                      value={engine}
                      onChange={(e) => {
                        setEngine(e.target.value);
                        setPreflight(null);
                      }}
                    >
                      <option value="">选择服务端返回的引擎</option>
                      {engines.flatMap((group) =>
                        group.instances.map((instance) => (
                          <option key={instance.id} value={instance.id}>
                            {instance.name} · {statusText(engineStatus(instance))}
                          </option>
                        )),
                      )}
                    </select>
                  </label>
                  <label>
                    检索模式
                    <select
                      className="admin-select"
                      value={retrievalMode}
                      onChange={(e) => setRetrievalMode(e.target.value)}
                    >
                      <option value="hybrid">hybrid</option>
                      <option value="global">global</option>
                      <option value="local">local</option>
                      <option value="basic">basic</option>
                      <option value="naive">naive</option>
                      <option value="agentic">agentic</option>
                    </select>
                  </label>
                  {engine &&
                    providerFields(
                      engines
                        .flatMap((group) => group.instances)
                        .find((instance) => instance.id === engine)?.provider ?? '',
                    ).map((field) => (
                      <label key={field}>
                        {fieldLabel(field)}
                        <input
                          className="admin-input-text"
                          value={connectionFields[field] ?? ''}
                          onChange={(e) => {
                            setConnectionFields((current) => ({
                              ...current,
                              [field]: e.target.value,
                            }));
                            setPreflight(null);
                          }}
                        />
                      </label>
                    ))}
                  <p>
                    字段仅限非敏感连接信息。密钥、token、password、cookie 不在浏览器输入或回显。
                  </p>
                </>
              )}
              {createStep === 3 && (
                <>
                  <h3>预检与预算</h3>
                  {preflight ? (
                    <p role={preflight.ok ? 'status' : 'alert'}>{preflight.message}</p>
                  ) : (
                    <p>尚未完成服务端预检。</p>
                  )}
                  <p>
                    服务端决定文件、字节、页面和时间预算；前端不会提高上限。只有预检通过才可提交。
                  </p>
                  {preflight?.result?.warnings?.map((warning) => (
                    <p key={warning} role="note">
                      提示：{warning}
                    </p>
                  ))}
                </>
              )}
            </div>
            <div className="admin-modal-footer">
              <button
                className="settings-action-btn"
                onClick={() => {
                  setNewBase(false);
                  setPreflight(null);
                }}
              >
                取消
              </button>
              {createStep > 1 && (
                <button
                  className="settings-action-btn"
                  onClick={() => setCreateStep((createStep - 1) as 1 | 2 | 3)}
                >
                  上一步
                </button>
              )}
              {createStep === 1 && (
                <button className="settings-action-btn is-primary" onClick={() => setCreateStep(2)}>
                  下一步
                </button>
              )}
              {createStep === 2 && (
                <button
                  className="settings-action-btn is-primary"
                  disabled={!name.trim() || !engine || preflightBusy || !online}
                  onClick={async () => {
                    const instance = engines
                      .flatMap((group) => group.instances)
                      .find((item) => item.id === engine);
                    if (!instance || engineStatus(instance) !== 'ready') {
                      setPreflight({
                        ok: false,
                        message: `引擎状态为 ${statusText(engineStatus(instance!))}，不能开始创建或连接。`,
                      });
                      return;
                    }
                    setPreflightBusy(true);
                    try {
                      if (createMode === 'create_new') {
                        const result = await centerRequest<{
                          ok?: boolean;
                          status?: ReadinessStatus;
                          errorCode?: string;
                          health?: {
                            status?: ReadinessStatus;
                            capabilities?: Record<string, boolean>;
                          };
                        }>(
                          `knowledge/engines/${encodeURIComponent(instance.id)}/check`,
                          'POST',
                          {},
                          retry.current.keyFor(`create-preflight:${instance.id}`),
                        );
                        const status =
                          result.status ??
                          result.health?.status ??
                          (result.ok ? 'ready' : 'unavailable');
                        const canCreate = result.health?.capabilities?.create !== false;
                        const ok =
                          status === 'ready' && result.errorCode === undefined && canCreate;
                        setPreflight({
                          ok,
                          message: ok
                            ? '预检通过：服务端已验证引擎能力与配置。'
                            : result.errorCode === 'REMOTE_CREATE_UNSUPPORTED' || !canCreate
                              ? '该云端 provider 仅支持连接已有远端库。'
                              : `预检未通过：${result.errorCode ?? statusText(status)}`,
                        });
                        if (ok) setCreateStep(3);
                      } else {
                        const result = await probeLinkedBase(
                          { provider: instance.provider, ...connectionFields },
                          retry.current.keyFor(
                            `probe:${engine}:${JSON.stringify(connectionFields)}`,
                          ),
                        );
                        setPreflight({
                          ok: result.ok,
                          result,
                          message: result.ok
                            ? '预检通过：服务端已验证连接/能力。'
                            : result.errorCode === 'REMOTE_CREATE_UNSUPPORTED'
                              ? '该云端 provider 仅支持连接已有远端库。'
                              : `预检未通过：${result.errorCode ?? 'UNKNOWN'}`,
                        });
                        if (result.ok) setCreateStep(3);
                      }
                    } catch (probeError) {
                      setPreflight({
                        ok: false,
                        message: probeError instanceof Error ? probeError.message : '预检失败',
                      });
                    } finally {
                      setPreflightBusy(false);
                    }
                  }}
                >
                  {preflightBusy ? '预检中…' : '运行服务端预检'}
                </button>
              )}
              {createStep === 3 && (
                <button
                  className="settings-action-btn is-primary"
                  disabled={busy || !preflight?.ok || !name.trim() || !engine || !online}
                  onClick={async () => {
                    if (!preflight?.ok) return;
                    setBusy(true);
                    try {
                      await createKnowledgeBase(
                        {
                          name,
                          engineInstanceId: engine,
                          mode: createMode,
                          retrievalMode,
                          connection: connectionFields,
                        },
                        retry.current.keyFor(
                          `create:${name}:${engine}:${createMode}:${JSON.stringify(connectionFields)}`,
                        ),
                      );
                      retry.current.acknowledge();
                      setNotice(
                        createMode === 'link_existing'
                          ? '外部知识库连接已提交'
                          : '知识库创建已提交，索引将在后台准备',
                      );
                      setNewBase(false);
                      setName('');
                      setConnectionFields({});
                      setPreflight(null);
                      setCreateStep(1);
                      await load();
                    } catch (createError) {
                      setError(createError instanceof Error ? createError : new Error('创建失败'));
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  提交{createMode === 'link_existing' ? '连接' : '创建'}
                </button>
              )}
            </div>
          </section>
        </div>
      )}
      {detail && (
        <div className="admin-modal-overlay">
          <section
            role="dialog"
            aria-modal="true"
            aria-label={detail.name}
            className="admin-modal-card"
            style={{ width: 'min(94vw,900px)', maxHeight: '90vh', overflowY: 'auto' }}
          >
            <div className="admin-modal-header">
              <h2>{detail.name}</h2>
              <button aria-label="关闭详情" onClick={() => setDetail(null)}>
                ×
              </button>
            </div>
            <div className="admin-modal-body">
              <p>
                {states[detail.build_state] ?? detail.build_state} ·{' '}
                {detail.kind === 'project' ? '只检索本项目资料' : '教学资料库'}
              </p>
              {detail.active_index_version_id && detail.build_state !== 'ready' && (
                <p role="status">当前有效旧版仍保留；新版本验证通过前不会替换。</p>
              )}
              <p>更换 embedding 模型必须重建新版本，不得混用不同向量空间。</p>
              {(detail.flavour === 'kiwix' || detail.connection?.flavour === 'kiwix') && (
                <h3>Articles / Settings</h3>
              )}
              {(detail.flavour === 'marginnote4' ||
                detail.connection?.flavour === 'marginnote4') && <h3>Devices / Settings</h3>}
              {detail.connection && (
                <section aria-label="Connections">
                  <h3>Connections</h3>
                  <p>
                    连接状态：{detail.connection.status}
                    {detail.connection.lastErrorCode ? ` · ${detail.connection.lastErrorCode}` : ''}
                  </p>
                  <p>类型：{detail.connection.flavour ?? detail.flavour ?? 'connected'}</p>
                </section>
              )}
              <h3>文件及资料来源</h3>
              {detail.files.length ? (
                detail.files.map((f) => (
                  <details key={f.id}>
                    <summary>{f.title}</summary>
                    <p style={{ overflowWrap: 'anywhere' }}>版本：{f.source_revision}</p>
                    <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
                      {JSON.stringify(f.origin, null, 2)}
                    </pre>
                    <button
                      className="settings-action-btn"
                      onClick={async () => {
                        try {
                          setPreview(
                            await centerRequest<{ title: string; content: string }>(
                              `knowledge/bases/${detail.id}/files/${f.id}`,
                            ),
                          );
                        } catch (e) {
                          setError(e instanceof Error ? e : new Error('读取失败'));
                        }
                      }}
                    >
                      预览正文
                    </button>
                    <button
                      className="settings-action-btn"
                      onClick={async () => {
                        try {
                          const file = await centerRequest<{ title: string; content: string }>(
                            `knowledge/bases/${detail.id}/files/${f.id}`,
                          );
                          const url = URL.createObjectURL(
                            new Blob([file.content], { type: 'text/plain;charset=utf-8' }),
                          );
                          const a = document.createElement('a');
                          a.href = url;
                          a.download = file.title + '.txt';
                          a.click();
                          URL.revokeObjectURL(url);
                        } catch (e) {
                          setError(e instanceof Error ? e : new Error('下载失败'));
                        }
                      }}
                    >
                      下载正文
                    </button>
                    {detail.kind !== 'project' && typeof f.origin.fileName === 'string' && (
                      <a
                        className="settings-action-btn"
                        href={`/api/v1/admin/knowledge/bases/${encodeURIComponent(detail.id)}/files/${encodeURIComponent(f.id)}/original`}
                      >
                        下载原文件
                      </a>
                    )}
                    {detail.kind !== 'project' && (
                      <>
                        <button
                          className="settings-action-btn"
                          disabled={busy}
                          onClick={() =>
                            void mutate(`knowledge/bases/${detail.id}/files/${f.id}`, {
                              allowMaterialize: f.origin.canMaterialize !== true,
                            })
                          }
                        >
                          {f.origin.canMaterialize === true ? '撤销项目导入许可' : '允许项目导入'}
                        </button>
                        <button
                          className="settings-action-btn"
                          disabled={busy}
                          onClick={() => {
                            if (
                              window.confirm(
                                '删除后将立即停止此资料的检索与派生引用，保留历史来源记录。',
                              )
                            )
                              void mutate(`knowledge/bases/${detail.id}/files/${f.id}`, {
                                deleted: true,
                              });
                          }}
                        >
                          删除资料
                        </button>
                      </>
                    )}
                  </details>
                ))
              ) : (
                <p>暂无资料。</p>
              )}
              {detail.flavour === 'kiwix' || detail.connection?.flavour === 'kiwix' ? (
                <p>文章由 Kiwix 服务端提供，此连接不支持普通文件上传。</p>
              ) : detail.flavour === 'marginnote4' ||
                detail.connection?.flavour === 'marginnote4' ? (
                <p>资料通过 MarginNote 设备同步，此连接不支持普通文件上传。</p>
              ) : detail.connection || detail.mode === 'link_existing' || detail.flavour ? (
                <p>外部连接仅保存指针并就地检索，不参与原始文件上传。</p>
              ) : (
                detail.kind !== 'project' && (
                  <>
                    <KnowledgeFileUpload
                      key={detail.id}
                      baseId={detail.id}
                      onSaved={async (saved) => {
                        setDetail(saved);
                        setNotice('文件已保存，索引正在后台准备');
                        await load();
                      }}
                    />
                    <h3>手动添加正文</h3>
                    <label>
                      文档标题
                      <input
                        className="admin-input-text"
                        value={title}
                        onChange={(e) => setTitle(e.target.value)}
                        maxLength={160}
                      />
                    </label>
                    <textarea
                      aria-label="资料正文"
                      className="admin-prompt-editor-box"
                      style={{ width: '100%', boxSizing: 'border-box' }}
                      rows={6}
                      value={content}
                      onChange={(e) => setContent(e.target.value)}
                      placeholder="输入或上传真实资料正文"
                    />
                    <label>
                      <input
                        type="checkbox"
                        checked={materialize}
                        onChange={(e) => setMaterialize(e.target.checked)}
                      />
                      我已确认资料来源，允许导入项目知识库
                    </label>
                    <button
                      className="settings-action-btn"
                      disabled={busy || !title.trim() || !content.trim() || !online}
                      onClick={async () => {
                        if (
                          await mutate(`knowledge/bases/${detail.id}/files`, {
                            title,
                            content,
                            allowMaterialize: materialize,
                          })
                        ) {
                          setTitle('');
                          setContent('');
                        }
                      }}
                    >
                      保存资料
                    </button>
                  </>
                )
              )}
              <section aria-label="外部来源">
                <h3>Linked folders / GitHub / Web</h3>
                <label>
                  来源类型
                  <select
                    className="admin-select"
                    value={sourceKind}
                    onChange={(event) =>
                      setSourceKind(event.target.value as 'folder' | 'github' | 'web')
                    }
                  >
                    <option value="folder">folder</option>
                    <option value="github">GitHub</option>
                    <option value="web">Web</option>
                  </select>
                </label>
                <label>
                  {sourceKind === 'folder'
                    ? '服务端允许的目录'
                    : sourceKind === 'github'
                      ? '仓库 / 分支 / 路径'
                      : '网页 URL'}
                  <input
                    className="admin-input-text"
                    value={sourceValue}
                    onChange={(event) => setSourceValue(event.target.value)}
                    placeholder={
                      sourceKind === 'folder'
                        ? '/allowlisted/path'
                        : sourceKind === 'github'
                          ? 'org/repo@main:path'
                          : 'https://example.invalid'
                    }
                  />
                </label>
                <button
                  className="settings-action-btn"
                  disabled={busy || !online || !sourceValue.trim()}
                  onClick={async () => {
                    setBusy(true);
                    try {
                      const saved = await createKnowledgeSource(
                        detail.id,
                        {
                          kind: sourceKind,
                          sourceConfig:
                            sourceKind === 'folder'
                              ? { path: sourceValue }
                              : sourceKind === 'github'
                                ? { repo: sourceValue }
                                : { url: sourceValue },
                        },
                        retry.current.keyFor(`source:${detail.id}:${sourceKind}:${sourceValue}`),
                      );
                      retry.current.acknowledge();
                      setDetail(saved);
                      setSourceValue('');
                      setNotice('来源已保存；可手动提交同步任务');
                    } catch (sourceError) {
                      setError(
                        sourceError instanceof Error ? sourceError : new Error('来源保存失败'),
                      );
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  添加来源
                </button>
                {detail.sources?.length ? (
                  detail.sources.map((source) => (
                    <div key={source.id}>
                      <p>
                        {source.kind} · {source.status}
                        {source.lastErrorCode ? ` · ${source.lastErrorCode}` : ''}
                      </p>
                      {source.lastSourceRevision && <p>来源修订：{source.lastSourceRevision}</p>}
                      <button
                        className="settings-action-btn"
                        disabled={busy || !online}
                        onClick={async () => {
                          try {
                            await syncKnowledgeSource(
                              detail.id,
                              source.id,
                              { reason: 'manual' },
                              retry.current.keyFor(`sync:${detail.id}:${source.id}`),
                            );
                            retry.current.acknowledge();
                            setNotice('同步任务已提交；旧版在新版本验证前保留');
                            await open(detail.id);
                          } catch (syncError) {
                            setError(
                              syncError instanceof Error ? syncError : new Error('同步失败'),
                            );
                          }
                        }}
                      >
                        同步
                      </button>
                    </div>
                  ))
                ) : (
                  <p>暂无外部来源。</p>
                )}
              </section>
              <section aria-label="Assistants and Partners">
                <h3>Assistants / Partners</h3>
                {baseBindingError ? (
                  <p role="alert">
                    {baseBindingError.message}{' '}
                    <button className="settings-action-btn" onClick={() => void open(detail.id)}>
                      重试
                    </button>
                  </p>
                ) : baseBindings === null ? (
                  <p>绑定状态不可用。</p>
                ) : baseBindings.length === 0 ? (
                  <p>暂无逐库绑定。</p>
                ) : (
                  (['admin_assistant', 'tutor_partner', 'runtime_agent'] as const).map(
                    (agentKind) => (
                      <fieldset key={agentKind}>
                        <legend>{agentKind}</legend>
                        {baseBindingDraft
                          .filter((binding) => binding.agentKind === agentKind)
                          .map((binding) => (
                            <div key={`${binding.agentId}:${binding.mode}`}>
                              <label>
                                <input
                                  type="checkbox"
                                  checked={binding.enabled}
                                  disabled={
                                    !online ||
                                    Boolean(binding.readonlyReason ?? binding.reasons?.join('; '))
                                  }
                                  onChange={(event) =>
                                    setBaseBindingDraft((current) =>
                                      current.map((item) =>
                                        item === binding
                                          ? { ...item, enabled: event.target.checked }
                                          : item,
                                      ),
                                    )
                                  }
                                />
                                {binding.agentName ?? binding.agentId} · {binding.mode}
                              </label>
                              {(binding.readonlyReason || binding.reasons?.length) && (
                                <p role="note">
                                  只读：{binding.readonlyReason ?? binding.reasons?.join('；')}
                                </p>
                              )}
                              {binding.effective === false && !binding.readonlyReason && (
                                <p role="note">服务端判定当前无效</p>
                              )}
                            </div>
                          ))}
                        {!baseBindingDraft.some((binding) => binding.agentKind === agentKind) && (
                          <p>暂无此类助手绑定。</p>
                        )}
                      </fieldset>
                    ),
                  )
                )}
                {baseBindings && (
                  <button
                    className="settings-action-btn"
                    disabled={busy || !online || Boolean(baseBindingError)}
                    onClick={async () => {
                      setBusy(true);
                      try {
                        const saved = await saveBaseBindings(
                          detail.id,
                          { expectedRevision: bindingRevision, bindings: baseBindingDraft },
                          retry.current.keyFor(
                            `base-bindings:${detail.id}:${JSON.stringify(baseBindingDraft)}`,
                          ),
                        );
                        retry.current.acknowledge();
                        setBaseBindings(saved.bindings);
                        setBaseBindingDraft(saved.bindings);
                        setBindingRevision(saved.bindingRevision ?? bindingRevision);
                        setNotice('逐库绑定已保存');
                      } catch (saveError) {
                        setBaseBindingError(
                          saveError instanceof Error ? saveError : new Error('保存逐库绑定失败'),
                        );
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    保存逐库绑定（retrieve / materialize）
                  </button>
                )}
              </section>
              <h3>索引版本</h3>
              {detail.versions.length ? (
                detail.versions.map((v) => (
                  <p key={v.id} style={{ overflowWrap: 'anywhere' }}>
                    {v.id} · {v.status}
                    {detail.active_index_version_id === v.id ? ' · 当前有效' : ''}
                  </p>
                ))
              ) : (
                <p>尚无有效索引。保存资料后需要建立索引并通过真实检索验证。</p>
              )}
              <h3>准备任务</h3>
              {detail.jobs.map((j) => (
                <p key={j.id}>
                  {states[j.state] ?? j.state} · 尝试 {j.attempts} 次{' '}
                  {j.error_code && `· ${j.error_code}`}
                  <button
                    className="settings-action-btn"
                    onClick={async () => {
                      try {
                        setJobRecord(await centerRequest(`knowledge/jobs/${j.id}`));
                      } catch (e) {
                        setError(e instanceof Error ? e : new Error('记录读取失败'));
                      }
                    }}
                  >
                    查看记录
                  </button>
                  {!['ready', 'empty', 'failed', 'cancelled'].includes(j.state) && (
                    <button
                      className="settings-action-btn"
                      onClick={async () => {
                        try {
                          await cancelKnowledgeJob(j.id, retry.current.keyFor('cancel:' + j.id));
                          retry.current.acknowledge();
                          await open(detail.id);
                        } catch (e) {
                          setError(e instanceof Error ? e : new Error('取消失败'));
                        }
                      }}
                    >
                      取消任务
                    </button>
                  )}
                </p>
              ))}
            </div>
            <div className="admin-modal-footer">
              <button
                className="settings-action-btn"
                disabled={busy}
                onClick={() => void open(detail.id)}
              >
                刷新记录
              </button>
              <button
                className="settings-action-btn is-primary"
                disabled={busy || !online}
                onClick={() => void mutate(`knowledge/bases/${detail.id}/rebuild`, {})}
              >
                准备 / 重建索引
              </button>
              <button className="settings-action-btn" onClick={() => setDetail(null)}>
                关闭
              </button>
            </div>
          </section>
        </div>
      )}
      {preview && (
        <div className="admin-modal-overlay">
          <section
            role="dialog"
            aria-modal="true"
            aria-label="资料正文"
            className="admin-modal-card"
            style={{ width: 'min(94vw,800px)', maxHeight: '85vh', overflowY: 'auto' }}
          >
            <div className="admin-modal-header">
              <h2>{preview.title}</h2>
              <button onClick={() => setPreview(null)} aria-label="关闭正文">
                ×
              </button>
            </div>
            <pre
              className="admin-modal-body"
              style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}
            >
              {preview.content}
            </pre>
          </section>
        </div>
      )}
      {jobRecord && (
        <div className="admin-modal-overlay">
          <section
            role="dialog"
            aria-modal="true"
            aria-label="准备记录"
            className="admin-modal-card"
            style={{ width: 'min(94vw,800px)', maxHeight: '85vh', overflowY: 'auto' }}
          >
            <div className="admin-modal-header">
              <h2>准备记录</h2>
              <button onClick={() => setJobRecord(null)} aria-label="关闭记录">
                ×
              </button>
            </div>
            <div className="admin-modal-body">
              {jobRecord.events.length ? (
                jobRecord.events.map((e, i) => (
                  <div key={i}>
                    <p>
                      {states[e.state] ?? e.state} · {new Date(e.occurred_at).toLocaleString()}
                    </p>
                    <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
                      {JSON.stringify(e.detail, null, 2)}
                    </pre>
                  </div>
                ))
              ) : (
                <p>任务尚未执行。</p>
              )}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
