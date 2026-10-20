import { createHash } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Optional,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type {
  ConfirmLearningPlanResponse,
  AnswerInteractiveQuizResponse,
  CurrentUser,
  GenerateLearningPlanResponse,
  KnowledgeType,
  LearningErrorType,
  LearningObjectiveView,
  LearningPlanView,
  LessonModuleView,
  LessonSessionView,
  MasterySummary,
  NextStepView,
  ProjectSummary,
  PublicQuestion,
  PlanSessionCount,
  StartSessionResponse,
  SubmitAnswerResponse,
  SubmitEvidenceResponse,
  TutorReplyBlock,
} from '@qitu/contracts';
// 门禁契约里的**值**导出（+ 对应的类型）：注册表是门禁 id 的真源。必须走值
// 导入——`import type` 下 `GATE_CONDITION_REGISTRY` 只能当类型用，取不到 `gateId`。
import {
  GATE_CONDITION_REGISTRY,
  isRegisteredGateCondition,
  type GateConditionId,
} from '@qitu/contracts';
import {
  buildQuestion,
  computeMasteryScore,
  computeTheoryMastered,
  deriveObjectiveStatus,
  gradeAnswer,
  isReviewDue,
  masteryBasisPoints,
  nextAction,
  qualityBasisPoints,
  toPublicQuestion,
  type ObjectiveMasteryState,
  type QuestionCard,
} from '@qitu/ai-client';
import { IdempotencyStore } from '../../common/idempotency/idempotency.service';
import { hashIdempotentInput } from '../../common/idempotency/idempotency.hash';
import { throwHttpForIdempotencyError } from '../../common/idempotency/idempotency.errors';
import { AuditWriter, type AuditTransaction } from '../../common/audit/audit.service';
import { OutboxWriter } from '../../common/outbox/outbox.service';
import { AccessPolicy } from '../../common/access/access-policy';
import { MasteryDomainService } from '../mastery/mastery-domain.service';
import { MasteryReadService } from '../mastery/mastery.service';
import { TeamRuntimeService } from '../team-runtime/team-runtime.service';
import { TemplateBindingService } from '../templates/templates-binding.service';
import {
  FORMAL_PROJECT_START_STAGE,
  computeStageProgress,
} from '../projects/intent-confirmation.state-machine';
import {
  LearningPlanStore,
  LearningPlanStoreConflictError,
  PendingQuestionConflictError,
  newId,
  type AttemptRecord,
  type MasteryEventRecord,
  type MasteryRecord,
  type ObjectiveRecord,
  type PendingQuestionRecord,
  type PlanBundle,
  type PlanRecord,
  type SessionRecord,
} from './learning-plan.store';
import {
  assertGenerateInput,
  PlanGenerationError,
  PlanGenerator,
  type GeneratePlanInput,
  type GeneratedPlan,
} from './plan-generator';
import { generatePlanFromTemplate } from './template-plan-generator';
import { OPTICS_16_TEMPLATE_SLUG } from '../templates/content/optics';
import { validateGeneratedPlan } from './session-plan-validator';
import { assertQuestionScope, dynamicQuestionBlock, dynamicQuestionEnvelope, parseChoiceQuestionCandidate, type QuestionCandidateScope, type DynamicQuestionEnvelope } from './question-candidate';
import { verifyQuestionSources, type VerifyQuestionEvidence } from './question-candidate.sources';

const PLAN_FORBIDDEN_MESSAGE = '无权访问该学习计划';
const THRESHOLD_BASIS_POINTS = 9000;
const MAX_EVIDENCE_REF_LENGTH = 200;
const MAX_EVIDENCE_SUMMARY_LENGTH = 500;

/** 服务端推进 / 门禁的稳定错误码（契约 `LearningPlanErrorCode` 子集）。 */
type ServiceErrorCode =
  | 'LEARNING_PLAN_NOT_FOUND'
  | 'LEARNING_PLAN_FORBIDDEN'
  | 'LEARNING_PLAN_TRANSITION_INVALID'
  | 'LEARNING_PLAN_INVALID'
  | 'LEARNING_SESSION_NOT_FOUND'
  | 'THEORY_MASTERED_REQUIRED'
  | 'QUESTION_NOT_AWAITING'
  | 'EVIDENCE_INVALID';

/**
 * 学习计划服务——「兴趣 → 按课时生成计划 → 逐课时掌握」的服务端真源。
 *
 * 硬约束（全部在此强制，客户端无法绕过）：
 *
 * 1. **未确认不建项目**：生成只写 `learning_plans` 草稿（`projectId=null`）；
 *    只有 `confirmPlan` 才在事务里创建唯一项目并冻结 `templateVersion`。
 * 2. **TheoryMastered 服务端计算**：`computeTheoryMastered` 只读服务端掌握记录；
 *    实践课 / 实践分块在理论达标前一律 403，客户端传入的 stage / mastery 被
 *    控制器白名单直接丢弃并在服务层拒绝。
 * 3. **判分与題库留在服务端**：题面用 `QuestionCard`（含答案与解析），下发前只经
 *    `toPublicQuestion` 结构化投影；作答请求只有 `questionId` + `answer`。
 * 4. **对象级授权**：学生只能碰自己的计划；班主任只能读当前在带的学生；越权 403。
 * 5. **幂等**：生成按 `(studentId, interest, lessonCount, lessonMinutes, templateVersion)`
 *    去重（课时数量和单课时分钟数共同构成计划形状）；
 *    confirm / answers / evidence 走 `IdempotencyStore`，重试不追加第二次尝试。
 * 6. **审计**：生成、确认、`TheoryMastered`、证据提交各写一次（`TheoryMastered`
 *    用「非达标 → 达标」的状态翻转保证 exactly-once）。
 * 7. **门禁证据桥（WS2）**：`TheoryMastered` 状态翻转后，把门禁证据交给
 *    `TeamRuntimeService.recordGateForStudent` —— 团队门禁事件、审计与待冲刷账本
 *    全部由服务端内部通道写；本服务只调用，不自己写门禁表（AGENTS.md：门禁事件
 *    服务端写入，AI 决策不直接写通过/接受）。调用点在业务提交**之后**、事务
 *    **之外**，门禁写入失败绝不回滚已成立的理论达标。
 */
@Injectable()
export class LearningPlanService {
  private readonly logger = new Logger(LearningPlanService.name);

  private readonly masteryDomain: MasteryDomainService;
  constructor(
    private readonly store: LearningPlanStore,
    private readonly generator: PlanGenerator,
    private readonly idempotency: IdempotencyStore,
    private readonly audit: AuditWriter,
    private readonly outbox: OutboxWriter,
    private readonly access: AccessPolicy,
    @Optional() mastery?: MasteryDomainService,
    /**
     * 门禁证据的唯一内部写入通道（服务器侧）。`@Optional()` 是刻意的：
     * 单测与无团队链路的部署不需要它；缺失时桥调用整体跳过，只记一条日志。
     */
    @Optional() private readonly teamRuntime?: TeamRuntimeService,
    @Optional() private readonly templateBindings?: TemplateBindingService,
  ) {
    this.masteryDomain = mastery ?? new MasteryDomainService(store, new MasteryReadService(store, access), access, audit, outbox);
  }

  /* ==================== 生成（draft，无项目） ==================== */

  async generatePlan(
    actor: CurrentUser,
    rawInput: { interest: unknown; lessonCount?: unknown; lessonMinutes?: unknown; goal?: unknown; sessionCount?: unknown; curriculumSlug?: unknown },
  ): Promise<GenerateLearningPlanResponse> {
    const input = assertGeneratePlanInput(rawInput);
    let generated: GeneratedPlan;
    if (input.curriculumSlug !== undefined) {
      if (input.curriculumSlug !== OPTICS_16_TEMPLATE_SLUG) {
        throw new BadRequestException({
          code: 'CURRICULUM_TEMPLATE_UNAVAILABLE',
          message: `???? ${input.curriculumSlug} ?????????`,
        });
      }
      const resolution = await this.resolveCurriculumTemplate(actor, input.curriculumSlug);
      generated = generatePlanFromTemplate(input, {
        templateVersion: resolution.templateVersionId,
        templateSpec: resolution.content.pbl,
      });
    } else {
      generated = this.generator.generate(input);
    }
    validateGeneratedPlan(generated);

    const signatureKey = lessonPlanSignatureKey(actor.id, generated);
    const findExisting = () => this.store.findPlanByLessonSignature(
      actor.id,
      generated.interest,
      generated.lessonCount,
      generated.lessonMinutes,
      generated.templateVersion,
      signatureKey,
    );
    const existing = await findExisting();
    if (existing !== null) return { plan: await this.toPlanView(existing), deduplicated: true };

    const bundle = this.buildBundle(actor.id, generated, new Date());
    try {
      await this.store.createPlan(bundle);
    } catch (error) {
      if (error instanceof LearningPlanStoreConflictError) {
        const raced = await findExisting();
        if (raced !== null) return { plan: await this.toPlanView(raced), deduplicated: true };
      }
      throw error;
    }
    await this.audit.write({
      actorId: actor.id,
      actorRole: actor.role,
      action: 'learning_plan.generate',
      targetType: 'learning_plan',
      targetId: bundle.plan.id,
      idempotencyKey: bundle.plan.idempotencyKey,
      detail: {
        interest: generated.interest,
        lessonCount: generated.lessonCount,
        lessonMinutes: generated.lessonMinutes,
        templateVersion: generated.templateVersion,
        modules: generated.modules.length,
        sessions: generated.sessions.length,
        objectives: generated.objectives.length,
      },
    });
    this.logger.log(`Generated plan draft=${bundle.plan.id} student=${actor.id} lessons=${generated.lessonCount}`);
    return { plan: await this.toPlanView(bundle), deduplicated: false };
  }

  /**
   * 课程模板 slug → 当前可用版本（学生端解析）。
   *
   * 只经治理/绑定读 seam（`TemplateBindingService.resolveCurriculumTemplateVersion`），
   * 不直接查模板/绑定 store。解析不到时**响亮失败**（400 `CURRICULUM_TEMPLATE_UNAVAILABLE`），
   * 绝不静默回退到通用生成器——调用方传了 slug 就必须拿到课程驱动计划。
   */
  private async resolveCurriculumTemplate(
    actor: CurrentUser,
    slug: string,
  ): Promise<{ templateVersionId: string; content: Record<string, unknown> }> {
    if (this.templateBindings === undefined) {
      throw new BadRequestException({
        code: 'CURRICULUM_TEMPLATE_UNAVAILABLE',
        message: '课程模板解析服务不可用',
      });
    }
    const resolution = await this.templateBindings.resolveCurriculumTemplateVersion(actor, slug);
    if (resolution === null) {
      throw new BadRequestException({
        code: 'CURRICULUM_TEMPLATE_UNAVAILABLE',
        message: `课程模板 ${slug} 无可用版本或生效绑定`,
      });
    }
    return { templateVersionId: resolution.templateVersionId, content: resolution.content };
  }

  /* ==================== 确认（唯一创建项目） ==================== */

  async confirmPlan(
    actor: CurrentUser,
    planId: string,
    idempotencyKey: string,
    _body: unknown = {},
  ): Promise<ConfirmLearningPlanResponse> {
    const bundle = await this.requireBundle(planId);
    this.assertOwnedStudent(actor, bundle.plan);
    if (bundle.plan.status === 'archived' || bundle.plan.status === 'completed') {
      throw new ConflictException({
        code: 'LEARNING_PLAN_TRANSITION_INVALID',
        message: `计划状态为 ${bundle.plan.status}，不能确认`,
      });
    }

    const scope = `student.learning-plan.confirm:${actor.id}:${planId}`;
    const requestHash = hashIdempotentInput(scope, { planId }, {});
    try {
      const result = await this.idempotency.execute(
        scope,
        idempotencyKey,
        requestHash,
        async () => {
          const existingProjectId = bundle.plan.projectId;
          if (existingProjectId !== null) {
            const project = await this.store.findProject(existingProjectId);
            if (project === null) throw new Error('计划引用的项目不存在（数据不一致）');
            return {
              status: 200,
              body: await this.confirmResponse(bundle, project, true),
            };
          }

          const progress = computeStageProgress(FORMAL_PROJECT_START_STAGE);
          const now = new Date();
          const confirmed = await this.store.confirmPlan({
            planId,
            now,
            project: {
              id: newId('proj'),
              studentId: actor.id,
              templateVersionId: bundle.plan.templateVersion,
              status: FORMAL_PROJECT_START_STAGE,
              currentStageIndex: progress.currentStageIndex,
              stageTotal: progress.stageTotal,
              progressPercent: progress.progressPercent,
              title: bundle.plan.goal.length > 0 ? bundle.plan.goal : bundle.plan.interest,
              subtitle: `${bundle.plan.interest} · ${bundle.plan.lessonCount} 课时`,
              tags: [bundle.plan.interest],
            },
            // F3: a formal project must carry an immutable binding snapshot. A
            // warning-only omission leaves Tutor without a governed team,
            // template, and MCP scope, so fail closed before returning success.
            commit: async (projectId, tx) => {
              if (!this.templateBindings) {
                throw new ConflictException({
                  code: 'CURRICULUM_BINDING_UNAVAILABLE',
                  message: '课程模板绑定服务不可用，无法确认项目',
                });
              }
              const outcome = await this.templateBindings.freezeProjectBinding({
                projectId,
                templateVersionId: bundle.plan.templateVersion,
                boundAt: now,
                tx,
              });
              if (outcome === 'omitted') {
                throw new ConflictException({
                  code: 'CURRICULUM_BINDING_UNAVAILABLE',
                  message: '课程模板绑定已失效，无法确认项目',
                });
              }
            },
          });

          if (confirmed.created) {
            await this.audit.write({
              actorId: actor.id,
              actorRole: actor.role,
              action: 'learning_plan.confirm',
              targetType: 'project',
              targetId: confirmed.project.id,
              idempotencyKey: `${scope}:${idempotencyKey}`,
              detail: {
                planId,
                templateVersion: bundle.plan.templateVersion,
                lessonCount: bundle.plan.lessonCount,
                lessonMinutes: bundle.plan.lessonMinutes,
                stage: FORMAL_PROJECT_START_STAGE,
              },
            });
            this.logger.log(`确认计划 plan=${planId} project=${confirmed.project.id}`);
          }

          const current = (await this.store.findBundle(planId)) ?? bundle;
          return {
            status: confirmed.created ? 201 : 200,
            body: await this.confirmResponse(current, confirmed.project, !confirmed.created),
          };
        },
      );
      const body = result.body;
      return result.replayed ? { ...body, replayed: true } : body;
    } catch (error) {
      throwHttpForIdempotencyError(error);
    }
  }

  /* ==================== 读 ==================== */

  async getPlan(actor: CurrentUser, planId: string): Promise<LearningPlanView> {
    const bundle = await this.requireBundle(planId);
    await this.assertCanRead(actor, bundle.plan);
    return this.toPlanView(bundle);
  }

  async listSessions(actor: CurrentUser, planId: string): Promise<LessonSessionView[]> {
    const bundle = await this.requireBundle(planId);
    await this.assertCanRead(actor, bundle.plan);
    const states = await this.loadStates(actor, bundle);
    return bundle.sessions
      .slice()
      .sort((a, b) => a.index - b.index)
      .map((session) => this.toSessionView(bundle, session, states));
  }

  /* ==================== 会话推进 ==================== */

  async startSession(
    actor: CurrentUser,
    planId: string,
    sessionId: string,
  ): Promise<StartSessionResponse> {
    const bundle = await this.requireBundle(planId);
    this.assertOwnedStudent(actor, bundle.plan);
    this.assertActive(bundle.plan);
    const session = await this.requireSession(bundle, sessionId);
    const states = await this.loadStates(actor, bundle);
    await this.assertPracticeGate(session, states, actor, bundle);
    return {
      session: this.toSessionView(bundle, session, states),
      nextStep: await this.nextStepView(bundle, session, states),
    };
  }

  async getNextStep(
    actor: CurrentUser,
    planId: string,
    sessionId: string,
  ): Promise<NextStepView> {
    const bundle = await this.requireBundle(planId);
    await this.assertCanRead(actor, bundle.plan);
    this.assertActive(bundle.plan);
    const session = await this.requireSession(bundle, sessionId);
    const states = await this.loadStates(actor, bundle);
    await this.assertPracticeGate(session, states, actor, bundle);
    return this.nextStepView(bundle, session, states);
  }

  /* ==================== 作答（判分 + 掌握） ==================== */

  /** Accept only a scoped server proposal; generated keys are formative evidence. */
  async acceptQuestionCandidate(
    actor: CurrentUser,
    sourceScope: QuestionCandidateScope,
    rawCandidate: unknown,
    idempotencyKey: string,
    verifyEvidence: VerifyQuestionEvidence,
  ): Promise<Extract<TutorReplyBlock, { kind: 'quiz' }>> {
    const candidate = parseChoiceQuestionCandidate(rawCandidate);
    await this.assertCandidateContext(actor, sourceScope);
    await verifyQuestionSources(candidate.sourceRefs, verifyEvidence);
    const scope = `student.learning-plan.dynamic-question:${actor.id}:${sourceScope.planId}`;
    const requestHash = hashIdempotentInput(scope, { ...sourceScope }, { ...candidate });
    const questionId = `question-${createHash('sha256').update(`${scope}:${idempotencyKey}`).digest('hex').slice(0, 40)}`;
    try {
      const result = await this.idempotency.execute(scope, idempotencyKey, requestHash, async () =>
        this.withAssessmentStore(actor.id, async scoped => {
          await scoped.assertCandidateContext(actor, sourceScope);
          const sources = await verifyQuestionSources(candidate.sourceRefs, verifyEvidence);
          const prior = await scoped.store.findPendingQuestion(questionId);
          if (prior !== null) {
            const envelope = dynamicQuestionEnvelope(prior);
            if (prior.studentUserId !== actor.id || envelope.candidateDigest !== requestHash || prior.status !== 'awaiting') {
              throw new ConflictException({ code: 'QUESTION_NOT_AWAITING', message: '该题已处理或候选内容已改变。' });
            }
            return { status: 200, body: { questionId } };
          }
          if (await scoped.store.findAwaitingQuestion(actor.id, sourceScope.planId)) {
            throw new ConflictException({ code: 'QUESTION_ALREADY_AWAITING', message: '请先完成当前待答题；新题不会替换已下发题目。' });
          }
          const options = candidate.options.map((option, index) => ({
            id: `option-${createHash('sha256').update(`${questionId}:${index}`).digest('hex').slice(0, 24)}`,
            label: String.fromCharCode(65 + index), body: option.text,
          }));
          const envelope: DynamicQuestionEnvelope = {
            schemaVersion: 'qitu.dynamic-choice.v1', kind: 'formative_choice', sourceScope: { ...sourceScope },
            correctOptionId: options[candidate.correctOptionIndex]!.id, candidateDigest: requestHash, sources,
          };
          const now = new Date();
          await scoped.store.createPendingQuestion({
            id: questionId, schoolId: await scoped.store.studentSchoolId(actor.id), studentUserId: actor.id,
            planId: sourceScope.planId, sessionId: sourceScope.learningSessionId, objectiveId: sourceScope.objectiveId,
            questionType: 'choice', prompt: candidate.prompt, options, expectedAnswer: JSON.stringify(envelope),
            explanation: candidate.explanation, difficulty: candidate.difficulty, assessmentType: 'formative',
            status: 'awaiting', attempt: 1, hintsUsed: 0, idempotencyKey: `${scope}:${idempotencyKey}`,
            askedAt: now, answeredAt: null, createdAt: now, updatedAt: now,
          }, async tx => {
            await scoped.audit.write({ actorId: actor.id, actorRole: actor.role, action: 'learning.question.generated',
              targetType: 'pending_question', targetId: questionId, idempotencyKey: `generated:${questionId}`,
              detail: { sourceScope, assessmentMode: 'formative', sourceRefs: sources.map(source => source.sourceRef) },
            }, tx);
          });
          return { status: 201, body: { questionId } };
        }));
      await this.assertCandidateContext(actor, sourceScope);
      const pending = await this.store.findPendingQuestion(result.body.questionId);
      if (pending === null || pending.studentUserId !== actor.id || pending.status !== 'awaiting' ||
          dynamicQuestionEnvelope(pending).candidateDigest !== requestHash) {
        throw new ConflictException({ code: 'QUESTION_NOT_AWAITING', message: '待答题已变化，请重新读取当前学习任务。' });
      }
      return dynamicQuestionBlock(pending);
    } catch (error) {
      if (error instanceof PendingQuestionConflictError) {
        throw new ConflictException({ code: 'QUESTION_ALREADY_AWAITING', message: '当前已有待答题，新题未覆盖原题。' });
      }
      throwHttpForIdempotencyError(error);
    }
  }

  /** Recover an accepted question after a turn persistence failure without generating another. */
  async readPendingQuestionCandidate(actor: CurrentUser, sourceScope: QuestionCandidateScope): Promise<Extract<TutorReplyBlock, { kind: 'quiz' }> | null> {
    await this.assertCandidateContext(actor, sourceScope);
    const pending = await this.store.findAwaitingQuestion(actor.id, sourceScope.planId);
    if (pending === null || pending.assessmentType !== 'formative') return null;
    const persisted = dynamicQuestionEnvelope(pending).sourceScope;
    if (Object.keys(persisted).some(key => persisted[key as keyof QuestionCandidateScope] !== sourceScope[key as keyof QuestionCandidateScope])) {
      throw new ConflictException({ code: 'QUESTION_SCOPE_MISMATCH', message: '已有待答题属于另一课时或对话，请先返回原任务。' });
    }
    return dynamicQuestionBlock(pending);
  }

  /** Historical readback uses persisted scope and attempt evidence, never a new grading decision. */
  async readQuestionCandidateResult(
    actor: CurrentUser, sourceScope: QuestionCandidateScope, questionId: string,
  ): Promise<AnswerInteractiveQuizResponse | null> {
    const bundle = await this.requireBundle(sourceScope.planId);
    this.assertOwnedStudent(actor, bundle.plan);
    const project = await this.store.findProject(sourceScope.projectId);
    if (project === null || project.studentId !== actor.id || bundle.plan.projectId !== sourceScope.projectId) {
      throw new ForbiddenException(PLAN_FORBIDDEN_MESSAGE);
    }
    const pending = await this.store.findPendingQuestion(questionId);
    if (pending === null || pending.studentUserId !== actor.id || pending.assessmentType !== 'formative') {
      throw new NotFoundException({ code: 'QUESTION_RESULT_UNAVAILABLE', message: '动态题记录不可用。' });
    }
    const envelope = dynamicQuestionEnvelope(pending);
    if (Object.keys(envelope.sourceScope).some(key => envelope.sourceScope[key as keyof QuestionCandidateScope] !== sourceScope[key as keyof QuestionCandidateScope])) {
      throw new ConflictException({ code: 'QUESTION_SCOPE_MISMATCH', message: '题目不属于该项目课时或对话。' });
    }
    if (pending.status === 'awaiting') return null;
    const attempts = (await this.store.listAttempts(actor.id, pending.objectiveId, { includeFormative: true }))
      .filter(attempt => attempt.questionId === questionId && attempt.planId === pending.planId && attempt.assessmentType === 'formative');
    const attempt = attempts[0];
    if (pending.status !== 'answered' || attempts.length !== 1 || !attempt ||
        !pending.options.some(option => option.id === attempt.userAnswer)) {
      throw new ConflictException({ code: 'QUESTION_RESULT_UNAVAILABLE', message: '已提交结果暂时无法核验，请稍后重试。' });
    }
    return {
      quizId: questionId, assessmentMode: 'formative', selectedKeys: [attempt.userAnswer!],
      correct: attempt.isCorrect, attempts: attempt.attemptCount, hintLevel: 1,
      explanation: pending.explanation, correctKeys: [envelope.correctOptionId], conceptDeltas: [],
      nextGuidance: '结合解析说明你的推理，再通过目标考核检验掌握情况。', replayed: true,
    };
  }

  private async assertCandidateContext(actor: CurrentUser, scope: QuestionCandidateScope): Promise<void> {
    if (!scope || typeof scope.planId !== 'string') throw new BadRequestException({ code: 'QUESTION_SCOPE_MISMATCH' });
    const bundle = await this.requireBundle(scope.planId);
    this.assertOwnedStudent(actor, bundle.plan);
    this.assertActive(bundle.plan);
    const session = await this.requireSession(bundle, scope.learningSessionId);
    assertQuestionScope(scope, bundle, session);
    const project = await this.store.findProject(scope.projectId);
    if (project === null || project.studentId !== actor.id) throw new ForbiddenException(PLAN_FORBIDDEN_MESSAGE);
    await this.assertPracticeGate(session, await this.loadStates(actor, bundle), actor, bundle);
  }

  private async submitFormativeAnswer(
    actor: CurrentUser, bundle: PlanBundle, session: SessionRecord, states: Map<string, ObjectiveMasteryState>,
    pending: PendingQuestionRecord, objective: ObjectiveRecord, answer: string, idempotencyKey: string,
  ): Promise<{ status: number; body: SubmitAnswerResponse }> {
    const envelope = dynamicQuestionEnvelope(pending);
    assertQuestionScope(envelope.sourceScope, bundle, session);
    if (!pending.options.some(option => option.id === answer)) {
      throw new BadRequestException({ code: 'QUESTION_OPTION_INVALID', message: '请选择本题下发的一个选项。' });
    }
    const card = { ...this.pendingToCard(pending), expectedAnswer: pending.options.find(option => option.id === envelope.correctOptionId)!.body };
    const grade = gradeAnswer(card, answer, 'awaiting');
    const now = new Date();
    const attempt: AttemptRecord = {
      id: newId('attempt'), studentUserId: actor.id, planId: bundle.plan.id, objectiveId: objective.id,
      questionId: pending.id, result: grade.result, isCorrect: grade.isCorrect, assessmentType: 'formative',
      errorType: grade.errorType, hintsUsed: pending.hintsUsed, attemptCount: pending.attempt,
      qualityBasisPoints: qualityBasisPoints(grade.score), userAnswer: answer, createdAt: now,
    };
    const completed = await this.store.completePendingQuestion({
      questionId: pending.id, answeredAt: now, attempt, mastery: null, masteryEvent: null,
      commit: async tx => {
        await this.audit.write({ actorId: actor.id, actorRole: actor.role, action: 'learning.question.formative-answered',
          targetType: 'pending_question', targetId: pending.id, idempotencyKey: `formative:${pending.id}:${idempotencyKey}`,
          detail: { planId: bundle.plan.id, objectiveId: objective.id, isCorrect: grade.isCorrect, assessmentMode: 'formative' },
        }, tx);
      },
    });
    if (!completed) throw new ConflictException({ code: 'QUESTION_NOT_AWAITING', message: '该题已作答。' });
    return { status: 200, body: {
      questionId: pending.id, assessmentMode: 'formative', correctOptionIds: [envelope.correctOptionId],
      result: grade.result, isCorrect: grade.isCorrect, score: grade.score, explanation: pending.explanation,
      errorType: grade.errorType, remediation: grade.remediation,
      mastery: this.toMasterySummary(await this.store.findMastery(actor.id, objective.id), objective),
      theoryMastered: computeTheoryMastered(session.theoryObjectiveIds, states), practiceUnlocked: this.isPracticeUnlocked(session, states), replayed: false,
    } };
  }

  async submitAnswer(
    actor: CurrentUser,
    planId: string,
    sessionId: string,
    body: { questionId: unknown; answer: unknown },
    idempotencyKey: string,
  ): Promise<SubmitAnswerResponse> {
    const bundle = await this.requireBundle(planId);
    this.assertOwnedStudent(actor, bundle.plan);
    this.assertActive(bundle.plan);
    const session = await this.requireSession(bundle, sessionId);
    const states = await this.loadStates(actor, bundle);
    await this.assertPracticeGate(session, states, actor, bundle);

    const questionId = typeof body.questionId === 'string' ? body.questionId.trim() : '';
    if (questionId.length === 0) {
      throw this.badRequest('QUESTION_NOT_AWAITING', '缺少 questionId');
    }
    if (typeof body.answer !== 'string') {
      throw this.badRequest('LEARNING_PLAN_INVALID', 'answer 必须是字符串');
    }

    const storedQuestion = await this.store.findPendingQuestion(questionId);
    if (storedQuestion?.assessmentType === 'formative') {
      const envelope = dynamicQuestionEnvelope(storedQuestion);
      if (storedQuestion.studentUserId !== actor.id) throw new ForbiddenException(PLAN_FORBIDDEN_MESSAGE);
      assertQuestionScope(envelope.sourceScope, bundle, session);
      await this.assertCandidateContext(actor, envelope.sourceScope);
    }

    const scope = `student.learning-plan.answer:${actor.id}:${planId}:${sessionId}:${questionId}`;
    const requestHash = hashIdempotentInput(
      scope,
      { planId, sessionId, questionId },
      { answer: body.answer },
    );
    let theoryMasteredFlip = false;
    try {
      const result = await this.idempotency.execute(
        scope,
        idempotencyKey,
        requestHash,
        async () => this.withAssessmentStore(actor.id, async (scoped) => {
          const fresh = await scoped.requireBundle(planId);
          scoped.assertOwnedStudent(actor, fresh.plan);
          scoped.assertActive(fresh.plan);
          const freshSession = await scoped.requireSession(fresh, sessionId);
          const freshStates = await scoped.loadStates(actor, fresh);
          await scoped.assertPracticeGate(freshSession, freshStates, actor, fresh);
          // 题面从 `pending_questions`（迁移 0009）按 id 解析：只有本人、本计划、
          // 本会话的 `awaiting` 题可判分；服务端持有 expectedAnswer / explanation。
          const pending = await scoped.store.findPendingQuestion(questionId);
          if (
            pending === null ||
            pending.studentUserId !== fresh.plan.studentUserId ||
            pending.planId !== planId ||
            pending.sessionId !== sessionId ||
            pending.status !== 'awaiting'
          ) {
            throw new ConflictException({
              code: 'QUESTION_NOT_AWAITING',
              message: '该题不属于当前会话的待答题，或已作答',
            });
          }
          const objective = scoped.objectiveIndex(fresh).get(pending.objectiveId);
          if (objective === undefined) {
            throw new ConflictException({
              code: 'QUESTION_NOT_AWAITING',
              message: '该题引用的目标不存在（数据不一致）',
            });
          }
          if (pending.assessmentType === 'formative') {
            return scoped.submitFormativeAnswer(actor, fresh, freshSession, freshStates, pending, objective, body.answer as string, idempotencyKey);
          }
          const card = scoped.pendingToCard(pending);
          const grade = gradeAnswer(card, body.answer as string, 'awaiting');
          const existing = await scoped.store.listAttempts(fresh.plan.studentUserId, objective.id);
          const attempt = scoped.buildAttempt({
            studentId: fresh.plan.studentUserId,
            planId,
            objective,
            card,
            grade,
            attemptCount: existing.length + 1,
            now: new Date(),
          });
          const wasMastered = computeTheoryMastered(freshSession.theoryObjectiveIds, freshStates);
          const nextMastery = await scoped.recomputeMastery(
            fresh.plan.studentUserId,
            fresh,
            objective,
            { correctAnswer: grade.isCorrect },
            false,
            attempt,
          );
          const answeredAt = new Date();
          const masteryEvent = await scoped.buildMasteryEvent({
            bundle: fresh,
            pending,
            objective,
            attempt,
            mastery: nextMastery,
            answeredAt,
            idempotencyKey,
          });
          const masteryToPersist = masteryEvent === null
            ? nextMastery
            : {
                ...nextMastery,
                knowledgePointId: masteryEvent.knowledgePointId,
                courseVersion: masteryEvent.courseVersion,
                sourceEventId: masteryEvent.id,
                sourceSequence: masteryEvent.sequence,
                assessmentVersion: masteryEvent.assessmentVersion,
                validFrom: masteryEvent.validFrom,
              };
          const isMastered = scoped.theoryMasteredWithCandidate(
            freshSession,
            freshStates,
            masteryToPersist,
          );
          const shouldEmitTheoryMastered = !wasMastered && isMastered;
          const completed = await scoped.store.completePendingQuestion({
            questionId,
            answeredAt,
            attempt,
            mastery: masteryToPersist,
            masteryEvent,
            commit: async (tx) => {
              await scoped.emitMasteryAssessed(masteryEvent, tx as AuditTransaction);
              if (shouldEmitTheoryMastered) {
                await scoped.emitTheoryMastered(actor, fresh, freshSession, tx as AuditTransaction);
              }
            },
          });
          if (!completed) {
            throw new ConflictException({
              code: 'QUESTION_NOT_AWAITING',
              message: '该题已作答',
            });
          }
          theoryMasteredFlip = shouldEmitTheoryMastered;

          const updatedStates = await scoped.loadStates(actor, fresh);
          return {
            status: 200,
            body: {
              questionId,
              result: grade.result,
              isCorrect: grade.isCorrect,
              score: grade.score,
              explanation: grade.explanation,
              errorType: grade.errorType,
              remediation: grade.remediation,
              mastery: scoped.toMasterySummary(masteryToPersist, objective),
              theoryMastered: isMastered,
              practiceUnlocked: scoped.isPracticeUnlocked(freshSession, updatedStates),
              replayed: false,
            } satisfies SubmitAnswerResponse,
          };
        }),
      );
      if (theoryMasteredFlip && !result.replayed) {
        await this.recordTheoryMasteredGate(actor.id, sessionId);
      }
      const resp = result.body;
      return result.replayed ? { ...resp, replayed: true } : resp;
    } catch (error) {
      throwHttpForIdempotencyError(error);
    }
  }

  /* ==================== 实践证据 ==================== */

  async submitEvidence(
    actor: CurrentUser,
    planId: string,
    sessionId: string,
    body: { objectiveId: unknown; evidenceRef: unknown; summary?: unknown },
    idempotencyKey: string,
  ): Promise<SubmitEvidenceResponse> {
    const bundle = await this.requireBundle(planId);
    this.assertOwnedStudent(actor, bundle.plan);
    this.assertActive(bundle.plan);
    const session = await this.requireSession(bundle, sessionId);
    const states = await this.loadStates(actor, bundle);
    await this.assertPracticeGate(session, states, actor, bundle);

    const objectiveId = typeof body.objectiveId === 'string' ? body.objectiveId.trim() : '';
    if (!session.practiceObjectiveIds.includes(objectiveId)) {
      throw this.badRequest('EVIDENCE_INVALID', '证据只能提交给本会话的实践目标');
    }
    const objective = this.objectiveIndex(bundle).get(objectiveId);
    if (objective === undefined) {
      throw this.badRequest('EVIDENCE_INVALID', '目标不存在');
    }
    const evidenceRef = typeof body.evidenceRef === 'string' ? body.evidenceRef.trim() : '';
    if (evidenceRef.length === 0 || evidenceRef.length > MAX_EVIDENCE_REF_LENGTH) {
      throw this.badRequest('EVIDENCE_INVALID', 'evidenceRef 长度非法');
    }
    const summary =
      typeof body.summary === 'string' ? body.summary.trim().slice(0, MAX_EVIDENCE_SUMMARY_LENGTH) : null;

    const scope = `student.learning-plan.evidence:${actor.id}:${planId}:${sessionId}:${objectiveId}`;
    const requestHash = hashIdempotentInput(
      scope,
      { planId, sessionId, objectiveId },
      { evidenceRef, summary },
    );
    let theoryMasteredFlip = false;
    try {
      const result = await this.idempotency.execute(
        scope,
        idempotencyKey,
        requestHash,
        async () => this.withAssessmentStore(actor.id, async (scoped) => {
          const fresh = await scoped.requireBundle(planId);
          const freshSession = await scoped.requireSession(fresh, sessionId);
          const existing = await scoped.store.listAttempts(fresh.plan.studentUserId, objectiveId);
          const freshStates = await scoped.loadStates(actor, fresh);
          await scoped.assertPracticeGate(freshSession, freshStates, actor, fresh);
          const wasMastered = computeTheoryMastered(freshSession.theoryObjectiveIds, freshStates);
          const attempt: AttemptRecord = {
            id: newId('attempt'),
            studentUserId: fresh.plan.studentUserId,
            planId,
            objectiveId,
            questionId: null,
            result: 'correct',
            isCorrect: true,
            assessmentType: 'qualitative',
            errorType: null,
            hintsUsed: 0,
            attemptCount: existing.length + 1,
            qualityBasisPoints: qualityBasisPoints(1),
            userAnswer: evidenceRef,
            createdAt: new Date(),
          };
          const nextMastery = await scoped.recomputeMastery(
            fresh.plan.studentUserId,
            fresh,
            objective,
            { correctAnswer: true },
            false,
            attempt,
          );
          const masteryEvent = await scoped.buildMasteryEvent({
            bundle: fresh,
            objective,
            attempt,
            mastery: nextMastery,
            answeredAt: attempt.createdAt,
            idempotencyKey,
            evidenceRefs: [`evidence:${evidenceRef}`],
            sourceType: 'practice',
          });
          const masteryToPersist = masteryEvent === null
            ? nextMastery
            : {
                ...nextMastery,
                knowledgePointId: masteryEvent.knowledgePointId,
                courseVersion: masteryEvent.courseVersion,
                sourceEventId: masteryEvent.id,
                sourceSequence: masteryEvent.sequence,
                assessmentVersion: masteryEvent.assessmentVersion,
                validFrom: masteryEvent.validFrom,
              };
          const isMastered = scoped.theoryMasteredWithCandidate(freshSession, freshStates, masteryToPersist);
          const shouldEmitTheoryMastered = !wasMastered && isMastered;
          await scoped.store.completeAssessment({
            attempt,
            mastery: masteryToPersist,
            masteryEvent,
            commit: async (tx) => {
              await scoped.emitMasteryAssessed(masteryEvent, tx as AuditTransaction);
              if (shouldEmitTheoryMastered) {
                await scoped.emitTheoryMastered(actor, fresh, freshSession, tx as AuditTransaction);
              }
              await scoped.audit.write({
                actorId: actor.id,
                actorRole: actor.role,
                action: 'learning_plan.evidence',
                targetType: 'learning_objective',
                targetId: objectiveId,
                idempotencyKey: `${scope}:${idempotencyKey}`,
                detail: { planId, sessionId, knowledgeType: objective.type },
              }, tx as AuditTransaction);
            },
          });
          theoryMasteredFlip = shouldEmitTheoryMastered;
          const updatedStates = await scoped.loadStates(actor, fresh);
          return {
            status: 201,
            body: {
              objectiveId,
              accepted: true,
              theoryMastered: isMastered,
              practiceUnlocked: scoped.isPracticeUnlocked(freshSession, updatedStates),
              replayed: false,
            } satisfies SubmitEvidenceResponse,
          };
        }),
      );
      const resp = result.body;
      if (theoryMasteredFlip && !result.replayed) {
        await this.recordTheoryMasteredGate(actor.id, sessionId);
      }
      return result.replayed ? { ...resp, replayed: true } : resp;
    } catch (error) {
      throwHttpForIdempotencyError(error);
    }
  }

  /**
   * 门禁证据桥：`TheoryMastered` 状态翻转后，把证据交给团队运行时的**唯一内部
   * 写入通道**（`recordGateForStudent`）。本服务不写门禁事件表、不写账本、也不
   * 自行判定门禁达成——它只递交证据引用。
   *
   * 三条硬约束（改这里之前先读）：
   *
   * 1. **必须在业务事务之外调用**：门禁写入失败不得回滚已成立的理论达标
   *    （`projects.service.ts` / `works.service.ts` 的同一判据）；
   * 2. **`evidenceRef` 必须稳定**：门禁幂等键是字面量
   *    `gate:<student>:<gate>:<evidenceRef>`，不做哈希。用「每题一个 / 带时间戳」
   *    的引用会在翻转之后每答一题都新写一条门禁事件，而事件表没有库级兜底
   *    （唯一约束在待冲刷账本上）。故按 (student, gate, session) 稳定。
   * 3. **`source` 必须在白名单内**：`learning-plan.theory-mastered` 是
   *    `TheoryMastered` 门禁登记的生产者身份，写侧白名单表驱动校验。
   *
   * 三种返回（recorded / already_satisfied / deferred）一律视为成功：学生尚未
   * 进入团队链路时证据进待冲刷账本，由 `startRun` 后续物化。
   */
  private async recordTheoryMasteredGate(studentId: string, sessionId: string): Promise<void> {
    if (this.teamRuntime === undefined) {
      // 未装配团队运行时（单测 / 无团队链路的部署）：只记日志，不改变业务结果。
      this.logger.log(`门禁桥未装配，跳过 TheoryMastered 证据（session=${sessionId}）`);
      return;
    }
    try {
      await this.teamRuntime.recordGateForStudent({
        studentUserId: studentId,
        gate: CONCEPT_MASTERY_GATE,
        evidenceRef: theoryMasteredEvidenceRef(sessionId),
        source: 'learning-plan.theory-mastered',
      });
    } catch (error) {
      this.logger.warn(
        `门禁证据写入失败（不影响已成立的理论达标） session=${sessionId} err=${(error as Error)?.message ?? error}`,
      );
    }
  }

  /**
   * F1 判分门禁桥（A2）：在**调用方自有的事务**内评估 TheoryMastered 门禁，
   * 与 `submitAnswer` 共用 `computeTheoryMastered` / `theoryMasteredWithCandidate`，
   * 不再在 tutor 判分侧重写一份门禁逻辑。调用方（TutorQuizService）传入事务
   * 作用域 store，本方法不开启任何事务。
   */
  async evaluateGradingGate(input: {
    store: LearningPlanStore;
    bundle: PlanBundle;
    session: SessionRecord;
    candidateMastery: MasteryRecord;
  }): Promise<{ theoryMastered: boolean; practiceUnlocked: boolean; theoryMasteredFlip: boolean }> {
    const states = await this.loadStatesFromStore(input.store, input.bundle.plan.studentUserId, input.bundle);
    const wasMastered = computeTheoryMastered(input.session.theoryObjectiveIds, states);
    const isMastered = this.theoryMasteredWithCandidate(input.session, states, input.candidateMastery);
    const updatedStates = new Map(states);
    updatedStates.set(
      input.candidateMastery.objectiveId,
      this.toState(input.candidateMastery, input.candidateMastery.knowledgeType),
    );
    return {
      theoryMastered: isMastered,
      practiceUnlocked: this.isPracticeUnlocked(input.session, updatedStates),
      theoryMasteredFlip: !wasMastered && isMastered,
    };
  }

  /**
   * F1 判分门禁桥（A2）：在调用方评估事务的 commit 回调里发掌握度评估 /
   * 理论达标审计与 outbox 事件，复用 `submitAnswer` 的同一对 helper。
   */
  async emitGradingAssessmentEvents(
    input: {
      actor: CurrentUser;
      bundle: PlanBundle;
      session: SessionRecord;
      masteryEvent: MasteryEventRecord | null;
      theoryMasteredFlip: boolean;
    },
    tx?: AuditTransaction,
  ): Promise<void> {
    if (input.masteryEvent !== null) {
      await this.emitMasteryAssessed(input.masteryEvent, tx as AuditTransaction);
    }
    if (input.theoryMasteredFlip) {
      // 与 `submitAnswer` 同构：事务内只写达标审计与 outbox，**不**直写门禁。
      // 门禁由调用方在提交后走 `applyGradingGateBridge`（best-effort、幂等键
      // `gate:${student}:${gate}:${evidenceRef}` 兜底），团队链路故障不得让
      // 一次正确作答整体回滚。
      await this.emitTheoryMastered(input.actor, input.bundle, input.session, tx);
    }
  }

  /**
   * F1 判分门禁桥（A2）：判分调用方在评估事务 commit 回调中写入门禁证据。
   * 事务失败时掌握度、达标事件与门禁证据一并回滚。
   */
  async applyGradingGateBridge(studentId: string, sessionId: string): Promise<void> {
    await this.recordTheoryMasteredGate(studentId, sessionId);
  }

  private async withAssessmentStore<T>(studentId: string, work: (scoped: LearningPlanService) => Promise<T>): Promise<T> {
    return this.store.withAssessmentTransaction(studentId, async (scopedStore) => {
      // 作用域实例必须**原样带上**可选依赖：所有 emitTheoryMastered / 门禁桥调用
      // 都发生在这个子实例上，只在外层构造器注入而这里漏传 = 静默空操作。
      const scoped = new LearningPlanService(
        scopedStore,
        this.generator,
        this.idempotency,
        this.audit,
        this.outbox,
        this.access,
        this.masteryDomain,
        this.teamRuntime,
      );
      return work(scoped);
    });
  }

  /* ==================== 内部：构造 / 映射 ==================== */

  private buildBundle(studentId: string, generated: GeneratedPlan, now: Date): PlanBundle {
    const planId = newId('plan');
    const moduleIdMap = new Map<string, string>();
    const objectiveIdMap = new Map<string, string>();
    for (const module of generated.modules) moduleIdMap.set(module.id, `${planId}:${module.id}`);
    for (const objective of generated.objectives) objectiveIdMap.set(objective.id, `${planId}:${objective.id}`);
    const remap = (id: string): string => objectiveIdMap.get(id) ?? id;

    const plan: PlanRecord = {
      id: planId,
      studentUserId: studentId,
      projectId: null,
      interest: generated.interest,
      goal: generated.goal,
      lessonCount: generated.lessonCount,
      lessonMinutes: generated.lessonMinutes,
      minutesPerSession: generated.minutesPerSession,
      templateVersion: generated.templateVersion,
      status: 'draft',
      version: 1,
      idempotencyKey: lessonPlanSignatureKey(studentId, generated),
      confirmedAt: null,
      completedAt: null,
      createdAt: now,
      updatedAt: now,
    };

    return {
      plan,
      modules: generated.modules.map((module) => ({
        id: moduleIdMap.get(module.id) ?? module.id,
        planId,
        name: module.name,
        lessonIndex: module.lessonIndex,
        objective: module.objective,
        ordinal: module.ordinal,
      })),
      objectives: generated.objectives.map((objective) => ({
        id: remap(objective.id),
        planId,
        moduleId: moduleIdMap.get(objective.moduleId) ?? objective.moduleId,
        name: objective.name,
        type: objective.type,
        objective: objective.objective,
        prerequisiteIds: objective.prerequisiteIds.map(remap),
        ordinal: objective.ordinal,
        conceptId: objective.conceptId,
      })),
      sessions: generated.sessions.map((session) => ({
        id: `${planId}:${session.id}`,
        planId,
        moduleId: moduleIdMap.get(session.moduleId) ?? session.moduleId,
        index: session.index,
        lessonIndex: session.lessonIndex,
        title: session.title,
        blocks: session.blocks.map((block) => ({
          kind: block.kind,
          minutes: block.minutes,
          ...(block.guidance === undefined ? {} : { title: block.title, guidance: block.guidance }),
          ...(block.evidenceRequirements === undefined ? {} : { evidenceRequirements: [...block.evidenceRequirements] }),
        })),
        theoryObjectiveIds: session.theoryObjectiveIds.map(remap),
        practiceObjectiveIds: session.practiceObjectiveIds.map(remap),
        mode: session.mode,
      })),
    };
  }

  private async toPlanView(bundle: PlanBundle): Promise<LearningPlanView> {
    const states = await this.loadStatesByStudent(bundle.plan.studentUserId, bundle);
    const objectiveByModule = new Map<string, ObjectiveRecord[]>();
    for (const objective of bundle.objectives) {
      const list = objectiveByModule.get(objective.moduleId) ?? [];
      list.push(objective);
      objectiveByModule.set(objective.moduleId, list);
    }
    const modules: LessonModuleView[] = bundle.modules
      .slice()
      .sort((a, b) => a.ordinal - b.ordinal)
      .map((module) => ({
        id: module.id,
        name: module.name,
        lessonIndex: module.lessonIndex,
        objective: module.objective,
        ordinal: module.ordinal,
        objectives: (objectiveByModule.get(module.id) ?? [])
          .slice()
          .sort((a, b) => a.ordinal - b.ordinal)
          .map((objective) => {
            const view: LearningObjectiveView = {
              id: objective.id,
              moduleId: objective.moduleId,
              name: objective.name,
              type: objective.type,
              objective: objective.objective,
              prerequisiteIds: [...objective.prerequisiteIds],
              ordinal: objective.ordinal,
            };
            // 课程驱动目标才带概念键；通用计划（无 conceptId）省略该字段，
            // 保持对旧客户端的投影字节兼容（不加 `conceptId: null`）。
            if (objective.conceptId !== undefined && objective.conceptId !== null) {
              view.conceptId = objective.conceptId;
            }
            return view;
          }),
      }));
    return {
      id: bundle.plan.id,
      studentUserId: bundle.plan.studentUserId,
      projectId: bundle.plan.projectId,
      interest: bundle.plan.interest,
      goal: bundle.plan.goal,
      lessonCount: bundle.plan.lessonCount,
      lessonMinutes: bundle.plan.lessonMinutes,
      minutesPerSession: bundle.plan.minutesPerSession,
      templateVersion: bundle.plan.templateVersion,
      status: bundle.plan.status,
      version: bundle.plan.version,
      sessionCount: bundle.sessions.length as PlanSessionCount,
      modules,
      sessions: bundle.sessions
        .slice()
        .sort((a, b) => a.index - b.index)
        .map((session) => this.toSessionView(bundle, session, states)),
      confirmedAt: bundle.plan.confirmedAt?.toISOString() ?? null,
      createdAt: bundle.plan.createdAt.toISOString(),
      updatedAt: bundle.plan.updatedAt.toISOString(),
    };
  }

  private toSessionView(
    bundle: PlanBundle,
    session: SessionRecord,
    states: Map<string, ObjectiveMasteryState>,
  ): LessonSessionView {
    const theoryMastered = computeTheoryMastered(session.theoryObjectiveIds, states);
    return {
      id: session.id,
      moduleId: session.moduleId,
      index: session.index,
      lessonIndex: session.lessonIndex ?? session.index + 1,
      title: session.title ?? `${bundle.plan.interest} · 第 ${session.index + 1} 节`,
      blocks: session.blocks.map((block) => ({
        kind: block.kind,
        minutes: block.minutes,
        ...(block.title === undefined ? {} : { title: block.title }),
        ...(block.guidance === undefined ? {} : { guidance: block.guidance }),
        ...(block.evidenceRequirements === undefined ? {} : { evidenceRequirements: [...block.evidenceRequirements] }),
      })),
      theoryObjectiveIds: [...session.theoryObjectiveIds],
      practiceObjectiveIds: [...session.practiceObjectiveIds],
      mode: session.mode,
      theoryMastered,
      practiceUnlocked: this.isPracticeUnlocked(session, states),
    };
  }

  private async confirmResponse(
    bundle: PlanBundle,
    project: {
      id: string;
      status: ProjectSummary['stage'];
      progressPercent: number;
      title: string;
    },
    replayed: boolean,
  ): Promise<ConfirmLearningPlanResponse> {
    const summary: ProjectSummary = {
      id: project.id,
      title: project.title,
      stage: project.status,
      progress: project.progressPercent,
    };
    return { plan: await this.toPlanView(bundle), project: summary, replayed };
  }

  /* ==================== 内部：掌握度 ==================== */

  private objectiveIndex(bundle: PlanBundle): Map<string, ObjectiveRecord> {
    return new Map(bundle.objectives.map((objective) => [objective.id, objective]));
  }

  private async loadStates(
    _actor: CurrentUser,
    bundle: PlanBundle,
  ): Promise<Map<string, ObjectiveMasteryState>> {
    // 掌握度始终按**计划所有者**读取：班主任读学生计划时不能读成自己的掌握记录。
    return this.loadStatesByStudent(bundle.plan.studentUserId, bundle);
  }

  private async loadStatesByStudent(
    studentId: string,
    bundle: PlanBundle,
  ): Promise<Map<string, ObjectiveMasteryState>> {
    return this.loadStatesFromStore(this.store, studentId, bundle);
  }

  /** 从指定 store（事务作用域或外部）读取掌握度投影，单一实现。 */
  private async loadStatesFromStore(
    store: LearningPlanStore,
    studentId: string,
    bundle: PlanBundle,
  ): Promise<Map<string, ObjectiveMasteryState>> {
    const states = new Map<string, ObjectiveMasteryState>();
    for (const objective of bundle.objectives) {
      const record = await store.findMastery(studentId, objective.id);
      if (record !== null) states.set(objective.id, this.toState(record, objective.type));
    }
    return states;
  }

  private toState(record: MasteryRecord, knowledgeType: KnowledgeType): ObjectiveMasteryState {
    return {
      objectiveId: record.objectiveId,
      knowledgeType,
      score: record.masteryBasisPoints / 10_000,
      status: record.status,
      qualitativeMastered: record.qualitativeMastered,
      intervalIndex: record.intervalIndex,
    };
  }

  private async theoryMastered(studentId: string, session: SessionRecord): Promise<boolean> {
    if (session.theoryObjectiveIds.length === 0) return false;
    const states = new Map<string, ObjectiveMasteryState>();
    for (const objectiveId of session.theoryObjectiveIds) {
      const record = await this.store.findMastery(studentId, objectiveId);
      if (record !== null) states.set(objectiveId, this.toState(record, record.knowledgeType));
    }
    return computeTheoryMastered(session.theoryObjectiveIds, states);
  }

  private isPracticeUnlocked(
    session: SessionRecord,
    states: Map<string, ObjectiveMasteryState>,
  ): boolean {
    if (session.practiceObjectiveIds.length === 0) return false;
    return computeTheoryMastered(session.theoryObjectiveIds, states);
  }

  /**
   * 实践门槛（学生侧 403）。AGENTS.md 硬规则：`TheoryMastered` 之前不得进入
   * 实践阶段，所以这条 403 **原样保留**——团队门禁事件是权威，但不替代它。
   *
   * 门禁 id 取自 WS1 的**注册表**（`GATE_CONDITION_REGISTRY`），不再在本文件
   * 硬编码第二份 `'TheoryMastered'` 真源；`practiceGateForDeliverable` 提供
   * 「交付物 → 实践门禁」的同一套映射（可运行代码 → 代码运行验证；实验/报告 →
   * 报告校验），供团队链路在有交付物元数据时使用。计划路径在确认前拿不到部署的
   * PBL 交付物（`learning_projects` 只有 templateVersionId，没有 deliverableType），
   * 因此本处不按交付物推断、也不放宽：只按理论门槛判定并把权威门禁 id 记入日志。
   */
  private async assertPracticeGate(
    session: SessionRecord,
    _states: Map<string, ObjectiveMasteryState>,
    actor: CurrentUser,
    bundle: PlanBundle,
  ): Promise<void> {
    if (session.practiceObjectiveIds.length === 0) return;
    if (!await this.masteryDomain.checkRequiredObjectives(actor, bundle.plan.studentUserId, bundle.plan.id, session.theoryObjectiveIds, this.store)) {
      this.logger.warn(
        `实践门禁未达成 session=${session.id} gate=${CONCEPT_MASTERY_GATE}`,
      );
      throw new ForbiddenException({
        code: 'THEORY_MASTERED_REQUIRED',
        message: '理论目标全部掌握前，实践分块保持锁定',
      });
    }
  }

  private async recomputeMastery(
    studentId: string,
    bundle: PlanBundle,
    objective: ObjectiveRecord,
    options: { correctAnswer: boolean },
    persist = true,
    additionalAttempt?: AttemptRecord,
  ): Promise<MasteryRecord> {
    const existing = await this.store.findMastery(studentId, objective.id);
    const attempts = await this.store.listAttempts(studentId, objective.id);
    const allAttempts = additionalAttempt === undefined ? attempts : [...attempts, additionalAttempt];
    const signals = allAttempts.map((attempt) => ({
      result: attempt.result,
      isCorrect: attempt.isCorrect,
      hintsUsed: attempt.hintsUsed,
      attemptCount: attempt.attemptCount,
    }));
    const score = computeMasteryScore(signals);
    const qualitative =
      objective.type === 'concept' || objective.type === 'design'
        ? options.correctAnswer || (existing?.qualitativeMastered ?? false)
        : false;
    const status = deriveObjectiveStatus(objective.type, {
      score,
      qualitativeMastered: qualitative,
    });
    const correct = allAttempts.filter((attempt) => attempt.isCorrect).length;
    const wrong = allAttempts.length - correct;
    const record: MasteryRecord = {
      id: existing?.id ?? newId('mastery'),
      studentUserId: studentId,
      planId: bundle.plan.id,
      objectiveId: objective.id,
      knowledgeType: objective.type,
      status,
      masteryBasisPoints: masteryBasisPoints(score),
      thresholdBasisPoints: THRESHOLD_BASIS_POINTS,
      qualitativeMastered: qualitative,
      consecutiveCorrect: correct,
      consecutiveWrong: wrong,
      intervalIndex: existing?.intervalIndex ?? 0,
      nextReviewAt: existing?.nextReviewAt ?? null,
      reviewCount: existing?.reviewCount ?? 0,
      lapseCount: existing?.lapseCount ?? 0,
      updatedAt: new Date(),
    };
    if (persist) await this.store.upsertMastery(record);
    return record;
  }

  private toMasterySummary(
    record: MasteryRecord | null,
    objective: ObjectiveRecord,
  ): MasterySummary {
    return {
      objectiveId: objective.id,
      knowledgeType: objective.type,
      status: record?.status ?? 'new',
      mastery: (record?.masteryBasisPoints ?? 0) / 10_000,
      threshold: (record?.thresholdBasisPoints ?? THRESHOLD_BASIS_POINTS) / 10_000,
      qualitativeMastered: record?.qualitativeMastered ?? false,
    };
  }

  private buildAttempt(input: {
    studentId: string;
    planId: string;
    objective: ObjectiveRecord;
    card: QuestionCard;
    grade: ReturnType<typeof gradeAnswer>;
    attemptCount: number;
    now: Date;
  }): AttemptRecord {
    return {
      id: newId('attempt'),
      studentUserId: input.studentId,
      planId: input.planId,
      objectiveId: input.objective.id,
      questionId: input.card.questionId,
      result: input.grade.result,
      isCorrect: input.grade.isCorrect,
      assessmentType: 'quiz',
      errorType: input.grade.errorType as LearningErrorType | null,
      hintsUsed: 0,
      attemptCount: input.attemptCount,
      qualityBasisPoints: qualityBasisPoints(input.grade.score),
      userAnswer: null,
      createdAt: input.now,
    };
  }

  private async buildMasteryEvent(input: {
    bundle: PlanBundle;
    pending?: PendingQuestionRecord;
    objective: ObjectiveRecord;
    attempt: AttemptRecord;
    mastery: MasteryRecord;
    answeredAt: Date;
    idempotencyKey: string;
    evidenceRefs?: string[];
    sourceType?: MasteryEventRecord['sourceType'];
  }): Promise<MasteryEventRecord | null> {
    return this.masteryDomain.prepareAssessment(this.store, input);
  }

  private theoryMasteredWithCandidate(
    session: SessionRecord,
    states: Map<string, ObjectiveMasteryState>,
    candidate: MasteryRecord,
  ): boolean {
    const projected = new Map(states);
    projected.set(candidate.objectiveId, this.toState(candidate, candidate.knowledgeType));
    return computeTheoryMastered(session.theoryObjectiveIds, projected);
  }

  private async emitMasteryAssessed(
    event: MasteryEventRecord | null,
    tx: AuditTransaction,
  ): Promise<void> {
    if (event === null) return;
    await this.audit.write({
      actorId: event.studentId, actorRole: 'student', action: 'mastery.assessed', targetType: 'mastery_event',
      targetId: event.id, idempotencyKey: `audit:${event.id}`, detail: { sourceEventId: event.sourceEventId, evidenceRefs: event.evidenceRefs },
    }, tx);
    await this.outbox.write({
      id: `mastery-assessed:${event.id}`,
      topic: 'mastery.assessed',
      payload: {
        eventId: event.id,
        studentId: event.studentId,
        knowledgePointId: event.knowledgePointId,
        courseVersion: event.courseVersion,
        eventType: event.eventType,
        sequence: event.sequence,
        validFrom: event.validFrom.toISOString(),
        recordedAt: event.recordedAt.toISOString(),
        evidenceRefs: [...event.evidenceRefs],
        assessmentVersion: event.assessmentVersion,
      },
    }, tx);
  }

  private async emitTheoryMastered(
    actor: CurrentUser,
    bundle: PlanBundle,
    session: SessionRecord,
    tx?: AuditTransaction,
  ): Promise<void> {
    await this.audit.write(
      {
        actorId: actor.id,
        actorRole: actor.role,
        action: 'learning_plan.theory_mastered',
        targetType: 'learning_session',
        targetId: session.id,
        idempotencyKey: `theory-mastered:${session.id}`,
        detail: {
          planId: bundle.plan.id,
          theoryObjectiveIds: [...session.theoryObjectiveIds],
          practiceObjectiveIds: [...session.practiceObjectiveIds],
        },
      },
      tx,
    );
    await this.outbox.write(
      {
        id: `theory-mastered:${session.id}`,
        topic: 'learning.theory_mastered',
        payload: {
          planId: bundle.plan.id,
          sessionId: session.id,
          studentUserId: bundle.plan.studentUserId,
          theoryObjectiveIds: [...session.theoryObjectiveIds],
        },
      },
      tx,
    );
  }

  /* ==================== 内部：下一步 / 題面 ==================== */

  private async nextStepView(
    bundle: PlanBundle,
    session: SessionRecord,
    states: Map<string, ObjectiveMasteryState>,
  ): Promise<NextStepView> {
    const studentId = bundle.plan.studentUserId;
    const theoryMastered = computeTheoryMastered(session.theoryObjectiveIds, states);
    const practiceUnlocked = this.isPracticeUnlocked(session, states);

    // `answer_pending` 是最高优先级：只要本计划还有一道未答题，就先把它发回去，
    // 不推进到复习 / 探测 / 练习。未答题由 `pending_questions`（迁移 0009）持久化。
    const awaiting = await this.store.findAwaitingQuestion(studentId, bundle.plan.id);
    if (awaiting !== null) {
      return this.pendingNextStepView(bundle, awaiting, theoryMastered, practiceUnlocked);
    }

    const candidates =
      session.practiceObjectiveIds.length > 0
        ? session.practiceObjectiveIds
        : session.theoryObjectiveIds;
    const objectiveIndex = this.objectiveIndex(bundle);

    let dueReviewObjectiveId: string | null = null;
    for (const objectiveId of new Set([...session.theoryObjectiveIds, ...session.practiceObjectiveIds])) {
      const record = await this.store.findMastery(studentId, objectiveId);
      if (record === null) continue;
      if (record.status !== 'mastered') continue;
      const state: ObjectiveMasteryState = {
        ...this.toState(record, record.knowledgeType),
        lastSessionIndex: session.index,
      };
      if (isReviewDue(state, session.index + 1)) {
        dueReviewObjectiveId = objectiveId;
        break;
      }
    }

    let candidate: NextStepView['objectiveId'] = null;
    let candidateObjective: ObjectiveRecord | undefined;
    for (const objectiveId of candidates) {
      const record = await this.store.findMastery(studentId, objectiveId);
      if (record === null || record.status !== 'mastered') {
        candidate = objectiveId;
        candidateObjective = objectiveIndex.get(objectiveId);
        break;
      }
    }

    const action = nextAction({
      hasPendingQuestion: false,
      dueReviewObjectiveId,
      candidate:
        candidate === null || candidateObjective === undefined
          ? null
          : {
              objectiveId: candidate,
              knowledgeType: candidateObjective.type,
              status: (await this.store.findMastery(studentId, candidate))?.status ?? 'new',
            },
    });

    const targetObjectiveId =
      action === 'review'
        ? dueReviewObjectiveId
        : action === 'complete'
          ? null
          : candidate;
    if (targetObjectiveId === null) {
      return {
        action,
        objectiveId: null,
        knowledgeType: null,
        status: null,
        gate: null,
        mastery: 0,
        threshold: THRESHOLD_BASIS_POINTS / 10_000,
        reason: action === 'complete' ? '本会话目标已全部掌握' : '当前没有待办目标',
        theoryMastered,
        practiceUnlocked,
        question: null,
      };
    }

    const objective = objectiveIndex.get(targetObjectiveId);
    if (objective === undefined) {
      throw this.badRequest('LEARNING_PLAN_INVALID', '目标不存在（数据不一致）');
    }
    const record = await this.store.findMastery(studentId, targetObjectiveId);
    const attempts = await this.store.listAttempts(studentId, targetObjectiveId);
    // 出题时持久化题面（含服务端答案 / 解析），只返回结构化投影。
    const pending = await this.ensurePendingQuestion(bundle, session, objective, attempts.length);
    const question: PublicQuestion = toPublicQuestion(this.pendingToCard(pending), pending.attempt);
    return {
      action,
      objectiveId: objective.id,
      knowledgeType: objective.type,
      status: record?.status ?? 'new',
      gate: objective.type === 'concept' || objective.type === 'design' ? 'qualitative' : 'quantitative',
      mastery: (record?.masteryBasisPoints ?? 0) / 10_000,
      threshold: (record?.thresholdBasisPoints ?? THRESHOLD_BASIS_POINTS) / 10_000,
      reason: this.actionReason(action),
      theoryMastered,
      practiceUnlocked,
      question,
    };
  }

  /**
   * 已存在未答题时的 `answer_pending` 视图：题面来自 `pending_questions`，
   * `expectedAnswer` / `explanation` 只用于服务端判分，绝不出现在响应里。
   */
  private async pendingNextStepView(
    bundle: PlanBundle,
    awaiting: PendingQuestionRecord,
    theoryMastered: boolean,
    practiceUnlocked: boolean,
  ): Promise<NextStepView> {
    const objective = this.objectiveIndex(bundle).get(awaiting.objectiveId);
    if (objective === undefined) {
      throw this.badRequest('LEARNING_PLAN_INVALID', '待答题引用的目标不存在（数据不一致）');
    }
    const record = await this.store.findMastery(bundle.plan.studentUserId, objective.id);
    return {
      action: 'answer_pending',
      objectiveId: objective.id,
      knowledgeType: objective.type,
      status: record?.status ?? 'new',
      gate: objective.type === 'concept' || objective.type === 'design' ? 'qualitative' : 'quantitative',
      mastery: (record?.masteryBasisPoints ?? 0) / 10_000,
      threshold: (record?.thresholdBasisPoints ?? THRESHOLD_BASIS_POINTS) / 10_000,
      reason: this.actionReason('answer_pending'),
      theoryMastered,
      practiceUnlocked,
      question: toPublicQuestion(this.pendingToCard(awaiting), awaiting.attempt),
    };
  }

  /**
   * 出题并落库。`(student, plan)` 至多一道未答题：若并发下已有未答题，
   * 读取并复用，保证重试不产生第二道题。
   */
  private async ensurePendingQuestion(
    bundle: PlanBundle,
    session: SessionRecord,
    objective: ObjectiveRecord,
    attemptIndex: number,
  ): Promise<PendingQuestionRecord> {
    const existing = await this.store.findAwaitingQuestion(
      bundle.plan.studentUserId,
      bundle.plan.id,
    );
    if (existing !== null) return existing;

    const card = this.buildCard(objective, attemptIndex);
    const now = new Date();
    const record: PendingQuestionRecord = {
      id: card.questionId,
      schoolId: null,
      studentUserId: bundle.plan.studentUserId,
      planId: bundle.plan.id,
      sessionId: session.id,
      objectiveId: objective.id,
      questionType: card.questionType,
      prompt: card.prompt,
      options: card.options.map((option) => ({ ...option })),
      expectedAnswer: card.expectedAnswer,
      explanation: card.explanation,
      difficulty: card.difficulty,
      assessmentType: 'quiz',
      status: 'awaiting',
      attempt: attemptIndex + 1,
      hintsUsed: 0,
      idempotencyKey: `pending-question:${bundle.plan.id}:${session.id}:${objective.id}:${attemptIndex}`,
      askedAt: now,
      answeredAt: null,
      createdAt: now,
      updatedAt: now,
    };
    try {
      await this.store.createPendingQuestion(record);
    } catch (error) {
      if (error instanceof PendingQuestionConflictError) {
        const raced = await this.store.findAwaitingQuestion(
          bundle.plan.studentUserId,
          bundle.plan.id,
        );
        if (raced !== null) return raced;
      }
      throw error;
    }
    return record;
  }

  /** 持久化记录 → 服务端题面（含答案 / 解析），仅供判分与投影，绝不下发。 */
  private pendingToCard(record: PendingQuestionRecord): QuestionCard {
    return {
      questionId: record.id,
      objectiveId: record.objectiveId,
      prompt: record.prompt,
      questionType: record.questionType,
      expectedAnswer: record.expectedAnswer,
      options: record.options.map((option) => ({ ...option })),
      explanation: record.explanation,
      difficulty: record.difficulty ?? 'medium',
      // 判分函数直接从 `expectedAnswer` 重新提取开放题关键词，此处无需求值。
      keywords: [],
    };
  }

  private actionReason(action: NextStepView['action']): string {
    switch (action) {
      case 'answer_pending':
        return '有一道题已下发，等待作答';
      case 'review':
        return '到达间隔复习时间，先复习已掌握目标';
      case 'probe':
        return '先探测当前理解，再决定下一步';
      case 'assess':
        return '概念 / 设计目标需要用自己的话证明理解';
      case 'practice':
        return '通过练习把程序性目标练到达标';
      default:
        return '本会话目标已完成';
    }
  }

  private buildCard(objective: ObjectiveRecord, index: number): QuestionCard {
    return buildQuestion({
      objective: { id: objective.id, name: objective.name, type: objective.type },
      index,
      seed: objective.id,
    });
  }

  /* ==================== 内部：授权 / 校验 ==================== */

  private async requireBundle(planId: string): Promise<PlanBundle> {
    const bundle = await this.store.findBundle(planId);
    if (bundle === null) {
      throw new NotFoundException({
        code: 'LEARNING_PLAN_NOT_FOUND',
        message: '学习计划不存在',
      });
    }
    return bundle;
  }

  private async requireSession(bundle: PlanBundle, sessionId: string): Promise<SessionRecord> {
    const session = bundle.sessions.find((item) => item.id === sessionId);
    if (session === undefined) {
      throw new NotFoundException({
        code: 'LEARNING_SESSION_NOT_FOUND',
        message: '学习会话不存在',
      });
    }
    return session;
  }

  private assertOwnedStudent(actor: CurrentUser, plan: PlanRecord): void {
    if (actor.role !== 'student' || plan.studentUserId !== actor.id) {
      throw new ForbiddenException({
        code: 'LEARNING_PLAN_FORBIDDEN',
        message: PLAN_FORBIDDEN_MESSAGE,
      });
    }
  }

  private async assertCanRead(actor: CurrentUser, plan: PlanRecord): Promise<void> {
    if (actor.role === 'student') {
      if (plan.studentUserId === actor.id) return;
      throw new ForbiddenException({ code: 'LEARNING_PLAN_FORBIDDEN', message: PLAN_FORBIDDEN_MESSAGE });
    }
    const allowed = await this.access.canReadStudent(actor, plan.studentUserId);
    if (!allowed) {
      throw new ForbiddenException({ code: 'LEARNING_PLAN_FORBIDDEN', message: PLAN_FORBIDDEN_MESSAGE });
    }
  }

  private assertActive(plan: PlanRecord): void {
    if (plan.status !== 'active') {
      throw new ConflictException({
        code: 'LEARNING_PLAN_TRANSITION_INVALID',
        message: '计划确认后才能开始会话',
      });
    }
  }

  private badRequest(code: ServiceErrorCode, message: string): BadRequestException {
    return new BadRequestException({ code, message });
  }
}

/**
 * 去重签名查询（服务层唯一入口）。
 *
 * 只按完整课时签名命中，计划形状不再由日历周期推导。
 */
export function assertGeneratePlanInput(raw: {
  interest: unknown;
  lessonCount?: unknown;
  lessonMinutes?: unknown;
  goal?: unknown;
  sessionCount?: unknown;
  curriculumSlug?: unknown;
}): GeneratePlanInput {
  return assertGenerateInput(raw);
}

function lessonPlanSignatureKey(studentId: string, generated: GeneratedPlan): string {
  const signature = hashIdempotentInput(`learning-plan:${studentId}:lesson`, {}, {
    templateVersion: generated.templateVersion,
    interest: generated.interest,
    lessonCount: generated.lessonCount,
    lessonMinutes: generated.lessonMinutes,
  });
  return `learning-plan:${studentId}:lesson:${signature}`;
}

function theoryMasteredEvidenceRef(sessionId: string): string {
  return `mastery:theory:${sessionId}`;
}

/**
 * `concept_mastery` 的门禁 id。登记表按**门禁 id** 索引（不按阶段名），
 * 所以这里直接按键取 `gateId`，取不到才回落到冻结契约的核心字面量——
 * 语义不变，但门禁 id 不再是散落在本文件里的第二份硬编码真源。
 */
const CONCEPT_MASTERY_GATE: GateConditionId =
  isRegisteredGateCondition('TheoryMastered')
    ? (GATE_CONDITION_REGISTRY['TheoryMastered']?.gateId ?? 'TheoryMastered')
    : 'TheoryMastered';
