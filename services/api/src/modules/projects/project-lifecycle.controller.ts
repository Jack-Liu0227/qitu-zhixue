import { BadRequestException, Body, Controller, Get, Headers, Param, Post } from '@nestjs/common';
import { AuthService } from '../identity-auth/auth.service';
import { requireRole } from '../../common/access/request-auth';
import { ProjectLifecycleService } from './project-lifecycle.service';

@Controller('projects')
export class ProjectLifecycleController {
  constructor(private readonly projects: ProjectLifecycleService, private readonly auth: AuthService) {}
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
