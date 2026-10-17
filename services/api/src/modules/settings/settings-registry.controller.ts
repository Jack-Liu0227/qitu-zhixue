import { Controller, Get, Headers } from '@nestjs/common';
import type { AdminSettingsRegistry } from '@qitu/contracts';
import { requireRole } from '../../common/access/request-auth';
import { AuthService } from '../identity-auth/auth.service';
import { SettingsRegistryService } from './settings-registry.service';

/** 设置名称与路由的服务端单一事实源。 */
@Controller('admin/settings')
export class SettingsRegistryController {
  constructor(
    private readonly authService: AuthService,
    private readonly registry: SettingsRegistryService,
  ) {}

  @Get('registry')
  getRegistry(@Headers('cookie') cookieHeader: string | undefined): { data: AdminSettingsRegistry } {
    requireRole(this.authService, cookieHeader, 'admin', '设置注册表仅向管理员开放');
    return { data: this.registry.list() };
  }
}
