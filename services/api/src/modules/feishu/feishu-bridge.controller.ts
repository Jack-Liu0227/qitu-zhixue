import { Controller, Get, Headers, Query } from '@nestjs/common';
import type { FeishuBridgeStatus } from '@qitu/contracts';
import { requireRole } from '../../common/access/request-auth';
import { AuthService } from '../identity-auth/auth.service';
import { parseAssistantId } from './feishu.controller';
import { FeishuBridgeService } from './feishu-bridge.service';

@Controller('admin/integrations/feishu/bridge')
export class FeishuBridgeController {
  constructor(private readonly auth: AuthService, private readonly bridge: FeishuBridgeService) {}
  @Get()
  async get(@Headers('cookie') cookie: string | undefined, @Query('assistantId') value?: string): Promise<{ data: FeishuBridgeStatus }> {
    requireRole(this.auth, cookie, 'admin', '飞书连接状态仅向管理员开放');
    return { data: await this.bridge.status(parseAssistantId(value)) };
  }
}
