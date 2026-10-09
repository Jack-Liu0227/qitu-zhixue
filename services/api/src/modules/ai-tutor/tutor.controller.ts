import {
  Body,
  BadRequestException,
  Controller,
  ForbiddenException,
  Get,
  Headers,
  HttpCode,
  Param,
  Post,
  Query,
  Res,
  UnauthorizedException,
  Optional,
} from '@nestjs/common';
import type { Response } from 'express';
import type {
  CreateTutorSessionResponse,
  CreateTutorTurnResponse,
  GetTutorSessionResponse,
  PedagogicMove,
  TutorProjectContext,
  TutorSessionSummary,
} from '@qitu/contracts';
import { AuthService } from '../identity-auth/auth.service';
import { TutorService } from './tutor.service';
import { TutorWorkspaceService } from './tutor-workspace.service';
import { TeamRuntimeService, teamFrameName, type TeamStreamFrame } from '../team-runtime/team-runtime.service.js';
import type { StreamedTutorEvent } from './tutor.service';

const SESSION_COOKIE = 'qitu_session';

interface StreamBody {
  projectId?: unknown;
  sessionId?: unknown;
  explorationId?: unknown;
  content?: unknown;
  pedagogicMove?: unknown;
  optionLabel?: unknown;
  idempotencyKey?: unknown;
}

const MOVES = new Set<PedagogicMove>([
  'hint',
  'scaffold',
  'explain',
  'review_work',
  'debug_guide',
  'stall_signal',
]);

/** 每个事件的节流，让「逐步发生」真的看得见。可用环境变量关闭以便测试。 */
const SPEED = Number.parseFloat(process.env.TUTOR_STREAM_SPEED ?? '1');
const DELAY_BY_TYPE: Record<StreamedTutorEvent['event']['type'], number> = {
  tool_call: 180,
  tool_result: 300,
  delta: 35,
  block: 120,
  error: 0,
  done: 0,
};

/**
 * AI搭档 HTTP 接口。
 *
 * - `GET  /api/v1/tutor/session?projectId=&explorationId=` 取回会话历史与游标。
 * - `POST /api/v1/tutor/sessions/:id/stream` 流式执行一轮（SSE）。
 *
 * `/tutor/stream` 仅保留为服务端路由别名，学生端 SDK 不再调用它。
 *
 * 权限：只有 `student` 角色可以调用；对象级校验在服务端完成（`qitu_session`
 * 是 httpOnly cookie，前端拿不到也不应拿得到 token）。
 */
@Controller('tutor')
export class TutorController {
  constructor(
    private readonly authService: AuthService,
    private readonly tutorService: TutorService,
    @Optional() private readonly workspace?: TutorWorkspaceService,
    /**
     * 团队编排流式帧：阶段事件 / 成员委派事件 / 工具调用事件 / 模型思考事件。
     * 可选注入：Team Runtime 未接线时对话流保持原样（fail-closed）。
     */
    @Optional() private readonly teamRuntime?: TeamRuntimeService,
  ) {}

  @Get('templates')
  async listTemplates(
    @Headers('cookie') cookieHeader: string | undefined,
    @Query('q') query?: string,
  ): Promise<{ data: { templates: Array<Record<string, unknown>> } }> {
    const actor = this.requireStudent(cookieHeader);
    const results = this.workspace === undefined
      ? []
      : await this.workspace.searchTemplates({
          studentId: actor.id,
          projectId: null,
          query: typeof query === 'string' ? query : '',
          limit: 24,
        });
    return {
      data: {
        templates: results.map(({ document, score, matchedTerms }) => ({
          id: document.id,
          title: document.title,
          summary: document.summary,
          subject: document.tags[0] ?? '综合创作',
          tags: document.tags,
          difficulty: '入门',
          durationWeeks: durationWeeksOf(document.content),
          stages: [{ id: document.stage, label: stageLabelOf(document.stage) }],
          outcome: document.summary,
          score,
          matchedTerms,
        })),
      },
    };
  }

  @Get('session')
  async getSession(
    @Headers('cookie') cookieHeader: string | undefined,
    @Query('projectId') projectId?: string,
    @Query('explorationId') explorationId?: string,
  ): Promise<{ data: GetTutorSessionResponse }> {
    const actor = this.requireStudent(cookieHeader);
    if (projectId === undefined && explorationId === undefined) {
      throw new BadRequestException({ code: 'TUTOR_CONTEXT_REQUIRED', message: '需要 projectId 或 explorationId' });
    }
    const record = await this.tutorService.resolveSession(
      projectId ?? null,
      actor.id,
      explorationId,
    );
    return { data: this.tutorService.toSessionResponse(record) };
  }

  @Get('project-context')
  getProjectContext(
    @Headers('cookie') cookieHeader: string | undefined,
    @Query('projectId') projectId?: string,
  ): { data: TutorProjectContext | null } {
    const actor = this.requireStudent(cookieHeader);
    return { data: this.tutorService.getProjectContext(projectId, actor.id) };
  }

  /**
   * 流式执行一轮。
   *
   * 使用 Server-Sent Events：一次请求对应一次响应，天然复用 httpOnly 会话
   * cookie 与 nginx 的 `/api/` 代理，不需要第二个协议或第二个鉴权通道。
   *
   * 响应头在写第一帧之前全部设置完毕；401/403 会在 SSE 开始之前以普通
   * JSON 抛出，客户端据此走正常的错误分支而不是「流断了」。
   */
  @Post('sessions/:id/stream')
  async stream(
    @Body() body: StreamBody,
    @Param('id') pathSessionId: string | undefined,
    @Headers('idempotency-key') headerIdempotencyKey: string | undefined,
    @Headers('cookie') cookieHeader: string | undefined,
    @Res() response: Response,
  ): Promise<void> {
    const actor = this.requireStudent(cookieHeader);
    const projectId = typeof body.projectId === 'string' ? body.projectId : null;
    const requestedSessionId = typeof body.sessionId === 'string' && body.sessionId.length > 0
      ? body.sessionId
      : pathSessionId;
    const explorationId = typeof body.explorationId === 'string' ? body.explorationId : undefined;
    if (requestedSessionId === undefined && projectId === null && explorationId === undefined) {
      throw new BadRequestException({ code: 'TUTOR_CONTEXT_REQUIRED', message: '需要 sessionId、projectId 或 explorationId' });
    }
    const record = requestedSessionId !== undefined
      ? await this.tutorService.loadSession(requestedSessionId, actor.id)
      : await this.tutorService.resolveSession(projectId, actor.id, explorationId);
    const idempotencyKey =
      typeof headerIdempotencyKey === 'string' && headerIdempotencyKey.trim().length > 0
        ? headerIdempotencyKey.trim()
        : typeof body.idempotencyKey === 'string' && body.idempotencyKey.length > 0
          ? body.idempotencyKey
          : `${record.sessionId}:${record.lastSeq + 1}`;

    response.status(200);
    response.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    response.setHeader('Cache-Control', 'no-cache, no-transform');
    response.setHeader('Connection', 'keep-alive');
    // nginx 默认会缓冲代理响应，这会让「流式」变成「一次性吐出来」。
    response.setHeader('X-Accel-Buffering', 'no');
    response.flushHeaders();

    let aborted = false;
    response.on('close', () => {
      aborted = true;
    });

    const turnId = `live-${record.sessionId}-${record.lastSeq + 1}`;
    const streamStartedAt = new Date();
    let lastStreamedSeq = record.lastSeq;
    // The service owns `seq`; it yields each event already numbered so the
    // student turn, every step and the assistant turn never collide.

    try {
      for await (const streamed of this.tutorService.runTurn(record, {
        actorId: actor.id,
        idempotencyKey,
        ...(typeof body.content === 'string' ? { content: body.content } : {}),
        ...(isMove(body.pedagogicMove) ? { pedagogicMove: body.pedagogicMove } : {}),
        ...(typeof body.optionLabel === 'string' ? { optionLabel: body.optionLabel } : {}),
      })) {
        if (aborted) break;
        lastStreamedSeq = streamed.seq;
        writeFrame(response, streamed, { sessionId: record.sessionId, turnId });
        await delay(DELAY_BY_TYPE[streamed.event.type]);
      }
    } catch (error) {
      // Headers are already sent, so the only honest failure signal left is an
      // SSE `error` frame — the client maps it onto `safety.block` and offers a
      // retry instead of an infinite spinner.
      if (!aborted && !response.writableEnded) {
        writeRawFrame(response, 'error', {
          sessionId: record.sessionId,
          turnId,
          seq: record.lastSeq,
          timestamp: new Date().toISOString(),
          message: error instanceof Error ? error.message : 'AI搭档暂时不可用',
        });
      }
    }

    // 团队编排事件帧：阶段推进 / 门禁拒绝 / 成员委派 / 工具调用 / 模型思考。
    // 只携带服务端脱敏后的元数据（frameId / runId / phase / taskType 等），
    // 不含未成年人原文；seq 沿用本回合末端游标，不占用回合序号。
    if (!aborted && !response.writableEnded && this.teamRuntime !== undefined) {
      try {
        const frames = await this.teamRuntime.listSessionStreamFrames(
          { id: actor.id, email: '', displayName: '', role: 'student' },
          record.sessionId,
          { since: streamStartedAt },
        );
        let frameIndex = 0;
        for (const frame of frames) {
          if (aborted || response.writableEnded) break;
          frameIndex += 1;
          writeTeamFrame(response, frame, {
            sessionId: record.sessionId,
            turnId,
            seq: lastStreamedSeq,
            frameSeq: frameIndex,
          });
        }
      } catch {
        // Team Runtime 故障不能把正常的学生对话流变成错误流。
      }
    }
    if (!aborted && !response.writableEnded) response.end();
  }

  /* ---------------- 契约中 REST 风格的等价路由 ---------------- */

  @Post('sessions')
  async createSession(
    @Headers('cookie') cookieHeader: string | undefined,
    @Body() body: { projectId?: unknown; explorationId?: unknown; source?: unknown },
  ): Promise<{ data: CreateTutorSessionResponse }> {
    const actor = this.requireStudent(cookieHeader);
    const projectId = typeof body.projectId === 'string' ? body.projectId : undefined;
    const explorationId = typeof body.explorationId === 'string' ? body.explorationId : undefined;
    const source = body.source === 'project' || body.source === 'exploration'
      ? body.source
      : projectId === undefined ? 'exploration' : 'project';
    if (source === 'project' && (projectId === undefined || explorationId !== undefined)) {
      throw new BadRequestException({ code: 'TUTOR_PROJECT_CONTEXT_REQUIRED', message: '项目会话必须只提供经授权的 projectId' });
    }
    if (source === 'exploration' && (explorationId === undefined || projectId !== undefined)) {
      throw new BadRequestException({ code: 'TUTOR_EXPLORATION_CONTEXT_REQUIRED', message: '探索会话必须只提供已创建的 explorationId' });
    }
    const record = await this.tutorService.resolveSession(projectId ?? null, actor.id, explorationId);
    return {
      data: {
        sessionId: record.sessionId,
        projectId: record.projectId,
        explorationId: record.explorationId ?? null,
        source: record.source,
        createdAt: record.createdAt,
        lastSeq: record.lastSeq,
        context: {
          kind: record.source,
          label: record.source === 'exploration' ? '自由探索' : '项目学习',
          status: record.source === 'exploration' ? 'active' : 'confirmed',
          projectId: record.projectId,
        },
      },
    };
  }

  @Get('sessions/:id')
  async getSessionById(
    @Headers('cookie') cookieHeader: string | undefined,
    @Param('id') id: string,
  ): Promise<{ data: GetTutorSessionResponse }> {
    const actor = this.requireStudent(cookieHeader);
    const record = await this.tutorService.loadSession(id, actor.id);
    return { data: this.tutorService.toSessionResponse(record) };
  }

  /**
   * 非流式提交：只返回受理确认（`seq` 是本次回合的日志基线）。
   * 真正的回复通过 `POST /tutor/sessions/:id/stream` 流式取回——与前端 `submitTurn` 一致。
   */
  @Post('sessions/:id/turns')
  @HttpCode(202)
  async submitTurn(
    @Headers('cookie') cookieHeader: string | undefined,
    @Param('id') id: string,
    @Body() _body: { content?: unknown; pedagogicMove?: unknown; optionLabel?: unknown; idempotencyKey?: unknown },
  ): Promise<{ data: CreateTutorTurnResponse }> {
    const actor = this.requireStudent(cookieHeader);
    const record = await this.tutorService.loadSession(id, actor.id);
    return {
      data: {
        turnId: `${record.sessionId}:pending:${record.lastSeq + 1}`,
        seq: record.lastSeq,
        accepted: true,
      },
    };
  }

  @Get('sessions/:id/summary')
  async getSummary(
    @Headers('cookie') cookieHeader: string | undefined,
    @Param('id') id: string,
  ): Promise<{ data: TutorSessionSummary }> {
    const actor = this.requireStudent(cookieHeader);
    const record = await this.tutorService.loadSession(id, actor.id);
    return { data: this.tutorService.toSummary(record) };
  }

  /* ------------------------------ 内部 ------------------------------ */

  private requireStudent(cookieHeader: string | undefined): { id: string } {
    const token = readCookie(cookieHeader, SESSION_COOKIE);
    if (token === undefined) throw new UnauthorizedException('请先登录');
    const session = this.authService.getSession(token);
    if (session.user.role !== 'student') {
      throw new ForbiddenException('AI搭档仅向学生开放');
    }
    return session.user;
  }
}

function durationWeeksOf(content: string): number {
  return /8\s*周计划/.test(content) ? 8 : 4;
}

function stageLabelOf(stage: string): string {
  const labels: Record<string, string> = {
    exploration: '探索与发现',
    intent_confirmed: '意图确认',
    theory_learning: '理论学习',
    theory_check: '理论检验',
    practice_ready: '实践制作',
    practice_building: '实践制作',
    artifact_review: '成果反思',
    reflection: '成果反思',
    published: '成果展示',
    completed: '已完成',
  };
  return labels[stage] ?? '探索与发现';
}

function isMove(value: unknown): value is PedagogicMove {
  return typeof value === 'string' && MOVES.has(value as PedagogicMove);
}

function readCookie(header: string | undefined, name: string): string | undefined {
  if (header === undefined) return undefined;
  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator === -1) continue;
    if (part.slice(0, separator).trim() !== name) continue;
    const value = part.slice(separator + 1).trim();
    return value.length > 0 ? value : undefined;
  }
  return undefined;
}

/**
 * 写一帧 SSE。
 *
 * 载荷是**扁平**的：`sessionId` / `turnId` / `seq` / `timestamp` 与事件自身
 * 字段处于同一层，与共享的 `RealtimeServerEvent` 信封一致，前端因此不需要
 * 第二套解析逻辑。
 */
function writeFrame(
  response: Response,
  streamed: StreamedTutorEvent,
  envelope: { sessionId: string; turnId: string },
): void {
  writeRawFrame(response, FRAME_NAME[streamed.event.type], {
    ...envelope,
    seq: streamed.seq,
    timestamp: new Date().toISOString(),
    ...toPayload(streamed.event),
  });
}

function writeRawFrame(response: Response, frameName: string, data: unknown): void {
  response.write(`event: ${frameName}\ndata: ${JSON.stringify(data)}\n\n`);
}

/**
 * 写一帧团队事件。沿用 writeRawFrame 机制，帧名取自服务端冻结的
 * `TEAM_FRAME_NAMES`（阶段 / 门禁拒绝 / 委派 / 工具 / 思考），前端因此能
 * 把团队事件与 tutor.* 对话帧区分开。新增/改名帧类型必须同步
 * team-runtime.protocol.test.ts 的断言。
 */
function writeTeamFrame(
  response: Response,
  frame: TeamStreamFrame,
  envelope: { sessionId: string; turnId: string; seq: number; frameSeq: number },
): void {
  writeRawFrame(response, teamFrameName(frame.kind), {
    ...envelope,
    timestamp: frame.occurredAt,
    frameId: frame.frameId,
    ...frame.data,
  });
}

/** Flatten one event onto the shared `RealtimeServerEvent` envelope shape. */
function toPayload(event: StreamedTutorEvent['event']): Record<string, unknown> {
  switch (event.type) {
    case 'tool_call':
      return { callId: event.callId, name: event.name, label: event.label };
    case 'tool_result':
      return { callId: event.callId, status: event.status, result: event.result };
    case 'delta':
      return { text: event.text };
    case 'block':
      return { block: event.block };
    case 'done':
      return { turnSummary: event.turnSummary };
    case 'error':
      // 已脱敏的稳定错误码 + 面向学生的短句；不含密钥或上游正文。
      return { code: event.code, message: event.message, retryable: event.retryable };
  }
}

const FRAME_NAME: Record<StreamedTutorEvent['event']['type'], string> = {
  tool_call: 'tutor.tool_call',
  tool_result: 'tutor.tool_result',
  delta: 'tutor.delta',
  block: 'tutor.block',
  error: 'error',
  done: 'turn.done',
};

function delay(ms: number): Promise<void> {
  const scaled = SPEED > 0 ? Math.round(ms * SPEED) : 0;
  if (scaled <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, scaled));
}
