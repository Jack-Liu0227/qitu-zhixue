import { Injectable, Optional } from '@nestjs/common';
import { VisualAssetsService } from '../visual-assets/visual-assets.service';
import { resolveVisualBinding } from '../visual-assets/visual-assets.policy';
import type { CurrentUser } from '@qitu/contracts';
import { TemplateViewerDirectory } from './template-evidence.store';
import { assertStudentCanReadTemplate } from './templates.policy';
import { TemplateStore } from './templates.store';
import { TemplateBindingStore } from './templates-binding.store';
import { templateSchedule } from './templates.presentation';
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
 * 只读已发布 / 试点中模板；可见范围 = 平台模板 ∪ 本校模板（`school_id` 由服务端
 * 从会话解析，客户端无法伪造）。未发布 / 他校模板一律 403，不泄露存在性。
 */
@Injectable()
export class TemplatesService {
  constructor(
    private readonly store: TemplateStore,
    private readonly directory: TemplateViewerDirectory,
    @Optional() private readonly visuals?: VisualAssetsService,
    @Optional() private readonly bindings?: TemplateBindingStore,
  ) {}

  async listPublishedTemplates(actor: CurrentUser): Promise<TemplateView[]> {
    const schoolId = await this.directory.findSchoolId(actor.id);
    const records = await this.store.listTemplates({
      visibleToSchoolId: schoolId,
    });
    // 学生可见态 = published ∪ piloting（试点模板可被学生选用）。
    return Promise.all(
      records
        .filter((record) => record.status === 'published' || record.status === 'piloting')
        .map((record) => this.project(record)),
    );
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
      .filter((version) => version.status === 'published' || version.status === 'piloting')
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
      (version.status !== 'published' && version.status !== 'piloting')
    ) {
      throw versionNotFound();
    }
    const view = toTemplateVersionView(version);
    if (this.visuals) {
      const bindings = await this.visuals.presentationSnapshot();
      view.iconAssetId = resolveVisualBinding({ kind: 'template-version', id: version.id }, 'icon', bindings).effectiveAssetId;
      view.coverAssetId = resolveVisualBinding({ kind: 'template-version', id: version.id }, 'cover', bindings).effectiveAssetId;
    }
    return view;
  }

  private async project(
    record: Parameters<typeof toTemplateView>[0],
  ): Promise<TemplateView> {
    const versions = await this.store.listVersions(record.id);
    const view = toTemplateView(record, latestPublishedVersionId(versions));
    Object.assign(view, await templateSchedule(view.latestPublishedVersionId, this.bindings));
    if (this.visuals) {
      const bindings = await this.visuals.presentationSnapshot();
      view.iconAssetId = resolveVisualBinding({ kind: 'template', id: record.id }, 'icon', bindings).effectiveAssetId;
      view.coverAssetId = resolveVisualBinding({ kind: 'template', id: record.id }, 'cover', bindings).effectiveAssetId;
    }
    return view;
  }
}
