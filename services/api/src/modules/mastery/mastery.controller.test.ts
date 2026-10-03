import 'reflect-metadata';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { CurrentUser } from '@qitu/contracts';
import type { AuthService } from '../identity-auth/auth.service';
import { MasteryController } from './mastery.controller';
import type { MasteryReadService } from './mastery.service';

const user: CurrentUser = {
  id: 'student-1',
  email: 'student@example.com',
  displayName: 'student',
  role: 'student',
};
const auth = { getSession: () => ({ user }) } as unknown as AuthService;

function controller() {
  let calls = 0;
  let input: unknown;
  const service = {
    getCurrent: async (_actor: CurrentUser, query: unknown) => {
      calls += 1;
      input = query;
      return { current: [] };
    },
    getTimeline: async (_actor: CurrentUser, query: unknown) => {
      calls += 1;
      input = query;
      return { items: [] };
    },
  } as unknown as MasteryReadService;
  return {
    controller: new MasteryController(service, auth),
    calls: () => calls,
    input: () => input,
  };
}

describe('MasteryController', () => {
  it('查询白名单拒绝服务端字段、未知字段、数组和重复参数', async () => {
    const test = controller();
    for (const query of [
      { score: '1' },
      { approved: 'true' },
      { level: '1' },
      { confidence: '1' },
      { extra: 'x' },
      { knowledgePointId: ['a', 'b'] },
    ]) {
      await assert.rejects(
        () => test.controller.current('qitu_session=test', query),
        (error: unknown) => {
          const http = error as { getStatus(): number; getResponse(): { code: string } };
          assert.equal(http.getStatus(), 400);
          assert.equal(http.getResponse().code, 'MASTERY_INPUT_INVALID');
          return true;
        },
      );
    }
    assert.equal(test.calls(), 0);
  });

  it('timeline 将 cursor 和数值 limit 传到服务层，响应沿用 data envelope', async () => {
    const test = controller();
    const result = await test.controller.timeline('qitu_session=test', {
      knowledgePointId: 'kp',
      cursor: 'event-1',
      limit: '5',
    });
    assert.deepEqual(result, { data: { items: [] } });
    assert.deepEqual(test.input(), { knowledgePointId: 'kp', cursor: 'event-1', limit: 5 });
  });

  it('无会话拒绝，不执行查询', async () => {
    const test = controller();
    await assert.rejects(
      () => test.controller.current(undefined, {}),
      (error: unknown) => {
        assert.equal((error as { getStatus(): number }).getStatus(), 401);
        return true;
      },
    );
    assert.equal(test.calls(), 0);
  });
});
