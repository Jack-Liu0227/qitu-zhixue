import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ForbiddenException, ServiceUnavailableException } from '@nestjs/common';
import { ReportingService } from './reporting.service';

test('ReportingService rejects roles outside admin/teacher before touching report storage', async () => {
  let touched = false;
  const service = new ReportingService(
    { select: () => { touched = true; throw new Error('must not query'); } } as never,
    {} as never,
    {} as never,
  );
  // D1（20261018 问题总结助手）：仅管理员与班主任可生成；学生/家长在触碰存储前即被拒。
  await assert.rejects(
    () => service.buildReport({ id: 'student-1', role: 'student' } as never),
    ForbiddenException,
  );
  assert.equal(touched, false);
});

test('ReportingService resolves the teacher scope before aggregation (D1)', async () => {
  const tables: string[] = [];
  let call = 0;
  // 依次对应 admin_assistants → users → mentor_assignments；第三次返回空 = 无 active 班主任分配。
  const rowsFor = (): unknown[] => {
    call += 1;
    if (call === 1) return [{ id: 'feishu-reporting-assistant', enabled: true }];
    if (call === 2) return [{ id: 'student-1', role: 'student' }];
    return [];
  };
  const select = () => ({
    from: (table: unknown) => ({
      where: () => {
        tables.push(String((table as { name?: string })?.name ?? `call-${call}`));
        return rowsFor();
      },
    }),
  });
  const service = new ReportingService({ select } as never, {} as never, {} as never);
  await assert.rejects(
    () => service.buildReport({ id: 'teacher-1', role: 'teacher' } as never),
    (error: unknown) => {
      // 班主任无任何 active 分配时 fail closed；且已查询分配表而非直接放行全局。
      return error instanceof ForbiddenException && /班主任分配/.test(String((error as Error).message));
    },
  );
  assert.ok(tables.length >= 3);
});

test('ReportingService fails closed when database is unavailable', async () => {
  const service = new ReportingService(null, {} as never, {} as never);
  await assert.rejects(
    () => service.buildReport({ id: 'admin-1', role: 'admin' } as never),
    ServiceUnavailableException,
  );
});

test('binding another assistant does not give it reporting access', async () => {
  const service = new ReportingService(null, {} as never, {} as never);
  await assert.rejects(() => service.buildReport({ id: 'admin-1', role: 'admin' } as never, 'assistant-other'), ForbiddenException);
});

