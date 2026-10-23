'use client';

// Master-detail browsing follows DeepTutor KbFilesTab (6cf793bd, MIT).
import { useEffect, useRef, useState } from 'react';
import { centerRequest, type BaseDetail } from '../../api/knowledge-center';
import { PdfDocumentPreview } from './PdfDocumentPreview';
import { bytes, Glyph, message } from './shared';
import styles from './KnowledgeLibrary.module.css';

type FileEntry = { id: string; title: string; origin: Record<string, unknown> };
type FilePage = {
  items: FileEntry[];
  folders: { id: string; name: string }[];
  nextCursor?: string;
};
type Location = { folderId: string; cursor: string };
type Preview = { title: string; content: string; origin: Record<string, unknown> };
const isPdf = (file: FileEntry) =>
  file.origin?.mimeType === 'application/pdf' ||
  /\.pdf$/i.test(String(file.origin?.fileName ?? file.title));

export function LibraryFiles({ detail, online }: { detail: BaseDetail; online: boolean }) {
  const remote = !!detail.connection && detail.connection.status !== 'not_applicable';
  const basePath = `knowledge/bases/${encodeURIComponent(detail.id)}`;
  const [location, setLocation] = useState<Location>({ folderId: '', cursor: '' });
  const [history, setHistory] = useState<Location[]>([]);
  const [listing, setListing] = useState<FilePage>({ items: [], folders: [] });
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState('');
  const [refresh, setRefresh] = useState(0);
  const [query, setQuery] = useState('');
  const [collapsed, setCollapsed] = useState(false);
  const [selected, setSelected] = useState<FileEntry | null>(null);
  const [mode, setMode] = useState<'original' | 'text'>('text');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [previewError, setPreviewError] = useState('');
  const previewSequence = useRef(0);

  function clearPreview() {
    previewSequence.current++;
    setSelected(null);
    setPreview(null);
    setPreviewError('');
    setPreviewBusy(false);
  }
  useEffect(() => {
    let current = true;
    clearPreview();
    setListing({ items: [], folders: [] });
    setListError('');
    setLoading(online);
    if (online) {
      void (async () => {
        try {
          const page = remote
            ? await centerRequest<FilePage>(
                `${basePath}/remote-files?${new URLSearchParams(location)}`,
              )
            : await centerRequest<BaseDetail>(basePath).then((base) => ({
                items: base.files,
                folders: (base.library_settings?.folders ?? []).map((id) => ({ id, name: id })),
              }));
          if (current)
            setListing({ ...page, items: page.items ?? [], folders: page.folders ?? [] });
        } catch (e) {
          if (current) setListError(message(e));
        } finally {
          if (current) setLoading(false);
        }
      })();
    }
    return () => {
      current = false;
      previewSequence.current++;
    };
  }, [basePath, remote, location, refresh, online]);

  function navigate(next: Location, back = false) {
    clearPreview();
    setQuery('');
    setListing({ items: [], folders: [] });
    setLoading(true);
    setHistory((previous) => (back ? previous.slice(0, -1) : [...previous, location]));
    setLocation(next);
  }
  async function showFile(file: FileEntry, requestedMode?: 'original' | 'text') {
    const nextMode = requestedMode ?? (isPdf(file) ? 'original' : 'text');
    const sequence = ++previewSequence.current;
    setSelected(file);
    setMode(nextMode);
    setPreview(null);
    setPreviewError('');
    setPreviewBusy(nextMode === 'text');
    if (nextMode === 'original') return;
    try {
      const result = await centerRequest<Preview>(
        remote
          ? `${basePath}/remote-files/${encodeURIComponent(file.id)}?${new URLSearchParams(location)}`
          : `${basePath}/files/${encodeURIComponent(file.id)}`,
      );
      if (sequence === previewSequence.current) {
        setPreview(result);
        const resolved = { ...file, origin: { ...file.origin, ...result.origin } };
        setSelected(resolved);
        // Cloud listings may omit MIME types and filename extensions.
        if (!requestedMode && isPdf(resolved)) setMode('original');
      }
    } catch (e) {
      if (sequence === previewSequence.current) setPreviewError(message(e));
    } finally {
      if (sequence === previewSequence.current) setPreviewBusy(false);
    }
  }
  const visible = listing.items.filter(
    (file) =>
      file.title.toLowerCase().includes(query.trim().toLowerCase()) &&
      (remote || !location.folderId || file.origin?.folder === location.folderId),
  );
  const original = selected
    ? `/api/v1/admin/${basePath}/${remote ? 'remote-files' : 'files'}/${encodeURIComponent(selected.id)}/original?${new URLSearchParams({ ...location, inline: '1' })}`
    : '';
  return (
    <>
      {!online && (
        <p className={styles.error} role="alert">
          当前离线，请恢复网络后重新读取文件。
        </p>
      )}
      <div className={`${styles.fileWorkspace} ${collapsed ? styles.collapsed : ''}`}>
        <aside className={styles.fileSidebar} aria-label="知识库文件列表" aria-busy={loading}>
          <div className={styles.sidebarHead}>
            {!collapsed && (
              <strong>
                文件 <span className={styles.badge}>{listing.items.length}</span>
              </strong>
            )}
            <div>
              <button
                className={styles.iconButton}
                aria-label="刷新文件"
                disabled={!online || loading}
                onClick={() => {
                  clearPreview();
                  setRefresh((n) => n + 1);
                }}
              >
                <Glyph name="refresh" size={15} />
              </button>
              <button
                className={styles.iconButton}
                aria-label={collapsed ? '展开文件列表' : '收起文件列表'}
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
                placeholder={remote ? '搜索当前页文件…' : '搜索文件…'}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
              {history.length > 0 && (
                <button
                  className={styles.fileRow}
                  disabled={!online || loading}
                  onClick={() => navigate(history[history.length - 1]!, true)}
                >
                  <Glyph name="back" />
                  返回上一位置
                </button>
              )}
              {location.folderId && (
                <button
                  className={styles.fileRow}
                  disabled={!online || loading}
                  onClick={() => navigate({ folderId: '', cursor: '' })}
                >
                  <Glyph name="folder" />
                  知识库根目录
                </button>
              )}
              {loading ? (
                <p className={styles.sidebarEmpty} role="status">
                  正在读取文件…
                </p>
              ) : listError ? (
                <div className={styles.error} role="alert">
                  {listError}
                  <button
                    className={styles.textButton}
                    disabled={!online}
                    onClick={() => setRefresh((n) => n + 1)}
                  >
                    重试读取目录
                  </button>
                </div>
              ) : (
                <>
                  {listing.folders.map((folder) => (
                    <button
                      key={folder.id}
                      className={styles.fileRow}
                      disabled={!online || folder.id === location.folderId}
                      onClick={() => navigate({ folderId: folder.id, cursor: '' })}
                    >
                      <Glyph name="folder" />
                      {folder.name}
                    </button>
                  ))}
                  {visible.map((file) => (
                    <button
                      key={file.id}
                      className={`${styles.fileRow} ${file.id === selected?.id ? styles.fileActive : ''}`}
                      aria-pressed={file.id === selected?.id}
                      disabled={!online}
                      onClick={() => void showFile(file)}
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
                  {online && !visible.length && (
                    <p className={styles.sidebarEmpty}>
                      {query
                        ? '没有匹配的文件'
                        : listing.folders.length
                          ? '请选择文件夹查看其中的文件'
                          : '此目录暂无可浏览文件'}
                    </p>
                  )}
                  {remote && listing.nextCursor && (
                    <button
                      className={styles.textButton}
                      disabled={!online}
                      onClick={() => navigate({ ...location, cursor: listing.nextCursor! })}
                    >
                      下一页文件
                    </button>
                  )}
                </>
              )}
            </>
          )}
        </aside>
        <div className={styles.preview} aria-label="文档预览">
          {selected ? (
            <>
              <div className={styles.previewHead}>
                <strong title={selected.title}>{selected.title}</strong>
                <div className={styles.previewModes} role="group" aria-label="文档显示方式">
                  {isPdf(selected) && (
                    <button
                      aria-pressed={mode === 'original'}
                      disabled={!online}
                      onClick={() => void showFile(selected, 'original')}
                    >
                      PDF 原文预览
                    </button>
                  )}
                  <button
                    aria-pressed={mode === 'text'}
                    disabled={!online}
                    onClick={() => void showFile(selected, 'text')}
                  >
                    提取文本
                  </button>
                </div>
              </div>
              {mode === 'original' ? (
                <PdfDocumentPreview key={original} url={original} title={selected.title} />
              ) : previewBusy ? (
                <div className={styles.empty} role="status">
                  正在读取文档…
                </div>
              ) : previewError ? (
                <div className={styles.error} role="alert">
                  {previewError}
                  <button
                    className={styles.textButton}
                    disabled={!online}
                    onClick={() => void showFile(selected, 'text')}
                  >
                    重试读取文档
                  </button>
                </div>
              ) : (
                <pre className={styles.documentText}>
                  {preview?.content || '此文档尚无可用的提取文本。'}
                </pre>
              )}
            </>
          ) : (
            <div className={styles.empty}>
              <Glyph name="file" size={36} />
              <h3>请选择一个文件以预览</h3>
              <p>从左侧列表选择文档，可直接查看 PDF 原文或提取文本。</p>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
