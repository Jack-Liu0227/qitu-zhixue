import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { BadRequestException } from '@nestjs/common';
import type { AnswerInteractiveQuizResponse, CurrentUser } from '@qitu/contracts';
import { AuthService } from '../identity-auth/auth.service';
import { TutorService } from './tutor.service';
import { TutorQuizService } from './tutor-quiz.service';
import { TutorController } from './tutor.controller';

const STUDENT: CurrentUser = {
  id: 'stu-1',
  email: 'stu-1@example.com',
  displayName: '学生一',
  role: 'student',
};

function newController(input: {
  quiz?: TutorQuizService;
  loadSession?: () => Promise<unknown>;
}): { controller: TutorController; answered: Array<{ bodyKey: string; selectedKeys: unknown }> } {
  const answered: Array<{ bodyKey: string; selectedKeys: unknown }> = [];
  const authService = {
    getSession: () => ({ user: STUDENT }),
  } as unknown as AuthService;
  const tutorService = {
    loadSession: input.loadSession ?? (async () => ({
      sessionId: 'session-1',
      projectId: 'project-1',
      explorationId: null,
      source: 'project',
      createdAt: new Date().toISOString(),
      lastSeq: 0,
    })),
  } as unknown as TutorService;
  const quiz = (input.quiz ?? {
    answer: async (
      _actor: CurrentUser,
      _record: unknown,
      _quizId: string,
      payload: { selectedKeys: unknown; idempotencyKey: string },
    ) => {
      answered.push({ bodyKey: payload.idempotencyKey, selectedKeys: payload.selectedKeys });
      return {} as AnswerInteractiveQuizResponse;
    },
  }) as unknown as TutorQuizService;
  return { controller: new TutorController(authService, tutorService, undefined, undefined, quiz), answered };
}

function assertHttpError(promise: Promise<unknown>, status: number, code: string): Promise<void> {
  return promise.then(
    () => assert.fail(`expected HTTP ${status} ${code}, but resolved`),
    (error: unknown) => {
      assert.ok(error instanceof BadRequestException, `expected BadRequestException, got ${String(error)}`);
      const response = (error as BadRequestException).getResponse() as { statusCode?: number; code?: string };
      assert.equal(response.statusCode ?? 400, status);
      assert.equal(response.code, code);
    },
  );
}

describe('TutorController.answerInteractiveQuiz 幂等键契约（A7）', () => {
  test('body.idempotencyKey 必填；无 header 也可作答', async () => {
    const { controller, answered } = newController({});
    const result = await controller.answerInteractiveQuiz(
      'qitu_session=token-1',
      undefined,
      'session-1',
      'quiz-1',
      { selectedKeys: ['B'], idempotencyKey: 'body-key' },
    );
    assert.deepEqual(result, { data: {} });
    assert.deepEqual(answered, [{ bodyKey: 'body-key', selectedKeys: ['B'] }]);
  });

  test('header 与 body 一致时放行', async () => {
    const { controller, answered } = newController({});
    await controller.answerInteractiveQuiz(
      'qitu_session=token-1',
      'body-key',
      'session-1',
      'quiz-1',
      { selectedKeys: ['B'], idempotencyKey: 'body-key' },
    );
    assert.deepEqual(answered, [{ bodyKey: 'body-key', selectedKeys: ['B'] }]);
  });

  test('header 与 body 不一致：400 IDEMPOTENCY_KEY_MISMATCH', async () => {
    const { controller } = newController({});
    await assertHttpError(
      controller.answerInteractiveQuiz(
        'qitu_session=token-1',
        'header-key',
        'session-1',
        'quiz-1',
        { selectedKeys: ['B'], idempotencyKey: 'body-key' },
      ),
      400,
      'IDEMPOTENCY_KEY_MISMATCH',
    );
  });

  test('body 缺失幂等键：400 IDEMPOTENCY_KEY_REQUIRED', async () => {
    const { controller } = newController({});
    await assertHttpError(
      controller.answerInteractiveQuiz(
        'qitu_session=token-1',
        'header-key',
        'session-1',
        'quiz-1',
        { selectedKeys: ['B'] },
      ),
      400,
      'IDEMPOTENCY_KEY_REQUIRED',
    );
  });
});
