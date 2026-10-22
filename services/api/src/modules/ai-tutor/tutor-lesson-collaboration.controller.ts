import { BadRequestException, Body, Controller, Get, Headers, Param, Post, Query } from '@nestjs/common';
import type { TutorLearningScope } from '@qitu/contracts';
import { requireRole } from '../../common/access/request-auth';
import { AuthService } from '../identity-auth/auth.service';
import { TutorLessonCollaborationService } from './tutor-lesson-collaboration.service';

function scope(raw: unknown, query = false): TutorLearningScope {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || Object.keys(raw).some(key => !['planId', 'planRevision', 'learningSessionId'].includes(key))) {
    throw new BadRequestException('协作课时参数无效');
  }
  const value = raw as Record<string, unknown>;
  if (typeof value.planId !== 'string' || value.planId.length > 200 || typeof value.learningSessionId !== 'string' || value.learningSessionId.length > 200
    || query && (typeof value.planRevision !== 'string' || !/^[1-9][0-9]*$/u.test(value.planRevision))) throw new BadRequestException('协作课时参数无效');
  const revision = query ? Number(value.planRevision) : value.planRevision;
  if (typeof revision !== 'number' || !Number.isSafeInteger(revision) || revision < 1) throw new BadRequestException('协作计划版本无效');
  return { planId: value.planId, learningSessionId: value.learningSessionId, planRevision: revision };
}
@Controller('tutor/projects')
export class TutorLessonCollaborationController {
  constructor(private readonly auth: AuthService, private readonly collaboration: TutorLessonCollaborationService) {}
  @Get(':projectId/lesson/collaboration')
  async read(@Headers('cookie') cookie: string | undefined, @Param('projectId') projectId: string, @Query() query: unknown) {
    return { data: await this.collaboration.read(requireRole(this.auth, cookie, 'student', '课堂协作仅允许学生本人操作'), projectId, scope(query, true)) };
  }
  @Post(':projectId/lesson/collaboration')
  async request(@Headers('cookie') cookie: string | undefined, @Headers('idempotency-key') key: string | undefined,
    @Param('projectId') projectId: string, @Body() body: unknown) {
    if (!key?.trim() || key.length > 160) throw new BadRequestException('需要有效的幂等键');
    return { data: await this.collaboration.read(requireRole(this.auth, cookie, 'student', '课堂协作仅允许学生本人操作'), projectId, scope(body), key) };
  }
}
