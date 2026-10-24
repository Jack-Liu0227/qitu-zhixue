import { WorksLearningEvidenceService } from '../works/works-learning-evidence.service';
import type { CurrentUser } from '@qitu/contracts';
import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException, Optional, ServiceUnavailableException } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { auditLogs, type Database } from '@qitu/database';
import type { GetTutorSessionResponse, ProjectStage, TutorExperimentActionRequest, TutorExperimentActionResponse, TutorReplyBlock, SavedWaveExperiment } from '@qitu/contracts';
import { hasLearningSessionCompletion } from '@qitu/contracts';
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
import { isWaveActivityAuthorized, WAVE_ACTIVITY_TOOL } from './tutor-lesson-activity';
import { parseWaveOpticsParameters, projectWaveOptics, WaveOpticsDomainError } from '@qitu/ai-client';
import { LearningSessionProgressService } from '../learning-plan/learning-session-progress.service';
import { ProjectLearningLifecycleService } from '../projects/project-learning-lifecycle.service';

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
    @Optional() private readonly lessonProgress?: LearningSessionProgressService,
    @Optional() private readonly lifecycle?: ProjectLearningLifecycleService,
    @Optional() private readonly learningEvidence?: WorksLearningEvidenceService,
  ) {}

  async propose(actorId: string, scope: LessonActivityScope, candidate: OpticsCandidate, key: string): Promise<ExperimentBlock> {
    const project = await this.plans.findProject(scope.projectId);
    if (!project || project.studentId !== actorId || !project.templateVersionId) this.reject('PROJECT_REQUIRED', '需要有效的项目授权');
    this.assertOpenOrRecoverableStage(project.status);
    const plan = await this.plans.findBundle(scope.planId);
    const session = plan?.sessions.find((entry) => entry.id === scope.learningSessionId);
    if (!plan || plan.plan.projectId !== project.id || plan.plan.studentUserId !== actorId || plan.plan.version !== scope.planRevision || !session) this.reject('REVISION_CHANGED', '当前课时已变化');
    const teaching = await this.bindings.getFrozenTeachingBundle(project.id, project.templateVersionId);
    const lesson = teaching.template.curriculum?.profiles.find((profile) => profile.id === teaching.scheduleProfileId)
      ?.sessions.find((entry) => entry.sessionIndex === session.lessonIndex);
    const expectedTopic = candidate.mode === 'diffraction' ? 'diffraction_slit' : candidate.mode === 'interference' ? 'double_slit_interference' : 'particle_scattering';
    if (!lesson?.interactiveSpec?.enabled || lesson.interactiveSpec.domainTopic !== expectedTopic
      || session.id !== `${plan.plan.id}:${lesson.id}` || plan.plan.templateVersion !== teaching.templateVersionId
      || !lesson.objectiveIds.some((id) => `${plan.plan.id}:${id}` === scope.objectiveId)) this.reject('MODEL_NOT_SCHEDULED', '本课时未授权该实验模型');
    const actor = { id: actorId, role: 'student' as const, email: '', displayName: '' };
    if (!this.mastery || !await this.mastery.checkRequiredObjectives(actor, actorId, plan.plan.id, session.theoryObjectiveIds, this.plans)) this.reject('GATE_REQUIRED', '尚无有效的理论掌握证据');
    const specVersion = lesson.requiredToolIds?.includes(WAVE_ACTIVITY_TOOL) ? '2.0.0' : '1.0.0';
    const validated = validateTutorExperimentAction(candidate.mode, 'run', { mode: candidate.mode, parameters: candidate.parameters }, specVersion);
    const frozenScope = await this.scope(project.id, actorId, session.lessonIndex, scope.objectiveId);
    if (!frozenScope || frozenScope.planRevision !== scope.planRevision || frozenScope.learningSessionId !== scope.learningSessionId) this.reject('REVISION_CHANGED', '课时状态已变化');
    if (specVersion === '2.0.0' && (!scope.activityId || frozenScope.activityId !== scope.activityId)) this.reject('ACTIVITY_CHANGED', '当前实践活动已变化');
    await this.recoverPracticeStage(actorId, project.id, project.status, scope.planId, key);
    const block: ExperimentBlock = {
      kind: 'optics_experiment', experimentId: `optics-${hashRequest({ scope, key }).slice(0, 32)}`,
      title: candidate.title, summary: candidate.summary, initialMode: candidate.mode,
      initialParameters: validated.auditPayload.parameters as Record<string, number>, allowedModels: [candidate.mode],
      specVersion, objectiveId: `optics.wave.${candidate.mode}`, sessionIndex: session.lessonIndex,
      allowedActions: ['submit_prediction', 'run', 'record_observation'], scope: frozenScope,
      predictionGate: { required: true, submitted: false },
    };
    if (specVersion === '2.0.0') await this.assertDynamicAccess(actorId, project.id, block);
    return block;
  }

  async scope(projectId: string, studentId: string, lessonIndex: number, requestedObjectiveId?: string): Promise<ExperimentBlock['scope']> {
    const project = await this.plans.findProject(projectId);
    if (!project || project.studentId !== studentId || !project.templateVersionId) return undefined;
    const plan = (await this.plans.listPlansByStudent(studentId)).find((entry) => entry.projectId === projectId);
    if (!plan) return undefined;
    const bundle = await this.plans.findBundle(plan.id);
    const session = bundle?.sessions.find((entry) => entry.lessonIndex === lessonIndex);
    if (!session) return undefined;
    const teaching = await this.bindings.getFrozenTeachingBundle(projectId, project.templateVersionId);
    const profile = teaching.template.curriculum?.profiles.find((entry) => entry.id === teaching.scheduleProfileId);
    const lesson = profile?.sessions.find((entry) => entry.sessionIndex === lessonIndex);
    if (!profile || !lesson || session.id !== `${plan.id}:${lesson.id}`) return undefined;
    const objectiveIds = lesson.objectiveIds.map((id) => `${plan.id}:${id}`);
    const objectiveId = requestedObjectiveId ?? (objectiveIds.length === 1 ? objectiveIds[0] : undefined);
    if (!objectiveId || !objectiveIds.includes(objectiveId)) return undefined;
    if (profile.sessions.every(hasLearningSessionCompletion)) {
      const completed = new Set((await this.plans.listSessionCompletions(plan.id, plan.version)).map((entry) => entry.learningSessionId));
      const current = [...bundle!.sessions].sort((left, right) => left.index - right.index).find((entry) => !completed.has(entry.id));
      if (current?.id !== session.id) return undefined;
    }
    const activityId = lesson.requiredToolIds?.includes(WAVE_ACTIVITY_TOOL) ? await this.currentPracticeActivity(studentId, plan.id, session.id) : undefined;
    return {
      planId: plan.id, planRevision: plan.version, learningSessionId: session.id, objectiveId,
      ...(activityId ? { activityId } : {}),
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
    this.assertOpenOrRecoverableStage(project.status);
    if (!['1.0.0', '2.0.0'].includes(block.specVersion) || !Number.isSafeInteger(block.sessionIndex)
      || block.sessionIndex < 1 || !['optics.wave.diffraction', 'optics.wave.scattering', ...(block.specVersion === '2.0.0' ? ['optics.wave.interference'] : [])].includes(block.objectiveId)) {
      this.reject('PROTOCOL_REQUIRED', '实验协议需要更新，请重新打开课件');
    }
    const currentScope = await this.scope(project.id, actorId, block.sessionIndex, block.scope?.objectiveId);
    // Older cards may omit the target only when the actual frozen lesson has exactly one objective.
    const submittedScope = block.scope && { ...block.scope, objectiveId: block.scope.objectiveId ?? currentScope?.objectiveId };
    if (!submittedScope || !currentScope?.objectiveId || hashRequest(currentScope) !== hashRequest(submittedScope)) {
      this.reject('REVISION_CHANGED', '学习计划已变化，请重新打开课件');
    }
    const learningObjectiveId = currentScope.objectiveId;
    await this.recoverPracticeStage(actorId, project.id, project.status, currentScope.planId, input.idempotencyKey);
    await this.assertDynamicAccess(actorId, record.projectId, block);
    const validated = validateTutorExperimentAction(block.initialMode, input.action, input.payload, block.specVersion);
    if (block.allowedModels && !block.allowedModels.some(mode => mode === validated.auditPayload.mode)) {
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
          studentId: actorId, objectiveId: learningObjectiveId, parameters, observation: (payload.observation as string).trim(),
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
        ...(block.specVersion === '2.0.0' ? { objectiveId: learningObjectiveId, modelObjectiveId: block.objectiveId,
          modelVersion: 'wave-optics-model.v1', savedAt } : {}),
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
    if (result.body.observationReceipt && this.learningEvidence && block.scope) {
      try {
        await this.learningEvidence.evaluateLessonQuality({ id: actorId, role: 'student' } as CurrentUser,
          block.scope.planId, block.scope.learningSessionId, block.scope.planRevision, result.body.observationReceipt.evidenceRef);
      } catch (error) {
        // The saved observation remains available for a student-triggered evaluation retry.
        if (!(error instanceof ServiceUnavailableException)) throw error;
      }
    }
    return result.body;
  }

  /** Existing legacy cards retain their original gate; new dynamic cards also honor immediate tool revocation. */
  private async assertDynamicAccess(actorId: string, projectId: string | null, block: ExperimentBlock): Promise<void> {
    if (!block.allowedModels) return;
    if (!this.registry || !this.mastery || !block.scope || !projectId) this.reject('AUTHORIZATION_REQUIRED', '动态实验授权暂不可用');
    const project = await this.plans.findProject(projectId);
    if (!project || project.studentId !== actorId || !project.templateVersionId) this.reject('PROJECT_REQUIRED', '当前项目授权不可用');
    this.assertPracticeStage(project.status);
    const plan = await this.plans.findBundle(block.scope.planId);
    const session = plan?.sessions.find((entry) => entry.id === block.scope!.learningSessionId);
    if (!plan || plan.plan.projectId !== projectId || plan.plan.studentUserId !== actorId
      || plan.plan.version !== block.scope.planRevision || !session) this.reject('REVISION_CHANGED', '课时状态已变化');
    const bundle = teachingBundleForSession(await this.bindings.getFrozenTeachingBundle(projectId, project.templateVersionId), session.lessonIndex);
    const lesson = bundle.template.curriculum?.profiles.find((entry) => entry.id === bundle.scheduleProfileId)
      ?.sessions.find((entry) => entry.sessionIndex === session.lessonIndex);
    const mode = block.allowedModels[0];
    const topic = mode === 'diffraction' ? 'diffraction_slit' : mode === 'interference' ? 'double_slit_interference' : mode === 'scattering' ? 'particle_scattering' : null;
    if (!lesson?.interactiveSpec?.enabled || lesson.interactiveSpec.domainTopic !== topic || block.allowedModels.length !== 1
      || session.lessonIndex !== block.sessionIndex || session.id !== `${plan.plan.id}:${lesson.id}`
      || plan.plan.templateVersion !== bundle.templateVersionId) this.reject('MODEL_NOT_SCHEDULED', '当前课时未授权该模型');
    const routes = bundle.sessionRoutes.filter((route) => route.sessionIndex === session.lessonIndex);
    const role = routes.length === 1 ? bundle.roles.find((entry) => entry.roleSlotId === routes[0]!.roleSlotId) : undefined;
    if (!role?.modelByPurpose.dialogue) this.reject('AUTHORIZATION_REQUIRED', '课时导师授权缺失');
    const runtime = freezeTutorRuntime(await this.registry.getAssistantRuntime(role.assistantId), role,
      this.registry.isModelAvailable(role.modelByPurpose.dialogue));
    if (!isLessonActivityAuthorized(runtime)) this.reject('AUTHORIZATION_REVOKED', '本实验的教学工具授权已撤销');
    if (block.specVersion === '2.0.0' && (!lesson.requiredToolIds?.includes(WAVE_ACTIVITY_TOOL) || !isWaveActivityAuthorized(runtime))) {
      this.reject('AUTHORIZATION_REVOKED', '本课波动工具授权已撤销');
    }
    if (block.specVersion === '2.0.0' && (!block.scope.activityId
      || block.scope.activityId !== await this.currentPracticeActivity(actorId, plan.plan.id, session.id))) this.reject('ACTIVITY_CHANGED', '当前实践活动已变化');
    const actor = { id: actorId, role: 'student' as const, email: '', displayName: '' };
    if (!await this.mastery.checkRequiredObjectives(actor, actorId, plan.plan.id, session.theoryObjectiveIds, this.plans)) {
      this.reject('GATE_REQUIRED', '当前理论掌握证据未满足实践门禁');
    }
  }

  private async currentPracticeActivity(studentId: string, planId: string, sessionId: string): Promise<string> {
    if (!this.lessonProgress) this.reject('ACTIVITY_UNAVAILABLE', '课时活动服务暂不可用');
    const progress = await this.lessonProgress.readProgress({ id: studentId, role: 'student', email: '', displayName: '' }, planId);
    const activity = progress.sessions.find(session => session.sessionId === sessionId)?.activities?.find(entry => entry.status === 'current');
    if (progress.currentSessionId !== sessionId || activity?.kind !== 'practice') this.reject('ACTIVITY_CHANGED', '请在当前实践活动中操作');
    return activity.activityId;
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
    const project = await this.plans.findProject(record.projectId);
    const actionable = new Set<string>();
    for (const block of response.turns.flatMap(turn => turn.blocks)) {
      if (block.kind !== 'optics_experiment' || !block.allowedActions.length || !block.scope
        || !project || project.studentId !== record.ownerId || !['practice_ready', 'practice_building'].includes(project.status)) continue;
      try {
        const current = await this.scope(project.id, record.ownerId, block.sessionIndex, block.scope.objectiveId);
        if (!current || hashRequest(current) !== hashRequest({ ...block.scope, objectiveId: block.scope.objectiveId ?? current.objectiveId })) continue;
        await this.assertDynamicAccess(record.ownerId, project.id, block);
        actionable.add(block.experimentId);
      } catch (error) {
        // A stale activity is still readable. Unexpected storage failures remain errors.
        if (!(error instanceof ConflictException)) throw error;
      }
    }
    const receipts = await this.evidence.experimentReceipts(record.projectId, record.ownerId, record.sessionId);
    const states = new Map<string, SavedWaveExperiment>();
    for (const block of response.turns.flatMap(turn => turn.blocks)) {
      if (block.kind !== 'optics_experiment' || block.specVersion !== '2.0.0' || !block.scope) continue;
      const actions = (await this.read(record.ownerId, record.sessionId, block.experimentId)).filter(action =>
        action.detail.projectId === record.projectId && action.detail.planId === block.scope?.planId
        && action.detail.planRevision === block.scope?.planRevision && action.detail.learningSessionId === block.scope?.learningSessionId
        && action.detail.objectiveId === block.scope?.objectiveId && action.detail.mode === block.initialMode
        && action.detail.activityId === block.scope?.activityId
        && action.detail.modelVersion === 'wave-optics-model.v1');
      const runs: SavedWaveExperiment['runs'][number][] = [];
      for (const action of actions.filter(action => action.detail.action === 'run')
        .sort((a, b) => String(a.detail.savedAt).localeCompare(String(b.detail.savedAt))).slice(-3)) {
        try {
          const parameters = parseWaveOpticsParameters(action.detail.mode, action.detail.parameters);
          runs.push({ actionId: action.id, parameters, projection: projectWaveOptics(parameters) });
        } catch (error) { if (!(error instanceof WaveOpticsDomainError)) throw error; }
      }
      states.set(block.experimentId, { predictionSubmitted: actions.some(action => action.detail.action === 'submit_prediction'), runs });
    }
    return { ...response, turns: response.turns.map((turn) => ({ ...turn, blocks: turn.blocks.map((block) => {
      if (block.kind !== 'optics_experiment') return block;
      const saved = receipts.filter((receipt) => receipt.experimentId === block.experimentId)
        .sort((a, b) => b.savedAt.localeCompare(a.savedAt))[0];
      const savedExperiment = states.get(block.experimentId);
      return { ...block, allowedActions: actionable.has(block.experimentId) ? block.allowedActions : [],
        ...(saved ? { savedObservation: saved } : {}), ...(savedExperiment ? { savedExperiment } : {}) };
    }) })) };
  }

  private assertOpenOrRecoverableStage(stage: ProjectStage): void {
    if (this.lifecycle && ['intent_confirmed', 'theory_learning', 'theory_check'].includes(stage)) return;
    this.assertPracticeStage(stage);
  }

  private async recoverPracticeStage(actorId: string, projectId: string, stage: ProjectStage, planId: string, key: string): Promise<void> {
    if (!['practice_ready', 'practice_building'].includes(stage) && this.lifecycle) {
      await this.lifecycle.syncAfterAnswer({ id: actorId, role: 'student', email: '', displayName: '' }, planId,
        hashRequest({ source: 'experiment.learning.sync', projectId, key }));
      const project = await this.plans.findProject(projectId);
      if (!project || project.studentId !== actorId) this.reject('PROJECT_REQUIRED', '需要有效的项目授权');
      stage = project.status;
    }
    this.assertPracticeStage(stage);
  }

  private assertPracticeStage(stage: ProjectStage): void {
    if (['practice_ready', 'practice_building'].includes(stage)) return;
    if (['artifact_review', 'reflection', 'published', 'completed'].includes(stage)) {
      this.reject('PRACTICE_CLOSED', '项目已进入作品审核或完成阶段，此实验仅供回看，不能继续提交操作。');
    }
    this.reject('GATE_REQUIRED', '项目理论目标尚未全部达标，请先完成理论课的目标检查。');
  }

  private reject(suffix: string, message: string): never {
    throw new ConflictException({ code: `TUTOR_EXPERIMENT_${suffix}`, message });
  }
}
import { teachingBundleForSession } from '../templates/teaching-session-assignments';
