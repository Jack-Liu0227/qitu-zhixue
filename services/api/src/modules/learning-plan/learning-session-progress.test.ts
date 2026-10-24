import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { CurrentUser, ProjectTemplateSpec } from '@qitu/contracts';
import { OPTICS_16_COMPLETION_TEMPLATE_SPEC, OPTICS_16_SESSION_TEMPLATE_SPEC } from '@qitu/ai-client/quiz-bank';
import type { AccessPolicy } from '../../common/access/access-policy';
import type { AuditWriter } from '../../common/audit/audit.service';
import type { MasteryDomainService } from '../mastery/mastery-domain.service';
import type { TemplateBindingService } from '../templates/templates-binding.service';
import type { WorksLearningEvidenceService, LessonEvidenceProofs, LearningEvidenceProof, LearningEvidenceScope } from '../works/works-learning-evidence.service';
import type { OutboxWriter } from '../../common/outbox/outbox.service';
import type { IdempotencyStore } from '../../common/idempotency/idempotency.service';
import { ProjectLifecycleService } from '../projects/project-lifecycle.service';
import { LearningSessionProgressService } from './learning-session-progress.service';
import { InMemoryLearningPlanStore, type PlanBundle } from './learning-plan.store';

const actor: CurrentUser = { id: 'synthetic-student', role: 'student', email: '', displayName: '' };
const now = new Date('2026-10-20T00:00:00Z');
const empty = (): LessonEvidenceProofs => ({ submissions: [], observations: [], approvedArtifacts: [], reflections: [] });
async function harness(spec: ProjectTemplateSpec = OPTICS_16_COMPLETION_TEMPLATE_SPEC) {
  const store = new InMemoryLearningPlanStore();
  const profile = spec.curriculum!.profiles[0]!;
  const plan: PlanBundle['plan'] = { id: 'plan', studentUserId: actor.id, projectId: null, interest: 'optics', goal: '', lessonCount: 16,
    lessonMinutes: 60, minutesPerSession: 60, templateVersion: 'frozen-version', status: 'draft', version: 1,
    idempotencyKey: 'plan', confirmedAt: null, completedAt: null, createdAt: now, updatedAt: now };
  const bundle: PlanBundle = { plan,
    modules: [{ id: 'module', planId: plan.id, name: 'Optics', lessonIndex: 1, objective: '', ordinal: 0 }],
    objectives: spec.objectives.map((objective, ordinal) => ({ id: `plan:${objective.id}`, planId: plan.id, moduleId: 'module',
      name: objective.title, objective: objective.description, type: objective.knowledgeType ?? 'concept', prerequisiteIds: [], ordinal })),
    sessions: profile.sessions.map((session, index) => ({ id: `plan:${session.id}`, planId: plan.id, moduleId: 'module', index,
      lessonIndex: session.sessionIndex, title: session.title, blocks: [], theoryObjectiveIds: session.phase === 'concept_mastery'
        ? session.objectiveIds.map((id) => `plan:${id}`) : [], practiceObjectiveIds: [], mode: 'study' })),
  };
  await store.createPlan(bundle);
  await store.confirmPlan({ planId: plan.id, now, project: { id: 'project', studentId: actor.id, templateVersionId: plan.templateVersion,
    status: 'theory_learning', currentStageIndex: 0, stageTotal: 4, progressPercent: 0, title: 'Optics', subtitle: null, tags: [] } });
  const proofs = new Map<string, LessonEvidenceProofs>();
  const mastered = new Set<string>();
  let auditCount = 0, failAudit = false;
  const service = new LearningSessionProgressService(store,
    { canReadStudent: async (user: CurrentUser, id: string) => user.id === id || user.role === 'teacher' } as AccessPolicy,
    { getFrozenTeachingBundle: async () => ({ templateVersionId: 'frozen-version', scheduleProfileId: profile.id, template: spec }) } as unknown as TemplateBindingService,
    { checkRequiredObjectives: async (_actor: CurrentUser, _student: string, _plan: string, ids: readonly string[]) => ids.every((id) => mastered.has(id)) } as unknown as MasteryDomainService,
    { readLessonProofs: async (_actor: CurrentUser, scope: LearningEvidenceScope, refs?: readonly string[]) => {
      const value = proofs.get(scope.learningSessionId) ?? empty();
      const all = [...value.submissions, ...value.observations, ...value.approvedArtifacts, ...value.reflections];
      if (refs?.some((ref) => !all.some((proof) => proof.ref === ref))) throw new Error('EVIDENCE_REFERENCE_INVALID');
      return Object.fromEntries(Object.entries(value).map(([key, entries]) => [key, (entries as LearningEvidenceProof[])
        .filter((entry) => !refs || refs.includes(entry.ref))]));
    } } as unknown as WorksLearningEvidenceService,
    { write: async () => { if (failAudit) throw new Error('audit unavailable'); auditCount++; return 'audit'; } } as AuditWriter);
  const id = (lesson: number) => bundle.sessions[lesson - 1]!.id;
  const proof = (lesson: number, kind: LearningEvidenceProof['kind'], sourceKind: LearningEvidenceProof['sourceKind'] = kind === 'experiment_observation' ? 'experiment_observation' : 'task_submission') => ({
    kind, sourceKind, ref: `${kind}:${lesson}`, objectiveId: `plan:${profile.sessions[lesson - 1]!.objectiveIds[0]}`,
    scope: { projectId: 'project', planId: 'plan', planRevision: 1, learningSessionId: id(lesson), objectiveIds: profile.sessions[lesson - 1]!.objectiveIds.map((value) => `plan:${value}`) },
    artifactId: `artifact:${lesson}`, artifactVersionId: `version:${lesson}`,
  } as LearningEvidenceProof);
  const add = (lesson: number, kind: LearningEvidenceProof['kind'], sourceKind?: LearningEvidenceProof['sourceKind']) => {
    const value = proofs.get(id(lesson)) ?? empty(); const entry = proof(lesson, kind, sourceKind);
    const key = sourceKind === 'reflection' ? 'reflections' : kind === 'experiment_observation' ? 'observations' : kind === 'approved_artifact' ? 'approvedArtifacts' : 'submissions';
    value[key].push(entry); proofs.set(id(lesson), value); return entry;
  };
  const complete = (lesson: number, key = `complete:${lesson}`, refs: string[] = []) => service.complete(actor, 'plan', id(lesson), { projectId: 'project', planRevision: 1, evidenceRefs: refs }, key);
  return { service, store, spec, profile, id, proof, proofs, mastered, add, complete, auditCount: () => auditCount, failAudit: () => { failAudit = true; } };
}
async function rejected(work: Promise<unknown>, code: string) {
  await assert.rejects(work, (error: unknown) => {
    assert.equal((error as { getResponse(): { code: string } }).getResponse().code, code); return true;
  });
}
async function reach(h: Awaited<ReturnType<typeof harness>>, lesson: number) {
  for (const objective of h.spec.phases.find((phase) => phase.phase === 'concept_mastery')!.objectiveIds) h.mastered.add(`plan:${objective}`);
  for (let index = 1; index < lesson; index++) {
    if (index === 11 || index === 12) h.add(index, 'experiment_observation');
    else if (index === 14) { h.add(index, 'submitted_artifact'); h.add(index, 'approved_artifact'); }
    else h.add(index, 'session_response');
    await h.complete(index);
  }
}

test('all sixteen sessions are reachable in order; shared objectives do not skip distinct lessons', async () => {
  const h = await harness();
  await reach(h, 16);
  const before = await h.service.readProgress(actor, 'plan');
  assert.equal(before.currentSessionId, h.id(16)); assert.equal(before.completedCount, 15);
  h.add(16, 'session_response');
  h.proofs.get(h.id(16))!.approvedArtifacts.push(...h.proofs.get(h.id(14))!.approvedArtifacts);
  await rejected(h.complete(16), 'LEARNING_SESSION_REQUIREMENTS_UNMET');
  h.add(16, 'session_response', 'reflection');
  const result = await h.complete(16);
  assert.equal(result.progress.completedCount, 16); assert.equal(result.progress.currentSessionId, null);
  assert.equal((await h.store.findPlan('plan'))?.status, 'active');
  assert.equal((await h.store.findProject('project'))?.status, 'theory_learning');
  assert.equal((await h.store.listMasteryForPlan(actor.id, 'plan')).length, 0);
});

test('code artifact checkpoints require the submitted version and remain usable during final archive', async () => {
  const source = OPTICS_16_COMPLETION_TEMPLATE_SPEC;
  const spec: ProjectTemplateSpec = { ...source, governancePolicyId: undefined,
    phases: source.phases.map(phase => phase.phase === 'guided_practice'
      ? { ...phase, gateCondition: 'code_playable_run_verified', evidenceProfile: 'runnable_code', deliverableType: 'runnable_python_game' } : phase),
    curriculum: { profiles: source.curriculum!.profiles.map(profile => ({ ...profile,
      sessions: profile.sessions.map(session => session.checkpoint?.requiredGate === 'experiment_report_validated'
        ? { ...session, checkpoint: { requiredGate: 'code_playable_run_verified' } } : session),
    })) },
  };
  const h = await harness(spec); await reach(h, 14);
  h.add(14, 'submitted_artifact');
  const approval = h.add(14, 'approved_artifact'); approval.artifactVersionId = 'different-version';
  await rejected(h.complete(14), 'LEARNING_SESSION_REQUIREMENTS_UNMET');
  approval.artifactVersionId = 'version:14'; await h.complete(14);
  h.add(15, 'session_response'); await h.complete(15);
  h.add(16, 'session_response', 'reflection');
  h.proofs.get(h.id(16))!.approvedArtifacts.push(approval);
  const result = await h.complete(16);
  assert.equal(result.progress.completedCount, 16);
  assert.equal(result.progress.currentSessionId, null);
});

test('missing evidence, unmastered theory, pending answers and wrong lesson are rejected', async () => {
  const h = await harness();
  await rejected(h.complete(1), 'LEARNING_SESSION_REQUIREMENTS_UNMET');
  h.add(2, 'session_response'); await rejected(h.complete(2), 'LEARNING_SESSION_OUT_OF_ORDER');
  h.add(1, 'session_response'); await h.complete(1); await h.complete(2);
  h.add(3, 'session_response'); await rejected(h.complete(3), 'LEARNING_SESSION_REQUIREMENTS_UNMET');
  h.mastered.add('plan:opt-theory-reflection');
  await h.store.createPendingQuestion({ id: 'pending', schoolId: null, questionType: 'choice', prompt: 'Synthetic pending question', expectedAnswer: 'A', explanation: 'Synthetic explanation', difficulty: 'easy', assessmentType: 'quiz', attempt: 1, hintsUsed: 0, answeredAt: null, studentUserId: actor.id, planId: 'plan', sessionId: h.id(3),
    objectiveId: 'plan:opt-theory-reflection', status: 'awaiting', idempotencyKey: 'pending', options: [], askedAt: now, createdAt: now, updatedAt: now });
  await rejected(h.complete(3), 'LEARNING_SESSION_REQUIREMENTS_UNMET');
  await h.store.markPendingQuestionAnswered('pending', now); await h.complete(3);
  assert.equal((await h.service.readProgress(actor, 'plan')).currentSessionId, h.id(4));
  await rejected(h.complete(4), 'LEARNING_SESSION_REQUIREMENTS_UNMET');
});

test('observations and response proofs are scoped to the precise lesson and revision', async () => {
  const h = await harness(); await reach(h, 11);
  h.add(11, 'session_response'); await rejected(h.complete(11), 'LEARNING_SESSION_REQUIREMENTS_UNMET');
  const observation = h.add(11, 'experiment_observation'); observation.scope.planRevision = 2;
  await rejected(h.complete(11), 'LEARNING_SESSION_REQUIREMENTS_UNMET');
  observation.scope.planRevision = 1; await h.complete(11);
  const copied = empty(); copied.observations.push(observation); h.proofs.set(h.id(12), copied);
  await rejected(h.complete(12), 'LEARNING_SESSION_REQUIREMENTS_UNMET');
  h.add(12, 'experiment_observation'); await h.complete(12);
});

test('report checkpoint requires approval of its submitted immutable version; final reflection may reuse project approval', async () => {
  const h = await harness(); await reach(h, 14);
  const submitted = h.add(14, 'submitted_artifact'); const approved = h.add(14, 'approved_artifact');
  approved.artifactVersionId = 'other-version'; await rejected(h.complete(14), 'LEARNING_SESSION_REQUIREMENTS_UNMET');
  approved.artifactVersionId = submitted.artifactVersionId; await h.complete(14);
  h.add(15, 'session_response'); await h.complete(15);
  h.add(16, 'session_response', 'reflection'); h.proofs.get(h.id(16))!.approvedArtifacts.push(approved);
  assert.equal((await h.complete(16)).progress.completedCount, 16);
});

test('completion has object/revision permissions, strict input and idempotent audit/readback', async () => {
  const h = await harness(); h.add(1, 'session_response');
  const input = { projectId: 'project', planRevision: 1, evidenceRefs: [] };
  await rejected(h.service.complete({ ...actor, role: 'teacher' }, 'plan', h.id(1), input, 'key'), 'LEARNING_SESSION_FORBIDDEN');
  await rejected(h.service.complete({ ...actor, id: 'other' }, 'plan', h.id(1), input, 'key'), 'LEARNING_SESSION_FORBIDDEN');
  await rejected(h.service.complete(actor, 'plan', h.id(1), { ...input, planRevision: 2 }, 'key'), 'LEARNING_SESSION_SCOPE_STALE');
  await rejected(h.service.complete(actor, 'plan', h.id(1), { ...input, projectId: 'other' }, 'key'), 'LEARNING_SESSION_SCOPE_STALE');
  await rejected(h.service.complete(actor, 'plan', h.id(1), { ...input, evidenceRefs: [''] }, 'key'), 'INVALID_SESSION_COMPLETION');
  await rejected(h.service.complete(actor, 'plan', h.id(1), { ...input, completed: true }, 'key'), 'INVALID_SESSION_COMPLETION');
  await assert.rejects(h.complete(1, 'forged', ['forged-ref']), /EVIDENCE_REFERENCE_INVALID/);
  const [first, second] = await Promise.all([h.complete(1, 'key'), h.complete(1, 'key')]);
  assert.equal(first.replayed, false); assert.equal(second.replayed, true); assert.equal(h.auditCount(), 1);
  h.add(2, 'session_response'); await h.complete(2);
  assert.equal((await h.complete(1, 'key')).progress.currentSessionId, h.id(3));
  await rejected(h.complete(2, 'key'), 'IDEMPOTENCY_KEY_CONFLICT');
});

test('legacy contracts do not inherit new rules; audit failure rolls back completion', async () => {
  const legacy = await harness(OPTICS_16_SESSION_TEMPLATE_SPEC);
  assert.equal((await legacy.service.readProgress(actor, 'plan')).contractReady, false);
  await rejected(legacy.complete(1), 'LEARNING_SESSION_CONTRACT_REQUIRED');
  const h = await harness(); h.add(1, 'session_response'); h.failAudit();
  await assert.rejects(h.complete(1), /audit unavailable/);
  assert.equal((await h.store.listSessionCompletions('plan', 1)).length, 0);
  assert.equal((await h.store.listSessionCompletions('plan', 2)).length, 0);
});

test('project overview follows completion receipts even when project stage is advanced', async () => {
  const h = await harness(); h.add(1, 'session_response'); await h.complete(1);
  await h.store.transitionProject(actor.id, 'project', 'theory_learning', 'artifact_review', async () => {});
  const overview = new ProjectLifecycleService(h.store, {} as MasteryDomainService,
    { canReadStudent: async () => true } as unknown as AccessPolicy, {} as AuditWriter, {} as OutboxWriter, {} as IdempotencyStore,
    { findFrozenSnapshotForProject: async () => ({ projectId: 'project' }), getFrozenTeachingBundle: async () => ({
      template: h.spec, scheduleProfileId: h.profile.id,
    }) } as unknown as TemplateBindingService);
  const result = await overview.getProjectOverview(actor, 'project');
  assert.equal(result.tasks[0]?.status, 'done'); assert.equal(result.tasks[1]?.status, 'doing');
  assert.equal(result.tasks[2]?.status, 'locked'); assert.equal(result.tasks[10]?.stageId, 'practice_building');
  assert.equal(result.tasks[0]?.title, h.profile.sessions[0]?.title);
});

test('confirmation attach is transactional, scope checked and cannot create a second active plan', async () => {
  const h = await harness(); const bundle = (await h.store.findBundle('plan'))!; const project = (await h.store.findProject('project'))!;
  const store = new InMemoryLearningPlanStore();
  await assert.rejects(store.withConfirmationTransaction(undefined, async (transaction) => {
    await transaction.attachConfirmedProject(project, bundle); throw new Error('binding freeze failed');
  }), /binding freeze failed/);
  assert.equal(await store.findPlan('plan'), null); assert.equal(await store.findProject('project'), null);
  assert.equal(await store.findObjectiveMapping({ planId: 'plan', objectiveId: bundle.objectives[0]!.id, templateVersion: bundle.plan.templateVersion, contentVersion: bundle.plan.templateVersion }), null);
  await store.withConfirmationTransaction(undefined, (transaction) => transaction.attachConfirmedProject(project, bundle));
  assert.equal((await store.findPlan('plan'))?.status, 'active'); assert.equal((await store.findProject('project'))?.id, project.id);
  await assert.rejects(store.attachConfirmedProject(project, bundle), /PROJECT_ALREADY_HAS_ACTIVE_PLAN/);
  await assert.rejects(store.attachConfirmedProject({ ...project, studentId: 'other' }, bundle), /CONFIRMED_PROJECT_PLAN_SCOPE_INVALID/);
  assert.equal(await store.finishPlanForProject(actor.id, 'plan', 'project', 2), false);
  assert.equal(await store.finishPlanForProject(actor.id, 'plan', 'project', 1), true);
  assert.equal((await store.findPlan('plan'))?.status, 'completed');
  await store.transitionProject(actor.id, 'project', 'theory_learning', 'completed', async () => {});
  assert.ok((await store.findProject('project'))?.completedAt);
});
