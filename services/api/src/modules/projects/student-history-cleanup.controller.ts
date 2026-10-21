import { Controller, Delete, Get, Headers, Param } from '@nestjs/common';
import { requireRole } from '../../common/access/request-auth';
import { AuthService } from '../identity-auth/auth.service';
import { StudentHistoryCleanupService } from './student-history-cleanup.service';

@Controller('student-history')
export class StudentHistoryCleanupController {
  constructor(private readonly cleanup: StudentHistoryCleanupService, private readonly auth: AuthService) {}

  @Get('conversations')
  async list(@Headers('cookie') cookie: string | undefined) {
    return { data: await this.cleanup.conversations(requireRole(this.auth, cookie, 'student', '仅学生本人可读取会话历史')) };
  }

  @Delete(':kind/:id')
  async remove(@Headers('cookie') cookie: string | undefined, @Headers('idempotency-key') key: string | undefined,
    @Param('kind') kind: string, @Param('id') id: string) {
    const actor = requireRole(this.auth, cookie, 'student', '仅学生本人可永久删除自己的记录');
    return { data: await this.cleanup.remove(actor, kind, id, key) };
  }
}
