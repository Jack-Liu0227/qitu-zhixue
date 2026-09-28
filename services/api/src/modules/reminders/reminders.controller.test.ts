import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import type { CurrentUser, SetReminderPreferenceRequest } from '@qitu/contracts';
import type { AuthService } from '../identity-auth/auth.service';
import { RemindersController } from './reminders.controller';
import type { ReminderService } from './reminder.service';

/**
 * 提醒控制器边界验证（ISSUE-T2）。
 *
 * 重点：客户端**不能**提交模板 / 触发源 / 触发原因；写接口必须带
 * `Idempotency-Key`；非学生角色一律 403。
 */

const COOKIE = 'qitu_session=tok';

function fakeAuth(user: CurrentUser): AuthService {
  return {
    getSession: () => ({ user, token: 'tok' }) as never,
  } as unknown as AuthService;
}

function student(): CurrentUser {
  return { id: 'stu-a', email: 'x@example.com', displayName: '学生', role: 'student' };
}

interface Calls {
  list: string[];
  dismiss: Array<[string, string, string]>;
  preference: Array<[string, SetReminderPreferenceRequest, string]>;
}

function recordingService() {
  const calls: Calls = { list: [], dismiss: [], preference: [] };
  const service = {
    listForStudent: async (studentId: string) => {
      calls.list.push(studentId);
      return { reminders: [], deliveryEnabled: false, optedOut: false };
    },
    dismiss: async (studentId: string, id: string, key: string) => {
      calls.dismiss.push([studentId, id, key]);
      return { reminderId: id, dismissedAt: '2025-01-01T00:00:00.000Z' };
    },
    setPreference: async (
      studentId: string,
      request: SetReminderPreferenceRequest,
      key: string,
    ) => {
      calls.preference.push([studentId, request, key]);
      return { optedOut: request.optedOut, updatedAt: '2025-01-01T00:00:00.000Z' };
    },
  } as unknown as ReminderService;
  return { service, calls };
}

test('客户端提交的 templateId / source / trigger 被白名单丢弃', async () => {
  const { service, calls } = recordingService();
  const controller = new RemindersController(service, fakeAuth(student()));

  await controller.setPreference(COOKIE, 'key-1', {
    optedOut: true,
    templateId: 'learning_stall_take_break',
    source: 'learning_progress_stall',
    trigger: 'emotion',
    title: '伪造标题',
    reminderId: 'forged',
  });

  assert.deepEqual(calls.preference, [['stu-a', { optedOut: true }, 'key-1']]);
  assert.deepEqual(Object.keys(calls.preference[0]![1]), ['optedOut']);
});

test('写接口缺少 Idempotency-Key：400 + 稳定错误码', async () => {
  const { service } = recordingService();
  const controller = new RemindersController(service, fakeAuth(student()));

  for (const call of [
    () => controller.setPreference(COOKIE, undefined, { optedOut: true }),
    () => controller.dismiss(COOKIE, undefined, 'reminder-1'),
  ]) {
    await assert.rejects(call(), (error: unknown) => {
      assert.ok(error instanceof BadRequestException);
      assert.equal((error.getResponse() as { code: string }).code, 'IDEMPOTENCY_KEY_REQUIRED');
      return true;
    });
  }
});

test('非学生角色：403，且不触碰服务层', async () => {
  const { service, calls } = recordingService();
  const teacher: CurrentUser = {
    id: 't-1',
    email: 't@example.com',
    displayName: '班主任',
    role: 'teacher',
  };
  const controller = new RemindersController(service, fakeAuth(teacher));

  await assert.rejects(() => controller.list(COOKIE), ForbiddenException);
  assert.equal(calls.list.length, 0);
});

test('学生读取：作用域来自会话，而非请求参数', async () => {
  const { service, calls } = recordingService();
  const controller = new RemindersController(service, fakeAuth(student()));
  const response = await controller.list(COOKIE);
  assert.deepEqual(calls.list, ['stu-a']);
  assert.equal(response.data.deliveryEnabled, false);
});
