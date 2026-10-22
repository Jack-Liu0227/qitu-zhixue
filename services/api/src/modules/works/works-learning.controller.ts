import { BadRequestException, Body, Controller, Get, Headers, Param, Post, Query } from '@nestjs/common';
import { pickFields, requireAnyRole, requireRole } from '../../common/access/request-auth';
import { AuthService } from '../identity-auth/auth.service';
import { WorksLearningEvidenceService, type LearningTextSubmission } from './works-learning-evidence.service';
import type { LessonQualityDecision } from '@qitu/contracts';

@Controller('learning-plans/:planId/sessions/:sessionId')
export class WorksLearningController {
  constructor(private readonly learning: WorksLearningEvidenceService, private readonly auth: AuthService) {}

  @Post('quality-reviews')
  async qualityReview(@Headers('cookie') cookie: string | undefined, @Headers('idempotency-key') key: string | undefined,
    @Param('planId') planId: string, @Param('sessionId') sessionId: string, @Body() body: unknown) {
    const actor = requireRole(this.auth, cookie, 'teacher', '仅当前班主任可以评价课内产物');
    const input = pickFields<LessonQualityDecision>(body, ['planRevision', 'evidenceRef', 'subjectDigest', 'criteria']);
    return { data: await this.learning.reviewLessonQuality(actor, planId, sessionId, input, requireKey(key)) };
  }

  @Get('evidence')
  async evidence(@Headers('cookie') cookie: string | undefined, @Param('planId') planId: string,
    @Param('sessionId') sessionId: string, @Query('planRevision') revision: string) {
    return { data: await this.learning.getLessonProofs(requireAnyRole(this.auth, cookie), planId, sessionId, Number(revision)) };
  }

  @Post('responses')
  async respond(@Headers('cookie') cookie: string | undefined, @Headers('idempotency-key') key: string | undefined,
    @Param('planId') planId: string, @Param('sessionId') sessionId: string, @Body() body: unknown) {
    const actor = requireRole(this.auth, cookie, 'student', '学习回应仅限学生本人提交');
    const input = pickFields<LearningTextSubmission>(body, ['planRevision', 'content', 'evidenceRefs', 'activityId']);
    return { data: await this.learning.submitResponse(actor, planId, sessionId, input, requireKey(key)) };
  }

  @Post('artifacts')
  async artifact(@Headers('cookie') cookie: string | undefined, @Headers('idempotency-key') key: string | undefined,
    @Param('planId') planId: string, @Param('sessionId') sessionId: string, @Body() body: unknown) {
    const actor = requireRole(this.auth, cookie, 'student', '课时作品仅限学生本人提交');
    const input = pickFields<LearningTextSubmission>(body, ['planRevision', 'content', 'evidenceRefs', 'objectiveId', 'title', 'requestReview', 'activityId']);
    return { data: await this.learning.submitArtifact(actor, planId, sessionId, input, requireKey(key)) };
  }

  @Post('reflections')
  async reflect(@Headers('cookie') cookie: string | undefined, @Headers('idempotency-key') key: string | undefined,
    @Param('planId') planId: string, @Param('sessionId') sessionId: string, @Body() body: unknown) {
    const actor = requireRole(this.auth, cookie, 'student', '学习反思仅限学生本人提交');
    const input = pickFields<LearningTextSubmission>(body, ['planRevision', 'content', 'evidenceRefs', 'activityId']);
    return { data: await this.learning.submitReflection(actor, planId, sessionId, input, requireKey(key)) };
  }
}

function requireKey(input: string | undefined): string {
  if (!input?.trim() || input.length > 160) throw new BadRequestException({ code: 'IDEMPOTENCY_KEY_REQUIRED', message: '需要有效的 Idempotency-Key' });
  return input.trim();
}
