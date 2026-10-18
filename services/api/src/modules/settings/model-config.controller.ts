import { Controller, Get, Headers } from '@nestjs/common';
import type { ModelRuntimeResponse } from '@qitu/contracts';
import { requireAnyRole } from '../../common/access/request-auth';
import { AuthService } from '../identity-auth/auth.service';
import { ModelRegistryService } from '../model-registry/model-registry.service';

/** Public capabilities are a read-only projection of the governed registry. */
@Controller()
export class ModelConfigController {
  constructor(
    private readonly registry: ModelRegistryService,
    private readonly authService: AuthService,
  ) {}

  @Get('models/runtime')
  getRuntime(@Headers('cookie') cookieHeader: string | undefined): { data: ModelRuntimeResponse } {
    requireAnyRole(this.authService, cookieHeader);
    return { data: this.registry.getRuntimeSummary() };
  }
}
