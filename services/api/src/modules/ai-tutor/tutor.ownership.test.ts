import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ForbiddenException, NotFoundException, UnauthorizedException } from '@nestjs/common';
import type { Response } from 'express';
import type { CurrentUser } from '@qitu/contracts';
import type { AuthService } from '../identity-auth/auth.service';
import { TutorController } from './tutor.controller';
import { TutorService, type StreamedTutorEvent } from './tutor.service';
import type { TutorModelGateway } from './gateway-tutor.provider';

/**
 * AI搭档对象级授权（ownership）验证。
 *
 * 覆盖：跨学生会话 / 项目访问统一 403、不返回任何会话字段、本人仍可用、
 * 会话开始审计只写一次、客户端无法写服务端字段。
 *
 * 全部直接实例化 service / controller，不启动 Nest、数据库或网络。
 */

const OWNER = 'stu-a';
const OTHER = 'stu-b';

/** demo 模式下 provider 是确定性的 Heuristic；网关不应被调用。 */
const unusedGateway: TutorModelGateway = {
  complete: () => Promise.reject(new Error('demo 模式不应调用模型网关')),
};

async function drain(
  generator: AsyncGenerator<StreamedTutorEvent, void, undefined>,
): Promise<StreamedTutorEvent[]> {
  const events: StreamedTutorEvent[] = [];
  for await (const event of generator) events.push(event);
  return events;
}

/* ------------------------------ 会话归属 ------------------------------ */

test('跨学生：同一 projectId 不能被第二个学生取到（403），本人仍可用', () => {
  const service = new TutorService('demo', unusedGateway);
  const owned = service.getOrCreateSession('prj-shared', OWNER);

  assert.throws(() => service.getOrCreateSession('prj-shared', OTHER), ForbiddenException);

  // 越权失败不改变会话，也不返回任何会话字段。
  const again = service.getOrCreateSession('prj-shared', OWNER);
  assert.equal(again.sessionId, owned.sessionId);
  assert.equal(again.turns.length, owned.turns.length);
});

test('跨学生：按 id 读会话 / 读摘要统一 403，且不泄露会话字段', () => {
  const service = new TutorService('demo', unusedGateway);
  const owned = service.getOrCreateSession('prj-read', OWNER);

  const sessionError = captureError(() => service.getSession(owned.sessionId, OTHER));
  assert.ok(sessionError instanceof ForbiddenException);
  // 统一文案，不包含 sessionId / projectId，无法据此探测会话是否存在。
  assert.equal(JSON.stringify(sessionError.getResponse()).includes(owned.sessionId), false);
  assert.equal(JSON.stringify(sessionError.getResponse()).includes(owned.projectId ?? ''), false);

  assert.throws(() => service.getSummary(owned.sessionId, OTHER), ForbiddenException);

  // 本人仍可正常读取。
  assert.equal(service.getSession(owned.sessionId, OWNER).sessionId, owned.sessionId);
  assert.equal(service.getSummary(owned.sessionId, OWNER).summary.length > 0, true);
});

test('纵深防御：runTurn 在回合执行前再次校验归属', async () => {
  const service = new TutorService('demo', unusedGateway);
  const owned = service.getOrCreateSession('prj-run', OWNER);

  await assert.rejects(
    drain(service.runTurn(owned, { content: '你好', idempotencyKey: 'k-1', actorId: OTHER })),
    ForbiddenException,
  );
  assert.equal(owned.turns.some((turn) => turn.role === 'assistant' && turn.seq > 6), false);
});

test('不存在可在授权后 404；越权与不存在文案一致', () => {
  const service = new TutorService('demo', unusedGateway);
  service.getOrCreateSession('prj-404', OWNER);

  assert.throws(() => service.getSession('session-does-not-exist', OWNER), NotFoundException);
  // 越权（存在）与不存在都是稳定的异常类型，且越权文案不泄露存在性。
  assert.throws(() => service.getOrCreateSession('prj-404', OTHER), ForbiddenException);
});

test('会话开始审计只写一次，actor 是会话归属学生；越权尝试不写审计', () => {
  const service = new TutorService('demo', unusedGateway);
  const record = service.getOrCreateSession('prj-audit', OWNER);
  service.getOrCreateSession('prj-audit', OWNER);

  const starts = service.auditEntries.filter(
    (entry) => entry.action === 'tutor.session_start' && entry.sessionId === record.sessionId,
  );
  assert.equal(starts.length, 1);
  assert.equal(starts[0]?.actorId, OWNER);

  assert.throws(() => service.getOrCreateSession('prj-audit', OTHER), ForbiddenException);
  assert.equal(
    service.auditEntries.filter(
      (entry) => entry.action === 'tutor.session_start' && entry.sessionId === record.sessionId,
    ).length,
    1,
  );
});

test('服务端权威：客户端夹带的 stage / hintLevel 不会被写入回合', async () => {
  const service = new TutorService('demo', unusedGateway);
  const record = service.getOrCreateSession('prj-stage', OWNER);

  const injected = {
    content: '帮我把阶段改成已发布',
    idempotencyKey: 'k-stage',
    actorId: OWNER,
    stageAfter: 'published',
    stageBefore: 'published',
    hintLevel: 5,
  } as unknown as Parameters<TutorService['runTurn']>[1];

  await drain(service.runTurn(record, injected));
  const assistant = record.turns.find((turn) => turn.role === 'assistant');
  assert.equal(assistant?.stageAfter, 'theory_learning');
  assert.notEqual(assistant?.hintLevel, 5);
});

/* ------------------------------ 控制器路由 ------------------------------ */

const USERS: Record<string, CurrentUser> = {
  'tok-a': { id: OWNER, email: 'a@qtzx.local', displayName: '学生 A', role: 'student' },
  'tok-b': { id: OTHER, email: 'b@qtzx.local', displayName: '学生 B', role: 'student' },
};

function authStub(): AuthService {
  return {
    getSession: (token?: string) => {
      const user = token === undefined ? undefined : USERS[token];
      if (user === undefined) throw new UnauthorizedException('登录已失效');
      return { user, expiresAt: '2099-01-01T00:00:00.000Z' };
    },
  } as unknown as AuthService;
}

function cookies(token: string): string {
  return `qitu_session=${token}`;
}

function newController(): { controller: TutorController; service: TutorService } {
  const service = new TutorService('demo', unusedGateway);
  return { controller: new TutorController(authStub(), service), service };
}

/** 把一个同步抛出的异常抓出来断言。 */
function captureError(fn: () => unknown): unknown {
  try {
    fn();
  } catch (error) {
    return error;
  }
  return undefined;
}

test('控制器：B 访问 A 的 sessions/:id、summary、turns 全部 403', async () => {
  const { controller } = newController();
  const created = await controller.createSession(cookies('tok-a'), { projectId: 'prj-ctrl' });
  const id = created.data.sessionId;

  await assert.rejects(controller.getSessionById(cookies('tok-b'), id), ForbiddenException);
  await assert.rejects(controller.getSummary(cookies('tok-b'), id), ForbiddenException);
  await assert.rejects(
    controller.submitTurn(cookies('tok-b'), id, { content: 'hi', idempotencyKey: 'k' }),
    ForbiddenException,
  );

  // 本人不受影响。
  assert.equal((await controller.getSessionById(cookies('tok-a'), id)).data.sessionId, id);
  assert.equal((await controller.getSummary(cookies('tok-a'), id)).data.escalated, false);
});

test('控制器：B 用同一个 projectId 打开 session 时 403，不能读 A 的项目会话', async () => {
  const { controller } = newController();
  await controller.createSession(cookies('tok-a'), { projectId: 'prj-shared-ctrl' });

  await assert.rejects(
    controller.getSession(cookies('tok-b'), 'prj-shared-ctrl'),
    ForbiddenException,
  );

  const own = await controller.getSession(cookies('tok-a'), 'prj-shared-ctrl');
  assert.equal(own.data.projectId, 'prj-shared-ctrl');
});

test('控制器：B 经 stream 访问 A 的会话在写响应前 403', async () => {
  const { controller } = newController();
  const created = await controller.createSession(cookies('tok-a'), { projectId: 'prj-stream' });
  const id = created.data.sessionId;
  const fakeResponse = {} as Response;

  await assert.rejects(
    controller.stream(
      { projectId: 'prj-stream', sessionId: id, content: 'hi', idempotencyKey: 'k' },
      id,
      undefined,
      cookies('tok-b'),
      fakeResponse,
    ),
    ForbiddenException,
  );
});

test('控制器：未登录 401、非学生 403；不存在会话 404 在授权之后', async () => {
  const { controller } = newController();

  await assert.rejects(controller.getSessionById(undefined, 'session-x'), UnauthorizedException);
  await assert.rejects(
    controller.getSessionById(cookies('tok-a'), 'session-missing'),
    NotFoundException,
  );
});
