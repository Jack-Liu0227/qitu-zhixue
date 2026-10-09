import { BadRequestException, Body, Controller, Get, Headers, Param, Patch, Post } from '@nestjs/common';
import type { PblPhase } from '@qitu/contracts';
import { isPblPhase } from '@qitu/ai-client';
import { TeamRuntimeService, type AgentRouteInput, type AgentRouteTrigger, type AgentRouteUpdateInput, type DelegateTaskInput, type StartTeamRunInput } from './team-runtime.service';
import { requireAnyRole, requireRole } from '../../common/access/request-auth';
import { AuthService } from '../identity-auth/auth.service';
import { IdempotencyStore } from '../../common/idempotency/idempotency.service';
import { hashIdempotentInput } from '../../common/idempotency/idempotency.hash';
import { throwHttpForIdempotencyError } from '../../common/idempotency/idempotency.errors';

@Controller()
export class TeamRuntimeController {
  constructor(
    private readonly auth: AuthService,
    private readonly runtime: TeamRuntimeService,
    private readonly idempotency: IdempotencyStore,
  ) {}

  @Get('admin/agent-graph')
  async staticGraph(@Headers('cookie') cookie: string | undefined) {
    requireRole(this.auth, cookie, 'admin', '协作图仅向管理员开放');
    return { data: await this.runtime.getStaticGraph() };
  }

  @Get('admin/agent-graphs/:runId')
  async adminRunGraph(@Headers('cookie') cookie: string | undefined, @Param('runId') runId: string) {
    const actor = requireRole(this.auth, cookie, 'admin', '执行图仅向管理员开放');
    return { data: await this.runtime.getRunGraph(actor, runId) };
  }

  @Get('admin/ai-runtime/routes')
  async listRoutes(@Headers('cookie') cookie: string | undefined) {
    requireRole(this.auth, cookie, 'admin', 'Agent 路由仅向管理员开放');
    return { data: await this.runtime.listRoutes() };
  }

  @Post('admin/ai-runtime/routes')
  async createRoute(
    @Headers('cookie') cookie: string | undefined,
    @Headers('idempotency-key') headerKey: string | undefined,
    @Body() body: unknown,
  ) {
    const actor = requireRole(this.auth, cookie, 'admin', 'Agent 路由仅向管理员开放');
    const idempotencyKey = requireIdempotencyKey(headerKey);
    const input = parseRouteInput(body, false) as AgentRouteInput;
    const scope = 'admin.ai-runtime.route.create';
    try {
      const result = await this.idempotency.execute(scope, idempotencyKey, hashIdempotentInput(scope, { actorId: actor.id }, input), async () => ({
        status: 201,
        body: await this.runtime.createRoute(actor, input, idempotencyKey),
      }));
      return { data: result.body };
    } catch (error) {
      throwHttpForIdempotencyError(error);
    }
  }

  @Patch('admin/ai-runtime/routes/:routeId')
  async updateRoute(
    @Headers('cookie') cookie: string | undefined,
    @Headers('idempotency-key') headerKey: string | undefined,
    @Param('routeId') routeId: string,
    @Body() body: unknown,
  ) {
    const actor = requireRole(this.auth, cookie, 'admin', 'Agent 路由仅向管理员开放');
    const idempotencyKey = requireIdempotencyKey(headerKey);
    const input = parseRouteInput(body, true) as AgentRouteUpdateInput;
    const scope = `admin.ai-runtime.route.update:${routeId}`;
    try {
      const result = await this.idempotency.execute(scope, idempotencyKey, hashIdempotentInput(scope, { actorId: actor.id, routeId }, input), async () => ({
        status: 200,
        body: await this.runtime.updateRoute(actor, routeId, input, idempotencyKey),
      }));
      return { data: result.body };
    } catch (error) {
      throwHttpForIdempotencyError(error);
    }
  }

  @Post('tutor/team-runs')
  async createRun(
    @Headers('cookie') cookie: string | undefined,
    @Headers('idempotency-key') headerKey: string | undefined,
    @Body() body: unknown,
  ) {
    const actor = requireAnyRole(this.auth, cookie);
    const input = parseStartInput(body, headerKey);
    const scope = 'tutor.team-run.create';
    try {
      const result = await this.idempotency.execute(scope, input.idempotencyKey, hashIdempotentInput(scope, { actorId: actor.id }, input), async () => ({
        status: 201,
        body: await this.runtime.startRun(actor, input),
      }));
      return { data: result.body };
    } catch (error) {
      throwHttpForIdempotencyError(error);
    }
  }

  @Get('tutor/team-runs/:runId')
  async runGraph(@Headers('cookie') cookie: string | undefined, @Param('runId') runId: string) {
    const actor = requireAnyRole(this.auth, cookie);
    return { data: await this.runtime.getRunGraph(actor, runId) };
  }

  /** 当前 PBL 阶段与服务端门禁状态（只读；客户端不可写）。 */
  @Get('tutor/team-runs/:runId/phase')
  async getPhase(@Headers('cookie') cookie: string | undefined, @Param('runId') runId: string) {
    const actor = requireAnyRole(this.auth, cookie);
    return { data: await this.runtime.getPhaseStatus(actor, runId) };
  }

  /**
   * 阶段推进：服务端强制冻结门禁。未达成 → 409 + 稳定错误码
   * （如 PBL_GATE_THEORY_MASTERED_REQUIRED）；自动推进永远被拒。
   */
  @Post('tutor/team-runs/:runId/phase')
  async advancePhase(
    @Headers('cookie') cookie: string | undefined,
    @Headers('idempotency-key') headerKey: string | undefined,
    @Param('runId') runId: string,
    @Body() body: unknown,
  ) {
    const actor = requireAnyRole(this.auth, cookie);
    const idempotencyKey = requireIdempotencyKey(headerKey);
    const input = parsePhaseAdvanceInput(body);
    const scope = `tutor.team-run.phase:${runId}`;
    try {
      const result = await this.idempotency.execute(scope, idempotencyKey, hashIdempotentInput(scope, { actorId: actor.id, runId }, input), async () => ({
        status: 200,
        body: await this.runtime.advancePhase(actor, runId, { ...input, idempotencyKey }),
      }));
      return { data: result.body };
    } catch (error) {
      throwHttpForIdempotencyError(error);
    }
  }

  /** 管理员/服务端域逻辑写入门禁达成证据；学生没有任何直写路径。 */
  @Post('admin/agent-runs/:runId/gates')
  async recordGate(
    @Headers('cookie') cookie: string | undefined,
    @Headers('idempotency-key') headerKey: string | undefined,
    @Param('runId') runId: string,
    @Body() body: unknown,
  ) {
    const actor = requireRole(this.auth, cookie, 'admin', '门禁证据仅向管理员/服务端开放');
    const idempotencyKey = requireIdempotencyKey(headerKey);
    const input = parseGateInput(body);
    const scope = `admin.agent-run.gate:${runId}`;
    try {
      const result = await this.idempotency.execute(scope, idempotencyKey, hashIdempotentInput(scope, { actorId: actor.id, runId }, input), async () => ({
        status: 201,
        body: await this.runtime.recordGateSatisfied(actor, runId, input, idempotencyKey),
      }));
      return { data: result.body };
    } catch (error) {
      throwHttpForIdempotencyError(error);
    }
  }

  /** Admin-only test/delegation endpoint; TutorService should call the service directly. */
  @Post('admin/agent-runs/:runId/delegate')
  async delegate(
    @Headers('cookie') cookie: string | undefined,
    @Headers('idempotency-key') headerKey: string | undefined,
    @Param('runId') runId: string,
    @Body() body: unknown,
  ) {
    const actor = requireRole(this.auth, cookie, 'admin', 'Agent 委派测试仅向管理员开放');
    const input = parseDelegateInput(body, headerKey);
    const scope = `admin.agent-run.delegate:${runId}`;
    try {
      const result = await this.idempotency.execute(scope, input.idempotencyKey, hashIdempotentInput(scope, { actorId: actor.id, runId }, input), async () => ({
        status: 201,
        body: await this.runtime.delegate(actor, runId, input),
      }));
      return { data: result.body };
    } catch (error) {
      throwHttpForIdempotencyError(error);
    }
  }
}

function parseStartInput(body: unknown, headerKey: string | undefined): StartTeamRunInput {
  if (!body || typeof body !== 'object') throw new BadRequestException('请求体无效');
  const value = body as Record<string, unknown>;
  const idempotencyKey = typeof value.idempotencyKey === 'string' ? value.idempotencyKey : headerKey;
  if (!idempotencyKey) throw new BadRequestException({ code: 'IDEMPOTENCY_KEY_REQUIRED', message: '缺少 Idempotency-Key' });
  return {
    leaderAgentId: typeof value.leaderAgentId === 'string' ? value.leaderAgentId : undefined,
    studentUserId: typeof value.studentUserId === 'string' ? value.studentUserId : null,
    projectId: typeof value.projectId === 'string' ? value.projectId : null,
    tutorSessionId: typeof value.tutorSessionId === 'string' ? value.tutorSessionId : null,
    trigger: typeof value.trigger === 'string' ? value.trigger : undefined,
    context: isRecord(value.context) ? value.context : undefined,
    idempotencyKey,
  };
}

function parseDelegateInput(body: unknown, headerKey: string | undefined): DelegateTaskInput {
  if (!body || typeof body !== 'object') throw new BadRequestException('请求体无效');
  const value = body as Record<string, unknown>;
  const idempotencyKey = typeof value.idempotencyKey === 'string' ? value.idempotencyKey : headerKey;
  if (!idempotencyKey) throw new BadRequestException({ code: 'IDEMPOTENCY_KEY_REQUIRED', message: '缺少 Idempotency-Key' });
  if (typeof value.senderAgentId !== 'string' || typeof value.recipientAgentId !== 'string' || typeof value.taskType !== 'string') {
    throw new BadRequestException('缺少 senderAgentId、recipientAgentId 或 taskType');
  }
  let pblPhase: PblPhase | undefined;
  if (typeof value.pblPhase === 'string') {
    if (!isPblPhase(value.pblPhase)) throw new BadRequestException({ code: 'PBL_PHASE_INVALID', message: 'pblPhase 不在冻结阶段枚举内' });
    pblPhase = value.pblPhase;
  }
  return {
    senderAgentId: value.senderAgentId,
    recipientAgentId: value.recipientAgentId,
    taskType: value.taskType,
    input: isRecord(value.input) ? value.input : undefined,
    parentTaskId: typeof value.parentTaskId === 'string' ? value.parentTaskId : null,
    idempotencyKey,
    maxAttempts: typeof value.maxAttempts === 'number' ? value.maxAttempts : undefined,
    ...(pblPhase !== undefined ? { pblPhase } : {}),
  };
}

function parsePhaseAdvanceInput(body: unknown): { targetPhase: string; trigger?: string } {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new BadRequestException('阶段推进请求体无效');
  const value = body as Record<string, unknown>;
  if (typeof value.targetPhase !== 'string' || !isPblPhase(value.targetPhase)) {
    throw new BadRequestException({ code: 'PBL_PHASE_INVALID', message: 'targetPhase 必须是冻结阶段枚举内的值' });
  }
  const trigger = typeof value.trigger === 'string' ? value.trigger : undefined;
  if ('trigger' in value && trigger === undefined) throw new BadRequestException('trigger 必须是字符串');
  return { targetPhase: value.targetPhase, ...(trigger !== undefined ? { trigger } : {}) };
}

function parseGateInput(body: unknown): { gate: string; evidenceRef?: string; source?: string } {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new BadRequestException('门禁证据请求体无效');
  const value = body as Record<string, unknown>;
  if (typeof value.gate !== 'string' || !value.gate.trim()) {
    throw new BadRequestException({ code: 'PBL_GATE_REQUIRED_MISSING', message: '缺少 gate' });
  }
  return {
    gate: value.gate.trim(),
    ...(typeof value.evidenceRef === 'string' ? { evidenceRef: value.evidenceRef } : {}),
    ...(typeof value.source === 'string' ? { source: value.source } : {}),
  };
}

function requireIdempotencyKey(value: string | undefined): string {
  const key = value?.trim();
  if (!key || key.length > 160) throw new BadRequestException({ code: 'IDEMPOTENCY_KEY_REQUIRED', message: '缺少或无效的 Idempotency-Key' });
  return key;
}

function parseRouteInput(body: unknown, partial: boolean): AgentRouteInput | AgentRouteUpdateInput {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new BadRequestException('路由请求体无效');
  const value = body as Record<string, unknown>;
  const fields = new Set(['fromAgentId', 'toAgentId', 'trigger', 'taskType', 'enabled', 'inputSchema', 'outputSchema']);
  if (Object.keys(value).some((key) => !fields.has(key))) throw new BadRequestException('路由请求包含未知字段');
  const out: AgentRouteUpdateInput = {};
  for (const key of ['fromAgentId', 'toAgentId', 'taskType'] as const) {
    if (key in value) {
      if (typeof value[key] !== 'string' || !value[key].trim() || value[key].length > 160) throw new BadRequestException('路由 Agent 或任务类型无效');
      out[key] = value[key].trim();
    }
  }
  if (!partial && (out.fromAgentId === undefined || out.toAgentId === undefined || out.taskType === undefined)) {
    throw new BadRequestException('创建路由必须提供 fromAgentId、toAgentId 和 taskType');
  }
  if ('trigger' in value) {
    if (value.trigger !== 'delegate' && value.trigger !== 'event' && value.trigger !== 'schedule') throw new BadRequestException('路由触发类型无效');
    out.trigger = value.trigger as AgentRouteTrigger;
  } else if (!partial) {
    out.trigger = 'delegate';
  }
  if ('enabled' in value) {
    if (typeof value.enabled !== 'boolean') throw new BadRequestException('路由 enabled 无效');
    out.enabled = value.enabled;
  }
  for (const key of ['inputSchema', 'outputSchema'] as const) {
    if (key in value) {
      if (value[key] !== null && !isRecord(value[key])) throw new BadRequestException('路由 schema 必须是对象或 null');
      if (value[key] !== null && JSON.stringify(value[key]).length > 64_000) throw new BadRequestException('路由 schema 过大');
      out[key] = value[key] as Record<string, unknown> | null;
    }
  }
  if (partial && Object.keys(out).length === 0) throw new BadRequestException('路由更新至少需要一个字段');
  return out;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
