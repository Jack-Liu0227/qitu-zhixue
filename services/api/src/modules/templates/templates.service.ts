import { Injectable } from '@nestjs/common';
import type { CurrentUser } from '@qitu/contracts';
import { TemplateViewerDirectory } from './template-evidence.store';
import { assertStudentCanReadTemplate } from './templates.policy';
import { TemplateStore } from './templates.store';
import {
  latestPublishedVersionId,
  templateNotFound,
  toTemplateVersionView,
  toTemplateView,
  versionNotFound,
} from './templates.view';
import type { TemplateView, TemplateVersionView } from './templates.types';

/**
 * 学生端（受作用域约束的）模板只读服务。
 *
 * 只读已发布模板；可见范围 = 平台模板 ∪ 本校模板（`school_id` 由服务端从会话解析，
 * 客户端无法伪造）。未发布 / 他校模板一律 403，不泄露存在性。
 */
@Injectable()
export class TemplatesService {
  constructor(
    private readonly store: TemplateStore,
    private readonly directory: TemplateViewerDirectory,
  ) {}

  async listPublishedTemplates(actor: CurrentUser): Promise<TemplateView[]> {
    const schoolId = await this.directory.findSchoolId(actor.id);
    const records = await this.store.listTemplates({
      status: 'published',
      visibleToSchoolId: schoolId,
    });
    return Promise.all(records.map((record) => this.project(record)));
  }

  async getPublishedTemplate(actor: CurrentUser, templateId: string): Promise<TemplateView> {
    const schoolId = await this.directory.findSchoolId(actor.id);
    const record = await this.store.findTemplate(templateId);
    if (record === null) throw templateNotFound();
    assertStudentCanReadTemplate(record, schoolId);
    return this.project(record);
  }

  async listPublishedVersions(
    actor: CurrentUser,
    templateId: string,
  ): Promise<TemplateVersionView[]> {
    const schoolId = await this.directory.findSchoolId(actor.id);
    const record = await this.store.findTemplate(templateId);
    if (record === null) throw templateNotFound();
    assertStudentCanReadTemplate(record, schoolId);
    const versions = await this.store.listVersions(templateId);
    return versions
      .filter((version) => version.status === 'published')
      .map(toTemplateVersionView);
  }

  async getPublishedVersion(
    actor: CurrentUser,
    templateId: string,
    versionId: string,
  ): Promise<TemplateVersionView> {
    const schoolId = await this.directory.findSchoolId(actor.id);
    const record = await this.store.findTemplate(templateId);
    if (record === null) throw templateNotFound();
    assertStudentCanReadTemplate(record, schoolId);
    const version = await this.store.findVersion(versionId);
    if (
      version === null ||
      version.templateId !== templateId ||
      version.status !== 'published'
    ) {
      throw versionNotFound();
    }
    return toTemplateVersionView(version);
  }

  private async project(
    record: Parameters<typeof toTemplateView>[0],
  ): Promise<TemplateView> {
    const versions = await this.store.listVersions(record.id);
    return toTemplateView(record, latestPublishedVersionId(versions));
  }
}
