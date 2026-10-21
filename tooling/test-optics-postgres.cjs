// Disposable integration fixture. Never run against an application database.
const assert = require('node:assert/strict');
const { createRequire } = require('node:module');
const { resolve } = require('node:path');
const { existsSync, readFileSync, writeFileSync } = require('node:fs');
const root = resolve(__dirname, '..');
const url = new URL(process.env.DATABASE_URL ?? 'postgresql://invalid/invalid');
assert.equal(process.env.QITU_DISPOSABLE_FIXTURE, 'yes');
assert.equal(process.env.QITU_DATA_MODE, 'test');
assert.equal(url.hostname, '127.0.0.1');
assert.equal(url.port, '55439');
assert.equal(url.pathname, '/qitu_optics_qa');
const req = createRequire(resolve(root, 'services/api/package.json'));
const report = JSON.parse(readFileSync(resolve(root, 'services/api/.tmp/pbl-capability/verification.json')));
const dist = resolve(root, report.runDirectory, 'dist');
const mod = (path) => req(resolve(dist, path));
const { NestFactory } = req('@nestjs/core');
const { eq } = req('drizzle-orm');
const schema = req('@qitu/database');

(async () => {
  const app = await NestFactory.createApplicationContext(mod('app.module.js').AppModule, { logger: false });
  try {
    const db = app.get(mod('database/index.js').DATABASE_TOKEN);
    const live = mod('modules/templates/teaching-bundle.test-fixture.js').opticsTeachingFixture();
    const { OPTICS_PHASES } = req('@qitu/ai-client/quiz-bank');
    const admin = { id: 'admin-demo', role: 'admin', email: '', displayName: 'Synthetic admin' };
    const student = { id: 'student-demo', role: 'student', email: '', displayName: 'Synthetic learner' };
    const stamp = Date.now();
    const reportPath = process.env.QITU_FIXTURE_REPORT ?? '/tmp/qitu-optics-fixture.json';
    const previous = existsSync(reportPath) ? JSON.parse(readFileSync(reportPath)) : null;
    const bindingStore = app.get(mod('modules/templates/templates-binding.store.js').TemplateBindingStore);
    const active = previous ? await bindingStore.findActiveBinding(previous.templateVersionId) : null;
    const teamVersionId = active?.teamVersionId ?? `qa-team-${stamp}`;
    await db.insert(schema.adminTeams).values({
      id: live.teamId, name: 'Disposable optics team', leaderAssistantId: live.leaderAssistantId,
    }).onConflictDoNothing();
    await db.insert(schema.adminTeamVersions).values({
      id: teamVersionId, teamId: live.teamId, version: Math.floor(stamp / 1000),
      name: 'Disposable optics team', leaderAssistantId: live.leaderAssistantId,
      members: live.members.map((member) => ({ ...member, role: 'coach', roleLabel: 'Synthetic coach' })),
      pblSpec: { phases: OPTICS_PHASES }, enabled: true,
    }).onConflictDoNothing();
    const bindings = app.get(mod('modules/templates/templates-binding.service.js').TemplateBindingService);
    // Explicit synthetic catalog: this test makes no provider/IMA readiness claim.
    Object.assign(bindings, { bundleCatalog: live.catalog });
    const bootstrap = await mod('scripts/optics-template-bootstrap.js').runOpticsTemplateBootstrap({
      governance: app.get(mod('modules/templates/templates-governance.service.js').TemplateGovernanceService),
      bindings, templates: app.get(mod('modules/templates/templates.store.js').TemplateStore),
      bindingStore,
    }, { actor: admin, teamVersionId, pilotReason: 'Disposable fixture', teachingBundle: live.draft });
    const plans = app.get(mod('modules/learning-plan/learning-plan.service.js').LearningPlanService);
    const generated = await plans.generatePlan(student, {
      interest: `Synthetic optics ${stamp}`, lessonCount: 16, lessonMinutes: 60,
      curriculumSlug: mod('modules/templates/content/optics.js').OPTICS_16_TEMPLATE_SLUG,
    });
    assert.equal(generated.plan.projectId, null);
    const confirmed = await plans.confirmPlan(student, generated.plan.id, `qa-confirm-${stamp}`, {});
    const replay = await plans.confirmPlan(student, generated.plan.id, `qa-confirm-${stamp}`, {});
    assert.equal(replay.project.id, confirmed.project.id);
    const projectId = confirmed.project.id;
    const frozen = await bindings.findFrozenSnapshotForProject(projectId, bootstrap.versionId);
    assert.match(frozen.bundleDigest, /^[a-f0-9]{64}$/);
    const tutor = app.get(mod('modules/ai-tutor/tutor.service.js').TutorService);
    const experiments = app.get(mod('modules/ai-tutor/tutor-experiment.service.js').TutorExperimentService);
    const record = await tutor.resolveSession(projectId, student.id);
    const scope = await experiments.scope(projectId, student.id, 11);
    assert.ok(scope);
    const experimentId = `qa-experiment-${stamp}`;
    const turn = {
      turnId: `qa-turn-${stamp}`, role: 'assistant', seq: record.lastSeq + 1,
      createdAt: new Date().toISOString(), modality: 'text', hintLevel: null,
      stageBefore: 'theory_learning', stageAfter: 'theory_learning',
      pedagogicMove: 'explain', expectedEvidence: null, promptVersion: 'disposable-fixture', evidenceRef: null,
      blocks: [{ kind: 'optics_experiment', experimentId, title: 'Disposable simulation',
        initialMode: 'diffraction', specVersion: '1.0.0', objectiveId: 'optics.wave.diffraction',
        sessionIndex: 11, scope, allowedActions: ['submit_prediction', 'run', 'record_observation'],
        predictionGate: { required: true, submitted: false } }],
    };
    await app.get(mod('modules/ai-tutor/tutor-session.store.js').TutorSessionStore).appendTurns({
      sessionId: record.sessionId, expectedLastSeq: record.lastSeq, newLastSeq: turn.seq, turns: [turn],
    });
    record.turns.push(turn);
    record.lastSeq = turn.seq;
    const submit = (action, payload, key = action) => experiments.submit(student.id, record, experimentId, {
      action, payload, idempotencyKey: `qa-${stamp}-${key}`,
    });
    const parameters = { wavelength: 532, slitWidth: 80, screenDistance: 1 };
    await assert.rejects(submit('run', { mode: 'diffraction', parameters }),
      (error) => error.getResponse().code === 'TUTOR_EXPERIMENT_GATE_REQUIRED');
    // Deliberate gate fixture only: this is NOT evidence of learner mastery.
    await db.update(schema.projects).set({ status: 'practice_ready' }).where(eq(schema.projects.id, projectId));
    await submit('submit_prediction', { mode: 'diffraction', hypothesis: 'Synthetic prediction' });
    const run = await submit('run', { mode: 'diffraction', parameters });
    const payload = { mode: 'diffraction', parameters, runActionId: run.actionId, observation: 'Synthetic simulated observation.' };
    const saved = await submit('record_observation', payload);
    assert.equal(saved.observationReceipt.provenance, 'simulated_observation');
    assert.deepEqual(await submit('record_observation', payload), saved);
    await assert.rejects(submit('record_observation', { ...payload, parameters: { ...parameters, slitWidth: 81 } }, 'tampered'));
    const evidence = app.get(mod('modules/works/project-evidence.service.js').ProjectEvidenceMaterializer);
    const restored = await evidence.experimentReceipts(projectId, student.id, record.sessionId);
    assert.equal(restored.length, 1);
    assert.deepEqual(restored[0], saved.observationReceipt);
    const session = await tutor.loadSession(record.sessionId, student.id);
    const response = await tutor.toSessionResponseWithEvidence(session);
    assert.equal(response.turns.flatMap((item) => item.blocks).find((block) =>
      block.kind === 'optics_experiment').savedObservation.observationId, saved.observationReceipt.observationId);
    await assert.rejects(tutor.loadSession(record.sessionId, 'student-demo-2'));
    const result = { fixture: 'synthetic-catalog-and-practice-gate', projectId, sessionId: record.sessionId,
      experimentId, planId: generated.plan.id, templateVersionId: bootstrap.versionId,
      checks: ['compile-activate-freeze', 'confirm-replay', 'theory-gate', 'prediction-run-observation',
        'persisted-receipt', 'duplicate-replay', 'tampered-parameters', 'reload-receipt', 'cross-student-denial'] };
    writeFileSync(reportPath, JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result));
  } finally { await app.close(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
