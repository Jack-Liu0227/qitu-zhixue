import { Body, Controller, Get, Headers, Param, Patch, Post, Query } from '@nestjs/common';
import { AuthService } from '../identity-auth/auth.service';
import { requireRole } from '../../common/access/request-auth';
import { ProjectHistoryService } from './project-history.service';
import { ProjectTeachingPlanRecoveryService } from './project-teaching-plan-recovery.service';

@Controller('projects')
export class ProjectHistoryController {
  constructor(private readonly history: ProjectHistoryService, private readonly auth: AuthService,
    private readonly recovery: ProjectTeachingPlanRecoveryService) {}
  @Post(':id/teaching-plan/recovery')
  async recover(@Headers('cookie') cookie: string | undefined, @Headers('idempotency-key') key: string | undefined, @Param('id') id: string) {
    return { data: await this.recovery.recover(requireRole(this.auth, cookie, 'student', '仅学生本人可恢复课时计划'), id, key) };
  }
  @Get('query')
  async query(@Headers('cookie') cookie: string | undefined, @Query() query: Record<string, unknown>) {
    return { data: await this.history.query(requireRole(this.auth,cookie,'student','仅学生本人可读取项目历史'),query) };
  }
  @Patch('current-selection')
  async select(@Headers('cookie') cookie: string | undefined,@Headers('idempotency-key') key: string | undefined,@Body() body: unknown) {
    return { data: await this.history.change(requireRole(this.auth,cookie,'student','仅学生本人可选择项目'),null,body,key) };
  }
  @Patch(':projectId/display-preference')
  async display(@Headers('cookie') cookie: string | undefined,@Headers('idempotency-key') key: string | undefined,@Param('projectId') id:string,@Body() body:unknown) {
    return { data: await this.history.change(requireRole(this.auth,cookie,'student','仅学生本人可收纳项目'),id,body,key) };
  }
}
