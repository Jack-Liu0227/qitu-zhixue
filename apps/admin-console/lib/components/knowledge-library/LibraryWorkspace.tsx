'use client';

import { useEffect, useRef, useState } from 'react';
import type { BaseDetail, EngineGroup } from '../../api/knowledge-center';
import { KnowledgeFileUpload } from '../KnowledgeFileUpload';
import { LibraryFiles } from './LibraryFiles';
import { LibrarySettings } from './LibrarySettings';
import { LibrarySources } from './LibrarySources';
import { LibraryVersions } from './LibraryVersions';
import { useLibraryEditor } from './useLibraryEditor';
import { connectionDiagnostic } from './connection-checks';
import { EngineIcon, Glyph, statusLabels, time } from './shared';
import styles from './LibraryWorkspace.module.css';

type Section = 'files' | 'add' | 'folders' | 'github' | 'web' | 'versions' | 'settings';
const sections: [Section, string, string][] = [
  ['files', '文件', 'file'],
  ['add', '添加文档', 'upload'],
  ['folders', '关联文件夹', 'folder'],
  ['github', 'GitHub', 'github'],
  ['web', '网络', 'globe'],
  ['versions', '索引版本', 'layers'],
  ['settings', '设置', 'settings'],
];

// Page layout follows DeepTutor KnowledgeBaseDetail/KbFilesTab (6cf793bd, MIT).
export function LibraryWorkspace({
  detail,
  engines,
  online,
  onBack,
  onChanged,
  onBindings,
}: {
  detail: BaseDetail;
  engines: EngineGroup[];
  online: boolean;
  onBack: () => void;
  onChanged: () => Promise<void>;
  onBindings: () => void;
}) {
  const editor = useLibraryEditor(detail, online, onChanged, onBack);
  const { base, busy, uncertain, error, notice } = editor;
  const [section, setSection] = useState<Section>('files');
  const [uploadBusy, setUploadBusy] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const tabs = useRef<HTMLDivElement>(null);
  const blocked = busy || uncertain || uploadBusy;
  const disabled = blocked || !online;
  const remote = !!base.connection && base.connection.status !== 'not_applicable';
  const editableFiles = !remote && base.kind !== 'project';
  const available = sections.filter(([id]) => editableFiles || id === 'files' || id === 'settings');
  const group = engines.find((value) =>
    value.instances.some((engine) => engine.id === base.engine_instance_id),
  );
  const status =
    base.library_settings?.enabled === false
      ? '已停用'
      : remote
        ? connectionDiagnostic(
            base.connection?.status ?? null,
            base.connection?.lastErrorCode ?? null,
            base.connection?.lastCheckAt ?? null,
          ).label
        : (statusLabels[base.build_state] ?? base.build_state);
  useEffect(() => {
    heading.current?.focus();
    heading.current?.scrollIntoView({ block: 'nearest' });
  }, []);
  useEffect(() => {
    if (!uploadBusy) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [uploadBusy]);
  return (
    <section className={styles.workspace} aria-label="知识库详情">
      <header className={styles.header}>
        <button className={styles.back} disabled={blocked} onClick={onBack}>
          <Glyph name="back" size={15} />
          返回知识库
        </button>
        <div className={styles.identity}>
          <EngineIcon group={group} size={36} />
          <div className={styles.heading}>
            <div className={styles.titleRow}>
              <h2 ref={heading} tabIndex={-1}>
                {base.name}
              </h2>
              {base.library_settings?.isDefault && (
                <span className={styles.defaultBadge}>默认</span>
              )}
              <span className={styles.badge}>{status}</span>
            </div>
            <p>
              {group?.name ?? '未配置引擎'} · {remote ? '关联知识库' : '本地索引库'} · 最近更新{' '}
              {time(base.updated_at)}
            </p>
          </div>
          <button disabled={blocked} onClick={onBindings}>
            助手绑定
          </button>
        </div>
        <div
          className={styles.tabs}
          ref={tabs}
          role="tablist"
          aria-label="知识库详情页签"
          onKeyDown={(event) => {
            if (blocked || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
            event.preventDefault();
            const index = available.findIndex(([id]) => id === section);
            const next =
              event.key === 'Home'
                ? 0
                : event.key === 'End'
                  ? available.length - 1
                  : (index + (event.key === 'ArrowRight' ? 1 : -1) + available.length) %
                    available.length;
            setSection(available[next]![0]);
            tabs.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus();
          }}
        >
          {available.map(([id, label, icon]) => (
            <button
              key={id}
              id={`kb-tab-${id}`}
              role="tab"
              aria-selected={section === id}
              aria-controls={`kb-panel-${id}`}
              tabIndex={section === id ? 0 : -1}
              disabled={blocked}
              onClick={() => setSection(id)}
            >
              <Glyph name={icon} size={15} />
              {label}
            </button>
          ))}
        </div>
      </header>
      {(error || notice || uncertain || !online) && (
        <div className={styles.feedback}>
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
              当前离线，编辑内容已保留，请恢复网络后继续。
            </p>
          )}
          {uncertain && (
            <div className={styles.error} role="alert">
              提交状态待确认，请先核验本次操作。
              <button disabled={busy || !online} onClick={() => void editor.execute()}>
                重试核验
              </button>
            </div>
          )}
        </div>
      )}
      {available.map(([id]) => (
        <div
          key={id}
          id={`kb-panel-${id}`}
          role="tabpanel"
          aria-labelledby={`kb-tab-${id}`}
          hidden={section !== id}
          className={`${styles.pane} ${id === 'files' ? styles.filesPane : styles.editorPane}`}
        >
          {id === 'files' && (
            <LibraryFiles
              detail={base}
              online={online}
              refreshToken={editor.filesRevision}
              disabled={disabled}
              onManage={editableFiles ? editor.settings : undefined}
              onDelete={
                editableFiles
                  ? (fileId) =>
                      editor.execute(`${editor.basePath}/files/${encodeURIComponent(fileId)}`, {
                        deleted: true,
                      })
                  : undefined
              }
            />
          )}
          {id === 'add' && (
            <KnowledgeFileUpload
              baseId={base.id}
              disabled={disabled}
              onBusyChange={setUploadBusy}
              onSaved={async () => {
                await editor.refresh();
              }}
            />
          )}
          {(['folders', 'github', 'web'] as string[]).includes(id) && (
            <LibrarySources
              kind={id === 'folders' ? 'folder' : (id as 'github' | 'web')}
              editor={editor}
              disabled={disabled}
            />
          )}
          {id === 'versions' && (
            <LibraryVersions editor={editor} engines={engines} disabled={disabled} />
          )}
          {id === 'settings' && (
            <LibrarySettings
              editor={editor}
              engines={engines}
              online={online}
              disabled={disabled}
              onBindings={onBindings}
            />
          )}
        </div>
      ))}
    </section>
  );
}
