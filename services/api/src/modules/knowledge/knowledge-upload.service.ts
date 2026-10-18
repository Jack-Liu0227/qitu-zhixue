import {
  BadRequestException,
  Injectable,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { CurrentUser } from '@qitu/contracts';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { KnowledgeCenterService } from './knowledge-center.service';
import { record } from './knowledge-center.config';

export const UPLOAD_MAX_BYTES = 100 * 1024 * 1024;
export const UPLOAD_EXTENSIONS = [
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
const MIMES: Record<string, string> = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  epub: 'application/epub+zip',
};
const ERRORS: Record<string, string> = {
  DOCUMENT_NO_TEXT: '未提取到正文；扫描件或纯图片文档请先进行 OCR，再上传可读取的版本。',
  DOCUMENT_ENCRYPTED: '文件已加密，请解除密码保护后重新上传。',
  DOCUMENT_CORRUPT: '文件无法解析，请检查文件内容和扩展名是否一致。',
  ARCHIVE_LIMIT: '文件解压后的内容过大，请拆分后上传。',
  EXTRACTED_TEXT_LIMIT: '提取正文超过 5 MiB，请拆分文件后上传。',
  DOCUMENT_PAGE_LIMIT: 'PDF 超过 500 页，请拆分后上传。',
};
export function validateUpload(body: unknown) {
  const input = record(body);
  if (
    Object.keys(input).some((k) => !['fileName', 'base64', 'allowMaterialize'].includes(k)) ||
    typeof input.fileName !== 'string' ||
    typeof input.base64 !== 'string' ||
    (input.allowMaterialize !== undefined && typeof input.allowMaterialize !== 'boolean')
  )
    throw new BadRequestException({
      code: 'UPLOAD_INVALID',
      message: '请选择有效文件。',
    });
  const fileName = input.fileName
    .normalize('NFC')
    .split(/[\\/]/)
    .pop()!
    .replace(/[\x00-\x1f\x7f]/g, '')
    .trim();
  const extension = fileName.split('.').pop()!.toLowerCase();
  if (!fileName || fileName.length > 160 || !UPLOAD_EXTENSIONS.includes(extension))
    throw new BadRequestException({
      code: 'FILE_TYPE_UNSUPPORTED',
      message: '不支持此文件类型；旧版 DOC/XLS/PPT 请先另存为 DOCX/XLSX/PPTX。',
    });
  if (
    !input.base64.length ||
    input.base64.length > Math.ceil(UPLOAD_MAX_BYTES / 3) * 4 ||
    /[^A-Za-z0-9+/=]/.test(input.base64)
  )
    throw new BadRequestException({
      code: 'FILE_SIZE_LIMIT',
      message: '文件为空、编码无效或超过 100 MiB。',
    });
  const bytes = Buffer.from(input.base64, 'base64');
  if (!bytes.length || bytes.length > UPLOAD_MAX_BYTES || bytes.toString('base64') !== input.base64)
    throw new BadRequestException({
      code: 'UPLOAD_INVALID',
      message: '文件编码无效或超过 100 MiB。',
    });
  return {
    fileName,
    base64: input.base64,
    bytes,
    allowMaterialize: false,
    mimeType: MIMES[extension] ?? 'text/plain',
    originalChecksum: createHash('sha256').update(bytes).digest('hex'),
  };
}
export interface ParsedUpload {
  fileName: string;
  mimeType: string;
  base64: string;
  byteSize: number;
  originalChecksum: string;
  parser: string;
  upstreamCommit: string;
  pageCount: number | null;
}

@Injectable()
export class KnowledgeUploadService {
  private active = 0;
  constructor(private readonly center: KnowledgeCenterService) {}

  async upload(actor: CurrentUser, id: string, body: unknown, key: string) {
    const base = await this.center.base(id);
    if (base.kind === 'project' || base.lifecycle !== 'active')
      throw new BadRequestException('项目资料由准备任务管理');
    const input = validateUpload(body);
    if (this.active >= 2)
      throw new ServiceUnavailableException({
        code: 'PARSER_BUSY',
        message: '当前正在解析其他文件，请稍后重试。',
      });
    this.active++;
    try {
      const result = await this.extract(input.fileName, input.base64);
      if (!result.ok) {
        const code = typeof result.errorCode === 'string' ? result.errorCode : 'DOCUMENT_CORRUPT';
        if (
          ['PARSER_DEPENDENCY_MISSING', 'UPSTREAM_VERSION_MISMATCH', 'PARSER_UNAVAILABLE'].includes(
            code,
          )
        )
          throw new ServiceUnavailableException({
            code,
            message: '文件解析服务暂不可用，请联系管理员。',
          });
        throw new UnprocessableEntityException({
          code,
          message: ERRORS[code] ?? '文件解析失败，请检查文件或拆分后重试。',
        });
      }
      if (
        typeof result.content !== 'string' ||
        !result.content.trim() ||
        Buffer.byteLength(result.content) > 5 * 1024 * 1024
      )
        throw new UnprocessableEntityException({
          code: 'EXTRACTED_TEXT_LIMIT',
          message: '未取得完整正文，请拆分文件后重试。',
        });
      return this.center.addFile(
        actor,
        id,
        {
          title: input.fileName,
          content: result.content,
          allowMaterialize: false,
        },
        key,
        {
          fileName: input.fileName,
          mimeType: input.mimeType,
          base64: input.base64,
          byteSize: input.bytes.length,
          originalChecksum: input.originalChecksum,
          parser: 'deeptutor-text-only',
          upstreamCommit: String(result.upstreamCommit),
          pageCount: typeof result.pageCount === 'number' ? result.pageCount : null,
        },
      );
    } finally {
      this.active--;
    }
  }

  private extract(fileName: string, base64: string): Promise<Record<string, unknown>> {
    const python = process.env.QITU_KNOWLEDGE_PYTHON;
    const source = process.env.QITU_DEEPTUTOR_SOURCE;
    const bridge = process.env.QITU_KNOWLEDGE_BRIDGE;
    if (!python || !source || !bridge)
      return Promise.resolve({ ok: false, errorCode: 'PARSER_UNAVAILABLE' });
    return new Promise((resolve) => {
      const child = spawn(python, [join(dirname(bridge), 'extract_upload.py')], {
        env: {
          PATH: '/usr/bin:/bin',
          LANG: 'C.UTF-8',
          QITU_DEEPTUTOR_SOURCE: source,
          PYTHONDONTWRITEBYTECODE: '1',
          OPENBLAS_NUM_THREADS: '1',
        },
        stdio: ['pipe', 'pipe', 'ignore'],
      });
      let output = '';
      let length = 0;
      let done = false;
      const finish = (value: Record<string, unknown>) => {
        if (!done) {
          done = true;
          clearTimeout(timer);
          resolve(value);
        }
      };
      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        finish({ ok: false, errorCode: 'PARSER_TIMEOUT' });
      }, 60_000);
      child.on('error', () => finish({ ok: false, errorCode: 'PARSER_UNAVAILABLE' }));
      child.stdin.on('error', () => {});
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', (chunk: string) => {
        length += Buffer.byteLength(chunk);
        if (length > 8 * 1024 * 1024) {
          child.kill('SIGKILL');
          finish({ ok: false, errorCode: 'EXTRACTED_TEXT_LIMIT' });
        } else output += chunk;
      });
      child.on('close', (code) => {
        if (code !== 0) return finish({ ok: false, errorCode: 'DOCUMENT_CORRUPT' });
        try {
          finish(record(JSON.parse(output)));
        } catch {
          finish({ ok: false, errorCode: 'DOCUMENT_CORRUPT' });
        }
      });
      child.stdin.end(JSON.stringify({ fileName, base64 }));
    });
  }
}
