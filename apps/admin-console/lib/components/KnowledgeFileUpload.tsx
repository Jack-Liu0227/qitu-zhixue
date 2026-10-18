'use client';
import { useRef, useState } from 'react';
import { centerRequest, type BaseDetail } from '../api/knowledge-center';
import { newIdempotencyKey } from '../api/types';
import { Glyph } from './knowledge-library/shared';
import styles from './knowledge-library/KnowledgeLibrary.module.css';

const extensions = [
  'pdf',
  'docx',
  'xlsx',
  'pptx',
  'epub',
  'txt',
  'md',
  'markdown',
  'csv',
  'tsv',
  'json',
  'xml',
  'yaml',
  'yml',
  'html',
  'htm',
  'rst',
  'tex',
];
type Entry = {
  file: File;
  key: string;
  state: 'pending' | 'uploading' | 'saved' | 'failed' | 'invalid';
  message: string;
};
function readBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
    reader.onerror = () => reject(new Error('无法读取此文件，请重新选择。'));
    reader.readAsDataURL(file);
  });
}
export function KnowledgeFileUpload({
  baseId,
  onSaved,
}: {
  baseId: string;
  onSaved: (detail: BaseDetail) => Promise<void>;
}) {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [running, setRunning] = useState(false);
  const [message, setMessage] = useState('');
  const picker = useRef<HTMLInputElement>(null);
  const folderPicker = useRef<HTMLInputElement>(null);
  function pick(files: File[]) {
    if (files.length > 20) {
      setMessage('每批最多选择 20 个文件，请分批上传。');
      return;
    }
    setMessage('');
    setEntries(
      files.map((file) => {
        const supported = extensions.includes(file.name.split('.').pop()?.toLowerCase() ?? '');
        const valid = supported && file.size > 0 && file.size <= 10 * 1024 * 1024;
        return {
          file,
          key: newIdempotencyKey(),
          state: valid ? 'pending' : 'invalid',
          message: !supported
            ? '不支持此格式，请转换后上传。'
            : !valid
              ? '文件为空或超过 10 MiB。'
              : '等待上传',
        };
      }),
    );
  }
  const update = (key: string, state: Entry['state'], message: string) =>
    setEntries((current) =>
      current.map((row) => (row.key === key ? { ...row, state, message } : row)),
    );
  async function upload() {
    setRunning(true);
    setMessage('');
    let latest: BaseDetail | null = null;
    try {
      for (const row of entries) {
        if (!['pending', 'failed'].includes(row.state)) continue;
        update(row.key, 'uploading', '上传并解析中…');
        try {
          latest = await centerRequest<BaseDetail>(
            `knowledge/bases/${encodeURIComponent(baseId)}/uploads`,
            'POST',
            {
              fileName: row.file.name,
              base64: await readBase64(row.file),
            },
            row.key,
          );
          update(row.key, 'saved', '已解析并保存，索引在后台准备');
        } catch (error) {
          update(row.key, 'failed', error instanceof Error ? error.message : '上传失败，请重试。');
        }
      }
      if (latest) await onSaved(latest);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '刷新列表失败，请重新打开详情。');
    } finally {
      setRunning(false);
    }
  }
  return (
    <section className={`${styles.panel} ${styles.uploadPanel}`} aria-label="批量上传文件">
      <div className={styles.uploadHeading}>
        <h3>上传文件</h3>
        <p>将文档添加到知识库，解析后即可用于检索。</p>
      </div>
      <button
        className={styles.dropzone}
        disabled={running}
        onClick={() => picker.current?.click()}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          if (!running) pick(Array.from(e.dataTransfer.files));
        }}
      >
        <span className={styles.uploadIcon}>
          <Glyph name="upload" size={26} />
        </span>
        <strong>点击选择文件，或拖放到此处</strong>
        <span>每批最多 20 个文件 · 单个文件不超过 10 MiB</span>
      </button>
      <input
        ref={picker}
        hidden
        type="file"
        multiple
        aria-label="选择知识库文件"
        accept={extensions.map((e) => '.' + e).join(',')}
        disabled={running}
        onChange={(event) => {
          const files = Array.from(event.target.files ?? []);
          event.target.value = '';
          pick(files);
        }}
      />
      <input
        ref={folderPicker}
        hidden
        type="file"
        multiple
        {...{ webkitdirectory: '' }}
        onChange={(e) => {
          pick(Array.from(e.target.files ?? []));
          e.target.value = '';
        }}
      />
      <div className={styles.uploadFormats}>
        <strong>支持格式</strong>
        <span>
          PDF、Word（DOCX）、Excel（XLSX）、PowerPoint（PPTX）、EPUB，以及文本、Markdown、CSV、JSON、HTML
          等
        </span>
      </div>
      <div className={styles.uploadTips}>
        <strong>上传须知</strong>
        <ul>
          <li>扫描件或纯图片文档请先进行 OCR；旧版 DOC、XLS、PPT 请另存为新版格式。</li>
          <li>当前引擎每库最多 20 份资料，提取正文合计不超过 7 MiB，超出时请分库保存。</li>
          <li>上传成功后，可预览正文并下载原文件。</li>
        </ul>
      </div>
      {entries.length > 0 && (
        <ul className={styles.uploadList} aria-live="polite">
          {entries.map((row) => (
            <li key={row.key} data-upload-state={row.state}>
              <strong>{row.file.name}</strong>
              <span>
                {(row.file.size / 1024).toFixed(1)} KiB · {row.message}
              </span>
            </li>
          ))}
        </ul>
      )}
      {message && (
        <div className={styles.error} role="alert">
          {message}
        </div>
      )}
      <div className={styles.uploadActions}>
        <button
          className={styles.textButton}
          disabled={running}
          onClick={() => folderPicker.current?.click()}
        >
          <Glyph name="upload" size={16} /> 上传文件夹
        </button>
        <button
          className={styles.primary}
          disabled={running || !entries.some((row) => ['pending', 'failed'].includes(row.state))}
          onClick={() => void upload()}
        >
          {running
            ? '正在上传与解析…'
            : entries.some((row) => row.state === 'failed')
              ? '重试未完成文件'
              : '上传并保存文件'}
        </button>
      </div>
    </section>
  );
}
