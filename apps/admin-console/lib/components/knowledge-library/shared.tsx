'use client';
import type { EngineGroup } from '../../api/knowledge-center';
import styles from './KnowledgeLibrary.module.css';

export type ModelOption = {
  value: string;
  label: string;
  available: boolean;
  input: string[];
  output: string[];
};
export const statusLabels: Record<string, string> = {
  ready: '可用',
  unindexed: '待索引',
  queued: '等待索引',
  indexing: '索引中',
  parsing: '解析中',
  failed: '错误',
  empty: '暂无文档',
  validating: '验证中',
  collecting: '收集资料',
  discovering: '准备中',
  planning: '准备中',
  cancelled: '已取消',
  probing: '连接检查中',
  needs_key: '需配置密钥',
  needs_setup: '待配置',
  not_installed: '未安装',
  unreachable: '无法连接',
  unavailable: '不可用',
  unchecked: '未检查',
};
export function Glyph({ name, size = 18 }: { name: string; size?: number }) {
  const paths: Record<string, string> = {
    plus: 'M12 5v14M5 12h14',
    back: 'm12 5-7 7 7 7M5 12h15',
    close: 'm6 6 12 12M6 18 18 6',
    file: 'M14 2H6v20h12V6l-4-4ZM14 2v5h5M9 12h6M9 16h6',
    folder: 'M3 6h7l2 2h9v12H3V6ZM12 11v6M9 14h6',
    link: 'm10 13 4-4M7 16H5a4 4 0 0 1 0-8h4M15 8h4a4 4 0 0 1 0 8h-4',
    upload: 'M12 16V3m-5 5 5-5 5 5M4 15v6h16v-6',
    refresh: 'M20 7v5h-5M4 17v-5h5M5 8a8 8 0 0 1 14-2l1 6M4 12l1 6a8 8 0 0 0 14-2',
    globe: 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0ZM3 12h18M12 3a20 20 0 0 1 0 18 20 20 0 0 1 0-18Z',
    layers: 'm12 3 10 5-10 5L2 8l10-5ZM2 12l10 5 10-5M2 16l10 5 10-5',
    settings: 'M4 7h16M4 17h16M8 3v8M16 13v8',
    star: 'm12 3 3 6 7 1-5 5 1 7-6-3-6 3 1-7-5-5 7-1 3-6Z',
    assistant: 'M8 3h8M12 3v3M4 7h16v13H4V7ZM8 11v2M16 11v2M8 17h8',
    trash: 'M3 6h18M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7M14 10v7',
    chevron: 'm9 5 7 7-7 7',
    check: 'm5 12 4 4L19 6',
    search: 'M16 16l5 5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0Z',
    github:
      'M8 20c-5 1-5-3-7-3M15 22v-4a4 4 0 0 0-1-3c4 0 7-2 7-6 0-2-1-3-2-4 0-1 0-3-1-3l-4 2h-4L6 2C5 3 5 5 5 5 3 6 3 7 3 9c0 4 3 6 7 6-1 1-1 2-1 3v4',
    panel: 'M3 4h18v16H3V4ZM8 4v16m8-11-3 3 3 3',
  };
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[name] ?? paths.file} />
    </svg>
  );
}
export function EngineIcon({ group, size = 32 }: { group?: EngineGroup; size?: number }) {
  return group?.definition?.icon ? (
    <img
      className={styles.engineIcon}
      src={`/admin/knowledge-engine-icons/${group.definition.icon}`}
      alt=""
      width={size}
      height={size}
    />
  ) : (
    <span className={styles.fallbackIcon}>
      <Glyph name="layers" size={size} />
    </span>
  );
}
export const message = (error: unknown) =>
  error instanceof Error ? error.message : '操作失败，请重试';
export const time = (value?: string | null) =>
  value ? new Date(value).toLocaleString('zh-CN') : '—';
export const bytes = (value: unknown) =>
  typeof value === 'number'
    ? value > 1024 * 1024
      ? `${(value / 1024 / 1024).toFixed(1)} MB`
      : `${(value / 1024).toFixed(1)} KB`
    : '';
export const remoteProviders = [
  'lightrag-server',
  'weknora',
  'ima',
  'obsidian',
  'marginnote',
  'kiwix',
];
export const linkableProviders = ['llamaindex', 'graphrag', 'lightrag', ...remoteProviders];
export function fileBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
    reader.onerror = () => reject(new Error('文件读取失败'));
    reader.readAsDataURL(file);
  });
}
