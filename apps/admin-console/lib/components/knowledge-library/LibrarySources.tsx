'use client';

import { useState } from 'react';
import type { LibraryEditor } from './useLibraryEditor';
import { time } from './shared';
import styles from './LibraryWorkspace.module.css';

export function LibrarySources({
  kind,
  editor,
  disabled,
}: {
  kind: 'web' | 'github' | 'folder';
  editor: LibraryEditor;
  disabled: boolean;
}) {
  const [value, setValue] = useState('');
  const [schedule, setSchedule] = useState('');
  const { base, basePath, execute } = editor;
  const sources = base.sources?.filter((source) => source.kind === kind) ?? [];
  const label = kind === 'folder' ? '关联文件夹' : kind === 'github' ? 'GitHub' : '网络';
  return (
    <div className={styles.form}>
      <section className={styles.card}>
        <h3>{label}来源</h3>
        <p>
          {kind === 'folder'
            ? '关联服务器已允许的目录，按同步设置更新知识库资料。'
            : '添加资料来源，手动或定期同步到知识库。'}
        </p>
        <label>
          来源地址
          <input
            aria-label={`${label}来源地址`}
            value={value}
            disabled={disabled}
            onChange={(event) => setValue(event.target.value)}
            placeholder={
              kind === 'github'
                ? 'owner/repository'
                : kind === 'folder'
                  ? '/服务器允许目录'
                  : 'https://example.com/article'
            }
          />
        </label>
        <label>
          同步频率
          <select
            value={schedule}
            disabled={disabled}
            onChange={(event) => setSchedule(event.target.value)}
          >
            <option value="">仅手动</option>
            <option value="24">每天</option>
            <option value="168">每周</option>
          </select>
        </label>
        <button
          disabled={disabled || !value.trim()}
          onClick={async () => {
            if (
              await execute(`${basePath}/sources`, {
                kind,
                scheduleHours: schedule ? Number(schedule) : null,
                sourceConfig:
                  kind === 'web'
                    ? { url: value.trim(), crawlMode: 'single_page' }
                    : kind === 'github'
                      ? { repo: value.trim(), branch: 'HEAD', path: '', glob: '**/*' }
                      : { path: value.trim() },
              })
            )
              setValue('');
          }}
        >
          添加来源
        </button>
      </section>
      {!sources.length && <p className={styles.empty}>尚未关联{label}来源</p>}
      {sources.map((source) => (
        <section className={styles.card} key={source.id}>
          <h3>
            {String(
              source.sourceConfig?.url ??
                source.sourceConfig?.repo ??
                source.sourceConfig?.path ??
                label,
            )}
          </h3>
          <p>
            {source.status} · 最近同步 {time(source.lastSyncAt)} ·{' '}
            {source.scheduleHours ? `每 ${source.scheduleHours} 小时` : '仅手动'}
          </p>
          {source.lastErrorCode && <p className={styles.error}>{source.lastErrorCode}</p>}
          <div className={styles.actions}>
            <button
              disabled={disabled || ['revoked', 'syncing'].includes(source.status)}
              onClick={() =>
                void execute(`${basePath}/sources/${encodeURIComponent(source.id)}/sync`, {})
              }
            >
              同步来源
            </button>
            <button
              disabled={disabled || source.status === 'revoked'}
              onClick={() => {
                if (window.confirm('取消此来源？相关资料将停止检索。'))
                  void execute(`${basePath}/sources/${encodeURIComponent(source.id)}/settings`, {
                    revoked: true,
                  });
              }}
            >
              取消来源
            </button>
          </div>
        </section>
      ))}
    </div>
  );
}
