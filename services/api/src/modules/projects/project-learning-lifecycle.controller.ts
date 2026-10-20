import { BadRequestException, Body, Controller, Headers, Param, Post } from '@nestjs/common';
import { requireRole } from '../../common/access/request-auth';
import { AuthService } from '../identity-auth/auth.service';
import { ProjectLearningLifecycleService, type ReconcileLearningInput } from './project-learning-lifecycle.service';

@Controller('projects')
export class ProjectLearningLifecycleController {
  constructor(private readonly auth: AuthService, private readonly learning: ProjectLearningLifecycleService) {}
  @Post(':projectId/reconcile-learning')
  async reconcile(@Headers('cookie') cookie: string | undefined, @Headers('idempotency-key') key: string | undefined,
    @Param('projectId') projectId: string, @Body() body: unknown) {
    const actor = requireRole(this.auth, cookie, 'student', '学习进度仅学生本人可提交');
    if (!key?.trim() || key.length > 160 || !body || typeof body !== 'object' || Array.isArray(body) ||
        Object.keys(body).some(field => !['planId', 'planRevision'].includes(field))) {
      throw new BadRequestException({ code: 'LEARNING_PROGRESS_INVALID', message: '需要当前计划、修订号与稳定的幂等键。' });
    }
    return { data: await this.learning.reconcile(actor, projectId, body as ReconcileLearningInput, key) };
  }
}
