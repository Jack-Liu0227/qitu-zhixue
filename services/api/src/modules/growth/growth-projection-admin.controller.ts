import {
  BadRequestException,
  Body,
  Controller,
  Headers,
  Param,
  Post,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { CurrentUser } from '@qitu/contracts';
import { requireRole } from '../../common/access/request-auth';
import { AuthService } from '../identity-auth/auth.service';
import { GrowthProjectionOwnerService } from './growth-projection-owner.service';

/** Admin-only review operations for server-generated profile/growth proposals. */
@Controller('admin/projections')
export class GrowthProjectionAdminController {
  constructor(
    private readonly owner: GrowthProjectionOwnerService,
    private readonly auth: AuthService,
  ) {}

  @Post(':candidateId/validate')
  async validate(
    @Headers('cookie') cookieHeader: string | undefined,
    @Param('candidateId') candidateId: string,
  ) {
    this.requireAdmin(cookieHeader);
    return { data: await this.owner.inspect(candidateId) };
  }

  @Post(':candidateId/accept')
  async accept(
    @Headers('cookie') cookieHeader: string | undefined,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Param('candidateId') candidateId: string,
  ) {
    const actor = this.requireAdmin(cookieHeader);
    const data = await this.owner.accept(candidateId, actor, idempotencyKey);
    if (data.status === 'rejected') {
      throw new UnprocessableEntityException({ code: data.errorCode ?? 'PROJECTION_VALIDATION_FAILED' });
    }
    return { data };
  }

  @Post(':candidateId/reject')
  async reject(
    @Headers('cookie') cookieHeader: string | undefined,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Param('candidateId') candidateId: string,
    @Body() body: unknown,
  ) {
    const actor = this.requireAdmin(cookieHeader);
    if (!isRecord(body) || typeof body.reasonCode !== 'string') throw new BadRequestException('PROJECTION_REJECTION_CODE_INVALID');
    return { data: await this.owner.reject(candidateId, actor, body.reasonCode, idempotencyKey) };
  }

  private requireAdmin(cookieHeader: string | undefined): Pick<CurrentUser, 'id'> & { role: 'admin' } {
    const user = requireRole(this.auth, cookieHeader, 'admin', '画像候选审核仅向管理员开放');
    return { id: user.id, role: 'admin' };
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
