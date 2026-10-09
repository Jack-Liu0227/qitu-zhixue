import { BadRequestException, Body, Controller, Get, Headers, Param, Patch, Post } from '@nestjs/common';
import type { AdminRuntimeAgent, AdminRuntimeSnapshot } from '@qitu/contracts';
import { ADMIN_AI_RUNTIME_IDEMPOTENCY_SCOPES } from '@qitu/contracts';
import { requireRole } from '../../common/access/request-auth';
import { AuthService } from '../identity-auth/auth.service';
import { PlatformRegistryService } from './platform-registry.service';
import { IdempotencyStore } from '../../common/idempotency/idempotency.service';
import { hashIdempotentInput } from '../../common/idempotency/idempotency.hash';
import { throwHttpForIdempotencyError } from '../../common/idempotency/idempotency.errors';
import { parseAgentUpdate } from './agent-config.validation';
import { parseAssistantCreate, parseAssistantUpdate, parseTeamCreate, parseTeamUpdate } from './admin-ai-config.validation';
import type { AdminAssistantResponse, AdminAssistantListResponse, AdminTeamResponse, AdminTeamListResponse } from '@qitu/contracts';

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

  /* ==================== admin 助手 / 团队 CRUD（T2） ==================== */

  @Get('ai-runtime/assistants')
  async listAssistants(@Headers('cookie') cookie: string | undefined): Promise<AdminAssistantListResponse> {
    requireRole(this.auth, cookie, 'admin', '助手配置仅向管理员开放');
    return { data: await this.registry.listAssistants() };
  }

  @Post('ai-runtime/assistants')
  async createAssistant(
    @Headers('cookie') cookie: string | undefined,
    @Headers('idempotency-key') key: string | undefined,
    @Body() body: unknown,
  ): Promise<AdminAssistantResponse> {
    const actor = requireRole(this.auth, cookie, 'admin', '助手配置仅向管理员开放');
    const idempotencyKey = requireAdminAiIdempotencyKey(key);
    const input = parseAssistantCreate(body);
    const scope = ADMIN_AI_RUNTIME_IDEMPOTENCY_SCOPES.assistantCreate;
    try {
      const result = await this.idempotency.execute(scope, idempotencyKey, hashIdempotentInput(scope, { actorId: actor.id }, input), async () => ({
        status: 201,
        body: await this.registry.createAssistant(actor, input),
      }));
      return { data: result.body };
    } catch (error) {
      throwHttpForIdempotencyError(error);
    }
  }

  @Patch('ai-runtime/assistants/:assistantId')
  async updateAssistant(
    @Headers('cookie') cookie: string | undefined,
    @Headers('idempotency-key') key: string | undefined,
    @Param('assistantId') assistantId: string,
    @Body() body: unknown,
  ): Promise<AdminAssistantResponse> {
    const actor = requireRole(this.auth, cookie, 'admin', '助手配置仅向管理员开放');
    const idempotencyKey = requireAdminAiIdempotencyKey(key);
    const input = parseAssistantUpdate(body);
    // 冻结契约：更新类作用域必须拼上资源 id，避免同一 key 跨对象重放。
    const scope = `${ADMIN_AI_RUNTIME_IDEMPOTENCY_SCOPES.assistantUpdate}:${assistantId}`;
    try {
      const result = await this.idempotency.execute(scope, idempotencyKey, hashIdempotentInput(scope, { actorId: actor.id, assistantId }, input), async () => ({
        status: 200,
        body: await this.registry.updateAssistant(actor, assistantId, input),
      }));
      return { data: result.body };
    } catch (error) {
      throwHttpForIdempotencyError(error);
    }
  }

  @Get('ai-runtime/teams')
  async listTeams(@Headers('cookie') cookie: string | undefined): Promise<AdminTeamListResponse> {
    requireRole(this.auth, cookie, 'admin', '团队配置仅向管理员开放');
    return { data: await this.registry.listTeams() };
  }

  @Post('ai-runtime/teams')
  async createTeam(
    @Headers('cookie') cookie: string | undefined,
    @Headers('idempotency-key') key: string | undefined,
    @Body() body: unknown,
  ): Promise<AdminTeamResponse> {
    const actor = requireRole(this.auth, cookie, 'admin', '团队配置仅向管理员开放');
    const idempotencyKey = requireAdminAiIdempotencyKey(key);
    const input = parseTeamCreate(body);
    const scope = ADMIN_AI_RUNTIME_IDEMPOTENCY_SCOPES.teamCreate;
    try {
      const result = await this.idempotency.execute(scope, idempotencyKey, hashIdempotentInput(scope, { actorId: actor.id }, input), async () => ({
        status: 201,
        body: await this.registry.createTeam(actor, input),
      }));
      return { data: result.body };
    } catch (error) {
      throwHttpForIdempotencyError(error);
    }
  }

  @Patch('ai-runtime/teams/:teamId')
  async updateTeam(
    @Headers('cookie') cookie: string | undefined,
    @Headers('idempotency-key') key: string | undefined,
    @Param('teamId') teamId: string,
    @Body() body: unknown,
  ): Promise<AdminTeamResponse> {
    const actor = requireRole(this.auth, cookie, 'admin', '团队配置仅向管理员开放');
    const idempotencyKey = requireAdminAiIdempotencyKey(key);
    const input = parseTeamUpdate(body);
    const scope = `${ADMIN_AI_RUNTIME_IDEMPOTENCY_SCOPES.teamUpdate}:${teamId}`;
    try {
      const result = await this.idempotency.execute(scope, idempotencyKey, hashIdempotentInput(scope, { actorId: actor.id, teamId }, input), async () => ({
        status: 200,
        body: await this.registry.updateTeam(actor, teamId, input),
      }));
      return { data: result.body };
    } catch (error) {
      throwHttpForIdempotencyError(error);
    }
  }
}

/** 幂等键只走 HTTP 头（IDEMPOTENCY_KEY_HEADER='Idempotency-Key'），缺失/过长统一 400。 */
function requireAdminAiIdempotencyKey(value: string | undefined): string {
  const key = value?.trim();
  if (!key || key.length > 160) throw new BadRequestException({ code: 'IDEMPOTENCY_KEY_REQUIRED', message: '缺少或无效的 Idempotency-Key' });
  return key;
}
