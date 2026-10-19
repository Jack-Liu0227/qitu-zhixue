'use client';

import { AssistantGlyph } from '@qitu/ui';
// Layout and operations adapted from DeepTutor KnowledgeBaseDetail/KbFilesTab (6cf793bd, MIT).
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  cancelKnowledgeJob,
  centerRequest,
  createKnowledgeSource,
  fetchBaseBindings,
  saveBaseBindings,
  syncKnowledgeSource,
  type BaseDetail,
  type EngineGroup,
  type KnowledgeBinding,
} from '../../api/knowledge-center';
import { createIdempotentRetryKey } from '../../api/types';
import { KnowledgeFileUpload } from '../KnowledgeFileUpload';
import { PdfDocumentPreview } from './PdfDocumentPreview';
import { bytes, EngineIcon, Glyph, message, remoteProviders, statusLabels, time } from './shared';
import styles from './KnowledgeLibrary.module.css';

type Section =
  'files' | 'add' | 'folders' | 'github' | 'web' | 'versions' | 'assistants' | 'settings';
const sections: [Section, string, string][] = [
  ['files', '文件', 'file'],
  ['add', '添加文档', 'upload'],
  ['folders', '关联文件夹', 'folder'],
  ['github', 'GitHub', 'github'],
  ['web', '网络', 'globe'],
  ['versions', '索引版本', 'layers'],
  ['assistants', 'AI 助手', 'assistant'],
  ['settings', '设置', 'settings'],
];
const running = (state: string) => !['ready', 'failed', 'empty', 'cancelled'].includes(state);
export function LibraryDetail({
  detail,
  engines,
  online,
  onBack,
  onRefresh,
  onDeleted,
}: {
  detail: BaseDetail;
  engines: EngineGroup[];
  online: boolean;
  onBack: () => void;
  onRefresh: () => Promise<BaseDetail>;
  onDeleted: () => Promise<void>;
}) {
  const [section, setSection] = useState<Section>('files');
  const [selected, setSelected] = useState<string | null>(null);
  const [preview, setPreview] = useState<{
    title: string;
    content: string;
    origin: Record<string, unknown>;
  } | null>(null);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [previewError, setPreviewError] = useState('');
  const [previewMode, setPreviewMode] = useState<'text' | 'original'>('original');
  const [collapsed, setCollapsed] = useState(false);
  const [fileQuery, setFileQuery] = useState('');
  const [folder, setFolder] = useState('');
  const [cursor, setCursor] = useState('');
  const [remoteFiles, setRemoteFiles] = useState<{
    items: { id: string; title: string; origin: Record<string, unknown> }[];
    folders: { id: string; name: string }[];
    nextCursor?: string;
  }>({ items: [], folders: [] });
  const filesSequence = useRef(0);
  const [filesLoading, setFilesLoading] = useState(false);
  const [filesError, setFilesError] = useState('');
  const [engineChoice, setEngineChoice] = useState(detail.engine_instance_id ?? '');
  const [bindings, setBindings] = useState<KnowledgeBinding[]>([]);
  const [bindingRevision, setBindingRevision] = useState(0);
  const [bindingLoading, setBindingLoading] = useState(true);
  const [bindingError, setBindingError] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [sourceValue, setSourceValue] = useState('');
  const [branch, setBranch] = useState('HEAD');
  const [sourcePath, setSourcePath] = useState('');
  const [glob, setGlob] = useState('**/*');
  const [schedule, setSchedule] = useState('');
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [name, setName] = useState(detail.name);
  const [events, setEvents] = useState<
    { state: string; occurred_at: string; detail: Record<string, unknown> }[]
  >([]);
  const retry = useRef(createIdempotentRetryKey());
  const previewSequence = useRef(0);
  const group = engines.find((e) => e.instances.some((i) => i.id === detail.engine_instance_id));
  const instance = group?.instances.find((i) => i.id === detail.engine_instance_id);
  const remote =
    remoteProviders.includes(group?.provider ?? '') ||
    (detail.connection?.status && detail.connection.status !== 'not_applicable');
  const readonly = Boolean(remote) || detail.kind === 'project';
  const linkedFiles = Boolean(remote) && detail.connection?.status !== 'not_applicable';
  const files = linkedFiles ? remoteFiles.items : detail.files;
  const folders = detail.library_settings?.folders ?? [];
  const loadRemoteFiles = useCallback(async () => {
    if (!linkedFiles) return;
    const sequence = ++filesSequence.current;
    setFilesLoading(true);
    setFilesError('');
    try {
      const data = await centerRequest<typeof remoteFiles>(
        `knowledge/bases/${detail.id}/remote-files?${new URLSearchParams({ folderId: folder, cursor })}`,
      );
      if (sequence === filesSequence.current)
        setRemoteFiles({ ...data, items: data.items ?? [], folders: data.folders ?? [] });
    } catch (e) {
      if (sequence === filesSequence.current) setFilesError(message(e));
    } finally {
      if (sequence === filesSequence.current) setFilesLoading(false);
    }
  }, [detail.id, linkedFiles, folder, cursor]);
  useEffect(() => {
    void loadRemoteFiles();
  }, [loadRemoteFiles]);
  const activeJob = detail.jobs.find((j) => running(j.state));
  const loadBindings = useCallback(async () => {
    setBindingLoading(true);
    setBindingError('');
    try {
      const data = await fetchBaseBindings(detail.id);
      setBindings(data.catalog ?? data.bindings);
      setBindingRevision(data.bindingRevision ?? detail.revision ?? 0);
    } catch (e) {
      setBindingError(message(e));
    } finally {
      setBindingLoading(false);
    }
  }, [detail.id, detail.revision]);
  useEffect(() => {
    void loadBindings();
  }, [loadBindings]);
  useEffect(() => {
    if (!activeJob) return;
    const timer = setInterval(() => void onRefresh().catch((e) => setError(message(e))), 4000);
    return () => clearInterval(timer);
  }, [activeJob?.id, onRefresh]);
  useEffect(() => {
    const job = detail.jobs[0];
    if (!job) {
      setEvents([]);
      return;
    }
    void centerRequest<{ events: typeof events }>(`knowledge/jobs/${encodeURIComponent(job.id)}`)
      .then((data) => setEvents(data.events))
      .catch(() => setEvents([]));
  }, [detail.jobs]);
  async function showFile(id: string, mode: 'original' | 'text' = 'original') {
    const sequence = ++previewSequence.current;
    setSelected(id);
    setPreviewMode(mode);
    setPreview(null);
    setPreviewBusy(true);
    setPreviewError('');
    try {
      const listed = files.find((file) => file.id === id);
      if (
        mode === 'original' &&
        listed &&
        (listed.origin?.mimeType === 'application/pdf' || /\.pdf$/i.test(listed.title))
      ) {
        setPreview({ title: listed.title, content: '', origin: listed.origin });
        return;
      }
      const file = await centerRequest<typeof preview>(
        linkedFiles
          ? `knowledge/bases/${encodeURIComponent(detail.id)}/remote-files/${encodeURIComponent(id)}?${new URLSearchParams({ folderId: folder, cursor })}`
          : `knowledge/bases/${encodeURIComponent(detail.id)}/files/${encodeURIComponent(id)}`,
      );
      if (sequence === previewSequence.current) setPreview(file);
    } catch (e) {
      if (sequence === previewSequence.current) setPreviewError(message(e));
    } finally {
      if (sequence === previewSequence.current) setPreviewBusy(false);
    }
  }
  async function action(path: string, body: unknown, refresh = true) {
    if (!online) return false;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await centerRequest(path, 'POST', body, retry.current.keyFor(path + JSON.stringify(body)));
      retry.current.acknowledge();
      if (refresh) await onRefresh();
      setNotice('已保存');
      return true;
    } catch (e) {
      setError(message(e));
      return false;
    } finally {
      setBusy(false);
    }
  }
  async function settings(body: Record<string, unknown>) {
    return action(
      `knowledge/bases/${detail.id}/settings`,
      { expectedRevision: detail.revision, ...body },
      !body.deleted,
    );
  }
  async function saveBindings() {
    setBusy(true);
    setBindingError('');
    try {
      const payload = bindings.map((b) => ({
        agentKind: b.agentKind,
        agentId: b.agentId,
        mode: b.mode,
        enabled: b.enabled,
      }));
      await saveBaseBindings(
        detail.id,
        { expectedRevision: bindingRevision, bindings: payload },
        retry.current.keyFor('bindings:' + JSON.stringify(payload)),
      );
      retry.current.acknowledge();
      await onRefresh();
      await loadBindings();
      setNotice('助手绑定已保存；检索仍遵守工具总开关和助手启用状态。');
    } catch (e) {
      setBindingError(message(e));
    } finally {
      setBusy(false);
    }
  }
  const selectedFile = files.find((f) => f.id === selected);
  const original = linkedFiles
    ? `/api/v1/admin/knowledge/bases/${encodeURIComponent(detail.id)}/remote-files/${encodeURIComponent(selected ?? '')}/original?${new URLSearchParams({ folderId: folder, cursor, inline: '1' })}`
    : `/api/v1/admin/knowledge/bases/${encodeURIComponent(detail.id)}/files/${encodeURIComponent(selected ?? '')}/original?inline=1`;
  const isPdf =
    String(preview?.origin?.mimeType ?? selectedFile?.origin?.mimeType) === 'application/pdf' ||
    /\.pdf$/i.test(String(preview?.origin?.fileName ?? selectedFile?.title ?? ''));
  const selectedSources =
    detail.sources?.filter(
      (s) =>
        s.kind === (section === 'folders' ? 'folder' : section === 'github' ? 'github' : 'web'),
    ) ?? [];
  return (
    <section className={styles.detail} aria-label="知识库详情">
      <header className={styles.detailHeader}>
        <div className={styles.split}>
          <div className={styles.identity}>
            <EngineIcon group={group} size={40} />
            <div>
              <button className={styles.textButton} onClick={onBack}>
                <Glyph name="back" size={15} />
                知识库
              </button>
              <h2>
                {detail.name}
                {detail.library_settings?.isDefault && (
                  <span className={styles.defaultBadge}>
                    <Glyph name="star" size={13} />
                    默认
                  </span>
                )}
                <span className={styles.libraryBadge}>账户资源库</span>
                <span
                  className={`${styles.badge} ${detail.build_state === 'failed' ? styles.bad : ''}`}
                >
                  {statusLabels[detail.build_state] ?? detail.build_state}
                </span>
              </h2>
              <p>
                {group?.name ?? '未选择引擎'}
                {detail.library_settings?.engineOverrides?.embeddingModelRef ||
                instance?.config.embeddingModelRef
                  ? ` · ${String(detail.library_settings?.engineOverrides?.embeddingModelRef ?? instance?.config.embeddingModelRef)}`
                  : ''}{' '}
                · 最近更新 {time(detail.updated_at)}
              </p>
            </div>
          </div>
          {!readonly && (
            <button
              className={styles.secondary}
              disabled={busy || !online || !!activeJob}
              onClick={() => void action(`knowledge/bases/${detail.id}/rebuild`, {})}
            >
              <Glyph name="refresh" />
              {detail.build_state === 'failed' ? '重试索引' : '重建索引'}
            </button>
          )}
        </div>
        <nav className={styles.detailTabs} aria-label="知识库内容">
          {sections
            .filter(
              ([id]) => !readonly || !['add', 'folders', 'github', 'web', 'versions'].includes(id),
            )
            .map(([id, label, icon]) => (
              <button
                key={id}
                role="tab"
                aria-selected={section === id}
                onClick={() => {
                  setSection(id);
                  setSourceValue('');
                  setError('');
                  setNotice('');
                }}
              >
                <Glyph name={icon} size={16} />
                {label}
              </button>
            ))}
        </nav>
      </header>
      {activeJob && (
        <div className={styles.taskBar} role="status">
          <Glyph name="refresh" size={15} />
          {statusLabels[activeJob.state] ?? activeJob.state} · 文档在后台处理
          <button
            disabled={busy || !online}
            className={styles.textButton}
            onClick={async () => {
              try {
                await cancelKnowledgeJob(
                  activeJob.id,
                  retry.current.keyFor('cancel:' + activeJob.id),
                );
                retry.current.acknowledge();
                await onRefresh();
              } catch (e) {
                setError(message(e));
              }
            }}
          >
            取消任务
          </button>
        </div>
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
      {!online && (
        <p className={styles.error} role="alert">
          当前离线，恢复网络后可继续保存。
        </p>
      )}
      {section === 'files' ? (
        <div className={`${styles.fileWorkspace} ${collapsed ? styles.collapsed : ''}`}>
          <aside className={styles.fileSidebar}>
            <div className={styles.sidebarHead}>
              {!collapsed && (
                <strong>
                  文件 <span className={styles.badge}>{files.length}</span>
                </strong>
              )}
              <div>
                {!readonly && (
                  <button
                    className={styles.iconButton}
                    title="新建文件夹"
                    onClick={async () => {
                      const value = window.prompt('文件夹名称（可用 / 分级）');
                      if (value?.trim()) await settings({ createFolder: value.trim() });
                    }}
                  >
                    <Glyph name="folder" size={15} />
                  </button>
                )}
                <button
                  className={styles.iconButton}
                  title="刷新文件"
                  onClick={() =>
                    void (linkedFiles ? loadRemoteFiles() : onRefresh()).catch((e) =>
                      setError(message(e)),
                    )
                  }
                >
                  <Glyph name="refresh" size={15} />
                </button>
                <button
                  className={styles.iconButton}
                  title={collapsed ? '展开文件列表' : '收起文件列表'}
                  onClick={() => setCollapsed(!collapsed)}
                >
                  <Glyph name="panel" size={15} />
                </button>
              </div>
            </div>
            {!collapsed && (
              <>
                <input
                  className={styles.fileSearch}
                  aria-label="搜索文件"
                  placeholder="搜索文件…"
                  value={fileQuery}
                  onChange={(e) => setFileQuery(e.target.value)}
                />
                {(linkedFiles ? remoteFiles.folders.length > 0 || folder : folders.length > 0) && (
                  <>
                    <button
                      className={styles.fileRow}
                      onClick={() => {
                        setFolder('');
                        setCursor('');
                        setSelected(null);
                        setPreview(null);
                      }}
                    >
                      <Glyph name="folder" />
                      {linkedFiles ? '知识库根目录' : '全部文件'}
                    </button>
                    {(linkedFiles
                      ? remoteFiles.folders
                      : folders.map((f) => ({ id: f, name: f }))
                    ).map((f) => (
                      <button
                        key={f.id}
                        className={`${styles.fileRow} ${folder === f.id ? styles.fileActive : ''}`}
                        onClick={() => {
                          setFolder(f.id);
                          setCursor('');
                          setSelected(null);
                          setPreview(null);
                        }}
                      >
                        <Glyph name="folder" />
                        {f.name}
                      </button>
                    ))}
                  </>
                )}
                {filesLoading && <p className={styles.sidebarEmpty}>正在读取文件…</p>}
                {filesError && (
                  <p className={styles.error} role="alert">
                    {filesError}
                  </p>
                )}
                {files
                  .filter(
                    (f) =>
                      f.title.toLowerCase().includes(fileQuery.toLowerCase()) &&
                      (linkedFiles || !folder || f.origin.folder === folder),
                  )
                  .map((file) => (
                    <button
                      key={file.id}
                      className={`${styles.fileRow} ${file.id === selected ? styles.fileActive : ''}`}
                      onClick={() => void showFile(file.id)}
                    >
                      <Glyph name="file" size={19} />
                      <span>
                        <strong>{file.title}</strong>
                        <small>
                          {bytes(file.origin?.byteSize)}
                          {file.origin?.parser ? ' · 已解析' : ''}
                        </small>
                      </span>
                    </button>
                  ))}
                {linkedFiles && remoteFiles.nextCursor && (
                  <button
                    className={styles.textButton}
                    onClick={() => setCursor(remoteFiles.nextCursor ?? '')}
                  >
                    下一页
                  </button>
                )}
                {files.length === 0 && !filesLoading && !filesError && (
                  <div className={styles.sidebarEmpty}>
                    {readonly ? '此目录暂无可浏览文件。索引资料仍保留在关联来源中。' : '暂无文件'}
                    {!readonly && (
                      <button className={styles.textButton} onClick={() => setSection('add')}>
                        添加文档
                      </button>
                    )}
                  </div>
                )}
              </>
            )}
          </aside>
          <div className={styles.preview}>
            {previewBusy ? (
              <div className={styles.empty}>正在读取文档…</div>
            ) : previewError ? (
              <div className={styles.error} role="alert">
                {previewError}
                <button
                  className={styles.textButton}
                  onClick={() => selected && void showFile(selected)}
                >
                  重试
                </button>
              </div>
            ) : preview && selectedFile ? (
              <>
                <div className={styles.previewHead}>
                  <strong>{preview.title}</strong>
                  <div>
                    {!readonly && folders.length > 0 && (
                      <select
                        aria-label="移动到文件夹"
                        value={String(selectedFile.origin.folder ?? '')}
                        onChange={(e) =>
                          void settings({
                            moveFile: { memberId: selectedFile.id, folder: e.target.value },
                          })
                        }
                      >
                        <option value="">根目录</option>
                        {folders.map((f) => (
                          <option key={f} value={f}>
                            {f}
                          </option>
                        ))}
                      </select>
                    )}
                    <div className={styles.previewModes} role="group" aria-label="文档显示方式">
                      <button
                        type="button"
                        aria-pressed={previewMode === 'original'}
                        onClick={() => setPreviewMode('original')}
                      >
                        PDF 原文预览
                      </button>
                      <button
                        type="button"
                        aria-pressed={previewMode === 'text'}
                        onClick={() => void showFile(selectedFile.id, 'text')}
                      >
                        提取文本
                      </button>
                    </div>
                    {!readonly && (
                      <button
                        className={styles.dangerText}
                        disabled={busy || !online}
                        onClick={async () => {
                          if (window.confirm(`删除“${selectedFile.title}”？`)) {
                            if (
                              await action(
                                `knowledge/bases/${detail.id}/files/${selectedFile.id}`,
                                { deleted: true },
                              )
                            ) {
                              setSelected(null);
                              setPreview(null);
                            }
                          }
                        }}
                      >
                        <Glyph name="trash" size={15} />
                        删除
                      </button>
                    )}
                  </div>
                </div>
                {previewMode === 'original' ? (
                  isPdf ? (
                    <PdfDocumentPreview key={original} url={original} title={preview.title} />
                  ) : (
                    <div className={styles.empty}>
                      <Glyph name="file" size={32} />
                      <h3>此文档没有可用的 PDF 原文</h3>
                      <p>可切换「提取文本」查看解析内容。</p>
                      <button
                        className={styles.secondary}
                        onClick={() => void showFile(selectedFile.id, 'text')}
                      >
                        查看提取文本
                      </button>
                    </div>
                  )
                ) : (
                  <pre className={styles.documentText}>
                    {preview.content || '此文档尚无可用的提取文本。'}
                  </pre>
                )}
              </>
            ) : (
              <div className={styles.empty}>
                <span className={styles.emptyGlyph}>
                  <Glyph name="file" size={36} />
                </span>
                <h3>请选择一个文件以预览</h3>
                <p>从左侧列表选择任意文档，可在此处直接预览，无需离开知识库。</p>
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className={styles.detailBody}>
          {section === 'add' && (
            <>
              <KnowledgeFileUpload
                key={detail.id}
                baseId={detail.id}
                onSaved={async () => {
                  await onRefresh();
                  setNotice('文件已保存，索引在后台准备。');
                }}
              />
              <details className={styles.panel}>
                <summary>添加文本资料</summary>
                <label className={styles.field}>
                  标题
                  <input value={title} onChange={(e) => setTitle(e.target.value)} />
                </label>
                <label className={styles.field}>
                  正文
                  <textarea
                    rows={10}
                    value={content}
                    onChange={(e) => setContent(e.target.value)}
                  />
                </label>
                <button
                  className={styles.primary}
                  disabled={!online || busy || !title.trim() || !content.trim()}
                  onClick={async () => {
                    if (await action(`knowledge/bases/${detail.id}/files`, { title, content })) {
                      setTitle('');
                      setContent('');
                    }
                  }}
                >
                  保存并建立索引
                </button>
              </details>
            </>
          )}
          {(['folders', 'github', 'web'] as string[]).includes(section) && (
            <>
              <section className={styles.panel}>
                <h3>
                  {section === 'folders'
                    ? '关联文件夹'
                    : section === 'github'
                      ? 'GitHub 来源'
                      : '网络来源'}
                </h3>
                <p>
                  {section === 'folders'
                    ? '关联启途服务器上的文件夹，按需同步其中的教学资料。'
                    : section === 'github'
                      ? '从 GitHub 仓库导入资料，保留来源和同步记录。'
                      : '导入网页正文，保留来源链接和同步记录。'}
                </p>
                <label className={styles.field}>
                  {section === 'folders'
                    ? '文件夹路径'
                    : section === 'github'
                      ? 'GitHub 仓库'
                      : '网页地址'}
                  <input
                    value={sourceValue}
                    onChange={(e) => setSourceValue(e.target.value)}
                    placeholder={
                      section === 'folders'
                        ? '/服务端资料目录'
                        : section === 'github'
                          ? 'owner/repository'
                          : 'https://example.com/article'
                    }
                  />
                </label>
                {section === 'github' && (
                  <div className={styles.configGrid}>
                    <label className={styles.field}>
                      分支
                      <input value={branch} onChange={(e) => setBranch(e.target.value)} />
                    </label>
                    <label className={styles.field}>
                      子目录
                      <input value={sourcePath} onChange={(e) => setSourcePath(e.target.value)} />
                    </label>
                    <label className={styles.field}>
                      文件匹配
                      <input value={glob} onChange={(e) => setGlob(e.target.value)} />
                    </label>
                  </div>
                )}
                <label className={styles.field}>
                  自动同步
                  <select value={schedule} onChange={(e) => setSchedule(e.target.value)}>
                    <option value="">仅手动同步</option>
                    <option value="1">每小时</option>
                    <option value="24">每天</option>
                    <option value="168">每周</option>
                  </select>
                </label>
                <button
                  className={styles.primary}
                  disabled={!online || busy || !sourceValue.trim()}
                  onClick={async () => {
                    setBusy(true);
                    setError('');
                    try {
                      const kind =
                        section === 'folders' ? 'folder' : section === 'github' ? 'github' : 'web';
                      const sourceConfig =
                        kind === 'folder'
                          ? { path: sourceValue }
                          : kind === 'github'
                            ? { repo: sourceValue, branch, path: sourcePath, glob }
                            : { url: sourceValue, crawlMode: 'single_page' };
                      await createKnowledgeSource(
                        detail.id,
                        { kind, sourceConfig, scheduleHours: schedule ? Number(schedule) : null },
                        retry.current.keyFor(
                          'source:' + JSON.stringify({ kind, sourceConfig, schedule }),
                        ),
                      );
                      retry.current.acknowledge();
                      setSourceValue('');
                      await onRefresh();
                      setNotice('来源已添加，可立即同步。');
                    } catch (e) {
                      setError(message(e));
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  <Glyph name="plus" />
                  添加来源
                </button>
              </section>
              <div className={styles.sourceList}>
                {selectedSources.length === 0 ? (
                  <div className={styles.emptySmall}>
                    暂无
                    {section === 'folders'
                      ? '关联文件夹'
                      : section === 'github'
                        ? 'GitHub 来源'
                        : '网络来源'}
                  </div>
                ) : (
                  selectedSources.map((source) => (
                    <section key={source.id} className={styles.panel}>
                      <div className={styles.split}>
                        <strong>
                          {String(
                            source.sourceConfig?.repo ??
                              source.sourceConfig?.url ??
                              source.sourceConfig?.path ??
                              source.id,
                          )}
                        </strong>
                        <span className={styles.badge}>{source.status}</span>
                      </div>
                      <p>
                        最近同步 {time(source.lastSyncAt)} ·{' '}
                        {source.scheduleHours ? `每 ${source.scheduleHours} 小时同步` : '手动同步'}
                      </p>
                      {source.lastErrorCode && (
                        <p className={styles.error}>{source.lastErrorCode}</p>
                      )}
                      <div className={styles.actions}>
                        <button
                          className={styles.secondary}
                          disabled={
                            busy ||
                            !online ||
                            source.status === 'revoked' ||
                            source.status === 'syncing'
                          }
                          onClick={async () => {
                            setBusy(true);
                            setError('');
                            try {
                              await syncKnowledgeSource(
                                detail.id,
                                source.id,
                                {},
                                retry.current.keyFor(
                                  'sync:' + source.id + ':' + source.lastSourceRevision,
                                ),
                              );
                              retry.current.acknowledge();
                              await onRefresh();
                            } catch (e) {
                              setError(message(e));
                            } finally {
                              setBusy(false);
                            }
                          }}
                        >
                          <Glyph name="refresh" />
                          同步
                        </button>
                        <button
                          className={styles.dangerText}
                          disabled={busy || !online || source.status === 'revoked'}
                          onClick={() => {
                            if (window.confirm('取消关联此来源？其资料将立即停止检索。'))
                              void action(
                                `knowledge/bases/${detail.id}/sources/${source.id}/settings`,
                                { revoked: true },
                              );
                          }}
                        >
                          取消关联
                        </button>
                      </div>
                    </section>
                  ))
                )}
              </div>
            </>
          )}
          {section === 'versions' && (
            <>
              <section className={styles.panel}>
                <div className={styles.split}>
                  <div>
                    <h3>索引版本</h3>
                    <p>查看索引快照和构建记录；重建成功后再切换到新索引。</p>
                  </div>
                  <button
                    className={styles.primary}
                    disabled={busy || !online || !!activeJob}
                    onClick={() => void action(`knowledge/bases/${detail.id}/rebuild`, {})}
                  >
                    <Glyph name="refresh" />
                    重建索引
                  </button>
                </div>
              </section>
              {detail.versions.length === 0 ? (
                <div className={styles.emptySmall}>尚无索引版本，添加文档后建立首个索引。</div>
              ) : (
                detail.versions.map((v) => (
                  <section key={v.id} className={styles.panel}>
                    <div className={styles.split}>
                      <strong>
                        {v.id === detail.active_index_version_id ? '当前索引' : '历史索引'}
                      </strong>
                      <span className={styles.badge}>{statusLabels[v.status] ?? v.status}</span>
                    </div>
                    <p>
                      {time(v.created_at)} · {String(v.manifest?.documents ?? 0)} 份文档
                    </p>
                    <code>{v.id}</code>
                  </section>
                ))
              )}
              <details className={styles.panel}>
                <summary>任务日志与历史记录（{detail.jobs.length}）</summary>
                {detail.jobs.map((j) => (
                  <div className={styles.logRow} key={j.id}>
                    <span>{statusLabels[j.state] ?? j.state}</span>
                    <code>{j.error_code ?? j.id}</code>
                  </div>
                ))}
                {events.map((e, index) => (
                  <div className={styles.logRow} key={index}>
                    <span>{time(e.occurred_at)}</span>
                    <strong>{statusLabels[e.state] ?? e.state}</strong>
                    {Boolean(e.detail.errorCode) && <code>{String(e.detail.errorCode)}</code>}
                  </div>
                ))}
              </details>
            </>
          )}
          {section === 'assistants' && (
            <section className={styles.panel} aria-label="知识库助手绑定">
              <h3>绑定 AI 助手</h3>
              <p>
                选择一个或多个助手。助手只检索已绑定且可用的知识库；取消绑定后，下轮调用立即生效。
              </p>
              {bindingLoading ? (
                <p>正在读取助手…</p>
              ) : bindingError ? (
                <p className={styles.error} role="alert">
                  {bindingError}
                  <button className={styles.textButton} onClick={() => void loadBindings()}>
                    重新读取
                  </button>
                </p>
              ) : bindings.length === 0 ? (
                <p>暂无可绑定助手，请先在“AI 助手”中添加。</p>
              ) : (
                <div className={styles.assistantGrid}>
                  {bindings
                    .filter((b) => b.agentKind === 'admin_assistant')
                    .map((b) => (
                      <label
                        key={b.agentId}
                        className={`${styles.assistantCard} ${b.enabled ? styles.selected : ''}`}
                      >
                        <input
                          type="checkbox"
                          disabled={busy || !online || b.targetEnabled === false}
                          checked={b.enabled}
                          onChange={(e) =>
                            setBindings((rows) =>
                              rows.map((row) =>
                                row.agentId === b.agentId && row.agentKind === b.agentKind
                                  ? { ...row, enabled: e.target.checked }
                                  : row,
                              ),
                            )
                          }
                        />
                        <span>
                          <strong>
                            <AssistantGlyph value={b.avatar} size={20} /> {b.agentName ?? b.agentId}
                          </strong>
                          <small>
                            {b.readonlyReason ??
                              (b.enabled
                                ? b.effective
                                  ? '已生效'
                                  : '保存后按权限检索'
                                : '未绑定')}
                            {b.reasons?.length ? ` · ${b.reasons.join('，')}` : ''}
                          </small>
                        </span>
                      </label>
                    ))}
                </div>
              )}
              <button
                className={styles.primary}
                disabled={busy || !online || bindingLoading || !!bindingError}
                onClick={() => void saveBindings()}
              >
                保存助手绑定
              </button>
            </section>
          )}
          {section === 'settings' && (
            <>
              <section className={styles.panel}>
                <h3>概览</h3>
                <dl className={styles.metadata}>
                  <div>
                    <dt>知识引擎</dt>
                    <dd>{group?.name ?? '未设置'}</dd>
                  </div>
                  <div>
                    <dt>引擎实例</dt>
                    <dd>{instance?.name ?? '未设置'}</dd>
                  </div>
                  <div>
                    <dt>创建时间</dt>
                    <dd>{time(detail.created_at)}</dd>
                  </div>
                  <div>
                    <dt>最近更新</dt>
                    <dd>{time(detail.updated_at)}</dd>
                  </div>
                  <div>
                    <dt>文档</dt>
                    <dd>{detail.files.length} 份</dd>
                  </div>
                  <div>
                    <dt>存储工作区</dt>
                    <dd>账户资源库</dd>
                  </div>
                </dl>
                <label className={styles.field}>
                  知识库名称
                  <input value={name} onChange={(e) => setName(e.target.value)} maxLength={160} />
                </label>
                <button
                  className={styles.secondary}
                  disabled={busy || !online || !name.trim() || name === detail.name}
                  onClick={() => void settings({ name })}
                >
                  保存名称
                </button>
                {!readonly && (
                  <>
                    <label className={styles.field}>
                      索引引擎
                      <select
                        aria-label="知识库索引引擎"
                        value={engineChoice}
                        onChange={(e) => setEngineChoice(e.target.value)}
                      >
                        <option value="">选择已配置引擎</option>
                        {engines
                          .filter((g) => !remoteProviders.includes(g.provider))
                          .flatMap((g) =>
                            g.instances
                              .filter((i) => i.enabled)
                              .map((i) => (
                                <option key={i.id} value={i.id}>
                                  {g.name} · {i.name}
                                </option>
                              )),
                          )}
                      </select>
                    </label>
                    <button
                      className={styles.secondary}
                      disabled={
                        busy ||
                        !online ||
                        !engineChoice ||
                        engineChoice === detail.engine_instance_id
                      }
                      onClick={() => void settings({ engineInstanceId: engineChoice })}
                    >
                      保存引擎，等待重新索引
                    </button>
                  </>
                )}
              </section>
              <section className={styles.panel}>
                <h3>默认知识库</h3>
                <p>已绑定助手检索时优先查询默认知识库，仍遵守逐库授权。</p>
                <button
                  className={styles.secondary}
                  disabled={busy || !online || detail.library_settings?.isDefault}
                  onClick={() => void settings({ isDefault: true })}
                >
                  <Glyph name="star" />
                  {detail.library_settings?.isDefault ? '当前默认' : '设为默认'}
                </button>
              </section>
              {remote && (
                <section className={styles.panel}>
                  <h3>关联连接</h3>
                  <p>
                    {detail.connection?.provider ?? group?.name} · {detail.connection?.status}
                  </p>
                  <dl className={styles.metadata}>
                    {Object.entries(detail.connection?.externalRef ?? {}).map(([key, value]) => (
                      <div key={key}>
                        <dt>{key}</dt>
                        <dd>{String(value)}</dd>
                      </div>
                    ))}
                  </dl>
                </section>
              )}
              <section className={`${styles.panel} ${styles.dangerPanel}`}>
                <h3>删除知识库</h3>
                <p>删除后助手将无法检索此知识库。关联的远端原文件和索引保留在原服务中。</p>
                <button
                  className={styles.dangerButton}
                  disabled={busy || !online}
                  onClick={async () => {
                    if (window.confirm(`确认删除知识库“${detail.name}”？`)) {
                      if (await settings({ deleted: true })) await onDeleted();
                    }
                  }}
                >
                  <Glyph name="trash" />
                  删除知识库
                </button>
              </section>
            </>
          )}
        </div>
      )}
    </section>
  );
}
