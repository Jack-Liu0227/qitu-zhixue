import { ServiceUnavailableException } from '@nestjs/common';
import { WorksPublicationReview } from '../works/works-publication-review';
import type { LessonQualityEvaluator, LessonEvaluationInput } from '../works/lesson-quality-evaluator';
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { OPTICS_16_COMPLETION_TEMPLATE_SPEC, OPTICS_16_QUALITY_TEMPLATE_SPEC, OPTICS_GUIDED_TEMPLATE_SPEC, WAVE_OPTICS_TEMPLATE_SPEC, WAVE_TEACHING_TEMPLATE_SPEC } from '@qitu/ai-client/quiz-bank';
import { InMemoryCoursewareStore } from '../knowledge/courseware.store';
import { CoursewareService } from '../knowledge/courseware.service';
import type { CurrentUser } from '@qitu/contracts';
import type { AccessPolicy } from '../../common/access/access-policy';
import type { AuditWriter } from '../../common/audit/audit.service';
import type { IdempotencyStore } from '../../common/idempotency/idempotency.service';
import type { OutboxWriter } from '../../common/outbox/outbox.service';
import type { OutboxEventInput } from '../../common/outbox/outbox.types';
import { loadTutorRuntimeSource } from '../../common/tutor-runtime/runtime-source';
import { runOpticsTemplateBootstrap } from '../../scripts/optics-template-bootstrap';
import { TutorExperimentService } from '../ai-tutor/tutor-experiment.service';
import { TutorLessonAssessmentService } from '../ai-tutor/tutor-lesson-assessment.service';
import { resolveTutorTeachingContext } from '../ai-tutor/tutor-teaching-context';
import type { TutorService } from '../ai-tutor/tutor.service';
import type { DirectoryService } from '../directory/directory.service';
import type { KnowledgeCenterService } from '../knowledge/knowledge-center.service';
import type { KnowledgeToolCatalogService } from '../knowledge/knowledge-tool-catalog.service';
import { MasteryDomainService } from '../mastery/mastery-domain.service';
import { MasteryReadService } from '../mastery/mastery.service';
import type { ModelRegistryService } from '../model-registry/model-registry.service';
import type { PlatformDataService } from '../platform-data/platform-data.service';
import { builtinToolRegistry } from '../platform-registry/built-in-tools';
import type { EffectiveAgentRuntime, PlatformRegistryService } from '../platform-registry/platform-registry.service';
import { ProjectLearningLifecycleService } from '../projects/project-learning-lifecycle.service';
import { InMemoryTeacherReviewRepository, TeacherService } from '../teacher/teacher.service';
import { TeamRuntimeService } from '../team-runtime/team-runtime.service';
import { InMemoryTemplateEvidenceSource, InMemoryTemplateViewerDirectory } from '../templates/template-evidence.store';
import { InMemoryTemplateVerificationStore } from '../templates/template-verification.store';
import { TeachingBundleCatalog } from '../templates/teaching-bundle.catalog';
import { opticsTeachingFixture } from '../templates/teaching-bundle.test-fixture';
import { TemplateBindingService } from '../templates/templates-binding.service';
import { InMemoryTemplateBindingStore } from '../templates/templates-binding.store';
import { TemplateGovernanceService } from '../templates/templates-governance.service';
import { InMemoryTemplateStore } from '../templates/templates.store';
import { actor, FakeAuditWriter, FakeIdempotencyStore } from '../templates/templates.test-support';
import { WorksDirectory } from '../works/works.access';
import { UnconfiguredObjectStoragePresigner } from '../works/object-storage.presigner';
import { ProjectEvidenceMaterializer } from '../works/project-evidence.service';
import { EmptyProjectEvidenceSource, InMemoryProjectEvidenceStore } from '../works/project-evidence.store';
import { WorksLearningEvidenceService } from '../works/works-learning-evidence.service';
import { WorksProjectReader } from '../works/works.project-reader';
import { WorksService } from '../works/works.service';
import { InMemoryWorksStore } from '../works/works.store';
import { LearningPlanService } from './learning-plan.service';
import { InMemoryLearningPlanStore, type LearningProjectRecord } from './learning-plan.store';
import { LearningSessionProgressService } from './learning-session-progress.service';
import { DeterministicPlanGenerator } from './plan-generator';
import { THUNDER_TEMPLATE_SPEC, THUNDER_TEMPLATE_INPUT, THUNDER_VERSION_INPUT } from '../templates/content/thunder-fighter';
import type { InspirationCourse } from '../templates/content/inspiration';

export const STUDENT = actor('student', 'fullflow-student');
export const TEACHER = actor('teacher', 'fullflow-teacher');
const ADMIN = actor('admin', 'fullflow-admin');

class FixtureDirectory extends WorksDirectory {
  currentMentorId: string | null = TEACHER.id;
  async isMentorOf(mentorId: string, studentId: string) { return mentorId === this.currentMentorId && studentId === STUDENT.id; }
  async isGuardianOf() { return false; }
  async studentsOfMentor(id: string) { return id === TEACHER.id ? [STUDENT.id] : []; }
  async childrenOfParent() { return []; }
  async mentorOfStudent(id: string) { return id === STUDENT.id ? this.currentMentorId : null; }
  async schoolOfStudent() { return null; }
}

/** Only storage, authorization directory and model catalog are synthetic. All learning decisions use production owners. */
export async function fullflowHarness(qualityReview = false, guidedLessons = false, waveOptics = false, zeroBase = false, thunder = false, course?: InspirationCourse) {
  guidedLessons ||= waveOptics || thunder || !!course;
  qualityReview ||= guidedLessons;
  const store = new InMemoryLearningPlanStore();
  const templates = new InMemoryTemplateStore();
  const bindingStore = new InMemoryTemplateBindingStore();
  const viewer = new InMemoryTemplateViewerDirectory();
  const keys = new FakeIdempotencyStore() as unknown as IdempotencyStore;
  const auditLog = new FakeAuditWriter();
  const audit = auditLog as unknown as AuditWriter;
  const events: OutboxEventInput[] = [];
  const outbox = { write: async (event: OutboxEventInput) => { events.push(event); return event.id; } } as unknown as OutboxWriter;
  const directory = new FixtureDirectory();
  const access = { canReadStudent: async (user: CurrentUser, student: string) =>
    user.role === 'student' && user.id === student || user.role === 'teacher' && await directory.isMentorOf(user.id, student) } as AccessPolicy;
  const spec = course?.spec ?? (thunder ? THUNDER_TEMPLATE_SPEC : zeroBase ? WAVE_TEACHING_TEMPLATE_SPEC : waveOptics ? WAVE_OPTICS_TEMPLATE_SPEC : guidedLessons ? OPTICS_GUIDED_TEMPLATE_SPEC
    : qualityReview ? OPTICS_16_QUALITY_TEMPLATE_SPEC : OPTICS_16_COMPLETION_TEMPLATE_SPEC);
  const fixture = opticsTeachingFixture(spec);
  const source = loadTutorRuntimeSource();
  const skill = source.skills.find((entry) => entry.id === 'pbl-dynamic-lesson');
  assert.ok(skill && skill.status === 'ready' && skill.version);
  const tools = builtinToolRegistry.listForAgentIds(['tutor.propose_lesson_activity', ...(waveOptics ? ['tutor.propose_wave_activity'] : []),
    ...(zeroBase ? ['tutor.propose_courseware_activity', 'knowledge_search', 'knowledge_read'] : [])]);
  const skillsFor = (id: string) => guidedLessons ? source.skills.filter(skill =>
    spec.curriculum!.profiles[0]!.sessions.filter(session => session.leadAssistantId === id)
      .some(session => session.requiredSkillIds?.includes(skill.id))) : [skill];
  const registry = { isModelAvailable: () => true, getAssistantRuntime: async (id: string) => ({
    agent: { id, enabled: true, roleDefinition: id, agentDefinition: 'Guide investigation using bounded tools.',
      capabilities: ['teach'], skillIds: skillsFor(id).map(skill => skill.id), toolIds: tools.map(tool => tool.id) },
    skills: skillsFor(id), tools, mcpServers: qualityReview && !course ? [{ serverId: 'ima-knowledge',
      toolIds: ['ima_search_knowledge', 'ima_read_document'] }] : [], policy: source.policy,
  } as unknown as EffectiveAgentRuntime) } as unknown as PlatformRegistryService;
  const catalog = new TeachingBundleCatalog(registry,
    { listAgentModelOptions: () => [{ providerId: 'isolated-provider', modelId: 'isolated-model', available: true }] } as unknown as ModelRegistryService,
    { configuration: async () => ({ config: { knowledgeEngines: { fixture: { provider: 'ima', enabled: true,
      config: { connectionRef: 'ima-legacy', allowedKnowledgeBaseIds: ['synthetic-kb'] } } } } }) } as unknown as KnowledgeCenterService,
    { list: async () => ({ stale: false, source: 'mcp', tools: ['ima_search_knowledge', 'ima_read_document'].map(name => ({
      name, inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    })) }) } as unknown as KnowledgeToolCatalogService);
  fixture.draft.skillPins = fixture.draft.roleMap.flatMap(({ roleSlotId, memberId }) =>
    skillsFor(fixture.members.find(member => member.slotId === memberId)!.assistantId).map(skill => ({ roleSlotId, canonicalId: skill.id,
      version: skill.version!, packageDigest: skill.contentHash })));
  fixture.draft.toolIds = fixture.draft.roleMap.flatMap(({ roleSlotId }) => tools.map(tool => ({ roleSlotId, toolId: tool.id })));
  if (qualityReview && !course) {
    fixture.draft.mcpServerIds = ['ima-knowledge']; fixture.draft.knowledgeBaseIds = ['synthetic-kb'];
    fixture.draft.toolIds = [...fixture.draft.toolIds, ...fixture.draft.roleMap.flatMap(({ roleSlotId }) =>
      ['ima_search_knowledge', 'ima_read_document'].map(toolId => ({ roleSlotId, toolId })))];
  }
  bindingStore.seedTeamVersion({ id: 'fullflow-team-v1', teamId: fixture.teamId, version: 1, name: 'Isolated optics team',
    description: 'Synthetic catalog only', workspaceMode: 'shared', sessionMode: 'auto', leaderAssistantId: fixture.leaderAssistantId,
    members: fixture.members, pblSpec: { phases: ['exploration', 'concept_mastery', 'guided_practice', 'deliverable_review'] },
    enabled: true, createdBy: ADMIN.id, createdAt: new Date() });
  const governance = new TemplateGovernanceService(templates, new InMemoryTemplateEvidenceSource(), new InMemoryTemplateVerificationStore(), viewer, keys, audit);
  const bindings = new TemplateBindingService(templates, viewer, bindingStore, keys, audit, catalog);
  const boot = thunder || course ? await (async () => {
    const { template } = await governance.createTemplate(ADMIN, course?.templateInput ?? THUNDER_TEMPLATE_INPUT, 'thunder-template');
    const { version } = await governance.createVersion(ADMIN, template.id, course?.versionInput ?? THUNDER_VERSION_INPUT, 'thunder-version');
    await governance.pilotVersion(ADMIN, template.id, version.id, 'thunder-pilot', 'Disposable novice fullflow verification');
    const team = await bindingStore.findTeamVersion('fullflow-team-v1'); assert.ok(team);
    const { binding } = await bindings.createBinding(ADMIN, template.id, version.id,
      { teamVersionId: team.id, teamSnapshots: { [team.id]: team } }, 'thunder-binding');
    await bindings.saveTeachingBundleDraft(ADMIN, template.id, version.id, binding.id,
      { ...fixture.draft, templateVersionId: version.id, teamVersionId: team.id }, 'thunder-bundle');
    await bindings.validateBinding(ADMIN, template.id, version.id, binding.id, 'thunder-validate');
    await bindings.activateBinding(ADMIN, template.id, version.id, binding.id, 'thunder-activate');
    return { versionId: version.id };
  })() : await runOpticsTemplateBootstrap({ governance, bindings, templates, bindingStore }, {
    teamVersionId: 'fullflow-team-v1', actor: ADMIN, pilotReason: 'Isolated full lifecycle behavior test', teachingBundle: fixture.draft,
    waveOptics, zeroBase, qualityReview: !waveOptics && qualityReview, guidedLessons: !waveOptics && guidedLessons,
  });
  const mastery = new MasteryDomainService(store, new MasteryReadService(store, access), access, audit, outbox);
  const artifacts = new InMemoryWorksStore();
  const facts = new InMemoryProjectEvidenceStore();
  const evidence = new ProjectEvidenceMaterializer(facts, new EmptyProjectEvidenceSource());
  const projects: WorksProjectReader = { findProject: (id: string) => store.findProject(id) };
  const teamRuntime = new TeamRuntimeService(null, audit, outbox);
  const evaluation = { calls: 0, fail: false, accepts: true, inputs: [] as LessonEvaluationInput[] };
  const evaluator: LessonQualityEvaluator = { evaluate: async (input: LessonEvaluationInput) => {
    evaluation.calls++;
    evaluation.inputs.push(input);
    if (evaluation.fail) throw new ServiceUnavailableException({ code: 'LESSON_EVALUATION_UNAVAILABLE' });
    return { providerId: 'isolated-fixture', modelId: 'controlled-evaluator', criteria: input.criteria.map(item => ({
      criterionId: item.id, meets: evaluation.accepts, feedback: evaluation.accepts ? 'Synthetic owner-contract verification.' : 'Please provide relevant evidence and explain it.',
    })) };
  } };
  const publication = new WorksPublicationReview(store, bindings, directory, artifacts, facts, evidence, audit, keys, evaluator, mastery);
  const works = new WorksService(artifacts, directory, projects, evidence, new UnconfiguredObjectStoragePresigner(), keys, audit, teamRuntime, publication);
  const coursewareStore = new InMemoryCoursewareStore(), courseware = new CoursewareService(coursewareStore, audit);
  const learningEvidence = new WorksLearningEvidenceService(store, bindings, directory, mastery, works, artifacts, evidence, facts, keys, audit, coursewareStore, evaluator);
  const plans = new LearningPlanService(store, new DeterministicPlanGenerator(), keys, audit, outbox, access, mastery, teamRuntime, bindings, learningEvidence, coursewareStore);
  const confirmedProject: LearningProjectRecord = { id: 'fullflow-project', studentId: STUDENT.id, templateVersionId: boot.versionId,
    status: 'intent_confirmed', currentStageIndex: 1, stageTotal: 10, progressPercent: 10, title: 'Optics investigation',
    subtitle: 'Compare models, observations and evidence', tags: [], createdAt: new Date(), completedAt: null };
  assert.equal(await bindings.freezeProjectBinding({ projectId: confirmedProject.id, templateVersionId: boot.versionId, boundAt: confirmedProject.createdAt }), 'frozen');
  const planId = await plans.attachConfirmedProjectPlan(confirmedProject);
  const plan = await store.findBundle(planId);
  assert.ok(plan);
  const teaching = await bindings.getFrozenTeachingBundle(confirmedProject.id, boot.versionId);
  const current = async () => {
    const project = await store.findProject(confirmedProject.id); assert.ok(project);
    const context = await resolveTutorTeachingContext(store, project, teaching);
    if (guidedLessons) {
      const view = await progress.readProgress(STUDENT, planId);
      context.lesson.currentActivity = view.sessions.find(session => session.sessionId === view.currentSessionId)?.activities?.find(activity => activity.status === 'current') ?? null;
    }
    return context;
  };
  const progress = new LearningSessionProgressService(store, access, bindings, mastery, learningEvidence, audit, coursewareStore);
  const lifecycle = new ProjectLearningLifecycleService(store, progress, bindings, mastery, learningEvidence, keys, audit, outbox);
  const assessment = new TutorLessonAssessmentService({ getProjectContext: async (id: string, student: string) => {
    assert.equal(id, confirmedProject.id); assert.equal(student, STUDENT.id);
    const context = await current(); return { project: { id }, lesson: context.lesson };
  } } as unknown as TutorService, plans, store, lifecycle);
  const teacherDirectory = { studentsOfMentor: async (id: string) => (await directory.studentsOfMentor(id)).map((userId) => ({ userId })) } as DirectoryService;
  const teacher = new TeacherService(teacherDirectory, {} as PlatformDataService, undefined,
    new InMemoryTeacherReviewRepository(audit, artifacts), store, works);
  const experiments = new TutorExperimentService(store, bindings, evidence, keys, audit, null, mastery, registry, progress, lifecycle, learningEvidence);
  return { store, templates, bindings, teaching, current, plan, planId, directory, projectId: confirmedProject.id, registry,
    mastery, plans, assessment, progress, lifecycle, teacher, works, artifacts, facts, evidence, learningEvidence, experiments, events, auditLog,
    coursewareStore, courseware, evaluation, teamRuntime };
}
