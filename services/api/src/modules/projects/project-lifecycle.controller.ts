import { BadRequestException, Body, Controller, Get, Headers, Param, Patch, Post } from '@nestjs/common';
import { AuthService } from '../identity-auth/auth.service';
import { requireRole } from '../../common/access/request-auth';
import { ProjectLifecycleService } from './project-lifecycle.service';

@Controller('projects')
export class ProjectLifecycleController {
  constructor(private readonly projects: ProjectLifecycleService, private readonly auth: AuthService) {}
  @Get()
  async list(@Headers('cookie') cookie: string | undefined) {
    const actor = requireRole(this.auth, cookie, 'student', '仅学生本人可读取项目列表');
    const projects = await this.projects.listProjects(actor);
    return { data: projects.map((project) => ({
      id: project.id, title: project.title, subtitle: project.subtitle ?? '', tags: project.tags,
      status: project.status, templateVersionId: project.templateVersionId ?? 'unknown',
      currentStageIndex: project.currentStageIndex, stageTotal: project.stageTotal,
      progressPercent: project.progressPercent,
    })) };
  }

  @Get(':projectId/overview')
  async overview(@Headers('cookie') cookie: string | undefined, @Param('projectId') projectId: string) {
    const actor = requireRole(this.auth, cookie, 'student', '仅学生本人可读取项目详情');
    return { data: await this.projects.getProjectOverview(actor, projectId) };
  }

  @Get(':projectId/next-step')
  async nextStep(@Headers('cookie') cookie: string | undefined, @Param('projectId') projectId: string) {
    const actor = requireRole(this.auth, cookie, 'student', '仅学生本人可读取项目下一步');
    return { data: await this.projects.getNextStep(actor, projectId) };
  }

  @Get(':projectId')
  async detail(@Headers('cookie') cookie: string | undefined, @Param('projectId') projectId: string) {
    const actor = requireRole(this.auth, cookie, 'student', '仅学生本人可读取项目详情');
    const overview = await this.projects.getProjectOverview(actor, projectId);
    return { data: overview.project };
  }

  @Get(':projectId/can-advance')
  async canAdvance(@Headers('cookie') cookie: string | undefined, @Param('projectId') projectId: string) {
    const actor = requireRole(this.auth, cookie, 'student', '仅学生本人可请求项目推进');
    return { data: await this.projects.canAdvance(actor, actor.id, projectId) };
  }
  @Post(':projectId/advance')
  async advance(@Headers('cookie') cookie: string | undefined, @Headers('idempotency-key') key: string | undefined, @Param('projectId') projectId: string, @Body() body: unknown) {
    const actor = requireRole(this.auth, cookie, 'student', '仅学生本人可请求项目推进');
    if (!key?.trim() || key.length > 160) throw new BadRequestException('Idempotency-Key 必填');
    if (body != null && (typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length > 0)) throw new BadRequestException('项目阶段由服务端决定');
    return { data: await this.projects.advance(actor, actor.id, projectId, key) };
  }
}
