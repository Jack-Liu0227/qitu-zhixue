import { BadRequestException, Controller, Get, Headers, Param, Post } from '@nestjs/common';
import type { AdminInitializationStatus } from '@qitu/contracts';
import { requireRole } from '../../common/access/request-auth';
import { AuthService } from '../identity-auth/auth.service';
import { InitializationService } from './initialization.service';
import { PlatformRegistryService } from '../platform-registry/platform-registry.service';

@Controller('admin/initialization')
export class InitializationController {
  constructor(
    private readonly auth: AuthService,
    private readonly initialization: InitializationService,
    private readonly registry: PlatformRegistryService,
  ) {}

  @Get()
  async getStatus(@Headers('cookie') cookie: string | undefined): Promise<{ data: AdminInitializationStatus }> {
    requireRole(this.auth, cookie, 'admin', '管理后台仅向管理员开放');
    return { data: (await this.registry.getSnapshot()).initialization };
  }

  @Post(':area/execute')
  async execute(
    @Headers('cookie') cookie: string | undefined,
    @Headers('idempotency-key') rawKey: string | undefined,
    @Param('area') rawArea: string,
  ) {
    const admin = requireRole(this.auth, cookie, 'admin', '管理后台仅向管理员开放');
    if (rawArea !== 'database' && rawArea !== 'knowledge' && rawArea !== 'template' && rawArea !== 'tutor') {
      throw new BadRequestException({ code: 'INITIALIZATION_AREA_INVALID', message: '未知的初始化范围' });
    }
    const key = requireIdempotencyKey(rawKey);
    return { data: await this.initialization.execute(rawArea, admin, key) };
  }
}

function requireIdempotencyKey(raw: string | undefined): string {
  const key = raw?.trim();
  if (!key || key.length > 200) {
    throw new BadRequestException({ code: 'IDEMPOTENCY_KEY_REQUIRED', message: '该接口必须携带有效的 Idempotency-Key 请求头' });
  }
  return key;
}
