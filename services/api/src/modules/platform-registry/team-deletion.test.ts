import { test } from 'node:test';
import assert from 'node:assert/strict';
import { adminTeams, adminTeamMembers, type Database } from '@qitu/database';
import type { CurrentUser } from '@qitu/contracts';
import type { AuditWriter } from '../../common/audit/audit.service';
import { PlatformRegistryService } from './platform-registry.service';
import { PlatformRegistryController } from './platform-registry.controller';
import { IdempotencyStore } from '../../common/idempotency/idempotency.service';
import type { IdempotentHandler, IdempotencyResult } from '../../common/idempotency/idempotency.types';

const admin = { id: 'admin-fixture', role: 'admin', displayName: 'Fixture' } as CurrentUser;
const modified = '2026-10-26T12:00:00.000Z';
class ReplayStore extends IdempotencyStore {
  private saved = new Map<string, { hash: string; result: IdempotencyResult<unknown> }>();
  async execute<T>(scope: string, key: string, hash: string, run: IdempotentHandler<T>): Promise<IdempotencyResult<T>> {
    const existing = this.saved.get(scope + key);
    if (existing) {
      assert.equal(existing.hash, hash);
      return { ...existing.result, replayed: true } as IdempotencyResult<T>;
    }
    const result = { ...await run(), replayed: false } as IdempotencyResult<T>;
    this.saved.set(scope + key, { hash, result });
    return result;
  }
}
function fixture() {
  const team = { id: 'team', name: 'Current team', leaderAssistantId: 'assistant', updatedAt: new Date(modified) };
  const state = { team: true, members: true };
  const history = { template: { linkedTeamId: 'team' }, binding: { hash: 'fixed', snapshot: { teamId: 'team', name: 'Frozen team' } }, project: { bindingId: 'binding' } };
  const references = [{ templateId: 'template', templateTitle: 'Course', templateStatus: 'published', templateVersionId: 'version',
    version: 'v1', versionStatus: 'published', linkedInTemplate: true, bindings: [{ id: 'binding', status: 'active', projectCount: 2 }] }];
  const audits: unknown[] = [];
  let failAudit = false;
  const db = {
    transaction: async <T>(run: (tx: unknown) => Promise<T>): Promise<T> => {
      const before = { ...state };
      try { return await run(db); } catch (error) { Object.assign(state, before); throw error; }
    },
    select: () => ({ from: (table: unknown) => ({ where() { return this; },
      for: async () => table === adminTeams && state.team ? [team] : [],
      limit: async () => table === adminTeams && state.team ? [team] : [],
    }) }),
    execute: async () => ({ rows: references }),
    delete: (table: unknown) => ({ where: async () => {
      if (table === adminTeams) state.team = false;
      else if (table === adminTeamMembers) state.members = false;
      else assert.fail('Deletion touched a frozen resource');
    } }),
  };
  const audit = { write: async (entry: unknown, tx: unknown) => {
    assert.equal(tx, db);
    if (failAudit) throw new Error('Audit unavailable');
    audits.push(entry); return 'audit-fixture';
  } } as AuditWriter;
  const service = new PlatformRegistryService(db as unknown as Database, 'live', audit, {} as never);
  return { service, state, history, audits, failAudit() { failAudit = true; } };
}
const status = (expected: number) => (error: unknown) => (error as { getStatus(): number }).getStatus() === expected;

test('a referenced team can be deleted while template, binding and project history remain intact', async () => {
  const h = fixture(); const history = structuredClone(h.history);
  const usage = await h.service.getTeamTemplateUsage(admin, 'team');
  assert.equal(usage.templateCount, 1); assert.equal(usage.bindingCount, 1); assert.equal(usage.projectCount, 2);
  assert.deepEqual(await h.service.deleteTeam(admin, 'team', modified), { success: true, deletedTeamId: 'team' });
  assert.deepEqual(h.state, { team: false, members: false });
  assert.deepEqual(h.history, history);
  assert.equal(h.audits.length, 1);
  assert.match(JSON.stringify(h.audits), /"frozenConfigurationPreserved":true/);
  await assert.rejects(h.service.getTeamTemplateUsage(admin, 'team'), status(404));
});

test('read and delete both require Admin and stale deletions preserve all data', async () => {
  const h = fixture(); const student = { ...admin, role: 'student' } as CurrentUser;
  await assert.rejects(h.service.getTeamTemplateUsage(student, 'team'), status(403));
  await assert.rejects(h.service.deleteTeam(student, 'team'), status(403));
  await assert.rejects(h.service.deleteTeam(admin, 'team', '2026-10-25T12:00:00.000Z'), status(409));
  assert.deepEqual(h.state, { team: true, members: true }); assert.deepEqual(h.audits, []);
});

test('audit failure rolls back team and membership deletion', async () => {
  const h = fixture(); h.failAudit();
  await assert.rejects(h.service.deleteTeam(admin, 'team', modified), /Audit unavailable/);
  assert.deepEqual(h.state, { team: true, members: true }); assert.deepEqual(h.audits, []);
});

test('controller protects relations, validates revisions and replays a confirmed deletion', async () => {
  const h = fixture();
  const auth = { getSession: (token: string) => ({ user: token === 'admin' ? admin : { ...admin, role: 'student' } }) };
  const controller = new PlatformRegistryController(auth as never, h.service, new ReplayStore());
  await assert.rejects(controller.getTeamTemplates(undefined, 'team'), status(401));
  await assert.rejects(controller.getTeamTemplates('qitu_session=student', 'team'), status(403));
  await assert.rejects(controller.deleteTeam('qitu_session=admin', undefined, 'team'), status(400));
  await assert.rejects(controller.deleteTeam('qitu_session=admin', 'delete', 'team', 'bad-revision'), status(400));
  const first = await controller.deleteTeam('qitu_session=admin', 'delete', 'team', JSON.stringify(modified));
  const retry = await controller.deleteTeam('qitu_session=admin', 'delete', 'team', JSON.stringify(modified));
  assert.deepEqual(first, retry); assert.equal(h.audits.length, 1);
});
