import { BadRequestException, ConflictException, ForbiddenException, Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { CurrentUser, EvaluateMasteryInput, MasteryAssessmentResult, MasteryTimelinePort } from '@qitu/contracts';
import { AccessPolicy } from '../../common/access/access-policy';
import { AuditWriter } from '../../common/audit/audit.service';
import { OutboxWriter } from '../../common/outbox/outbox.service';
import { LearningPlanStore, type MasteryEventRecord, type MasteryRecord, type PlanBundle, type ObjectiveRecord, type AttemptRecord, type PendingQuestionRecord } from '../learning-plan/learning-plan.store';
import { projectMasteryEvents, selectMasteryAt, toMasteryCurrent } from './mastery.projection';
import { MasteryReadService } from './mastery.service';
import { masteryDate, masteryId } from './mastery.validation';

export const MASTERY_TIMELINE_PORT = Symbol('MASTERY_TIMELINE_PORT');
export const MASTERY_ASSESSMENT_VERSION = 'qitu.mastery.v1';

@Injectable()
export class MasteryDomainService {
  constructor(
    private readonly store: LearningPlanStore,
    private readonly read: MasteryReadService,
    private readonly access: AccessPolicy,
    private readonly audit: AuditWriter,
    private readonly outbox: OutboxWriter,
  ) {}

  forActor(actor: CurrentUser): MasteryTimelinePort {
    return {
      evaluate: (input) => this.evaluate(actor, input),
      getCurrent: async (input) => (await this.read.getCurrent(actor, input)).current,
      getTimeline: async (input) => (await this.read.getTimeline(actor, input)).items,
      snapshot: (input) => this.read.getSnapshot(actor, input),
      checkThreshold: async (input) => (await this.read.getThreshold(actor, input)).threshold,
      getRegressionAlerts: async (input) => (await this.read.getRegressionAlerts(actor, input)).items,
    };
  }

  async prepareAssessment(store: LearningPlanStore, input: {
    bundle: PlanBundle; objective: ObjectiveRecord; attempt: AttemptRecord; mastery: MasteryRecord;
    pending?: PendingQuestionRecord; answeredAt: Date; idempotencyKey: string;
    sourceType?: MasteryEventRecord['sourceType'];
  }): Promise<MasteryEventRecord | null> {
    const mapping = await store.findObjectiveMapping({ planId: input.bundle.plan.id, objectiveId: input.objective.id, templateVersion: input.bundle.plan.templateVersion, contentVersion: input.bundle.plan.templateVersion });
    if (!mapping) return null;
    const history = await store.listMasteryEvents({ studentUserId: input.bundle.plan.studentUserId, knowledgePointId: mapping.knowledgePointId, courseVersion: mapping.courseVersion });
    const quantitative = input.objective.type === 'memory' || input.objective.type === 'procedure';
    const source = input.pending?.id ?? input.attempt.id;
    return {
      id: `mastery-event:${source}`, schoolId: await store.studentSchoolId(input.bundle.plan.studentUserId),
      studentId: input.bundle.plan.studentUserId, knowledgePointId: mapping.knowledgePointId, courseVersion: mapping.courseVersion,
      objectiveId: input.objective.id, planId: input.bundle.plan.id, projectId: input.bundle.plan.projectId,
      eventType: 'assessed', knowledgeType: input.objective.type,
      score: quantitative ? input.mastery.masteryBasisPoints / 10000 : null, confidence: null,
      qualitativeMastered: quantitative ? null : input.mastery.qualitativeMastered,
      validFrom: input.attempt.createdAt, recordedAt: input.answeredAt,
      sequence: Math.max(0, ...history.map((event) => event.sequence)) + 1,
      evidenceRefs: [`attempt:${input.attempt.id}`], sourceType: input.sourceType ?? 'quiz',
      sourceEventId: input.attempt.id, causationId: input.attempt.id, correlationId: input.idempotencyKey,
      supersedesEventId: null, assessmentVersion: MASTERY_ASSESSMENT_VERSION, idempotencyKey: `mastery-assessment:${source}`,
    };
  }

  async reassessProjectEvidence(actor: CurrentUser, studentId: string, projectId: string): Promise<number> {
    if (!(await this.access.canReadStudent(actor, studentId))) throw new ForbiddenException('无权访问项目证据');
    const plan = (await this.store.listPlansByStudent(studentId)).find((item) => item.projectId === projectId);
    if (!plan) return 0;
    const bundle = await this.store.findBundle(plan.id);
    if (!bundle) return 0;
    let assessed = 0;
    for (const objective of bundle.objectives) {
      const record = await this.store.findMastery(studentId, objective.id);
      const source = (await this.store.listAttempts(studentId, objective.id)).at(-1);
      if (!record || !source) continue;
      const mapping = await this.store.findObjectiveMapping({ planId: plan.id, objectiveId: objective.id, templateVersion: plan.templateVersion, contentVersion: plan.templateVersion });
      if (!mapping) continue;
      const history = await this.store.listMasteryEvents({ studentUserId: studentId, knowledgePointId: mapping.knowledgePointId, courseVersion: mapping.courseVersion });
      if (history.some((event) => event.sourceEventId === source.id)) continue;
      const base = { studentId, knowledgePointId: mapping.knowledgePointId, courseVersion: mapping.courseVersion,
        objectiveId: objective.id, planId: plan.id, projectId, sourceType: source.questionId ? 'quiz' as const : 'practice' as const,
        sourceEventId: source.id, evidenceRefs: [`attempt:${source.id}`], validFrom: source.createdAt.toISOString(),
        assessmentVersion: MASTERY_ASSESSMENT_VERSION, idempotencyKey: `runtime:${source.id}` };
      await this.forActor(actor).evaluate(objective.type === 'concept' || objective.type === 'design'
        ? { ...base, knowledgeType: objective.type, qualitativeMastered: record.qualitativeMastered }
        : { ...base, knowledgeType: objective.type, score: record.masteryBasisPoints / 10000, confidence: null });
      assessed += 1;
    }
    return assessed;
  }

  async checkRequiredObjectives(actor: CurrentUser, studentId: string, planId: string, objectiveIds: readonly string[], store: LearningPlanStore = this.store): Promise<boolean> {
    if (!(await this.access.canReadStudent(actor, studentId))) throw new ForbiddenException({ code: 'MASTERY_FORBIDDEN', message: '无权读取门槛' });
    const plan = await store.findPlan(planId);
    if (!plan || plan.studentUserId !== studentId || objectiveIds.length === 0) return false;
    for (const objectiveId of objectiveIds) {
      const mapping = await store.findObjectiveMapping({ planId, objectiveId, templateVersion: plan.templateVersion, contentVersion: plan.templateVersion });
      if (!mapping) {
        const legacy = await store.findMastery(studentId, objectiveId);
        if (!legacy || (legacy.knowledgeType === 'concept' || legacy.knowledgeType === 'design'
          ? !legacy.qualitativeMastered : legacy.masteryBasisPoints < legacy.thresholdBasisPoints)) return false;
        continue;
      }
      try {
        const scopedRead = new MasteryReadService(store, this.access);
        const result = (await scopedRead.getThreshold(actor, { studentId, knowledgePointId: mapping.knowledgePointId, courseVersion: mapping.courseVersion, validAt: null, knownAt: null })).threshold;
        if (!result.met) return false;
      } catch (error) {
        if (error instanceof Error && 'getStatus' in error && (error as { getStatus(): number }).getStatus() === 404) return false;
        throw error;
      }
    }
    return true;
  }

  async evaluate(actor: CurrentUser, input: EvaluateMasteryInput): Promise<MasteryAssessmentResult> {
    if (!(await this.access.canReadStudent(actor, input.studentId)) || (actor.role !== 'student' && actor.role !== 'teacher')) {
      throw new ForbiddenException({ code: 'MASTERY_WRITE_DENIED', message: '无权执行该评估' });
    }
    const eventType = input.eventType ?? 'assessed';
    if (!['assessed', 'corrected', 'revoked'].includes(eventType)) throw invalid('eventType 无效');
    if ((eventType !== 'assessed' || input.sourceType === 'staff') && actor.role !== 'teacher') {
      throw new ForbiddenException({ code: 'MASTERY_WRITE_DENIED', message: '纠错/撤销需要当前班主任核验' });
    }
    for (const value of [input.studentId, input.knowledgePointId, input.courseVersion, input.sourceEventId, input.idempotencyKey, input.assessmentVersion]) masteryId(value, true);
    const validFrom = masteryDate(input.validFrom);
    if (validFrom > new Date()) throw invalid('评估不能在未来生效');
    if (!Array.isArray(input.evidenceRefs) || input.evidenceRefs.length === 0 || input.evidenceRefs.length > 20 || input.evidenceRefs.some((ref) => !/^[a-z_]+:[a-zA-Z0-9._:-]{1,180}$/u.test(ref))) {
      throw new BadRequestException({ code: 'MASTERY_EVIDENCE_INVALID', message: '证据必须是本地不透明引用' });
    }
    const quantitative = input.knowledgeType === 'memory' || input.knowledgeType === 'procedure';
    if (!quantitative && input.knowledgeType !== 'concept' && input.knowledgeType !== 'design') throw invalid('knowledgeType 无效');
    const score = quantitative && 'score' in input ? input.score : null;
    const qualitative = !quantitative && 'qualitativeMastered' in input ? input.qualitativeMastered : null;
    const confidence = quantitative && 'confidence' in input ? input.confidence : null;
    if (quantitative ? !bounded(score) : typeof qualitative !== 'boolean') throw invalid('评估结果类型无效');
    if (confidence !== null && !bounded(confidence)) throw invalid('confidence 无效');
    if (input.assessmentVersion !== MASTERY_ASSESSMENT_VERSION) throw new ConflictException({ code: 'MASTERY_VERSION_MISMATCH', message: '评估版本未发布' });

    return this.store.withAssessmentTransaction(input.studentId, async (scoped) => {
      const plan = input.planId ? await scoped.findBundle(input.planId) : null;
      const objective = plan?.objectives.find((item) => item.id === input.objectiveId);
      if (!plan || plan.plan.studentUserId !== input.studentId || plan.plan.projectId !== input.projectId || !objective || objective.type !== input.knowledgeType) throw invalid('评估对象范围无效');
      const mapping = await scoped.findObjectiveMapping({ planId: plan.plan.id, objectiveId: objective.id, templateVersion: plan.plan.templateVersion, contentVersion: plan.plan.templateVersion });
      if (!mapping || mapping.knowledgePointId !== input.knowledgePointId || mapping.courseVersion !== input.courseVersion) {
        throw new ConflictException({ code: 'MASTERY_MAPPING_MISSING', message: '缺少该目标的显式知识点映射' });
      }
      const attempts = await scoped.listAttempts(input.studentId, objective.id);
      const previous = await scoped.findMastery(input.studentId, objective.id);
      const source = attempts.find((attempt) => attempt.id === input.sourceEventId);
      if (input.sourceType === 'staff') {
        if (actor.role !== 'teacher' || !input.evidenceRefs.every((ref) => ref.startsWith('attempt:') && attempts.some((attempt) => ref === `attempt:${attempt.id}`))) throw invalid('教师核验必须引用该目标的已记录证据');
      } else {
        if (!source || !previous || !input.evidenceRefs.includes(`attempt:${source.id}`)
          || validFrom.getTime() !== source.createdAt.getTime()
          || (quantitative ? score !== previous.masteryBasisPoints / 10000 || confidence !== null : qualitative !== previous.qualitativeMastered)) {
          throw new BadRequestException({ code: 'MASTERY_EVIDENCE_INVALID', message: '评估与服务端判分事实不一致' });
        }
      }
      if (input.supersedesEventId) {
        const target = await scoped.findMasteryEvent(input.supersedesEventId);
        if (!target || target.studentId !== input.studentId || target.knowledgePointId !== input.knowledgePointId || target.courseVersion !== input.courseVersion) throw invalid('替代事件不属于该聚合');
      } else if (eventType !== 'assessed') throw invalid('纠错/撤销必须引用旧评估');

      const idempotencyKey = `evaluate:${input.studentId}:${input.idempotencyKey}`;
      const requestHash = createHash('sha256').update(JSON.stringify(input)).digest('hex');
      const replay = await scoped.findMasteryEventByIdempotency(idempotencyKey);
      if (replay) {
        if (replay.correlationId !== requestHash) throw new ConflictException({ code: 'MASTERY_IDEMPOTENCY_CONFLICT', message: '幂等键载荷不一致' });
        return this.result(replay, true);
      }
      const history = await scoped.listMasteryEvents({ studentUserId: input.studentId, knowledgePointId: input.knowledgePointId, courseVersion: input.courseVersion });
      const now = new Date();
      const event: MasteryEventRecord = {
        id: `me-${createHash('sha256').update(idempotencyKey).digest('hex')}`,
        schoolId: await scoped.studentSchoolId(input.studentId),
        studentId: input.studentId, knowledgePointId: input.knowledgePointId, courseVersion: input.courseVersion,
        objectiveId: objective.id, planId: plan.plan.id, projectId: input.projectId,
        eventType, knowledgeType: input.knowledgeType,
        score: eventType === 'revoked' ? null : score, confidence: eventType === 'revoked' ? null : confidence,
        qualitativeMastered: eventType === 'revoked' ? null : qualitative,
        validFrom, recordedAt: now, sequence: Math.max(0, ...history.map((item) => item.sequence)) + 1,
        evidenceRefs: [...input.evidenceRefs], sourceType: input.sourceType, sourceEventId: input.sourceEventId,
        causationId: input.causationId ?? input.sourceEventId, correlationId: requestHash,
        supersedesEventId: input.supersedesEventId ?? null, assessmentVersion: input.assessmentVersion, idempotencyKey,
      };
      const selected = selectMasteryAt(projectMasteryEvents([...history, event], now), now)[0]!;
      const current = toMasteryCurrent(selected);
      const projection: MasteryRecord | null = selected.event.id !== event.id ? null : {
        ...(previous ?? {
          id: `mastery-${event.id}`, studentUserId: input.studentId, objectiveId: objective.id,
          knowledgeType: objective.type, thresholdBasisPoints: 9000, consecutiveCorrect: 0, consecutiveWrong: 0,
          intervalIndex: 0, nextReviewAt: null, reviewCount: 0, lapseCount: 0,
        }),
        schoolId: event.schoolId, planId: plan.plan.id, status: current.status,
        masteryBasisPoints: current.score === null ? 0 : Math.round(current.score * 10000),
        qualitativeMastered: current.qualitativeMastered === true,
        knowledgePointId: event.knowledgePointId, courseVersion: event.courseVersion,
        sourceEventId: event.id, sourceSequence: event.sequence, assessmentVersion: event.assessmentVersion,
        validFrom: event.validFrom, updatedAt: now,
      };
      await scoped.commitMasteryEvaluation(event, projection, async (tx) => {
        await this.audit.write({ actorId: actor.id, actorRole: actor.role, action: `mastery.${eventType}`, targetType: 'mastery_event', targetId: event.id, idempotencyKey: `audit:${event.id}`, detail: { sourceEventId: event.sourceEventId, evidenceRefs: event.evidenceRefs } }, tx);
        await this.outbox.write({ id: `mastery-assessed:${event.id}`, topic: 'mastery.assessed', payload: { eventId: event.id } }, tx);
      });
      return { event: serialize(event), current, replayed: false };
    });
  }

  private result(event: MasteryEventRecord, replayed: boolean): MasteryAssessmentResult {
    const current = toMasteryCurrent(projectMasteryEvents([event], event.recordedAt)[0]!);
    return { event: serialize(event), current, replayed };
  }
}

function serialize(event: MasteryEventRecord) { return { ...event, validFrom: event.validFrom.toISOString(), recordedAt: event.recordedAt.toISOString() }; }
function bounded(value: unknown): value is number { return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1; }
function invalid(message: string) { return new BadRequestException({ code: 'MASTERY_INPUT_INVALID', message }); }
