'use client';
import { AssistantGlyph } from '@qitu/ui';
// Adapted from HKUDS/DeepTutor CreateKbModal.tsx at 6cf793bd (MIT); Qitu APIs and admin authorization.
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  centerRequest,
  fetchCenterConfig,
  saveCenterConfig,
  type AssistantBindings,
  type CreateBaseRequest,
  type Engine,
  type EngineGroup,
} from '../../api/knowledge-center';
import { createIdempotentRetryKey } from '../../api/types';
import {
  EngineIcon,
  Glyph,
  linkableProviders,
  message,
  remoteProviders,
  statusLabels,
  type ModelOption,
} from './shared';
import styles from './KnowledgeLibrary.module.css';
import { ImaLibraryPicker } from './ImaLibraryPicker';

export type LibraryCreation = { request: CreateBaseRequest; files: File[]; assistantIds: string[] };
export function CreateLibraryModal({
  engines,
  assistants,
  models,
  online,
  onClose,
  onChanged,
  onCreate,
}: {
  engines: EngineGroup[];
  assistants: AssistantBindings | null;
  models: ModelOption[];
  online: boolean;
  onClose: () => void;
  onChanged: () => Promise<void>;
  onCreate: (creation: LibraryCreation) => Promise<void>;
}) {
  const [mode, setMode] = useState<'create_new' | 'link_existing'>('create_new');
  const [name, setName] = useState('');
  const [provider, setProvider] = useState('llamaindex');
  const [instanceId, setInstanceId] = useState(
    engines.find((g) => g.provider === 'llamaindex')?.instances[0]?.id ?? 'llamaindex-main',
  );
  const [draft, setDraft] = useState<Engine | null>(null);
  const [configure, setConfigure] = useState(false);
  const [editing, setEditing] = useState(false);
  const [embedding, setEmbedding] = useState('');
  const [fields, setFields] = useState<Record<string, string>>({});
  const [files, setFiles] = useState<File[]>([]);
  const [selectedAssistants, setSelectedAssistants] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [checked, setChecked] = useState(false);
  const [imaGeneration, setImaGeneration] = useState(0);
  const [imaSelected, setImaSelected] = useState(false);
  const [imaLoading, setImaLoading] = useState(false);
  const lastImaName = useRef('');
  const retry = useRef(createIdempotentRetryKey());
  const dialog = useRef<HTMLDivElement>(null);
  const group = engines.find((e) => e.provider === provider);
  const instance = group?.instances.find((i) => i.id === instanceId);
  const isRemote = remoteProviders.includes(provider);
  const linked = mode === 'link_existing' && !isRemote;
  const credentialsReady =
    instance?.enabled && (provider !== 'llamaindex' || Boolean(instance.config.embeddingModelRef));
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    dialog.current?.focus();
    return () => {
      document.body.style.overflow = overflow;
      previous?.focus();
    };
  }, []);
  useEffect(() => {
    const defaults = Object.fromEntries(
      (group?.definition?.fields ?? [])
        .filter((f) => f.default !== undefined)
        .map((f) => [f.key, f.default]),
    );
    setDraft({
      name: instance?.name ?? group?.name ?? provider,
      provider,
      description: instance?.description ?? group?.definition?.description ?? '',
      enabled: instance?.enabled ?? false,
      config: { ...defaults, ...instance?.config },
    });
    setEmbedding(String(instance?.config.embeddingModelRef ?? ''));
    setConfigure(!instance);
    setEditing(false);
    setFields({});
    setChecked(false);
    setImaSelected(false);
    setError('');
    setNotice('');
    // Refreshing saved defaults must not reset unsaved form inputs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provider, instanceId]);
  function selectProvider(next: EngineGroup) {
    setProvider(next.provider);
    setInstanceId(next.instances[0]?.id ?? `${next.provider}-main`);
  }
  function patch(key: string, value: unknown) {
    if (!draft) return;
    setDraft({ ...draft, config: { ...draft.config, [key]: value } });
    setEditing(true);
    setChecked(false);
    if (provider === 'ima') {
      setImaGeneration((v) => v + 1);
      setImaSelected(false);
      setFields({});
    }
  }
  async function saveEngine() {
    if (!draft || !online) return;
    setBusy(true);
    setError('');
    try {
      const current = await fetchCenterConfig();
      const config = structuredClone(current.config);
      config.knowledgeEngines[instanceId] = { ...draft, enabled: true };
      await saveCenterConfig(
        { expectedRevision: current.revision, config },
        retry.current.keyFor(`engine:${instanceId}:${JSON.stringify(draft)}`),
      );
      retry.current.acknowledge();
      setEditing(false);
      setConfigure(false);
      setNotice('默认配置已保存，下次选择此引擎会直接复用。');
      if (draft.config.embeddingModelRef) setEmbedding(String(draft.config.embeddingModelRef));
      await onChanged();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  function request(): CreateBaseRequest {
    const connection = Object.fromEntries(
      Object.entries(fields).filter(([, value]) => value.trim()),
    );
    if (linked) connection.ragProvider = provider;
    return {
      name: name.trim(),
      engineInstanceId: instanceId,
      mode,
      storageWorkspaceRef: 'account',
      ...(Object.keys(connection).length ? { connection } : {}),
      ...(!isRemote && !linked && embedding ? { embeddingModelRef: embedding } : {}),
    };
  }
  async function probe() {
    setBusy(true);
    setError('');
    setChecked(false);
    try {
      await centerRequest('knowledge/bases/connection-probe', 'POST', request());
      setChecked(true);
      setNotice('连接检查通过，可创建知识库。');
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  function pickFiles(selected: FileList | null) {
    const next = Array.from(selected ?? []);
    if (next.length > 20 || next.some((f) => f.size <= 0 || f.size > 100 * 1024 * 1024)) {
      setError('每批最多 20 个文件，每个文件需大于 0 且不超过 100 MiB。');
      return;
    }
    setFiles(next);
    setError('');
  }
  const connectionFields: [string, string, string][] = linked
    ? [['externalPath', '文件夹路径', '/服务端知识库目录/my-kb']]
    : provider === 'ima'
      ? []
      : provider === 'weknora'
        ? [
            [
              'remoteKnowledgeBaseId',
              '远端知识库 ID',
              String(instance?.config.remoteKnowledgeBaseId ?? '输入 WeKnora 知识库 ID'),
            ],
          ]
        : provider === 'obsidian'
          ? [['vaultPath', 'Obsidian 库路径', '/服务端目录/MyVault']]
          : provider === 'marginnote'
            ? [['deviceId', '已配对设备 ID', '输入 MarginNote 设备 ID']]
            : provider === 'kiwix'
              ? [['zimName', 'ZIM 名称', '输入已挂载 ZIM 名称']]
              : provider === 'lightrag-server'
                ? [['workspace', '远端工作区 · 可选', '使用服务默认工作区']]
                : [];
  const close = () => {
    if (!busy && (!editing || window.confirm('引擎配置尚未保存，确定关闭？'))) onClose();
  };
  return createPortal(
    <div
      className={styles.overlay}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div
        ref={dialog}
        className={styles.modal}
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-library-title"
        tabIndex={-1}
        onKeyDown={(event) => {
          if (event.key === 'Escape') close();
          if (event.key === 'Tab') {
            const nodes = Array.from(
              event.currentTarget.querySelectorAll<HTMLElement>(
                'button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href]',
              ),
            );
            const first = nodes[0],
              last = nodes[nodes.length - 1];
            if (event.shiftKey && document.activeElement === first) {
              event.preventDefault();
              last?.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
              event.preventDefault();
              first?.focus();
            }
          }
        }}
      >
        <header className={styles.modalHeader}>
          <h2 id="create-library-title">
            <Glyph name="plus" size={23} />
            创建知识库
          </h2>
          <button
            className={styles.iconButton}
            aria-label="关闭创建知识库"
            disabled={busy}
            onClick={close}
          >
            <Glyph name="close" size={23} />
          </button>
        </header>
        <div className={styles.modalBody}>
          <div className={styles.modeGrid} role="radiogroup" aria-label="创建方式">
            {(
              [
                ['create_new', '新建', '上传文档并建立全新索引。', 'plus'],
                [
                  'link_existing',
                  '关联已有',
                  '复用已建索引，就地读取，不上传、不重建索引。',
                  'link',
                ],
              ] as const
            ).map(([id, label, description, icon]) => (
              <button
                key={id}
                role="radio"
                aria-checked={mode === id}
                className={`${styles.modeCard} ${mode === id ? styles.selected : ''}`}
                onClick={() => {
                  setMode(id);
                  setChecked(false);
                  if (provider === 'ima') {
                    setImaSelected(false);
                    setFields({});
                  }
                  if (id === 'link_existing' && !linkableProviders.includes(provider))
                    selectProvider(engines.find((g) => g.provider === 'llamaindex')!);
                }}
              >
                <strong>
                  <Glyph name={icon} />
                  {label}
                </strong>
                <span>{description}</span>
              </button>
            ))}
          </div>
          <label className={styles.field}>
            知识库名称
            <input
              value={name}
              maxLength={160}
              placeholder="例如：高中物理"
              onChange={(e) => {
                setName(e.target.value);
                setChecked(false);
              }}
            />
          </label>
          {mode === 'create_new' && (
            <label className={styles.field}>
              存储工作区
              <select aria-label="存储工作区" defaultValue="account">
                <option value="account">账户资源库</option>
              </select>
              <small>文档和索引将保存在账户资源库中。</small>
            </label>
          )}
          <div className={styles.field}>
            <span>{mode === 'create_new' ? '索引引擎' : '来源'}</span>
            <div className={styles.engineGrid}>
              {[...engines]
                .sort(
                  (a, b) =>
                    [
                      'llamaindex',
                      'pageindex',
                      'pageindex-oss',
                      'graphrag',
                      'lightrag',
                      'lightrag-server',
                      'ima',
                      'weknora',
                      'obsidian',
                      'marginnote',
                      'kiwix',
                    ].indexOf(a.provider) -
                    [
                      'llamaindex',
                      'pageindex',
                      'pageindex-oss',
                      'graphrag',
                      'lightrag',
                      'lightrag-server',
                      'ima',
                      'weknora',
                      'obsidian',
                      'marginnote',
                      'kiwix',
                    ].indexOf(b.provider),
                )
                .map((g) => {
                  const available = mode === 'create_new' || linkableProviders.includes(g.provider);
                  const saved = g.instances.some((i) => i.enabled);
                  const health = g.instances[0]?.health;
                  const status = saved
                    ? '已配置'
                    : (statusLabels[
                        String(health?.health_status ?? health?.status ?? 'needs_setup')
                      ] ?? '待配置');
                  return (
                    <button
                      key={g.provider}
                      type="button"
                      disabled={!available}
                      className={`${styles.engineCard} ${provider === g.provider ? styles.selected : ''}`}
                      aria-pressed={provider === g.provider}
                      onClick={() => selectProvider(g)}
                    >
                      <div>
                        <EngineIcon group={g} size={30} />
                        <strong>{g.name}</strong>
                        <span className={styles.badge}>
                          {!available ? (
                            '云端索引'
                          ) : provider === g.provider ? (
                            <Glyph name="check" />
                          ) : (
                            status
                          )}
                        </span>
                      </div>
                      <p>{g.definition?.description}</p>
                    </button>
                  );
                })}
            </div>
          </div>
          {group && group.instances.length > 1 && (
            <label className={styles.field}>
              已保存的引擎实例
              <select value={instanceId} onChange={(e) => setInstanceId(e.target.value)}>
                {group.instances.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.name} · {i.id}
                  </option>
                ))}
              </select>
            </label>
          )}
          <section className={styles.defaultConfig}>
            <div className={styles.split}>
              <strong>引擎默认配置</strong>
              <button className={styles.textButton} onClick={() => setConfigure(!configure)}>
                {configure ? '收起配置' : '编辑默认配置'}
                <Glyph name="chevron" size={14} />
              </button>
            </div>
            <p>
              {credentialsReady
                ? '已保存的配置会直接复用，无需重新填写。'
                : '请在此完成引擎配置并保存。'}
            </p>
            <div className={styles.chips}>
              {Object.entries(instance?.config ?? {})
                .filter(
                  ([key, value]) =>
                    [
                      'retrieval_profile',
                      'mode',
                      'top_k',
                      'chunk_size',
                      'chunk_overlap',
                      'embeddingModelRef',
                      'llmModelRef',
                    ].includes(key) && value !== undefined,
                )
                .map(([key, value]) => (
                  <span key={key}>
                    {key}: {String(value)}
                  </span>
                ))}
            </div>
            {configure && draft && (
              <div className={styles.configForm}>
                <label className={styles.field}>
                  实例名称
                  <input
                    value={draft.name}
                    onChange={(e) => {
                      setDraft({ ...draft, name: e.target.value });
                      setEditing(true);
                    }}
                  />
                </label>
                {(group?.definition?.fields ?? []).map((f) => (
                  <label className={styles.field} key={f.key}>
                    {f.label}
                    {f.type === 'boolean' ? (
                      <input
                        type="checkbox"
                        checked={Boolean(draft.config[f.key])}
                        onChange={(e) => patch(f.key, e.target.checked)}
                      />
                    ) : f.type === 'select' || f.type === 'model' ? (
                      <select
                        value={String(draft.config[f.key] ?? '')}
                        onChange={(e) => patch(f.key, e.target.value)}
                      >
                        <option value="">请选择{f.label}</option>
                        {f.type === 'select'
                          ? f.options?.map((o) => (
                              <option key={o} value={o}>
                                {o}
                              </option>
                            ))
                          : models
                              .filter((m) =>
                                m.output.includes(
                                  f.key === 'embeddingModelRef' ? 'embedding' : 'text',
                                ),
                              )
                              .map((m) => (
                                <option key={m.value} value={m.value} disabled={!m.available}>
                                  {m.label}
                                  {!m.available ? '（不可用）' : ''}
                                </option>
                              ))}
                      </select>
                    ) : f.type === 'list' ? (
                      <textarea
                        rows={3}
                        value={
                          Array.isArray(draft.config[f.key])
                            ? (draft.config[f.key] as string[]).join('\n')
                            : ''
                        }
                        onChange={(e) =>
                          patch(
                            f.key,
                            e.target.value
                              .split('\n')
                              .map((v) => v.trim())
                              .filter(Boolean),
                          )
                        }
                      />
                    ) : (
                      <input
                        type={f.type === 'number' ? 'number' : 'text'}
                        value={String(draft.config[f.key] ?? '')}
                        min={f.min}
                        max={f.max}
                        readOnly={f.key === 'server_url' && ['ima', 'pageindex'].includes(provider)}
                        onChange={(e) =>
                          patch(
                            f.key,
                            f.type === 'number' ? Number(e.target.value) : e.target.value,
                          )
                        }
                      />
                    )}
                    <small>{f.description}</small>
                  </label>
                ))}
                <button
                  className={styles.primary}
                  disabled={busy || !online}
                  onClick={() => void saveEngine()}
                >
                  保存并使用此引擎
                </button>
              </div>
            )}
          </section>
          {provider === 'ima' && draft && (
            <ImaLibraryPicker
              key={`${instanceId}:${mode}:${imaGeneration}`}
              instanceId={instanceId}
              engine={draft}
              saved={!editing && !!instance}
              online={online}
              disabled={busy}
              selectedId={fields.remoteKnowledgeBaseId ?? ''}
              onLoading={setImaLoading}
              onSelect={(id, remoteName, fromList) => {
                setFields({ remoteKnowledgeBaseId: id });
                setChecked(false);
                setImaSelected(fromList);
                setError('');
                setNotice('');
                if (remoteName && (!name.trim() || name === lastImaName.current)) {
                  setName(remoteName);
                  lastImaName.current = remoteName;
                }
              }}
            />
          )}
          {!isRemote &&
            mode === 'create_new' &&
            group?.definition?.modelKinds.includes('embedding') && (
              <label className={styles.field}>
                嵌入模型
                <select
                  aria-label="知识库嵌入模型"
                  value={embedding}
                  onChange={(e) => setEmbedding(e.target.value)}
                >
                  <option value="">选择嵌入模型</option>
                  {models
                    .filter((m) => m.output.includes('embedding'))
                    .map((m) => (
                      <option key={m.value} value={m.value} disabled={!m.available}>
                        {m.label}
                      </option>
                    ))}
                </select>
                <small>此知识库固定使用所选模型，不受全局默认模型变更影响。</small>
              </label>
            )}
          {connectionFields.map(([key, label, placeholder]) => (
            <label key={key} className={styles.field}>
              {label}
              <input
                value={fields[key] ?? ''}
                placeholder={placeholder}
                onChange={(e) => {
                  setFields({ ...fields, [key]: e.target.value });
                  setChecked(false);
                }}
              />
            </label>
          ))}
          {(isRemote || linked) && (
            <div className={styles.defaultConfig}>
              <p>
                {linked
                  ? '填写启途服务器上已有索引的绝对路径；不会复制或重建原索引。'
                  : '凭证使用上方保存的引擎配置。这里只登记远端知识库连接，原文件继续由原服务管理。'}
              </p>
              <button
                className={`${styles.secondary} ${styles.connectionButton}`}
                disabled={
                  busy ||
                  imaLoading ||
                  !online ||
                  !name.trim() ||
                  !credentialsReady ||
                  editing ||
                  (provider === 'ima' && !fields.remoteKnowledgeBaseId)
                }
                onClick={() => void probe()}
              >
                <Glyph name="search" size={16} /> {checked ? '检查通过' : '检查连接'}
              </button>
            </div>
          )}
          {!isRemote && mode === 'create_new' && (
            <div className={styles.field}>
              <span>初始文档（可选）</span>
              <label className={styles.dropZone}>
                <Glyph name="file" size={30} />
                <strong>选择文件…</strong>
                <span>点击选择受支持的文档</span>
                <input
                  aria-label="选择初始文档"
                  type="file"
                  multiple
                  onChange={(e) => pickFiles(e.target.files)}
                />
              </label>
              <label className={styles.textButton}>
                或上传文件夹（一次性导入）
                <input
                  type="file"
                  multiple
                  ref={(node) => node?.setAttribute('webkitdirectory', '')}
                  aria-label="选择初始文件夹"
                  onChange={(e) => pickFiles(e.target.files)}
                />
              </label>
              <small>
                支持 PDF、Office、EPUB、Markdown 等 18 种格式；每批最多 20 个，每个不超过 10
                MiB。可稍后添加 GitHub、网络来源或上传文档。
              </small>
              {files.length > 0 && (
                <ul className={styles.fileSelection}>
                  {files.map((file, index) => (
                    <li key={index}>{file.webkitRelativePath || file.name}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
          {assistants && (
            <details className={styles.defaultConfig}>
              <summary>
                绑定 AI 助手（可选）
                <span className={styles.badge}>{selectedAssistants.length} 位</span>
              </summary>
              <p>选择一个或多个助手；创建后也可以在知识库的“AI 助手”中调整。</p>
              <div className={styles.assistantGrid}>
                {assistants.catalog.map((a) => (
                  <label className={styles.assistantCard} key={a.id}>
                    <input
                      type="checkbox"
                      disabled={!a.enabled}
                      checked={selectedAssistants.includes(a.id)}
                      onChange={(e) =>
                        setSelectedAssistants(
                          e.target.checked
                            ? [...selectedAssistants, a.id]
                            : selectedAssistants.filter((id) => id !== a.id),
                        )
                      }
                    />
                    <span>
                      <AssistantGlyph value={a.avatar} size={20} /> {a.name}
                      {!a.enabled ? '（已停用）' : ''}
                    </span>
                  </label>
                ))}
              </div>
            </details>
          )}
          {!online && (
            <p className={styles.error} role="alert">
              当前离线，请恢复网络后重试。
            </p>
          )}
          {error && (
            <p className={styles.error} role="alert">
              {error}
            </p>
          )}
          {notice && (
            <p className={styles.notice} role="status">
              {notice}
            </p>
          )}
        </div>
        <footer className={styles.modalFooter}>
          <button className={styles.secondary} disabled={busy} onClick={close}>
            取消
          </button>
          <button
            className={styles.primary}
            disabled={
              busy ||
              imaLoading ||
              !online ||
              !name.trim() ||
              !credentialsReady ||
              editing ||
              (provider === 'ima' &&
                (!fields.remoteKnowledgeBaseId || (!imaSelected && !checked))) ||
              (!isRemote &&
                !linked &&
                group?.definition?.modelKinds.includes('embedding') &&
                !embedding)
            }
            onClick={async () => {
              setBusy(true);
              setError('');
              try {
                await onCreate({ request: request(), files, assistantIds: selectedAssistants });
              } catch (e) {
                setError(message(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            <Glyph name={mode === 'link_existing' ? 'link' : 'plus'} />
            {busy ? '正在处理…' : mode === 'link_existing' ? '关联' : '创建'}
          </button>
        </footer>
      </div>
    </div>,
    document.body,
  );
}
