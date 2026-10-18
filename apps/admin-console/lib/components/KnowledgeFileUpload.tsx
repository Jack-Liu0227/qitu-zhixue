'use client';
import { useState } from 'react';
import { centerRequest, type BaseDetail } from '../api/knowledge-center';
import { newIdempotencyKey } from '../api/types';

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
    <section className="knowledge-upload-panel" aria-label="批量上传文件">
      <h3>上传文件</h3>
      <p>
        支持
        PDF、Word（DOCX）、Excel（XLSX）、PowerPoint（PPTX）、EPUB，以及文本、Markdown、CSV、JSON、HTML
        等格式。每批最多 20 个，每个不超过 10 MiB。
      </p>
      <p>
        扫描件或纯图片文档请先进行 OCR；旧版 DOC、XLS、PPT
        请另存为新版格式。上传成功后可预览正文、下载原文件。
      </p>
      <p>当前引擎每库最多 20 份资料，提取正文合计不超过 7 MiB；超出时请分库保存。</p>
      <label>
        选择文件（可多选）
        <input
          type="file"
          multiple
          aria-label="选择知识库文件"
          accept={extensions.map((e) => '.' + e).join(',')}
          disabled={running}
          onChange={(event) => {
            const files = Array.from(event.target.files ?? []);
            event.target.value = '';
            if (files.length > 20) {
              setMessage('每批最多选择 20 个文件，请分批上传。');
              return;
            }
            setMessage('');
            setEntries(
              files.map((file) => {
                const supported = extensions.includes(
                  file.name.split('.').pop()?.toLowerCase() ?? '',
                );
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
          }}
        />
      </label>
      {entries.length > 0 && (
        <ul className="knowledge-upload-list" aria-live="polite">
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
      {message && <p role="alert">{message}</p>}
      <button
        className="settings-action-btn is-primary"
        disabled={running || !entries.some((row) => ['pending', 'failed'].includes(row.state))}
        onClick={() => void upload()}
      >
        {running
          ? '正在上传与解析…'
          : entries.some((row) => row.state === 'failed')
            ? '重试未完成文件'
            : '上传并保存文件'}
      </button>
    </section>
  );
}
