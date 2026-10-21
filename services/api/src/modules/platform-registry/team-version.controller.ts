import { Body, Controller, Get, Headers, Param, Post } from '@nestjs/common';
import { AuthService } from '../identity-auth/auth.service';
import { requireRole } from '../../common/access/request-auth';
import { throwHttpForIdempotencyError } from '../../common/idempotency/idempotency.errors';
import { TeamVersionService } from './team-version.service';

@Controller('admin/teams/:teamId/versions')
export class TeamVersionController {
  constructor(private readonly auth: AuthService, private readonly versions: TeamVersionService) {}
  @Get()
  async list(@Headers('cookie') cookie: string | undefined, @Param('teamId') teamId: string) {
    return { data: await this.versions.list(requireRole(this.auth, cookie, 'admin', '团队版本仅管理员可用'), teamId) };
  }
  @Post()
  async publish(@Headers('cookie') cookie: string | undefined, @Headers('idempotency-key') key: string | undefined,
    @Param('teamId') teamId: string, @Body() body: unknown) {
    const actor = requireRole(this.auth, cookie, 'admin', '团队版本仅管理员可用');
    try { return { data: await this.versions.publish(actor, teamId, body, key ?? '') }; }
    catch (error) { throwHttpForIdempotencyError(error); }
  }
  @Post(':versionId/runtime-projection')
  async projectRuntime(@Headers('cookie') cookie: string | undefined,
    @Headers('idempotency-key') key: string | undefined,
    @Param('teamId') teamId: string, @Param('versionId') versionId: string) {
    const actor = requireRole(this.auth, cookie, 'admin', '团队版本仅管理员可用');
    try { return { data: await this.versions.projectRuntime(actor, teamId, versionId, key ?? '') }; }
    catch (error) { throwHttpForIdempotencyError(error); }
  }
}
