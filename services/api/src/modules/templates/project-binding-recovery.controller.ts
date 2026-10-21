import { Body, Controller, Get, Headers, HttpCode, Param, Post, BadRequestException } from '@nestjs/common';
import { requireAnyRole } from '../../common/access/request-auth';
import { AuthService } from '../identity-auth/auth.service';
import { pickFields } from '../../common/access/request-auth';
import { ProjectBindingRecoveryService } from './project-binding-recovery.service';

@Controller('admin/project-templates/:id/versions/:versionId/bindings')
export class ProjectBindingRecoveryController {
  constructor(private readonly recovery: ProjectBindingRecoveryService, private readonly auth: AuthService) {}

  @Get('project-recovery')
  async preview(@Headers('cookie') cookie: string | undefined, @Param('id') id: string, @Param('versionId') versionId: string) {
    return { data: await this.recovery.preview(requireAnyRole(this.auth, cookie), id, versionId) };
  }

  @Post(':bindingId/projects/:projectId/reconfirm')
  @HttpCode(200)
  async reconfirm(@Headers('cookie') cookie: string | undefined, @Headers('idempotency-key') key: string | undefined,
    @Param('id') id: string, @Param('versionId') versionId: string, @Param('bindingId') bindingId: string,
    @Param('projectId') projectId: string, @Body() body: unknown) {
    if (!key?.trim() || key.length > 160) throw new BadRequestException('必须提供有效的 Idempotency-Key');
    const input = pickFields<{ reason: string }>(body, ['reason']);
    return { data: await this.recovery.reconfirm(requireAnyRole(this.auth, cookie), id, versionId, bindingId, projectId, input.reason, key) };
  }
}
