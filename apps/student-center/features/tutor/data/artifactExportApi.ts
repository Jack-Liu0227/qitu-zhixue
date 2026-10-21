import { ARTIFACT_EXPORT_MIME_TYPES, type ArtifactExportFormat } from '@qitu/contracts';
import { TutorDataError } from './dataSource';

export async function exportArtifactVersion(artifactId: string, versionId: string, format: ArtifactExportFormat, signal: AbortSignal): Promise<Blob> {
  const response = await fetch(`/api/v1/artifacts/${encodeURIComponent(artifactId)}/versions/${encodeURIComponent(versionId)}/export?format=${format}`,
    { credentials: 'include', signal, cache: 'no-store' });
  if (!response.ok) {
    throw new TutorDataError(response.status === 401 ? '请重新登录后导出。' : response.status === 403
      ? '当前没有权限导出这份作品。' : '作品导出失败，请稍后重试。', response.status, 'ARTIFACT_EXPORT_FAILED');
  }
  if (response.headers.get('content-type')?.split(';')[0]?.trim() !== ARTIFACT_EXPORT_MIME_TYPES[format]) {
    throw new TutorDataError('文件格式不正确，请重试。', 502, 'ARTIFACT_EXPORT_INVALID');
  }
  const result = await response.blob();
  if (!result.size) throw new TutorDataError('生成的文件为空，请重试。', 502, 'ARTIFACT_EXPORT_EMPTY');
  return result;
}
