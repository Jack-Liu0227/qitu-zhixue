'use client';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  centerRequest,
  fetchCenterConfig,
  fetchAssistantBindings,
  saveAssistantBindings,
  type AssistantBindings,
  type Base,
  type BaseDetail,
  type EngineGroup,
  type CenterConfig,
} from '../../../../lib/api/knowledge-center';
import { createIdempotentRetryKey } from '../../../../lib/api/types';
import { AdminStateViews } from '../../../../lib/components/AdminStateViews';
import { KnowledgeFileUpload } from '../../../../lib/components/KnowledgeFileUpload';
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
  const [name, setName] = useState('');
  const [engine, setEngine] = useState('');
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
  const load = useCallback(async () => {
    setLoading(true);
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
    window.addEventListener('focus', refresh);
    window.addEventListener('qitu-configuration-changed', refresh);
    return () => {
      window.removeEventListener('focus', refresh);
      window.removeEventListener('qitu-configuration-changed', refresh);
    };
  }, [load]);
  async function open(id: string) {
    setBusy(true);
    setError(null);
    try {
      setDetail(await centerRequest<BaseDetail>(`knowledge/bases/${encodeURIComponent(id)}`));
    } catch (e) {
      setError(e instanceof Error ? e : new Error('读取失败'));
    } finally {
      setBusy(false);
    }
  }
  async function mutate(path: string, body: unknown) {
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
          <button className="settings-action-btn" onClick={() => void load()} disabled={busy}>
            刷新
          </button>
          <button className="settings-action-btn is-primary" onClick={() => setNewBase(true)}>
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
          {['本地引擎', '服务器引擎', '云服务', '外部知识源'].map((group) => (
            <section key={group}>
              <h2 style={{ fontSize: 17, marginTop: 24 }}>{group}</h2>
              <div className="admin-knowledge-cards-grid">
                {engines
                  .filter((e) => e.group === group)
                  .map((e) => (
                    <article key={e.provider} className="admin-knowledge-item-card">
                      <h3>{e.name}</h3>
                      {!e.instances.length ? (
                        <>
                          <p>未配置</p>
                          <Link className="settings-action-btn" href="/settings/tools">
                            添加引擎配置
                          </Link>
                        </>
                      ) : (
                        e.instances.map((i) => (
                          <div key={i.id}>
                            <p>
                              {i.name} · {i.enabled ? '已启用' : '已停用'}
                            </p>
                            <p>
                              预检：
                              {i.health?.health_status === 'ready'
                                ? '通过'
                                : (i.health?.error_code ?? '未检查')}
                            </p>
                            <p>
                              配置修订：{i.revision} · 关联库：{i.associatedBases.length}
                            </p>
                            <Link
                              className="settings-action-btn"
                              href={`/settings/tools?knowledgeEngine=${encodeURIComponent(i.id)}`}
                            >
                              配置引擎
                            </Link>
                            <button
                              className="settings-action-btn"
                              disabled={busy}
                              onClick={async () => {
                                setBusy(true);
                                try {
                                  const r = await centerRequest<{
                                    ok: boolean;
                                    errorCode?: string;
                                  }>(
                                    `knowledge/engines/${i.id}/check`,
                                    'POST',
                                    {},
                                    retry.current.keyFor('check:' + i.id),
                                  );
                                  retry.current.acknowledge();
                                  setNotice(r.ok ? '引擎预检通过' : `预检未通过：${r.errorCode}`);
                                  await load();
                                } catch (e) {
                                  setError(e instanceof Error ? e : new Error('预检失败'));
                                } finally {
                                  setBusy(false);
                                }
                              }}
                            >
                              检查连接
                            </button>
                          </div>
                        ))
                      )}
                    </article>
                  ))}
              </div>
            </section>
          ))}
          <section aria-label="检索助手绑定" style={{ marginTop: 32, borderTop: '1px solid var(--border, #e4ecf7)', paddingTop: 16 }}>
            <h2 style={{ fontSize: 17 }}>检索助手绑定</h2>
            <p style={{ color: '#64748b', fontSize: 13 }}>
              「项目知识库检索」工具当前绑定的助手；每轮对话由服务端重新解析（canRetrieve），未绑定或停用的助手不会检索项目知识库。
            </p>
            {bindingError ? (
              <p role="alert" style={{ color: '#b42318' }}>{bindingError.message}</p>
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
                      <label key={a.id} className="admin-knowledge-item-card" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
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
                        <span>{a.avatar ? `${a.avatar} ` : ''}{a.name}</span>
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
                  onChange={(e) => setEngine(e.target.value)}
                >
                  {Object.entries(configuration?.config.knowledgeEngines ?? {}).map(([id, e]) => (
                    <option key={id} value={id}>
                      {e.name} · {e.enabled ? '已启用' : '未启用'}
                    </option>
                  ))}
                </select>
              </label>
              <p>未就绪引擎可保存配置，不能建立有效索引。</p>
            </div>
            <div className="admin-modal-footer">
              <button className="settings-action-btn" onClick={() => setNewBase(false)}>
                取消
              </button>
              <button
                className="settings-action-btn is-primary"
                disabled={busy || !name.trim() || !engine}
                onClick={async () => {
                  if (await mutate('knowledge/bases', { name, engineInstanceId: engine })) {
                    setNewBase(false);
                    setName('');
                  }
                }}
              >
                创建
              </button>
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
              {detail.kind !== 'project' && (
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
                    disabled={busy || !title.trim() || !content.trim()}
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
              )}
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
                          await centerRequest(
                            `knowledge/jobs/${j.id}/cancel`,
                            'POST',
                            {},
                            retry.current.keyFor('cancel:' + j.id),
                          );
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
                disabled={busy}
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
