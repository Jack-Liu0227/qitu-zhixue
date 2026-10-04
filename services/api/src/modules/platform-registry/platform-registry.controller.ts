import { Controller, Get, Headers } from '@nestjs/common';
import type { AdminRuntimeSnapshot } from '@qitu/contracts';
import { requireRole } from '../../common/access/request-auth';
import { AuthService } from '../identity-auth/auth.service';
import { PlatformRegistryService } from './platform-registry.service';

@Controller('admin')
export class PlatformRegistryController {
  constructor(
    private readonly auth: AuthService,
    private readonly registry: PlatformRegistryService,
  ) {}

  @Get('ai-runtime')
  async getSnapshot(@Headers('cookie') cookie: string | undefined): Promise<{ data: AdminRuntimeSnapshot }> {
    requireRole(this.auth, cookie, 'admin', '管理后台仅向管理员开放');
    return { data: await this.registry.getSnapshot() };
  }
}
