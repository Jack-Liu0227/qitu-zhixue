import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { adminAssistants, auditLogs, closeDb, createDb, idempotencyKeys, users } from '@qitu/database';
import type { CurrentUser, DirectoryPersonRef } from '@qitu/contracts';
import { eq, sql } from 'drizzle-orm';
import { AuditService, AuditWriter } from '../../common/audit/audit.service';
import { IdempotencyService } from '../../common/idempotency/idempotency.service';
import { AuthService } from '../identity-auth/auth.service';
import { ToolBindingMigrationService } from './tool-binding-migration.service';
import { ToolBindingMigrationController } from './tool-binding-migration.controller';

const url = process.env.QITU_TOOL_MIGRATION_TEST_DATABASE_URL;

test('tool binding migration uses real isolated PostgreSQL transactions, audit and idempotency', { skip: !url && 'Requires an explicitly disposable tool migration fixture database' }, async t => {
  assert.ok(url);
  const parsed = new URL(url);
  assert.ok(['', 'localhost', '127.0.0.1'].includes(parsed.hostname));
  assert.ok(parsed.pathname.startsWith('/qitu_tool_migration_fixture_'), 'Never run this test against a live database');
  if (parsed.searchParams.has('host')) assert.equal(parsed.searchParams.get('host'), '/var/run/postgresql');
  const db = createDb(url);
  const actor: CurrentUser = { id: 'migration-admin-fixture', email: 'admin@fixture.invalid', role: 'admin', displayName: 'Fixture admin' };
  const student: CurrentUser = { id: 'migration-student-fixture', email: 'student@fixture.invalid', role: 'student', displayName: 'Fixture student' };
  const password = randomUUID();
  const passwordHash = createHash('sha256').update(password).digest('hex');
  const identities: DirectoryPersonRef[] = [
    { userId: actor.id, email: actor.email, role: 'admin', displayName: actor.displayName },
    { userId: student.id, email: student.email, role: 'student', displayName: student.displayName },
  ];
  const auth = new AuthService({ allowsDemoLogin: () => false, findUser: async id => identities.find(user => user.userId === id) ?? null,
    findCredentialByEmail: async email => { const user = identities.find(item => item.email === email); return user ? { user, passwordHash } : null; } });
  const service = new ToolBindingMigrationService(db, new AuditService(db));
  const controller = new ToolBindingMigrationController(auth, service, new IdempotencyService(db));
  async function reset() {
    await db.delete(idempotencyKeys);
    await db.delete(auditLogs);
    await db.delete(adminAssistants);
    await db.insert(adminAssistants).values([
      { id: 'migration-a', source: 'user', name: 'A', role: 'Fixture', description: 'Fixture', instructions: 'Fixture', enabledSkills: [],
        toolIds: ['mastery_query', 'learning_plan_advance', 'unrecognized-custom-tool'], mcpServerIds: ['ima-knowledge'], defaults: {} },
      { id: 'migration-b', source: 'user', name: 'B', role: 'Fixture', description: 'Fixture', instructions: 'Fixture', enabledSkills: [],
        toolIds: ['artifact_review', 'knowledge_search'], mcpServerIds: [], defaults: {} },
    ]);
  }
  try {
    await db.insert(users).values([actor, student].map(user => ({ id: user.id, email: user.email, displayName: user.displayName, role: user.role, passwordHash })));
    const adminCookie = `qitu_session=${(await auth.login(actor.email, password)).token}`;
    const studentCookie = `qitu_session=${(await auth.login(student.email, password)).token}`;

    await t.test('non-admin and anonymous requests never reach writes', async () => {
      await reset();
      await assert.rejects(controller.preview(undefined));
      await assert.rejects(controller.preview(studentCookie));
      await assert.rejects(controller.apply(studentCookie, randomUUID(), { revision: 'a'.repeat(64) }));
      assert.equal((await db.select().from(idempotencyKeys)).length, 0);
      assert.equal((await db.select().from(auditLogs)).length, 0);
    });

    await t.test('stale previews cannot overwrite a concurrent binding update', async () => {
      await reset();
      const plan = await service.preview(actor);
      const changed = ['learning_plan_advance', 'mastery_query', 'knowledge_read'];
      await db.update(adminAssistants).set({ toolIds: changed }).where(eq(adminAssistants.id, 'migration-a'));
      await assert.rejects(service.apply(actor, plan.revision), /刷新迁移预览/);
      assert.deepEqual((await db.select().from(adminAssistants).where(eq(adminAssistants.id, 'migration-a')))[0]?.toolIds, changed);
      assert.equal((await db.select().from(auditLogs)).length, 0);
    });

    await t.test('successful migration preserves unrelated fields and writes original bindings in the same audit transaction', async () => {
      await reset();
      const before = await db.select().from(adminAssistants).where(eq(adminAssistants.id, 'migration-a'));
      const result = await service.apply(actor, (await service.preview(actor)).revision);
      assert.equal(result.retiredBindingCount, 2);
      assert.equal(result.auditIds.length, 2);
      const [after] = await db.select().from(adminAssistants).where(eq(adminAssistants.id, 'migration-a'));
      assert.deepEqual(after?.toolIds, ['mastery_query', 'unrecognized-custom-tool']);
      assert.deepEqual(after?.mcpServerIds, before[0]?.mcpServerIds);
      assert.deepEqual(after?.defaults, before[0]?.defaults);
      const logs = await db.select().from(auditLogs);
      assert.equal(logs.every(row => row.action === 'admin.assistant.tools.migrate'), true);
      assert.equal(JSON.stringify(logs).includes('previousToolIds'), true);
      assert.deepEqual(result.remaining.unresolvedToolIds, ['unrecognized-custom-tool']);
    });

    await t.test('audit failure rolls back every assistant update', async () => {
      await reset();
      class FailedAudit extends AuditWriter { async write(): Promise<string> { throw new Error('Fixture audit unavailable'); } }
      const failing = new ToolBindingMigrationService(db, new FailedAudit());
      await assert.rejects(failing.apply(actor, (await failing.preview(actor)).revision), /Fixture audit/);
      assert.deepEqual((await db.select().from(adminAssistants).where(eq(adminAssistants.id, 'migration-a')))[0]?.toolIds,
        ['mastery_query', 'learning_plan_advance', 'unrecognized-custom-tool']);
      assert.equal((await db.select().from(auditLogs)).length, 0);
    });

    await t.test('database readback mismatch is rejected and rolled back', async () => {
      await reset();
      await db.execute(sql`CREATE FUNCTION fixture_keep_tool_ids() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW.tool_ids := OLD.tool_ids; RETURN NEW; END; $$`);
      await db.execute(sql`CREATE TRIGGER fixture_keep_tool_ids BEFORE UPDATE ON admin_assistants FOR EACH ROW EXECUTE FUNCTION fixture_keep_tool_ids()`);
      try {
        await assert.rejects(service.apply(actor, (await service.preview(actor)).revision), /迁移已回滚/);
        assert.equal((await db.select().from(auditLogs)).length, 0);
      } finally {
        await db.execute(sql`DROP TRIGGER fixture_keep_tool_ids ON admin_assistants`);
        await db.execute(sql`DROP FUNCTION fixture_keep_tool_ids()`);
      }
    });

    await t.test('concurrent plans serialize; one applies and the other observes the new revision', async () => {
      await reset();
      const revision = (await service.preview(actor)).revision;
      const results = await Promise.allSettled([service.apply(actor, revision), service.apply(actor, revision)]);
      assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
      assert.equal((await db.select().from(auditLogs)).length, 2);
    });

    await t.test('idempotent PATCH replay returns the same receipt without repeated updates or audit', async () => {
      await reset();
      const { revision } = (await controller.preview(adminCookie)).data;
      const key = randomUUID();
      const first = await controller.apply(adminCookie, key, { revision });
      const replay = await controller.apply(adminCookie, key, { revision });
      assert.deepEqual(replay, first);
      assert.equal((await db.select().from(auditLogs)).length, 2);
      await assert.rejects(controller.apply(adminCookie, randomUUID(), { revision, toolIds: [] }));
    });
  } finally { await closeDb(db); }
});
