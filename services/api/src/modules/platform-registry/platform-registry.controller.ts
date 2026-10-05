import { BadRequestException, Body, Controller, Get, Headers, Param, Patch } from '@nestjs/common';
import type { AdminRuntimeAgent, AdminRuntimeAgentUpdateRequest, AdminRuntimeSnapshot } from '@qitu/contracts';
import { requireRole } from '../../common/access/request-auth';
import { AuthService } from '../identity-auth/auth.service';
import { PlatformRegistryService } from './platform-registry.service';
import { IdempotencyStore } from '../../common/idempotency/idempotency.service';
import { hashIdempotentInput } from '../../common/idempotency/idempotency.hash';
import { throwHttpForIdempotencyError } from '../../common/idempotency/idempotency.errors';

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
    const input = pickAgentFields(body);
    const scope = `admin.ai-runtime.agent.update:${agentId}`;
    try {
      const result = await this.idempotency.execute(scope, key, hashIdempotentInput(scope, { agentId }, input), async () => ({
        status: 200,
        body: await this.registry.updateAgent(actor, agentId, input),
      }));
      return { data: result.body };
    } catch (error) {
      throwHttpForIdempotencyError(error);
    }
  }
}

function pickAgentFields(body: unknown): AdminRuntimeAgentUpdateRequest {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) throw new BadRequestException('Agent 更新内容无效');
  const value = body as Record<string, unknown>;
  const out: AdminRuntimeAgentUpdateRequest = {};
  if (typeof value.label === 'string') out.label = value.label;
  if (typeof value.roleDefinition === 'string') out.roleDefinition = value.roleDefinition;
  if (typeof value.modelUsage === 'string') out.modelUsage = value.modelUsage;
  if (typeof value.enabled === 'boolean') out.enabled = value.enabled;
  if (Array.isArray(value.capabilities) && value.capabilities.every((item) => typeof item === 'string')) out.capabilities = value.capabilities;
  if (Object.keys(out).length === 0) throw new BadRequestException('Agent 更新内容无效');
  return out;
}
