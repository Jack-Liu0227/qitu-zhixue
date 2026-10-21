import { Body, Controller, Headers, Post, Get } from '@nestjs/common';
import { AuthService } from '../identity-auth/auth.service';
import { requireRole } from '../../common/access/request-auth';
import { throwHttpForIdempotencyError } from '../../common/idempotency/idempotency.errors';
import { CopilotService } from './copilot.service';
import { parseRequest, text } from './copilot.protocol';

@Controller('admin/copilot')
export class CopilotController {
  constructor(private readonly auth: AuthService, private readonly copilot: CopilotService) {}

  @Get('capabilities')
  async capabilities(@Headers('cookie') cookie: string | undefined) {
    const actor = requireRole(this.auth, cookie, 'admin', '管家配置仅管理员可用');
    return { data: await this.copilot.capabilities(actor) };
  }

  @Post('turns')
  async turn(
    @Headers('cookie') cookie: string | undefined,
    @Headers('idempotency-key') key: string | undefined,
    @Body() body: unknown,
  ) {
    const actor = requireRole(this.auth, cookie, 'admin', '管家配置仅向管理员开放');
    const request = parseRequest(body);
    const idempotencyKey = text(key, 'Idempotency-Key');
    try { return { data: await this.copilot.run(actor, request, idempotencyKey) }; }
    catch (error) { throwHttpForIdempotencyError(error); }
  }
}
