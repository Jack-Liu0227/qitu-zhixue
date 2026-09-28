import { Controller, Get, Headers, Param } from '@nestjs/common';
import type { CurrentUser } from '@qitu/contracts';
import { requireRole } from '../../common/access/request-auth';
import { AuthService } from '../identity-auth/auth.service';
import { TemplatesService } from './templates.service';
import type { TemplateView, TemplateVersionView } from './templates.types';

/**
 * 学生端模板库只读接口（产品文档 7.4）。
 *
 * - `GET /api/v1/project-templates`                              已发布模板列表
 * - `GET /api/v1/project-templates/:id`                          模板详情
 * - `GET /api/v1/project-templates/:id/versions`                 已发布版本列表
 * - `GET /api/v1/project-templates/:id/versions/:versionId`      版本详情（冻结阶段）
 *
 * 只向 `student` 开放；可见范围 = 平台模板 ∪ 本校模板，由服务端解析会话学校后判定。
 */
@Controller('project-templates')
export class TemplatesController {
  constructor(
    private readonly templates: TemplatesService,
    private readonly auth: AuthService,
  ) {}

  @Get()
  async list(
    @Headers('cookie') cookieHeader: string | undefined,
  ): Promise<{ data: TemplateView[] }> {
    const user = this.requireStudent(cookieHeader);
    return { data: await this.templates.listPublishedTemplates(user) };
  }

  @Get(':id')
  async get(
    @Headers('cookie') cookieHeader: string | undefined,
    @Param('id') id: string,
  ): Promise<{ data: TemplateView }> {
    const user = this.requireStudent(cookieHeader);
    return { data: await this.templates.getPublishedTemplate(user, id) };
  }

  @Get(':id/versions')
  async listVersions(
    @Headers('cookie') cookieHeader: string | undefined,
    @Param('id') id: string,
  ): Promise<{ data: TemplateVersionView[] }> {
    const user = this.requireStudent(cookieHeader);
    return { data: await this.templates.listPublishedVersions(user, id) };
  }

  @Get(':id/versions/:versionId')
  async getVersion(
    @Headers('cookie') cookieHeader: string | undefined,
    @Param('id') id: string,
    @Param('versionId') versionId: string,
  ): Promise<{ data: TemplateVersionView }> {
    const user = this.requireStudent(cookieHeader);
    return { data: await this.templates.getPublishedVersion(user, id, versionId) };
  }

  private requireStudent(cookieHeader: string | undefined): CurrentUser {
    return requireRole(this.auth, cookieHeader, 'student', '模板库仅向学生开放');
  }
}
