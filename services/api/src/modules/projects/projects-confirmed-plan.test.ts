import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { OPTICS_16_COMPLETION_TEMPLATE_SPEC } from '@qitu/ai-client/quiz-bank';
import type { AuditWriter } from '../../common/audit/audit.service';
import type { IdempotencyStore } from '../../common/idempotency/idempotency.service';
import type { OutboxWriter } from '../../common/outbox/outbox.service';
import type { AccessPolicy } from '../../common/access/access-policy';
import { LearningPlanService } from '../learning-plan/learning-plan.service';
import { InMemoryLearningPlanStore } from '../learning-plan/learning-plan.store';
import { DeterministicPlanGenerator } from '../learning-plan/plan-generator';
import type { TemplateBindingService } from '../templates/templates-binding.service';
import type { TeamRuntimeService } from '../team-runtime/team-runtime.service';
import { InMemoryExplorationStore } from './exploration.store';
import { ProjectsService } from './projects.service';

function harness() {
  const explorations = new InMemoryExplorationStore();
  const plans = new InMemoryLearningPlanStore();
  const keys = new Map<string, { hash: string; body: unknown; status: number }>();
  const idempotency = { execute: async <T>(scope: string, key: string, hash: string, work: () => Promise<{ body: T; status: number }>) => {
    const old = keys.get(`${scope}:${key}`);
    if (old) { assert.equal(old.hash, hash); return { ...old, body: old.body as T, replayed: true }; }
    const result = await work(); keys.set(`${scope}:${key}`, { ...result, hash }); return { ...result, replayed: false };
  } } as unknown as IdempotencyStore;
  let auditFailure = false;
  let auditHook: (() => Promise<void>) | undefined;
  const audit = { write: async (entry: { action: string }) => {
    if (entry.action === 'learning_plan.attach_confirmed_project') await auditHook?.();
    if (auditFailure && entry.action === 'learning_plan.attach_confirmed_project') throw new Error('fixture audit unavailable');
  } } as unknown as AuditWriter;
  const bindings = { freezeProjectBinding: async () => 'frozen', getFrozenTeachingBundle: async (_project: string, version: string) => ({
    templateVersionId: version, template: OPTICS_16_COMPLETION_TEMPLATE_SPEC,
    scheduleProfileId: OPTICS_16_COMPLETION_TEMPLATE_SPEC.curriculum!.profiles[0]!.id,
  }) } as unknown as TemplateBindingService;
  const learning = new LearningPlanService(plans, new DeterministicPlanGenerator(), idempotency, audit,
    {} as OutboxWriter, {} as AccessPolicy, undefined, undefined, bindings);
  const team = { recordGateForStudent: async () => ({ status: 'recorded' }) } as unknown as TeamRuntimeService;
  const service = new ProjectsService(explorations, idempotency, audit, null, team, bindings, learning);
  const create = async () => {
    const draft = await service.createExploration('synthetic-student', { source: 'recommended', templateVersionId: 'frozen-v3' }, `draft-${keys.size}`);
    await service.updateIntentDraft('synthetic-student', draft.id, { coreInterests: ['光学探究'], preferredForm: '模拟探究报告' });
    return draft.id;
  };
  return { service, explorations, plans, create, setAuditHook: (hook: () => Promise<void>) => { auditHook = hook; }, setAuditFailure: (value: boolean) => { auditFailure = value; } };
}

test('explicit intent confirmation immediately owns one active plan from the exact frozen 16 lesson template', async () => {
  const h = harness(), explorationId = await h.create();
  assert.equal((await h.plans.listPlansByStudent('synthetic-student')).length, 0);
  const confirmed = await h.service.confirmIntent('synthetic-student', explorationId, 'confirm');
  const rows = await h.plans.listPlansByStudent('synthetic-student');
  assert.equal(rows.length, 1);
  const bundle = await h.plans.findBundle(rows[0]!.id);
  assert.ok(bundle);
  assert.equal(bundle.plan.projectId, confirmed.project.id);
  assert.equal(bundle.plan.status, 'active');
  assert.ok(bundle.plan.confirmedAt);
  assert.equal(bundle.plan.templateVersion, 'frozen-v3');
  assert.equal(bundle.sessions.length, 16);
  const frozen = OPTICS_16_COMPLETION_TEMPLATE_SPEC.curriculum!.profiles[0]!.sessions;
  assert.deepEqual(bundle.sessions.map(row => row.title), frozen.map(row => row.title));
  assert.deepEqual(bundle.sessions.map(row => row.id), frozen.map(row => `${bundle.plan.id}:${row.id}`));
  assert.equal((await h.plans.findProject(confirmed.project.id))?.status, 'intent_confirmed');
  const replay = await h.service.confirmIntent('synthetic-student', explorationId, 'confirm');
  const secondKey = await h.service.confirmIntent('synthetic-student', explorationId, 'different-key');
  assert.equal(replay.project.id, confirmed.project.id);
  assert.equal(secondKey.project.id, confirmed.project.id);
  assert.equal((await h.plans.listPlansByStudent('synthetic-student')).length, 1);
});

test('plan attach audit failure leaves exploration unconfirmed and no orphan plan or formal project', async () => {
  const h = harness(), explorationId = await h.create();
  h.setAuditFailure(true);
  await assert.rejects(h.service.confirmIntent('synthetic-student', explorationId, 'confirm'), /fixture audit unavailable/);
  assert.equal(await h.explorations.findProjectByExploration(explorationId), null);
  assert.equal((await h.explorations.findExploration(explorationId))?.status, 'awaiting_confirmation');
  assert.equal((await h.plans.listPlansByStudent('synthetic-student')).length, 0);
  assert.equal((await h.plans.listProjectsByStudent('synthetic-student')).length, 0);
  h.setAuditFailure(false);
  const confirmed = await h.service.confirmIntent('synthetic-student', explorationId, 'confirm');
  assert.ok(await h.plans.findProject(confirmed.project.id));
});

function barrier() {
  let release!: () => void;
  const reached = new Promise<void>((resolve) => { release = resolve; });
  return { reached, release };
}

function secondConfirmationEntered(h: ReturnType<typeof harness>) {
  const entered = barrier();
  const persist = h.explorations.persistConfirmation.bind(h.explorations);
  let calls = 0;
  h.explorations.persistConfirmation = async (input) => {
    calls++; if (calls === 2) entered.release();
    return persist(input);
  };
  return entered.reached;
}

async function assertOneConfirmedPlan(h: ReturnType<typeof harness>, explorationId: string, projectId: string) {
  const plans = await h.plans.listPlansByStudent('synthetic-student');
  const projects = await h.plans.listProjectsByStudent('synthetic-student');
  assert.equal(plans.length, 1);
  assert.equal(projects.length, 1);
  assert.equal(plans[0]!.projectId, projectId);
  assert.equal(projects[0]!.id, projectId);
  assert.equal((await h.explorations.findProjectByExploration(explorationId))?.id, projectId);
  assert.equal((await h.explorations.findExploration(explorationId))?.status, 'confirmed');
}

test('different-key concurrent confirmations serialize before attach and produce one project and plan', async () => {
  const h = harness(), explorationId = await h.create();
  const entered = barrier(), proceed = barrier();
  let attaches = 0;
  h.setAuditHook(async () => { attaches++; entered.release(); await proceed.reached; });
  const secondEntered = secondConfirmationEntered(h);
  const first = h.service.confirmIntent('synthetic-student', explorationId, 'concurrent-first');
  await entered.reached;
  const second = h.service.confirmIntent('synthetic-student', explorationId, 'concurrent-second');
  await secondEntered;
  await new Promise<void>((resolve) => setImmediate(resolve));
  try { assert.equal(attaches, 1, 'queued confirmation must not attach its own plan'); } finally { proceed.release(); }
  const [left, right] = await Promise.all([first, second]);
  assert.equal(left.project.id, right.project.id);
  assert.equal(attaches, 1);
  await assertOneConfirmedPlan(h, explorationId, left.project.id);
});

test('a failed confirmation releases its exploration lock; the queued request and failed key retry create no orphan', async () => {
  const h = harness(), explorationId = await h.create();
  const entered = barrier(), proceed = barrier();
  let attaches = 0;
  h.setAuditHook(async () => {
    attaches++;
    if (attaches === 1) { entered.release(); await proceed.reached; throw new Error('first confirmation rejected'); }
  });
  const secondEntered = secondConfirmationEntered(h);
  const first = h.service.confirmIntent('synthetic-student', explorationId, 'failing-first');
  const rejected = assert.rejects(first, /first confirmation rejected/);
  await entered.reached;
  const second = h.service.confirmIntent('synthetic-student', explorationId, 'queued-second');
  await secondEntered;
  await new Promise<void>((resolve) => setImmediate(resolve));
  try { assert.equal(attaches, 1); } finally { proceed.release(); }
  await rejected;
  const confirmed = await second;
  const retried = await h.service.confirmIntent('synthetic-student', explorationId, 'failing-first');
  assert.equal(retried.project.id, confirmed.project.id);
  assert.equal(attaches, 2);
  await assertOneConfirmedPlan(h, explorationId, confirmed.project.id);
});

test('a pending confirmation does not block another exploration', async () => {
  const h = harness(), firstExploration = await h.create(), otherExploration = await h.create();
  const entered = barrier(), proceed = barrier();
  let attaches = 0;
  h.setAuditHook(async () => { attaches++; if (attaches === 1) { entered.release(); await proceed.reached; } });
  const first = h.service.confirmIntent('synthetic-student', firstExploration, 'first-exploration');
  await entered.reached;
  try {
    const independent = await h.service.confirmIntent('synthetic-student', otherExploration, 'other-exploration');
    assert.ok(independent.project.id);
    assert.equal(attaches, 2);
  } finally { proceed.release(); }
  await first;
  assert.equal((await h.plans.listProjectsByStudent('synthetic-student')).length, 2);
  assert.equal((await h.plans.listPlansByStudent('synthetic-student')).length, 2);
});
