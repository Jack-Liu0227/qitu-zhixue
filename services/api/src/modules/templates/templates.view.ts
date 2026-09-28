import { NotFoundException } from '@nestjs/common';
import type {
  ProjectTemplateRecord,
  ProjectTemplateVersionRecord,
  TemplateView,
  TemplateVersionView,
} from './templates.types';

/** 模板不存在：与「无权限」使用同一类 404，避免用差异探测他人资源。 */
export function templateNotFound(): NotFoundException {
  return new NotFoundException({
    code: 'TEMPLATE_NOT_FOUND',
    message: '模板不存在',
  });
}

export function versionNotFound(): NotFoundException {
  return new NotFoundException({
    code: 'TEMPLATE_VERSION_NOT_FOUND',
    message: '模板版本不存在',
  });
}

export function toTemplateView(
  record: ProjectTemplateRecord,
  latestPublishedVersionId: string | null,
): TemplateView {
  return {
    id: record.id,
    schoolId: record.schoolId,
    scope: record.schoolId === null ? 'platform' : 'school',
    slug: record.slug,
    title: record.title,
    summary: record.summary,
    domain: record.domain,
    ageRange: record.ageRange,
    difficulty: record.difficulty,
    estimatedDurationMinutes: record.estimatedDurationMinutes,
    requiredMaterials: [...record.requiredMaterials],
    learningObjectives: [...record.learningObjectives],
    outcomeForm: record.outcomeForm,
    safetyNotes: record.safetyNotes,
    status: record.status,
    latestPublishedVersionId,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

export function toTemplateVersionView(
  record: ProjectTemplateVersionRecord,
): TemplateVersionView {
  return {
    id: record.id,
    templateId: record.templateId,
    version: record.version,
    stages: record.stages.map((stage) => ({ ...stage })),
    status: record.status,
    publishedAt: record.publishedAt?.toISOString() ?? null,
    createdAt: record.createdAt.toISOString(),
  };
}

/** 取已发布版本里版本号最大者作为「当前版本」。 */
export function latestPublishedVersionId(
  versions: ProjectTemplateVersionRecord[],
): string | null {
  let latest: ProjectTemplateVersionRecord | null = null;
  for (const version of versions) {
    if (version.status !== 'published') continue;
    if (latest === null || version.createdAt.getTime() >= latest.createdAt.getTime()) {
      latest = version;
    }
  }
  return latest?.id ?? null;
}
