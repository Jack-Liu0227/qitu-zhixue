import { Body, Controller, Get, Headers, Patch } from '@nestjs/common';
import { requireRole } from '../../common/access/request-auth';
import { AuthService } from '../identity-auth/auth.service';
import { GrowthProjectionSettingsService } from './growth-projection-settings.service';

@Controller('admin/growth-projection/settings')
export class GrowthProjectionSettingsController {
  constructor(private readonly settings: GrowthProjectionSettingsService, private readonly auth: AuthService) {}

  @Get()
  async read(@Headers('cookie') cookie: string | undefined) {
    requireRole(this.auth, cookie, 'admin', 'GROWTH_PROJECTION_ADMIN_REQUIRED');
    return { data: await this.settings.read() };
  }

  @Patch()
  async save(
    @Headers('cookie') cookie: string | undefined,
    @Headers('idempotency-key') key: string | undefined,
    @Body() body: unknown,
  ) {
    const actor = requireRole(this.auth, cookie, 'admin', 'GROWTH_PROJECTION_ADMIN_REQUIRED');
    return { data: await this.settings.save(actor, body, key ?? '') };
  }
}
