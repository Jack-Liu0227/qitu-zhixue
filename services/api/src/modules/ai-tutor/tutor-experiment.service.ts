import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { auditLogs, type Database } from '@qitu/database';
import type { GetTutorSessionResponse, TutorExperimentActionRequest, TutorExperimentActionResponse, TutorReplyBlock } from '@qitu/contracts';
import { DATABASE_TOKEN } from '../../database';
import { AuditWriter } from '../../common/audit';
import { hashRequest, IdempotencyStore } from '../../common/idempotency';
import { LearningPlanStore } from '../learning-plan/learning-plan.store';
import { TemplateBindingService } from '../templates/templates-binding.service';
import { ProjectEvidenceMaterializer } from '../works/project-evidence.service';
import { validateTutorExperimentAction } from './tutor-experiment.validation';
import type { TutorSessionRecord } from './tutor.service';
import { isLessonActivityAuthorized, type LessonActivityScope, type OpticsCandidate } from './tutor-lesson-activity';
import { MasteryDomainService } from '../mastery/mastery-domain.service';
import { PlatformRegistryService } from '../platform-registry/platform-registry.service';
import { freezeTutorRuntime } from './tutor-frozen-runtime';

type ExperimentBlock = Extract<TutorReplyBlock, { kind: 'optics_experiment' }>;
type ActionRecord = { id: string; detail: Record<string, unknown> };

@Injectable()
export class TutorExperimentService {
  private readonly actions: ActionRecord[] = [];

  constructor(
    private readonly plans: LearningPlanStore,
    private readonly bindings: TemplateBindingService,
    private readonly evidence: ProjectEvidenceMaterializer,
    private readonly idempotency: IdempotencyStore,
    private readonly audit: AuditWriter,
    @Inject(DATABASE_TOKEN) private readonly db: Database | null,
    @Optional() private readonly mastery?: MasteryDomainService,
    @Optional() private readonly registry?: PlatformRegistryService,
  ) {}

  async propose(actorId: string, scope: LessonActivityScope, candidate: OpticsCandidate, key: string): Promise<ExperimentBlock> {
    const project = await this.plans.findProject(scope.projectId);
    if (!project || project.studentId !== actorId || !project.templateVersionId) this.reject('PROJECT_REQUIRED', '需要有效的项目授权');
    if (!['practice_ready', 'practice_building'].includes(project.status)) this.reject('GATE_REQUIRED', '理论门禁通过后才能生成实践活动');
    const plan = await this.plans.findBundle(scope.planId);
    const session = plan?.sessions.find((entry) => entry.id === scope.learningSessionId);
    if (!plan || plan.plan.projectId !== project.id || plan.plan.studentUserId !== actorId || plan.plan.version !== scope.planRevision || !session) this.reject('REVISION_CHANGED', '当前课时已变化');
    const teaching = await this.bindings.getFrozenTeachingBundle(project.id, project.templateVersionId);
    const lesson = teaching.template.curriculum?.profiles.find((profile) => profile.id === teaching.scheduleProfileId)
      ?.sessions.find((entry) => entry.sessionIndex === session.lessonIndex);
    const expectedTopic = candidate.mode === 'diffraction' ? 'diffraction_slit' : 'particle_scattering';
    if (!lesson?.interactiveSpec?.enabled || lesson.interactiveSpec.domainTopic !== expectedTopic
      || session.id !== `${plan.plan.id}:${lesson.id}` || plan.plan.templateVersion !== teaching.templateVersionId
      || !lesson.objectiveIds.some((id) => `${plan.plan.id}:${id}` === scope.objectiveId)) this.reject('MODEL_NOT_SCHEDULED', '本课时未授权该实验模型');
    const actor = { id: actorId, role: 'student' as const, email: '', displayName: '' };
    if (!this.mastery || !await this.mastery.checkRequiredObjectives(actor, actorId, plan.plan.id, session.theoryObjectiveIds, this.plans)) this.reject('GATE_REQUIRED', '尚无有效的理论掌握证据');
    const validated = validateTutorExperimentAction(candidate.mode, 'run', { mode: candidate.mode, parameters: candidate.parameters });
    const frozenScope = await this.scope(project.id, actorId, session.lessonIndex);
    if (!frozenScope || frozenScope.planRevision !== scope.planRevision || frozenScope.learningSessionId !== scope.learningSessionId) this.reject('REVISION_CHANGED', '课时状态已变化');
    return {
      kind: 'optics_experiment', experimentId: `optics-${hashRequest({ scope, key }).slice(0, 32)}`,
      title: candidate.title, summary: candidate.summary, initialMode: candidate.mode,
      initialParameters: validated.auditPayload.parameters as Record<string, number>, allowedModels: [candidate.mode],
      specVersion: '1.0.0', objectiveId: `optics.wave.${candidate.mode}`, sessionIndex: session.lessonIndex,
      allowedActions: ['submit_prediction', 'run', 'record_observation'], scope: frozenScope,
      predictionGate: { required: true, submitted: false },
    };
  }

  async scope(projectId: string, studentId: string, lessonIndex: number): Promise<ExperimentBlock['scope']> {
    const project = await this.plans.findProject(projectId);
    if (!project || project.studentId !== studentId || !project.templateVersionId) return undefined;
    const plan = (await this.plans.listPlansByStudent(studentId)).find((entry) => entry.projectId === projectId);
    if (!plan) return undefined;
    const bundle = await this.plans.findBundle(plan.id);
    const session = bundle?.sessions.find((entry) => entry.lessonIndex === lessonIndex);
    if (!session) return undefined;
    const teaching = await this.bindings.getFrozenTeachingBundle(projectId, project.templateVersionId);
    const profile = teaching.template.curriculum?.profiles.find((entry) => entry.id === teaching.scheduleProfileId);
    if (!profile?.sessions.some((entry) => entry.sessionIndex === lessonIndex)) return undefined;
    return {
      planId: plan.id, planRevision: plan.version, learningSessionId: session.id,
      rubricRef: `rubric:${project.templateVersionId}:${teaching.template.rubricId}`,
      cerRef: 'cer:claim-evidence-reasoning:v1',
    };
  }

  async submit(actorId: string, record: TutorSessionRecord, experimentId: string, input: TutorExperimentActionRequest) {
    if (record.ownerId !== actorId) throw new ForbiddenException('无权访问该会话');
    const block = record.turns.flatMap((turn) => turn.blocks).find((entry): entry is ExperimentBlock =>
      entry.kind === 'optics_experiment' && entry.experimentId === experimentId);
    if (!block || !block.allowedActions.includes(input.action)) {
      throw new NotFoundException({ code: 'TUTOR_EXPERIMENT_NOT_EMITTED', message: '实验操作未由本会话下发' });
    }
    const project = record.projectId ? await this.plans.findProject(record.projectId) : null;
    if (!project || project.studentId !== actorId) this.reject('PROJECT_REQUIRED', '实验需要本人已确认的项目');
    if (project.status !== 'practice_ready' && project.status !== 'practice_building') {
      this.reject('GATE_REQUIRED', 'TheoryMastered 门禁通过后才能进入实验操作');
    }
    if (block.specVersion !== '1.0.0' || !Number.isSafeInteger(block.sessionIndex)
      || block.sessionIndex < 1 || !['optics.wave.diffraction', 'optics.wave.scattering'].includes(block.objectiveId)) {
      this.reject('PROTOCOL_REQUIRED', '实验协议需要更新，请重新打开课件');
    }
    const currentScope = await this.scope(project.id, actorId, block.sessionIndex);
    if (!block.scope || !currentScope || hashRequest(currentScope) !== hashRequest(block.scope)) {
      this.reject('REVISION_CHANGED', '学习计划已变化，请重新打开课件');
    }
    await this.assertDynamicAccess(actorId, record.projectId, block);
    const validated = validateTutorExperimentAction(block.initialMode, input.action, input.payload);
    if (block.allowedModels && !block.allowedModels.includes(validated.auditPayload.mode as 'diffraction' | 'scattering')) {
      this.reject('MODEL_NOT_SCHEDULED', '本活动未授权该实验模型');
    }
    const payload = input.payload as Record<string, unknown>;
    if (input.action === 'record_observation' &&
      (typeof payload.observation !== 'string' || !payload.observation.trim() || payload.observation.length > 500)) {
      throw new BadRequestException({ code: 'TUTOR_OBSERVATION_REQUIRED', message: '请填写模拟观察，最多 500 字' });
    }
    const scope = `student.tutor.experiment:${actorId}:${record.sessionId}:${experimentId}:${input.action}`;
    // Include the submitted prediction and run reference in identity, without logging learner text.
    const requestHash = hashRequest({ projectId: project.id, ...currentScope, payload: input.payload });
    const result = await this.idempotency.execute(scope, input.idempotencyKey, requestHash, async () => {
      const prior = await this.read(actorId, record.sessionId, experimentId);
      const actionId = hashRequest({ scope, key: input.idempotencyKey }).slice(0, 32);
      const previous = prior.find((action) => action.id === actionId);
      if (previous && previous.detail.requestHash !== requestHash) this.reject('IDEMPOTENCY_CONFLICT', '操作键已用于不同内容');
      const sameScope = prior.filter((action) => action.detail.planRevision === currentScope.planRevision
        && action.detail.planId === currentScope.planId && action.detail.mode === validated.auditPayload.mode);
      if (input.action === 'run' && block.predictionGate?.required &&
        !sameScope.some((action) => action.detail.action === 'submit_prediction')) {
        this.reject('PREDICTION_REQUIRED', '请先提交本模型的预测');
      }
      const parameters = validated.auditPayload.parameters as Record<string, number> | undefined;
      const parameterDigest = parameters ? hashRequest(parameters) : null;
      let run: ActionRecord | undefined;
      if (input.action === 'record_observation') {
        run = sameScope.find((action) => action.id === payload.runActionId && action.detail.action === 'run'
          && action.detail.parameterDigest === parameterDigest);
        if (!run) this.reject('RUN_REQUIRED', '请先运行与当前参数一致的仿真');
      }
      await this.assertDynamicAccess(actorId, record.projectId, block);
      const savedAt = new Date().toISOString();
      let observationReceipt: TutorExperimentActionResponse['observationReceipt'];
      if (run && parameters && parameterDigest) {
        const observationId = `obs-${actionId}`;
        observationReceipt = await this.evidence.saveExperimentObservation({
          studentId: actorId, objectiveId: `optics.wave.${validated.auditPayload.mode}`, parameters, observation: (payload.observation as string).trim(),
          receipt: {
            observationId, experimentId, evidenceRef: `experiment_observation:${observationId}`,
            projectId: project.id, sessionId: record.sessionId, ...currentScope,
            runActionId: run.id, parameterDigest, provenance: 'simulated_observation', savedAt,
          },
        });
      }
      const detail = {
        actionId, requestHash, projectId: project.id, sessionId: record.sessionId, experimentId,
        ...currentScope, action: input.action, specVersion: block.specVersion, objectiveId: block.objectiveId,
        ...validated.auditPayload, parameterDigest,
        ...(observationReceipt ? { evidenceRef: observationReceipt.evidenceRef } : {}),
      };
      if (!previous) await this.audit.write({
        actorId, actorRole: 'student', action: 'tutor.experiment.action', targetType: 'tutor_experiment',
        targetId: experimentId, idempotencyKey: `${scope}:${input.idempotencyKey}`, detail,
      });
      if (!this.db && !previous) this.actions.push({ id: actionId, detail });
      const response: TutorExperimentActionResponse = {
        accepted: true, actionId, experimentId, action: input.action,
        ...(input.action === 'run' ? { simulationResult: validated.simulationResult } : {}),
        ...(observationReceipt ? { observationReceipt } : {}),
      };
      return { status: 201, body: response };
    });
    return result.body;
  }

  /** Existing legacy cards retain their original gate; new dynamic cards also honor immediate tool revocation. */
  private async assertDynamicAccess(actorId: string, projectId: string | null, block: ExperimentBlock): Promise<void> {
    if (!block.allowedModels) return;
    if (!this.registry || !this.mastery || !block.scope || !projectId) this.reject('AUTHORIZATION_REQUIRED', '动态实验授权暂不可用');
    const project = await this.plans.findProject(projectId);
    if (!project || project.studentId !== actorId || !project.templateVersionId
      || !['practice_ready', 'practice_building'].includes(project.status)) this.reject('GATE_REQUIRED', '当前项目未获得实践授权');
    const plan = await this.plans.findBundle(block.scope.planId);
    const session = plan?.sessions.find((entry) => entry.id === block.scope!.learningSessionId);
    if (!plan || plan.plan.projectId !== projectId || plan.plan.studentUserId !== actorId
      || plan.plan.version !== block.scope.planRevision || !session) this.reject('REVISION_CHANGED', '课时状态已变化');
    const bundle = await this.bindings.getFrozenTeachingBundle(projectId, project.templateVersionId);
    const lesson = bundle.template.curriculum?.profiles.find((entry) => entry.id === bundle.scheduleProfileId)
      ?.sessions.find((entry) => entry.sessionIndex === session.lessonIndex);
    const mode = block.allowedModels[0];
    const topic = mode === 'diffraction' ? 'diffraction_slit' : mode === 'scattering' ? 'particle_scattering' : null;
    if (!lesson?.interactiveSpec?.enabled || lesson.interactiveSpec.domainTopic !== topic || block.allowedModels.length !== 1
      || session.lessonIndex !== block.sessionIndex || session.id !== `${plan.plan.id}:${lesson.id}`
      || plan.plan.templateVersion !== bundle.templateVersionId) this.reject('MODEL_NOT_SCHEDULED', '当前课时未授权该模型');
    const routes = bundle.sessionRoutes.filter((route) => route.sessionIndex === session.lessonIndex);
    const role = routes.length === 1 ? bundle.roles.find((entry) => entry.roleSlotId === routes[0]!.roleSlotId) : undefined;
    if (!role?.modelByPurpose.dialogue) this.reject('AUTHORIZATION_REQUIRED', '课时导师授权缺失');
    const runtime = freezeTutorRuntime(await this.registry.getAssistantRuntime(role.assistantId), role,
      this.registry.isModelAvailable(role.modelByPurpose.dialogue));
    if (!isLessonActivityAuthorized(runtime)) this.reject('AUTHORIZATION_REVOKED', '本实验的教学工具授权已撤销');
    const actor = { id: actorId, role: 'student' as const, email: '', displayName: '' };
    if (!await this.mastery.checkRequiredObjectives(actor, actorId, plan.plan.id, session.theoryObjectiveIds, this.plans)) {
      this.reject('GATE_REQUIRED', '当前理论掌握证据未满足实践门禁');
    }
  }

  private async read(actorId: string, sessionId: string, experimentId: string): Promise<ActionRecord[]> {
    const rows = this.db ? await this.db.select({ detail: auditLogs.detail }).from(auditLogs).where(and(
      eq(auditLogs.actorId, actorId), eq(auditLogs.action, 'tutor.experiment.action'),
      eq(auditLogs.targetType, 'tutor_experiment'), eq(auditLogs.targetId, experimentId),
    )) : this.actions;
    return rows.flatMap(({ detail }) => {
      if (!detail || typeof detail !== 'object' || Array.isArray(detail)) return [];
      const value = detail as Record<string, unknown>;
      return value.sessionId === sessionId && typeof value.actionId === 'string' ? [{ id: value.actionId, detail: value }] : [];
    });
  }

  async restore(record: TutorSessionRecord, response: GetTutorSessionResponse): Promise<GetTutorSessionResponse> {
    if (!record.projectId || !response.turns.some((turn) => turn.blocks.some((block) => block.kind === 'optics_experiment'))) return response;
    const receipts = await this.evidence.experimentReceipts(record.projectId, record.ownerId, record.sessionId);
    return { ...response, turns: response.turns.map((turn) => ({ ...turn, blocks: turn.blocks.map((block) => {
      if (block.kind !== 'optics_experiment') return block;
      const saved = receipts.filter((receipt) => receipt.experimentId === block.experimentId)
        .sort((a, b) => b.savedAt.localeCompare(a.savedAt))[0];
      return saved ? { ...block, savedObservation: saved } : block;
    }) })) };
  }

  private reject(suffix: string, message: string): never {
    throw new ConflictException({ code: `TUTOR_EXPERIMENT_${suffix}`, message });
  }
}
