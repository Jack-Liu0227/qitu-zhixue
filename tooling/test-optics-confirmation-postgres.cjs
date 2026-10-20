// Disposable PostgreSQL confirmation test. No provider calls or mastery/stage injection.
const assert = require('node:assert/strict');
const { createRequire } = require('node:module');
const { resolve, dirname } = require('node:path');
const { readFileSync, writeFileSync } = require('node:fs');
const root = resolve(__dirname, '..');
const url = new URL(process.env.DATABASE_URL ?? 'postgresql://invalid/invalid');
const dbName = decodeURIComponent(url.pathname.slice(1));
assert.equal(process.env.QITU_DISPOSABLE_FIXTURE, 'yes');
assert.equal(process.env.QITU_DATA_MODE, 'test');
assert.equal(process.env.NODE_ENV, 'test');
assert.equal(url.hostname, '127.0.0.1');
assert.equal(url.username, 'postgres');
assert.equal(url.password, '');
assert.match(dbName, /^qitu_optics_flow_20261021_[0-9]{10,17}$/);
assert.ok(Number(url.port) >= 1024 && Number(url.port) <= 65535);
const reportPath = resolve(process.env.QITU_FIXTURE_REPORT ?? resolve(root, '..', `${dbName}.json`));
assert.equal(dirname(reportPath), resolve(root, '..'), 'report must be outside the source worktree');
const dist = resolve(root, 'services/api/.tmp/optics-confirmation-pg-dist');
const req = createRequire(resolve(root, 'services/api/package.json'));
const mod = path => req(resolve(dist, path));
const { Pool } = req('pg');
const { migrate } = req('drizzle-orm/node-postgres/migrator');
const schema = req('@qitu/database');
const { NestFactory } = req('@nestjs/core');
process.env.REDIS_URL = '';
process.env.QITU_PROJECT_ROOT = root;
delete process.env.PGPASSWORD;
const adminUrl = new URL(url); adminUrl.pathname = '/postgres';
const administration = new Pool({ connectionString: adminUrl.toString(), connectionTimeoutMillis: 10000 });
let created = false, migrationDb, app, appDb;
const report = { fixture: 'real-postgresql-synthetic-catalog-no-provider-or-mastery-injection', databaseName: dbName,
  startedAt: new Date().toISOString(), checks: [], cleanup: { databaseDropped: false }, passed: false };
function check(name) { report.checks.push(name); console.log(`PASS ${name}`); }
async function counts(client) {
  const result = await client.query(`SELECT (SELECT count(*) FROM projects)::int projects,
    (SELECT count(*) FROM project_binding_snapshots)::int snapshots,
    (SELECT count(*) FROM learning_plans)::int plans,
    (SELECT count(*) FROM learning_sessions)::int sessions,
    (SELECT count(*) FROM mastery_objective_mappings)::int mappings`);
  return result.rows[0];
}
(async () => {
  const existing = await administration.query('SELECT 1 FROM pg_database WHERE datname=$1', [dbName]);
  assert.equal(existing.rowCount, 0, 'fixture requires a brand new database');
  await administration.query(`CREATE DATABASE "${dbName}"`); created = true;
  migrationDb = schema.createDb(url.toString());
  await migrate(migrationDb, { migrationsFolder: resolve(root, 'database/migrations') });
  const journal = JSON.parse(readFileSync(resolve(root, 'database/migrations/meta/_journal.json'), 'utf8'));
  assert.ok(journal.entries.some(entry => entry.tag === '0045_learning_session_progress'));
  report.migrations = journal.entries.map(entry => entry.tag);
  check('all-journal-migrations-including-0044-and-0045');
  const users = [
    { id: 'optics-fixture-admin', role: 'admin', displayName: 'Synthetic administrator' },
    { id: 'optics-fixture-student', role: 'student', displayName: 'Synthetic learner' },
    { id: 'optics-fixture-other', role: 'student', displayName: 'Synthetic other learner' },
  ];
  await migrationDb.insert(schema.users).values(users.map(user => ({ ...user,
    email: `${user.id}@example.invalid`, passwordHash: 'fixture-disabled-login' })));
  await schema.closeDb(migrationDb); migrationDb = undefined;
  app = await NestFactory.createApplicationContext(mod('app.module.js').AppModule, { logger: ['error', 'warn'], abortOnError: false });
  appDb = app.get(mod('database/index.js').DATABASE_TOKEN);
  check('AppModule-Nest-starts-with-real-PostgreSQL');
  const { OPTICS_16_COMPLETION_TEMPLATE_SPEC, OPTICS_PHASES } = req('@qitu/ai-client/quiz-bank');
  const teaching = mod('modules/templates/teaching-bundle.test-fixture.js').opticsTeachingFixture(OPTICS_16_COMPLETION_TEMPLATE_SPEC);
  const admin = { ...users[0], email: 'optics-fixture-admin@example.invalid' };
  const student = { ...users[1], email: 'optics-fixture-student@example.invalid' };
  const registry = app.get(mod('modules/platform-registry/platform-registry.service.js').PlatformRegistryService);
  await registry.listAssistants();
  const teamVersionId = 'optics-fixture-frozen-team';
  await appDb.insert(schema.adminTeams).values({ id: teaching.teamId, name: 'Synthetic optics team', leaderAssistantId: teaching.leaderAssistantId }).onConflictDoNothing();
  await appDb.insert(schema.adminTeamVersions).values({ id: teamVersionId, teamId: teaching.teamId, version: 1,
    name: 'Synthetic optics team', leaderAssistantId: teaching.leaderAssistantId,
    members: teaching.members.map(member => ({ ...member, role: 'coach', roleLabel: 'Synthetic coach' })),
    pblSpec: { phases: OPTICS_PHASES }, enabled: true });
  const bindingStore = app.get(mod('modules/templates/templates-binding.store.js').TemplateBindingStore);
  const bindings = app.get(mod('modules/templates/templates-binding.service.js').TemplateBindingService);
  // Synthetic runtime catalog affects only isolated configuration compilation; it grants no learner facts.
  Object.assign(bindings, { bundleCatalog: teaching.catalog });
  const bootstrap = await mod('scripts/optics-template-bootstrap.js').runOpticsTemplateBootstrap({
    governance: app.get(mod('modules/templates/templates-governance.service.js').TemplateGovernanceService), bindings,
    templates: app.get(mod('modules/templates/templates.store.js').TemplateStore), bindingStore,
  }, { actor: admin, teamVersionId, pilotReason: 'Disposable PostgreSQL confirmation fixture', teachingBundle: teaching.draft });
  report.templateVersionId = bootstrap.versionId;
  check('v3-template-pilot-binding-compile-validate-activate');
  const projects = app.get(mod('modules/projects/projects.service.js').ProjectsService);
  const plans = app.get(mod('modules/learning-plan/learning-plan.service.js').LearningPlanService);
  const learningStore = app.get(mod('modules/learning-plan/learning-plan.store.js').LearningPlanStore);
  const tutor = app.get(mod('modules/ai-tutor/tutor.service.js').TutorService);
  const progress = app.get(mod('modules/learning-plan/learning-session-progress.service.js').LearningSessionProgressService);
  const inspection = new Pool({ connectionString: url.toString() });
  try {
    const newExploration = async key => {
      const exploration = await projects.createExploration(student.id, { source: 'recommended', templateVersionId: bootstrap.versionId }, `explore:${key}`);
      await projects.updateIntentDraft(student.id, exploration.id, { goalUser: `Synthetic inquiry ${key}`, coreInterests: ['optics'], preferredForm: 'Evidence report', targetBeneficiary: 'Synthetic learning group' });
      return exploration.id;
    };
    const firstExploration = await newExploration('first');
    assert.equal((await counts(inspection)).projects, 0);
    assert.equal((await counts(inspection)).plans, 0);
    check('exploration-before-confirmation-has-no-formal-project-or-plan');
    const confirmed = await projects.confirmIntent(student.id, firstExploration, 'confirm:first', {});
    const projectId = confirmed.project.id;
    const activePlans = (await learningStore.listPlansByStudent(student.id)).filter(plan => plan.projectId === projectId);
    assert.equal(activePlans.length, 1);
    const plan = activePlans[0];
    assert.equal(plan.status, 'active'); assert.ok(plan.confirmedAt); assert.equal(plan.projectId, projectId); assert.equal(plan.templateVersion, bootstrap.versionId);
    const bundle = await learningStore.findBundle(plan.id);
    assert.equal(bundle.sessions.length, 16);
    const frozen = await bindings.findFrozenSnapshotForProject(projectId, bootstrap.versionId);
    assert.equal(frozen.backfilled, false); assert.equal(frozen.teamVersionId, teamVersionId); assert.match(frozen.bundleDigest, /^[a-f0-9]{64}$/);
    const context = await tutor.getProjectContext(projectId, student.id);
    assert.equal(context.lesson.lessonIndex, 1); assert.equal(context.lesson.planId, plan.id);
    assert.equal(context.lesson.learningSessionId, `${plan.id}:optics-v3-session-1`);
    assert.equal(context.lesson.planRevision, plan.version);
    check('confirmIntent-freezes-and-attaches-active-sixteen-session-plan-before-first-Tutor-read');
    const again = await projects.confirmIntent(student.id, firstExploration, 'confirm:first', {});
    const secondKey = await projects.confirmIntent(student.id, firstExploration, 'confirm:first:other-key', {});
    assert.equal(again.project.id, projectId); assert.equal(secondKey.project.id, projectId);
    assert.equal((await counts(inspection)).plans, 1);
    check('confirmation-same-and-different-key-replay-does-not-create-second-plan');
    const initialProgress = await progress.readProgress(student, plan.id);
    assert.equal(initialProgress.completedCount, 0); assert.equal(initialProgress.contractReady, true);
    await assert.rejects(progress.complete(student, plan.id, context.lesson.learningSessionId, { projectId, planRevision: plan.version, evidenceRefs: [] }, 'no-evidence'),
      error => error.getResponse().code === 'LEARNING_SESSION_REQUIREMENTS_UNMET');
    await assert.rejects(tutor.getProjectContext(projectId, users[2].id));
    check('first-lesson-remains-uncompleted-without-evidence-and-denies-other-student');
    const failingExploration = await newExploration('rollback');
    const before = await counts(inspection);
    const originalAttach = plans.attachConfirmedProjectPlan.bind(plans);
    let attemptedProject;
    plans.attachConfirmedProjectPlan = async (project, tx) => {
      attemptedProject = project.id;
      await originalAttach(project, tx);
      throw new Error('SYNTHETIC_FAILURE_AFTER_FREEZE_AND_PLAN_INSERT');
    };
    try {
      await assert.rejects(projects.confirmIntent(student.id, failingExploration, 'confirm:rollback', {}), /SYNTHETIC_FAILURE_AFTER_FREEZE_AND_PLAN_INSERT/);
    } finally { plans.attachConfirmedProjectPlan = originalAttach; }
    assert.deepEqual(await counts(inspection), before);
    assert.equal(await learningStore.findProject(attemptedProject), null);
    assert.equal(await bindingStore.findSnapshot(attemptedProject), null);
    const failedDraft = await projects.getExploration(student.id, failingExploration);
    assert.equal(failedDraft.status, 'awaiting_confirmation'); assert.equal(failedDraft.intentDraft.confirmedAt, null);
    const attachedAudit = await inspection.query("SELECT count(*)::int n FROM audit_logs WHERE action='learning_plan.attach_confirmed_project' AND detail->>'projectId'=$1", [attemptedProject]);
    assert.equal(attachedAudit.rows[0].n, 0);
    check('failure-after-freeze-and-plan-insert-rolls-back-project-snapshot-plan-sessions-mappings-and-attach-audit');
    const retry = await projects.confirmIntent(student.id, failingExploration, 'confirm:rollback', {});
    assert.ok(retry.project.id); assert.notEqual(retry.project.id, attemptedProject);
    check('failed-confirmation-retries-with-original-idempotency-key');
    const concurrentExploration = await newExploration('concurrent');
    const concurrent = await Promise.all([
      projects.confirmIntent(student.id, concurrentExploration, 'confirm:concurrent:1', {}),
      projects.confirmIntent(student.id, concurrentExploration, 'confirm:concurrent:2', {}),
    ]);
    assert.equal(concurrent[0].project.id, concurrent[1].project.id);
    assert.equal((await learningStore.listPlansByStudent(student.id)).filter(item => item.projectId === concurrent[0].project.id).length, 1);
    check('concurrent-confirmations-have-one-project-one-plan');
    const generated = await plans.generatePlan(student, { interest: 'Synthetic confirmPlan alternative', lessonCount: 16, lessonMinutes: 60,
      curriculumSlug: mod('modules/templates/content/optics.js').OPTICS_16_COMPLETION_TEMPLATE_SLUG });
    assert.equal(generated.plan.projectId, null);
    const planConfirmation = await plans.confirmPlan(student, generated.plan.id, 'plan:confirm', {});
    const planContext = await tutor.getProjectContext(planConfirmation.project.id, student.id);
    assert.equal(planContext.lesson.planId, generated.plan.id); assert.equal(planContext.lesson.lessonIndex, 1);
    assert.equal((await plans.confirmPlan(student, generated.plan.id, 'plan:confirm', {})).project.id, planConfirmation.project.id);
    check('confirmPlan-alternative-freezes-same-governed-curriculum-and-replays');
    const orphans = await inspection.query(`SELECT
      (SELECT count(*) FROM learning_plans p LEFT JOIN projects x ON x.id=p.project_id WHERE p.status='active' AND (x.id IS NULL OR p.confirmed_at IS NULL))::int plans,
      (SELECT count(*) FROM project_binding_snapshots s LEFT JOIN projects p ON p.id=s.project_id WHERE p.id IS NULL)::int snapshots,
      (SELECT count(*) FROM learning_sessions s LEFT JOIN learning_plans p ON p.id=s.plan_id WHERE p.id IS NULL)::int sessions,
      (SELECT count(*) FROM mastery_records)::int mastery_records,
      (SELECT count(*) FROM mastery_events)::int mastery_events`);
    assert.deepEqual(orphans.rows[0], { plans: 0, snapshots: 0, sessions: 0, mastery_records: 0, mastery_events: 0 });
    report.finalCounts = await counts(inspection); report.orphans = orphans.rows[0];
    check('no-orphan-or-injected-mastery-facts');
    report.passed = true;
  } finally { await inspection.end(); }
})().catch(error => {
  report.error = { name: error.name, message: error.message, code: error.code ?? error.getResponse?.().code ?? null };
  console.error(error); process.exitCode = 1;
}).finally(async () => {
  try {
    if (app) await app.close();
    if (!app && appDb) await schema.closeDb(appDb);
    if (migrationDb) await schema.closeDb(migrationDb);
    if (created) {
      await administration.query(`DROP DATABASE "${dbName}" WITH (FORCE)`);
      report.cleanup.databaseDropped = true;
    }
  } catch (error) {
    report.cleanup.error = error.message; process.exitCode = 1;
    if (created && !report.cleanup.databaseDropped) {
      try { await administration.query(`DROP DATABASE \"${dbName}\" WITH (FORCE)`); report.cleanup.databaseDropped = true; }
      catch (dropError) { report.cleanup.dropError = dropError.message; }
    }
  }
  await administration.end();
  report.finishedAt = new Date().toISOString();
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ passed: report.passed, checks: report.checks.length, databaseDropped: report.cleanup.databaseDropped, reportPath }));
});
