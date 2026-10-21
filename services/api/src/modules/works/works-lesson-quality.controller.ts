import { Controller, Get, Headers, Param, Query } from '@nestjs/common';
import { requireRole } from '../../common/access/request-auth';
import { AuthService } from '../identity-auth/auth.service';
import { WorksLearningEvidenceService } from './works-learning-evidence.service';

@Controller('teacher/students')
export class WorksLessonQualityController {
  constructor(private readonly learning: WorksLearningEvidenceService, private readonly auth: AuthService) {}

  @Get(':studentId/lesson-quality')
  async queue(@Headers('cookie') cookie: string | undefined, @Param('studentId') studentId: string,@Query('cursor') cursor?:string) {
    const actor = requireRole(this.auth, cookie, 'teacher', '仅班主任可以读取课内评价');
    return { data: await this.learning.listStudentLessonQuality(actor, studentId,cursor) };
  }
}
