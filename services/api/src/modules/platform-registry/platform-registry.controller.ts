import { BadRequestException, Body, Controller, Get, Headers, Param, Patch, Post } from '@nestjs/common';
import type { AdminRuntimeAgent, AdminRuntimeSnapshot } from '@qitu/contracts';
import { requireRole } from '../../common/access/request-auth';
import { AuthService } from '../identity-auth/auth.service';
import { PlatformRegistryService } from './platform-registry.service';
import { IdempotencyStore } from '../../common/idempotency/idempotency.service';
import { hashIdempotentInput } from '../../common/idempotency/idempotency.hash';
import { throwHttpForIdempotencyError } from '../../common/idempotency/idempotency.errors';
import { parseAgentUpdate } from './agent-config.validation';

@Controller('admin')
export class PlatformRegistryController {
  constructor(
    private readonly auth: AuthService,
    private readonly registry: PlatformRegistryService,
    private readonly idempotency: IdempotencyStore,
  ) {}

  @Get('ai-runtime')
  async getSnapshot(@Headers('cookie') cookie: string | undefined): Promise<{ data: AdminRuntimeSnapshot }> {
    requireRole(this.auth, cookie, 'admin', '管理后台仅向管理员开放');
    return { data: await this.registry.getSnapshot() };
  }

  @Patch('ai-runtime/agents/:agentId')
  async updateAgent(
    @Headers('cookie') cookie: string | undefined,
    @Headers('idempotency-key') key: string | undefined,
    @Param('agentId') agentId: string,
    @Body() body: unknown,
  ): Promise<{ data: AdminRuntimeAgent }> {
    const actor = requireRole(this.auth, cookie, 'admin', '管理后台仅向管理员开放');
    if (!key?.trim() || key.length > 160) throw new BadRequestException({ code: 'IDEMPOTENCY_KEY_REQUIRED', message: '缺少或无效的 Idempotency-Key' });
    const input = parseAgentUpdate(body);
    const scope = `admin.ai-runtime.agent.update:${agentId}`;
    try {
      const result = await this.idempotency.execute(scope, key, hashIdempotentInput(scope, { actorId: actor.id, agentId }, input), async () => ({
        status: 200,
        body: await this.registry.updateAgent(actor, agentId, input),
      }));
      return { data: result.body };
    } catch (error) {
      throwHttpForIdempotencyError(error);
    }
  }
  @Post('ai-runtime/agents/:agentId')
  async createAgent(
    @Headers('cookie') cookie: string | undefined,
    @Headers('idempotency-key') key: string | undefined,
    @Param('agentId') agentId: string,
    @Body() body: unknown,
  ): Promise<{ data: AdminRuntimeAgent }> {
    const actor = requireRole(this.auth, cookie, 'admin', '管理后台仅向管理员开放');
    if (!key?.trim() || key.length > 160) throw new BadRequestException({ code: 'IDEMPOTENCY_KEY_REQUIRED', message: '缺少或无效的 Idempotency-Key' });
    const input = parseAgentUpdate(body);
    const scope = `admin.ai-runtime.agent.create:${agentId}`;
    try {
      const result = await this.idempotency.execute(scope, key, hashIdempotentInput(scope, { actorId: actor.id, agentId }, input), async () => ({
        status: 201, body: await this.registry.createAgent(actor, agentId, input),
      }));
      return { data: result.body };
    } catch (error) {
      throwHttpForIdempotencyError(error);
    }
  }
}
