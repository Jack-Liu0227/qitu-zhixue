'use client';

import { useState } from 'react';
import type { FileEntry } from './LibraryFiles';
import { bytes, Glyph } from './shared';
import styles from './KnowledgeLibrary.module.css';

type Folder = { name: string; path: string; children: Map<string, Folder>; files: FileEntry[] };

export function LocalFileTree({
  files,
  folders,
  query,
  selectedId,
  disabled,
  onSelect,
}: {
  files: FileEntry[];
  folders: string[];
  query: string;
  selectedId?: string;
  disabled: boolean;
  onSelect: (file: FileEntry) => void;
}) {
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const root: Folder = { name: '', path: '', children: new Map(), files: [] };
  function folderAt(path: string) {
    let current = root;
    for (const name of path.split('/').filter(Boolean)) {
      const childPath = current.path ? `${current.path}/${name}` : name;
      if (!current.children.has(name))
        current.children.set(name, { name, path: childPath, children: new Map(), files: [] });
      current = current.children.get(name)!;
    }
    return current;
  }
  if (!query.trim()) folders.forEach(folderAt);
  files.forEach((file) => folderAt(String(file.origin?.folder ?? '')).files.push(file));
  const rows = (folder: Folder, depth: number): React.ReactNode => (
    <>
      {[...folder.children.values()]
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((child) => {
          const open = !!query.trim() || !collapsed.has(child.path);
          return (
            <div key={child.path}>
              <button
                className={styles.fileRow}
                style={{ paddingLeft: 10 + depth * 12 }}
                aria-expanded={open}
                onClick={() =>
                  setCollapsed((value) => {
                    const next = new Set(value);
                    if (open) next.add(child.path);
                    else next.delete(child.path);
                    return next;
                  })
                }
              >
                <span aria-hidden="true">{open ? '▾' : '▸'}</span>
                <Glyph name="folder" size={17} />
                <span>
                  <strong title={child.path}>{child.name}</strong>
                </span>
              </button>
              {open && rows(child, depth + 1)}
            </div>
          );
        })}
      {folder.files.map((file) => (
        <button
          key={file.id}
          className={`${styles.fileRow} ${file.id === selectedId ? styles.fileActive : ''}`}
          style={{ paddingLeft: 10 + depth * 12 }}
          aria-pressed={file.id === selectedId}
          disabled={disabled}
          onClick={() => onSelect(file)}
        >
          <Glyph name="file" size={19} />
          <span>
            <strong title={file.title}>{file.title}</strong>
            <small>
              {bytes(file.origin?.byteSize)}
              {file.origin?.parser ? ' · 已解析' : ''}
            </small>
          </span>
        </button>
      ))}
    </>
  );
  return <div aria-label="本地文件目录">{rows(root, 0)}</div>;
}
