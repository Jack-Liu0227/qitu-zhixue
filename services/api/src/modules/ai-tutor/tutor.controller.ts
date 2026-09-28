import {
  Body,
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
import type { StreamedTutorEvent } from './tutor.service';

const SESSION_COOKIE = 'qitu_session';

/** 未绑定项目时的演示项目 id（与前端 fixture 回退保持一致）。 */
const DEFAULT_PROJECT_ID = 'project-demo-001';

interface StreamBody {
  projectId?: unknown;
  sessionId?: unknown;
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
 * 两个「工作」端点，安全边界完全一致：
 * - `GET  /api/v1/tutor/session?projectId=`  取回会话历史与游标。
 * - `POST /api/v1/tutor/stream`              流式执行一轮（SSE）。
 *
 * 另外提供契约文档中 REST 风格的等价路由（`/tutor/sessions…`），
 * 两者共用同一个 `TutorService`，不存在第二套逻辑。
 *
 * 权限：只有 `student` 角色可以调用；对象级校验在服务端完成（`qitu_session`
 * 是 httpOnly cookie，前端拿不到也不应拿得到 token）。
 */
@Controller('tutor')
export class TutorController {
  constructor(
    private readonly authService: AuthService,
    private readonly tutorService: TutorService,
  ) {}

  @Get('session')
  getSession(
    @Headers('cookie') cookieHeader: string | undefined,
    @Query('projectId') projectId?: string,
  ): { data: GetTutorSessionResponse } {
    const actor = this.requireStudent(cookieHeader);
    const record = this.tutorService.getOrCreateSession(projectId ?? DEFAULT_PROJECT_ID, actor.id);
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
  @Post('stream')
  async stream(
    @Body() body: StreamBody,
    @Headers('cookie') cookieHeader: string | undefined,
    @Res() response: Response,
  ): Promise<void> {
    const actor = this.requireStudent(cookieHeader);
    const projectId = typeof body.projectId === 'string' ? body.projectId : DEFAULT_PROJECT_ID;
    // 若请求同时带了 sessionId，也先按归属校验一次：不能借 stream 读到
    // 别人的会话（即使它恰好映射到同一个 projectId）。
    if (typeof body.sessionId === 'string' && body.sessionId.length > 0) {
      this.tutorService.getSession(body.sessionId, actor.id);
    }
    const record = this.tutorService.getOrCreateSession(projectId, actor.id);
    const idempotencyKey =
      typeof body.idempotencyKey === 'string' && body.idempotencyKey.length > 0
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
    } finally {
      if (!aborted && !response.writableEnded) response.end();
    }
  }

  /* ---------------- 契约中 REST 风格的等价路由 ---------------- */

  @Post('sessions')
  createSession(
    @Headers('cookie') cookieHeader: string | undefined,
    @Body() body: { projectId?: unknown; source?: unknown },
  ): { data: CreateTutorSessionResponse } {
    const actor = this.requireStudent(cookieHeader);
    const projectId = typeof body.projectId === 'string' ? body.projectId : undefined;
    const record = this.tutorService.getOrCreateSession(projectId ?? DEFAULT_PROJECT_ID, actor.id);
    return {
      data: {
        sessionId: record.sessionId,
        projectId: record.projectId,
        createdAt: record.createdAt,
        lastSeq: record.lastSeq,
      },
    };
  }

  @Get('sessions/:id')
  getSessionById(
    @Headers('cookie') cookieHeader: string | undefined,
    @Param('id') id: string,
  ): { data: GetTutorSessionResponse } {
    const actor = this.requireStudent(cookieHeader);
    return {
      data: this.tutorService.toSessionResponse(this.tutorService.getSession(id, actor.id)),
    };
  }

  /**
   * 非流式提交：只返回受理确认（`seq` 是本次回合的日志基线）。
   * 真正的回复通过 `POST /tutor/stream` 流式取回——与前端 `submitTurn` 一致。
   */
  @Post('sessions/:id/turns')
  @HttpCode(202)
  submitTurn(
    @Headers('cookie') cookieHeader: string | undefined,
    @Param('id') id: string,
    @Body() _body: { content?: unknown; pedagogicMove?: unknown; optionLabel?: unknown; idempotencyKey?: unknown },
  ): { data: CreateTutorTurnResponse } {
    const actor = this.requireStudent(cookieHeader);
    const record = this.tutorService.getSession(id, actor.id);
    return {
      data: {
        turnId: `${record.sessionId}:pending:${record.lastSeq + 1}`,
        seq: record.lastSeq,
        accepted: true,
      },
    };
  }

  @Get('sessions/:id/summary')
  getSummary(
    @Headers('cookie') cookieHeader: string | undefined,
    @Param('id') id: string,
  ): { data: TutorSessionSummary } {
    const actor = this.requireStudent(cookieHeader);
    return { data: this.tutorService.getSummary(id, actor.id) };
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
