import { Body, Controller, Get, Headers, Param, Post } from '@nestjs/common';
import { requireRole } from '../../common/access/request-auth';
import { AuthService } from '../identity-auth/auth.service';
import { TutorCoursewareService } from './tutor-courseware.service';

@Controller('tutor/projects')
export class TutorCoursewareController {
  constructor(private readonly auth: AuthService, private readonly courseware: TutorCoursewareService) {}
  @Get(':projectId/lesson/courseware')
  async read(@Headers('cookie') cookie: string | undefined, @Param('projectId') id: string) {
    return { data: await this.courseware.read(requireRole(this.auth, cookie, 'student', '仅允许学生本人使用课件。'), id) };
  }
  @Post(':projectId/lesson/courseware/position')
  async position(@Headers('cookie') cookie: string | undefined, @Param('projectId') id: string,
    @Headers('idempotency-key') key: string | undefined, @Body() raw: unknown) {
    return { data: await this.courseware.position(requireRole(this.auth, cookie, 'student', '仅允许学生本人使用课件。'), id, raw, key ?? '') };
  }
}
