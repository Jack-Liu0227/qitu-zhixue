import { WorksPublicationReview } from './works-publication-review';
import type { LessonQualityEvaluator } from './lesson-quality-evaluator';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { CurrentUser } from '@qitu/contracts';
import { OPTICS_16_SESSION_TEMPLATE_SPEC } from '@qitu/ai-client/quiz-bank';
import { IdempotencyStore } from '../../common/idempotency/idempotency.service';
import { IdempotencyError } from '../../common/idempotency/idempotency.errors';
import type { IdempotentHandler } from '../../common/idempotency/idempotency.types';
import type { AuditWriter } from '../../common/audit/audit.service';
import type { OutboxWriter } from '../../common/outbox/outbox.service';
import type { AccessPolicy } from '../../common/access/access-policy';
import { InMemoryLearningPlanStore, type PlanBundle } from '../learning-plan/learning-plan.store';
import { LearningPlanService } from '../learning-plan/learning-plan.service';
import { DeterministicPlanGenerator } from '../learning-plan/plan-generator';
import { generatePlanFromTemplate } from '../learning-plan/template-plan-generator';
import type { MasteryDomainService } from '../mastery/mastery-domain.service';
import type { TemplateBindingService } from '../templates/templates-binding.service';
import type { TeamRuntimeService } from '../team-runtime/team-runtime.service';
import { InMemoryTeacherReviewRepository, TeacherService } from '../teacher/teacher.service';
import { TeacherController } from '../teacher/teacher.controller';
import type { DirectoryService } from '../directory/directory.service';
import type { PlatformDataService } from '../platform-data/platform-data.service';
import type { AuthService } from '../identity-auth/auth.service';
import type { FeedbackService } from '../feedback/feedback.service';
import { InMemoryWorksStore } from './works.store';
import { InMemoryWorksProjectReader } from './works.project-reader';
import { WorksDirectory } from './works.access';
import { InMemoryProjectEvidenceStore, EmptyProjectEvidenceSource } from './project-evidence.store';
import { ProjectEvidenceMaterializer } from './project-evidence.service';
import { UnconfiguredObjectStoragePresigner } from './object-storage.presigner';
import { WorksService } from './works.service';
import { WorksLearningEvidenceService } from './works-learning-evidence.service';

const STUDENT: CurrentUser = { id: 'student', role: 'student', email: 's@example.invalid', displayName: 'Fixture' };
const TEACHER: CurrentUser = { ...STUDENT, id: 'mentor', role: 'teacher' };

class MemoryKeys extends IdempotencyStore {
  private readonly values = new Map<string, { hash: string; status: number; body: unknown }>();
  async execute<T>(scope: string, key: string, hash: string, handler: IdempotentHandler<T>) {
    const id = `${scope}:${key}`;
    const old = this.values.get(id);
    if (old) {
      if (old.hash !== hash) throw new IdempotencyError('IDEMPOTENCY_CONFLICT', 'conflict');
      return { status: old.status, body: old.body as T, replayed: true };
    }
    const result = await handler();
    const value = { hash, status: result.status ?? 200, body: result.body };
    this.values.set(id, value);
    return { ...value, replayed: false };
  }
}

class FixtureDirectory extends WorksDirectory {
  currentMentor = 'mentor';
  async isMentorOf(id: string, studentId: string) { return id === this.currentMentor && studentId === STUDENT.id; }
  async isGuardianOf() { return false; }
  async studentsOfMentor(id: string) { return id === this.currentMentor ? [STUDENT.id] : []; }
  async childrenOfParent() { return []; }
  async mentorOfStudent() { return this.currentMentor || null; }
  async schoolOfStudent() { return null; }
}

async function harness() {
  const plans = new InMemoryLearningPlanStore();
  const generated = generatePlanFromTemplate({ interest: 'optics', lessonCount: 16, lessonMinutes: 60, goal: null },
    { templateVersion: 'template-optics', templateSpec: OPTICS_16_SESSION_TEMPLATE_SPEC });
  const prefix = (id: string) => `plan:${id}`;
  const now = new Date();
  const bundle: PlanBundle = {
    plan: { id: 'plan', studentUserId: STUDENT.id, projectId: null, interest: 'optics', goal: 'investigate', lessonCount: 16,
      lessonMinutes: 60, minutesPerSession: 60, templateVersion: 'template-optics', status: 'draft', version: 1,
      idempotencyKey: 'plan-fixture', confirmedAt: null, completedAt: null, createdAt: now, updatedAt: now },
    modules: generated.modules.map((entry) => ({ ...entry, id: prefix(entry.id), planId: 'plan' })),
    objectives: generated.objectives.map((entry) => ({ ...entry, id: prefix(entry.id), planId: 'plan', moduleId: prefix(entry.moduleId), prerequisiteIds: entry.prerequisiteIds.map(prefix) })),
    sessions: generated.sessions.map((entry) => ({ ...entry, id: prefix(entry.id), planId: 'plan', moduleId: prefix(entry.moduleId),
      blocks: entry.blocks.map((block) => ({ ...block, ...(block.evidenceRequirements ? { evidenceRequirements: [...block.evidenceRequirements] } : {}) })),
      theoryObjectiveIds: entry.theoryObjectiveIds.map(prefix), practiceObjectiveIds: entry.practiceObjectiveIds.map(prefix) })),
  };
  await plans.createPlan(bundle);
  const confirmed = await plans.confirmPlan({ planId: 'plan', now, project: { id: 'project', studentId: STUDENT.id,
    templateVersionId: 'template-optics', status: 'practice_building', currentStageIndex: 5, stageTotal: 10,
    progressPercent: 50, title: 'Optics', subtitle: null, tags: [] } });
  const projects = new InMemoryWorksProjectReader();
  projects.seed(confirmed.project);
  const directory = new FixtureDirectory();
  const artifacts = new InMemoryWorksStore();
  const facts = new InMemoryProjectEvidenceStore();
  const evidence = new ProjectEvidenceMaterializer(facts, new EmptyProjectEvidenceSource());
  const idempotency = new MemoryKeys();
  const audits: unknown[] = [];
  const audit = { write: async (input: unknown) => { audits.push(input); return 'audit'; } } as unknown as AuditWriter;
  const gates = { recordGateForStudent: async () => ({ status: 'recorded' }) } as unknown as TeamRuntimeService;

  const bindings = { getFrozenTeachingBundle: async () => ({ templateVersionId: 'template-optics', template: OPTICS_16_SESSION_TEMPLATE_SPEC,
    scheduleProfileId: OPTICS_16_SESSION_TEMPLATE_SPEC.curriculum!.profiles[0]!.id }) } as unknown as TemplateBindingService;
  let gate = true;
  const mastery = { checkRequiredObjectives: async () => gate } as unknown as MasteryDomainService;
  const evaluator: LessonQualityEvaluator = { evaluate: async input => ({ providerId: 'isolated', modelId: 'controlled', criteria: input.criteria.map(item => ({ criterionId: item.id, meets: true, feedback: 'Fixture verdict.' })) }) };
  const publication = new WorksPublicationReview(plans, bindings, directory, artifacts, facts, evidence, audit, idempotency, evaluator, mastery);
  const works = new WorksService(artifacts, directory, projects, evidence, new UnconfiguredObjectStoragePresigner(), idempotency, audit, gates, publication);
  const owner = new WorksLearningEvidenceService(plans, bindings, directory, mastery, works, artifacts, evidence, facts, idempotency, audit, undefined, evaluator);
  const access = { canReadStudent: async (actor: CurrentUser, studentId: string) => actor.id === studentId } as unknown as AccessPolicy;
  const learning = new LearningPlanService(plans, new DeterministicPlanGenerator(), idempotency, audit, {} as OutboxWriter, access,
    mastery, gates, bindings, owner);
  const reviews = new InMemoryTeacherReviewRepository(audit, artifacts);
  const teacherDirectory = { studentsOfMentor: async (id: string) => (await directory.studentsOfMentor(id)).map((userId) => ({ userId })) } as DirectoryService;
  const teacher = new TeacherService(teacherDirectory, {} as PlatformDataService, undefined, reviews, plans, works);
  const session = (index: number) => bundle.sessions[index - 1]!;
  const scope = async (index: number) => (await owner.getLessonProofs(STUDENT, 'plan', session(index).id, 1)).scope;
  return { owner, works, plans, artifacts, facts, evidence, directory, session, scope, learning, audits, teacher,
    setGate(value: boolean) { gate = value; } };
}

async function rejectCode(work: () => Promise<unknown>, code: string) {
  await assert.rejects(work, (error: unknown) => (error as { getResponse(): { code: string } }).getResponse().code === code);
}

async function approve(h: Awaited<ReturnType<typeof harness>>, artifactId: string) {
  return h.works.publishArtifact(STUDENT.id, artifactId, `publish-${artifactId}`);
}

test('responses persist immutable inline content and reload exact lesson scope; repeats do not create artifacts', async () => {
  const h = await harness();
  const input = { planRevision: 1, content: 'My ray diagram compares the incident angle with the normal.' };
  const first = await h.owner.submitResponse(STUDENT, 'plan', h.session(3).id, input, 'response');
  const again = await h.owner.submitResponse(STUDENT, 'plan', h.session(3).id, input, 'response');
  assert.equal(first.proof.kind, 'session_response');
  assert.equal(first.artifact.latestVersion?.inlineText, input.content);
  assert.equal(again.proof.ref, first.proof.ref);
  assert.equal(again.replayed, true);
  assert.equal((await h.artifacts.listArtifacts({ studentIds: [STUDENT.id] })).length, 1);
  const reloaded = await h.owner.getLessonProofs(STUDENT, 'plan', h.session(3).id, 1);
  assert.ok(reloaded.qualityCriteria.length, 'legacy frozen lessons also expose automatic evaluation criteria');
  assert.equal(reloaded.submissions[0]?.quality?.status, 'accepted');
  assert.deepEqual((await h.owner.getLessonProofs(STUDENT, 'plan', h.session(3).id, 1)).submissions.map((p) => p.ref), [first.proof.ref]);
  assert.equal((await h.owner.getLessonProofs(STUDENT, 'plan', h.session(4).id, 1)).submissions.length, 0, 'shared objective does not share lesson completion proof');
  await rejectCode(() => h.owner.readLessonProofs(STUDENT, { ...first.proof.scope, planRevision: 2 }), 'LEARNING_EVIDENCE_SCOPE_MISMATCH');
  await rejectCode(() => h.owner.readLessonProofs(STUDENT, { ...first.proof.scope, projectId: 'other' }), 'LEARNING_EVIDENCE_SCOPE_MISMATCH');
  await rejectCode(() => h.owner.readLessonProofs({ ...STUDENT, id: 'other' }, first.proof.scope), 'LEARNING_EVIDENCE_FORBIDDEN');
  assert.equal((await h.owner.readLessonProofs(TEACHER, first.proof.scope)).submissions.length, 1);
  await rejectCode(() => h.owner.submitResponse(TEACHER, 'plan', h.session(3).id, input, 'teacher-write'), 'LEARNING_EVIDENCE_FORBIDDEN');
  await rejectCode(() => h.owner.submitResponse(STUDENT, 'plan', h.session(3).id, { ...input, content: 'Changed' }, 'response'), 'IDEMPOTENCY_CONFLICT');
});

test('plain inline text is bounded; forged refs and direct artifacts are not lesson evidence', async () => {
  const h = await harness();
  for (const content of ['', '<script>alert(1)</script>', 'x'.repeat(10_001)]) {
    await rejectCode(() => h.owner.submitResponse(STUDENT, 'plan', h.session(1).id, { planRevision: 1, content }, 'bad'), 'ARTIFACT_INLINE_TEXT_INVALID');
  }
  await rejectCode(() => h.owner.submitResponse(STUDENT, 'plan', h.session(1).id,
    { planRevision: 1, content: 'A valid observation', evidenceRefs: ['artifact:invented'] }, 'fake'), 'LEARNING_EVIDENCE_SCOPE_MISMATCH');
  const raw = await h.works.createArtifact(STUDENT.id, { projectId: 'project', title: 'Unscoped', version: { inlineText: 'Unscoped report' } }, 'raw');
  await rejectCode(async () => h.owner.readLessonProofs(STUDENT, await h.scope(14), [`artifact:${raw.id}`]), 'LEARNING_EVIDENCE_SCOPE_MISMATCH');
});

test('real submitted version is readable to assigned mentor, and becomes proof only after approval AND publication', async () => {
  const h = await harness();
  const report = await h.owner.submitArtifact(STUDENT, 'plan', h.session(14).id,
    { planRevision: 1, objectiveId: h.session(14).practiceObjectiveIds[0]!, title: 'Optics report', content: 'Claim: the pattern widens. Evidence: saved simulations. Reasoning: the model predicts inverse width.', requestReview: true }, 'report');
  assert.equal(report.artifact.status, 'published');
  assert.equal(report.artifact.reviewStatus, 'approved');
  const proofs = await h.owner.getLessonProofs(STUDENT, 'plan', h.session(16).id, 1);
  assert.equal(proofs.approvedArtifacts[0]?.kind, 'approved_artifact');
  assert.equal(proofs.approvedArtifacts[0]?.artifactVersionId, report.artifact.latestVersion?.id);
  assert.equal(proofs.approvedArtifacts[0]?.scope.learningSessionId, h.session(14).id, 'project proof retains original scope');
  assert.equal(proofs.submissions.length, 0, 'report submission itself is not a final-session response');
  const final = await h.owner.submitReflection(STUDENT, 'plan', h.session(16).id,
    { planRevision: 1, content: 'I separated simulated observations from real measurements.', evidenceRefs: [proofs.approvedArtifacts[0]!.ref] }, 'final');
  assert.equal(final.proof.sourceKind, 'reflection');
  assert.equal((await h.owner.getLessonProofs(STUDENT, 'plan', h.session(16).id, 1)).reflections.length, 1);
  assert.equal((await h.plans.findProject('project'))?.status, 'practice_building', 'Works never advances project');
  assert.equal((await h.plans.listMasteryForPlan(STUDENT.id, 'plan')).length, 0, 'Works never awards mastery');
  h.directory.currentMentor = 'replacement';
  assert.equal((await h.owner.getLessonProofs(STUDENT, 'plan', h.session(16).id, 1)).approvedArtifacts.length, 1);
  await rejectCode(() => h.owner.getLessonProofs(TEACHER, 'plan', h.session(16).id, 1), 'LEARNING_EVIDENCE_FORBIDDEN');
});

test('old version approval cannot authorize a new version; ordinary final response is not reflection', async () => {
  const h = await harness();
  const report = await h.owner.submitArtifact(STUDENT, 'plan', h.session(14).id,
    { planRevision: 1, title: 'Report', content: 'Version one', requestReview: true }, 'report');
  await approve(h, report.artifact.id);
  const original = (await h.artifacts.listVersions(report.artifact.id))[0]!;
  await h.artifacts.appendVersion({ artifactId: report.artifact.id, expectedRevision: 1, title: 'Changed', note: original.note,
    objectKey: null, thumbnailRef: null, capturedAt: null, now: new Date() });
  assert.equal((await h.owner.getLessonProofs(STUDENT, 'plan', h.session(16).id, 1)).approvedArtifacts.length, 0);
  const response = await h.owner.submitResponse(STUDENT, 'plan', h.session(16).id, { planRevision: 1, content: 'A response, not an archive request' }, 'response');
  assert.equal(response.proof.sourceKind, 'task_submission');
  assert.equal((await h.owner.getLessonProofs(STUDENT, 'plan', h.session(16).id, 1)).reflections.length, 0);
});

test('saved observations are scoped and submission never creates correct attempts or mastery, even with new keys', async () => {
  const h = await harness();
  const session = h.session(11);
  const objectiveId = session.practiceObjectiveIds[0]!;
  const evidenceRef = 'experiment_observation:obs-fixture';
  await h.evidence.saveExperimentObservation({ studentId: STUDENT.id, objectiveId, parameters: { slitWidthUm: 50 }, observation: 'Simulated central maximum widened',
    receipt: { observationId: 'obs-fixture', experimentId: 'experiment', evidenceRef, projectId: 'project', sessionId: 'tutor', planId: 'plan',
      planRevision: 1, learningSessionId: session.id, runActionId: 'run', parameterDigest: 'a'.repeat(64), provenance: 'simulated_observation',
      rubricRef: 'rubric:frozen', cerRef: 'cer:observation', savedAt: new Date().toISOString() } });
  assert.equal((await h.owner.getLessonProofs(STUDENT, 'plan', session.id, 1)).observations.length, 1);
  await rejectCode(async () => h.owner.readLessonProofs(STUDENT, await h.scope(12), [evidenceRef]), 'LEARNING_EVIDENCE_SCOPE_MISMATCH');
  for (const key of ['first', 'first', 'another-key']) {
    const result = await h.learning.submitEvidence(STUDENT, 'plan', session.id, { planRevision: 1, objectiveId, evidenceRef }, key);
    assert.equal(result.accepted, true);
    assert.equal(result.assessmentStatus, 'assessment_required');
    assert.equal(result.masteryUpdated, false);
  }
  assert.equal((await h.plans.listAttempts(STUDENT.id, objectiveId)).length, 0);
  assert.equal(await h.plans.findMastery(STUDENT.id, objectiveId), null);
  assert.equal((await h.facts.listByProject('project')).filter((row) => row.sourceId.startsWith('submission-')).length, 1);
  await rejectCode(() => h.learning.submitEvidence(STUDENT, 'plan', session.id, { planRevision: 2, objectiveId, evidenceRef }, 'stale'), 'LEARNING_EVIDENCE_SCOPE_MISMATCH');
  await rejectCode(() => h.learning.submitEvidence(STUDENT, 'plan', session.id, { planRevision: 1, objectiveId, evidenceRef: 'artifact:invented' }, 'fake'), 'LEARNING_EVIDENCE_SCOPE_MISMATCH');
  h.setGate(false);
  await rejectCode(() => h.owner.submitResponse(STUDENT, 'plan', h.session(10).id, { planRevision: 1, content: 'Practice before permission' }, 'locked'), 'THEORY_MASTERED_REQUIRED');
});

test('teacher review queue is bounded and current-mentor-only, and returns the submitted immutable version', async () => {
  const h = await harness();
  const report = await h.owner.submitArtifact(STUDENT, 'plan', h.session(14).id,
    { planRevision: 1, title: 'Reviewable report', content: 'The full submitted report.', requestReview: false }, 'queue-report');
  // Historical pending review fixture; the current publication path never creates it.
  const stored = (await h.artifacts.findArtifact(report.artifact.id))!;
  const version = (await h.artifacts.listVersions(stored.id))[0]!;
  await h.artifacts.transitionArtifact({ artifactId: stored.id, expectedStatuses: ['draft'], status: 'submitted', now: new Date() });
  const review = await h.artifacts.createMentorReview({ id: 'historical-review', schoolId: null, studentId: STUDENT.id,
    mentorUserId: TEACHER.id, projectId: 'project', artifactId: stored.id, status: 'requested', idempotencyKey: 'historical-fixture', now: new Date() });
  await h.evidence.recordArtifactReviewRequest(stored, version, review);
  const reviews = new InMemoryTeacherReviewRepository();
  const row = { ...review, studentUserId: review.studentId, artifactRef: review.artifactId };
  reviews.seed(row);
  const directory = { studentsOfMentor: async (id: string) => (await h.directory.studentsOfMentor(id)).map((userId) => ({ userId })) } as DirectoryService;
  const teacher = new TeacherService(directory, {} as PlatformDataService, undefined, reviews, h.plans, h.works);
  const page = await teacher.listStudentReviews(TEACHER, STUDENT.id, 0, 1);
  assert.equal(page.items[0]?.reviewId, review.id);
  assert.equal(page.items[0]?.artifactVersionId, report.artifact.latestVersion?.id);
  assert.equal(page.items[0]?.versionAvailable, true);
  assert.equal(page.nextOffset, null);
  const original = (await h.artifacts.listVersions(report.artifact.id))[0]!;
  await h.artifacts.appendVersion({ artifactId: report.artifact.id, expectedRevision: 1, title: 'Newer version', note: original.note,
    objectKey: null, thumbnailRef: null, capturedAt: null, now: new Date() });
  const after = await teacher.listStudentReviews(TEACHER, STUDENT.id);
  assert.equal(after.items[0]?.artifactVersionId, original.id, 'never substitutes current version for submitted version');
  assert.deepEqual((await h.works.listVersions(TEACHER, report.artifact.id)).map((version) => version.id), [original.id], 'review permission does not expose an unsubmitted replacement version');
  await rejectCode(() => h.works.getArtifact(TEACHER, report.artifact.id), 'ARTIFACT_FORBIDDEN');
  const draft = await h.works.createArtifact(STUDENT.id, { projectId: 'project', title: 'Private draft', version: { inlineText: 'Draft only' } }, 'draft');
  reviews.seed({ ...row, id: 'unsubmitted', artifactRef: draft.id });
  assert.equal((await teacher.listStudentReviews(TEACHER, STUDENT.id)).items.length, 1, 'unsubmitted drafts are excluded');
  await rejectCode(() => teacher.listStudentReviews(TEACHER, STUDENT.id, 0, 51), 'TEACHER_REVIEW_REQUEST_INVALID');
  const controller = new TeacherController(teacher, { getSession: () => ({ user: STUDENT }) } as unknown as AuthService,
    {} as FeedbackService, new MemoryKeys());
  await assert.rejects(() => controller.studentReviews('qitu_session=fixture', STUDENT.id), (error: unknown) =>
    (error as { getStatus(): number }).getStatus() === 403);
  h.directory.currentMentor = 'replacement';
  await assert.rejects(() => teacher.listStudentReviews(TEACHER, STUDENT.id), (error: unknown) =>
    (error as { getStatus(): number }).getStatus() === 403);
});
