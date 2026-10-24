import { Controller, Get, Headers } from '@nestjs/common';
import { requireRole } from '../../common/access/request-auth';
import { AuthService } from '../identity-auth/auth.service';
import { LearningInsightsService } from '../learning-insights/learning-insights.service';
import { ParentCommunicationService } from './parent-communication.service';

@Controller('students/me')
export class StudentLearningController {
  constructor(private readonly auth: AuthService, private readonly insights: LearningInsightsService,
    private readonly communication: ParentCommunicationService) {}

  @Get('learning-activity')
  async activity(@Headers('cookie') cookie: string | undefined) {
    const actor = requireRole(this.auth, cookie, 'student', '仅限学生读取本人的学习记录');
    return { data: await this.insights.activity(actor.id) };
  }

  @Get('encouragements')
  async encouragements(@Headers('cookie') cookie: string | undefined) {
    const actor = requireRole(this.auth, cookie, 'student', '仅限学生读取本人的家庭消息');
    return { data: await this.communication.inbox(actor.id) };
  }
}
