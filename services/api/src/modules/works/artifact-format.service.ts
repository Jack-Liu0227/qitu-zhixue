import { BadRequestException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { ARTIFACT_EXPORT_MIME_TYPES, type ArtifactExportFormat, type CurrentUser } from '@qitu/contracts';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { AuditWriter } from '../../common/audit/audit.service';
import { findRuntimeRoot } from '../../common/tutor-runtime/runtime-source';
import { WorksService } from './works.service';

const MIME_TYPES = ARTIFACT_EXPORT_MIME_TYPES;

function unavailable(code = 'ARTIFACT_RENDERER_UNAVAILABLE'): never {
  throw new ServiceUnavailableException({ code, message: '作品文件生成暂不可用，请稍后重试。' });
}

/** Read-only projection of an authorized immutable version; it creates no learning or assessment fact. */
@Injectable()
export class ArtifactFormatService {
  private active = 0;
  constructor(private readonly works: WorksService, private readonly audit: AuditWriter) {}

  async export(actor: CurrentUser, artifactId: string, versionId: string, format: unknown) {
    if (format !== 'docx' && format !== 'pptx' && format !== 'xlsx' && format !== 'pdf') {
      throw new BadRequestException({ code: 'ARTIFACT_FORMAT_INVALID', message: '请选择 Word、PPT、Excel 或 PDF。' });
    }
    const artifact = await this.works.getArtifact(actor, artifactId);
    const version = (await this.works.listVersions(actor, artifactId)).find(item => item.id === versionId);
    if (!version) throw new NotFoundException('ARTIFACT_VERSION_NOT_FOUND');
    if (!version.inlineText?.trim()) throw new BadRequestException({ code: 'ARTIFACT_TEXT_REQUIRED', message: '该版本没有可导出的文字内容。' });
    const bytes = await this.render(artifact.title, version.inlineText, format);
    // A download must not outlive a revoked relationship or a removed version.
    await this.works.getArtifact(actor, artifactId);
    if (!(await this.works.listVersions(actor, artifactId)).some(item => item.id === versionId)) throw new NotFoundException('ARTIFACT_VERSION_NOT_FOUND');
    const sourceDigest = createHash('sha256').update(version.inlineText).digest('hex');
    await this.audit.write({ actorId: actor.id, actorRole: actor.role, action: 'artifact.version.export',
      targetType: 'artifact_version', targetId: versionId,
      idempotencyKey: `artifact-export:${createHash('sha256').update(JSON.stringify([actor.id, artifactId, versionId, format])).digest('hex')}`,
      detail: { artifactId, versionId, format, sourceDigest, assessmentUpdated: false } });
    return { bytes, mimeType: MIME_TYPES[format], filename: `${artifact.title.replace(/[\x00-\x1f\x7f/\\]/g, '_')}.${format}`,
      artifactId, versionId, sourceDigest };
  }

  private render(title: string, body: string, format: ArtifactExportFormat): Promise<Buffer> {
    if (this.active >= 2) unavailable('ARTIFACT_RENDERER_BUSY');
    this.active++;
    const script = join(findRuntimeRoot(), 'tooling', 'render_artifact.py');
    const python = process.env.QITU_ARTIFACT_PYTHON ?? (process.platform === 'win32' ? 'python' : 'python3');
    return new Promise<Buffer>((resolve, reject) => {
      const environment: NodeJS.ProcessEnv = {};
      for (const key of ['PATH', 'Path', 'SystemRoot', 'SYSTEMROOT', 'WINDIR', 'TEMP', 'TMP', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA']) {
        if (process.env[key] !== undefined) environment[key] = process.env[key];
      }
      const child = spawn(python, ['-E', '-X', 'utf8', script], { env: environment, stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true });
      let output = ''; let size = 0; let done = false;
      const finish = (error?: Error, result?: Buffer) => {
        if (done) return; done = true; clearTimeout(timer);
        if (error) reject(error); else if (result) resolve(result); else reject(new Error('ARTIFACT_RENDER_FAILED'));
      };
      const timer = setTimeout(() => { child.kill(); finish(new Error('ARTIFACT_RENDER_TIMEOUT')); }, 30_000);
      child.on('error', () => finish(new Error('ARTIFACT_RENDERER_UNAVAILABLE')));
      child.stdin.on('error', () => {});
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', (chunk: string) => {
        size += Buffer.byteLength(chunk);
        if (size > 20 * 1024 * 1024) { child.kill(); finish(new Error('ARTIFACT_RENDER_SIZE_LIMIT')); }
        else output += chunk;
      });
      child.on('close', code => {
        if (code !== 0) return finish(new Error('ARTIFACT_RENDER_FAILED'));
        try {
          const result: unknown = JSON.parse(output);
          if (result && typeof result === 'object' && 'ok' in result && result.ok === false
            && 'code' in result && result.code === 'ARTIFACT_RENDERER_DEPENDENCY_MISSING') {
            return finish(new Error(result.code));
          }
          if (!result || typeof result !== 'object' || !('ok' in result) || result.ok !== true
            || !('mimeType' in result) || result.mimeType !== MIME_TYPES[format] || !('base64' in result) || typeof result.base64 !== 'string') {
            return finish(new Error('ARTIFACT_RENDER_FAILED'));
          }
          const bytes = Buffer.from(result.base64, 'base64');
          if (!bytes.length || bytes.toString('base64') !== result.base64) return finish(new Error('ARTIFACT_RENDER_FAILED'));
          finish(undefined, bytes);
        } catch { finish(new Error('ARTIFACT_RENDER_FAILED')); }
      });
      child.stdin.end(JSON.stringify({ title, body, format }));
    }).catch(error => unavailable(error instanceof Error ? error.message : undefined)).finally(() => { this.active--; });
  }
}
