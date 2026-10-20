import { BadRequestException, Body, Controller, Headers, Param, Post } from '@nestjs/common';
import type { TutorLearningScope, TutorLessonAssessmentAnswer } from '@qitu/contracts';
import { requireRole } from '../../common/access/request-auth';
import { AuthService } from '../identity-auth/auth.service';
import { TutorLessonAssessmentService } from './tutor-lesson-assessment.service';

const fields = ['planId', 'planRevision', 'learningSessionId'];
function bodyObject(raw: unknown, allowed: string[]) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || Object.keys(raw).some(key => !allowed.includes(key))) {
    throw new BadRequestException({ code: 'TUTOR_ASSESSMENT_INVALID', message: '考核请求包含无效字段。' });
  }
  return raw;
}
@Controller('tutor/projects')
export class TutorLessonAssessmentController {
  constructor(private readonly auth: AuthService, private readonly assessment: TutorLessonAssessmentService) {}

  @Post(':projectId/lesson/assessment')
  async start(@Headers('cookie') cookie: string | undefined, @Param('projectId') projectId: string, @Body() raw: unknown) {
    const actor = requireRole(this.auth, cookie, 'student', '目标考核仅允许学生本人操作');
    return { data: await this.assessment.start(actor, projectId, bodyObject(raw, fields) as TutorLearningScope) };
  }

  @Post(':projectId/lesson/assessment/answers')
  async answer(@Headers('cookie') cookie: string | undefined, @Headers('idempotency-key') key: string | undefined,
    @Param('projectId') projectId: string, @Body() raw: unknown) {
    const actor = requireRole(this.auth, cookie, 'student', '目标考核仅允许学生本人操作');
    if (!key?.trim() || key.length > 160) throw new BadRequestException({ code: 'IDEMPOTENCY_KEY_REQUIRED', message: '作答需要稳定的幂等键。' });
    return { data: await this.assessment.answer(actor, projectId, bodyObject(raw, [...fields, 'questionId', 'answer']) as TutorLessonAssessmentAnswer, key) };
  }
}
