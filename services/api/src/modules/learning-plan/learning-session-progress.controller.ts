import { Body, Controller, Get, Headers, HttpCode, Param, Post } from '@nestjs/common';
import { requireAnyRole, requireRole } from '../../common/access/request-auth';
import { AuthService } from '../identity-auth/auth.service';
import { LearningSessionProgressService } from './learning-session-progress.service';
import { ProjectLearningLifecycleService } from '../projects/project-learning-lifecycle.service';

@Controller('learning-plans')
export class LearningSessionProgressController {
  constructor(private readonly progress: LearningSessionProgressService, private readonly auth: AuthService,
    private readonly lifecycle: ProjectLearningLifecycleService) {}
  @Get(':planId/progress')
  async read(@Headers('cookie') cookie: string | undefined, @Param('planId') planId: string) {
    return { data: await this.progress.readProgress(requireAnyRole(this.auth, cookie), planId) };
  }
  @Post(':planId/sessions/:sessionId/complete')
  @HttpCode(200)
  async complete(@Headers('cookie') cookie: string | undefined, @Headers('idempotency-key') key: string | undefined,
    @Param('planId') planId: string, @Param('sessionId') sessionId: string, @Body() body: unknown) {
    return { data: await this.lifecycle.completeLesson(requireRole(this.auth, cookie, 'student', '只有学生可完成课时'), planId, sessionId, body, key) };
  }
}
