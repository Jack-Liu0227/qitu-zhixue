import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { CurrentUser, EvidenceRequirement, PblRubric, ProjectReviewCandidate } from '@qitu/contracts';
import { AuditWriter } from '../../common/audit/audit.service';
import { TeamRuntimeService } from '../team-runtime/team-runtime.service';
import {
  ProjectAssessmentStore,
  assessmentCandidateKey,
  checkFromCodeReport,
  checkFromMediaVerdict,
  checkFromDocumentReport,
  type AssessmentCandidateRecord,
} from './project-assessment.store';
import {
  applyAutomaticAcceptance,
  evaluateAutomaticAcceptance,
  toAiProjectReviewCandidate,
  toAutomaticAcceptanceState,
  type AutomaticAcceptanceDecision,
} from './project-review';
import { ProjectEvidenceMaterializer } from './project-evidence.service';
import {
  documentEvidenceLabel,
  toDocumentEvidenceRef,
  validateDocumentStructure,
  type DocumentStructureProfile,
} from './assessor/document-structure-validator';
import { ArtifactBytesReader } from './assessor/artifact-bytes.reader';
import {
  MediaArtifactResolver,
  assessMediaCompliance,
  type MediaKind,
} from './assessor/media-compliance-validator';
import {
  CodeArtifactResolver,
  PythonSyntaxChecker,
  codeStaticCheckKey,
  runCodeStaticCheck,
} from './assessor/code-static-check-producer';

/**
 * P2 自动评估编排（服务端内部）。
 *
 * ============================ 职责边界 ============================
 *
 * - 本服务是**唯一**把三条链路串起来的服务端编排：确定性生产者 → 候选 → 确定性规则；
 * - 它不新增任何 HTTP 路由：证据是服务端事实（`ProjectEvidenceMaterializer`），
 *   候选与校验结论落在两张**服务端私有**表（迁移 0023）；
 * - 门禁写入只经由 `applyAutomaticAcceptance`（`project-review.ts` 里的确定性规则），
 *   本服务不做任何自己的门禁判定。
 *
 * ============================ 未成年人数据 ============================
 *
 * - 文档：只落 `validatorVersion + sha256 + 缺项 + 计数`，报告正文不进库、不进日志；
 * - 视频：只落合规结论 + 头部摘要 + 说明**长度**，帧/缩略图/转写一律不进库；
 * - 代码：只落语法结论 + 文件摘要 + 语义红线声明，源码正文不进库。
 */

export interface RecordAiCandidateInput {
  projectId: string;
  studentUserId: string;
  schoolId: string | null;
  artifactId: string;
  artifactVersionId: string;
  rubric: PblRubric;
  evidenceRequirements: readonly EvidenceRequirement[];
  /** 服务端已知可用证据（来自 project_evidence / artifact_versions）。 */
  availableEvidenceIds: readonly string[];
  /** AI 评估方输出：模型 id + 分数 + 逐条结果。 */
  modelId: string;
  score: number;
  criteria: ProjectReviewCandidate['criteria'];
  missingEvidenceIds?: readonly string[];
  /** 交付物档案：决定该验收对应哪个门禁。 */
  evidenceProfile?: 'runnable_code' | 'experiment_report' | null;
  deliverableType?: string | null;
  minimumCriterionLevel?: 0 | 1 | 2 | 3 | 4 | null;
  /** 触发器名称，进审计行（例如 'works.publish-approved'）。 */
  trigger: string;
}

export interface RecordAiCandidateResult {
  candidateKey: string;
  inserted: boolean;
  decision: AutomaticAcceptanceDecision;
  gateWrite: { written: boolean; writeStatus: string | null; reason: string | null };
}

/**
 * 自动评估的内部身份（审计用）。
 *
 * 与 `PBL_GATE_INTERNAL_ACTOR` 同一性质：**不**由认证签发、**没有**任何 HTTP
 * 路由可达，只为了让审计行说清「这是服务端自动评估链路写的，不是某个学生/教师
 * 会话写的」。`Role` 联合里没有 `'system'`，这里按既有做法就地窄化，
 * 不动认证契约。
 */
const ASSESSOR_INTERNAL_ACTOR = {
  id: 'system:pbl-assessor',
  role: 'system' as unknown as CurrentUser['role'],
} as const;

@Injectable()
export class ProjectAssessmentService {
  private readonly logger = new Logger(ProjectAssessmentService.name);

  constructor(
    private readonly store: ProjectAssessmentStore,
    private readonly evidence: ProjectEvidenceMaterializer,
    private readonly reader: ArtifactBytesReader,
    private readonly mediaResolver: MediaArtifactResolver,
    private readonly codeResolver: CodeArtifactResolver,
    private readonly syntaxChecker: PythonSyntaxChecker,
    private readonly audit: AuditWriter,
    private readonly teamRuntime: TeamRuntimeService,
  ) {}

  /* ==================== 1. 文档 / 报告结构校验 ==================== */

  async assessDocumentStructure(input: {
    projectId: string;
    studentUserId: string;
    schoolId: string | null;
    artifactId: string;
    artifactVersionId: string;
    objectKey: string;
    /** 服务端已知的作品标题（`artifact_versions.title`）。 */
    versionTitle?: string | null;
    profile?: DocumentStructureProfile;
  }): Promise<{
    verdict: string;
    sha256: string;
    missing: readonly string[];
    inserted: boolean;
    evidenceInserted: number;
  } | null> {
    const outcome = await validateDocumentStructure(this.reader, input.objectKey, {
      title: input.versionTitle ?? null,
      ...(input.profile === undefined ? {} : { profile: input.profile }),
    });
    if (outcome === null) return null;

    const check = checkFromDocumentReport({
      id: `check-${randomUUID()}`,
      schoolId: input.schoolId,
      projectId: input.projectId,
      studentUserId: input.studentUserId,
      artifactId: input.artifactId,
      artifactVersionId: input.artifactVersionId,
      report: outcome.report,
      now: new Date(),
    });
    const { inserted } = await this.store.upsertCheck(check);

    // 证据：只写引用 + 版本 + 摘要（label 里带 validatorVersion 与 digest）。
    const ref = toDocumentEvidenceRef({
      artifactId: input.artifactId,
      artifactVersionId: input.artifactVersionId,
      outcome,
    });
    const evidenceInserted = await this.evidence.ingestServerFacts([{
      projectId: input.projectId,
      studentUserId: input.studentUserId,
      schoolId: input.schoolId,
      artifactId: input.artifactId,
      columnKind: 'independent',
      sourceKind: 'artifact',
      // 幂等键由 project_evidence 的唯一索引承担：校验器版本 + 摘要进 sourceId。
      sourceId: `doc-structure:${input.artifactVersionId}:${outcome.report.validatorVersion}:${outcome.report.sha256.slice(0, 16)}`,
      label: documentEvidenceLabel(ref),
      detail: null,
      occurredAt: new Date(),
    }]);

    return {
      verdict: outcome.report.verdict,
      sha256: outcome.report.sha256,
      missing: outcome.report.missing,
      inserted,
      evidenceInserted,
    };
  }

  /* ==================== 2. 视频 / 硬件演示合规 ==================== */

  async assessMediaCompliance(input: {
    projectId: string;
    studentUserId: string;
    schoolId: string | null;
    objectKey: string;
    note: string | null | undefined;
    kind?: MediaKind;
  }): Promise<{ verdict: string; issues: readonly string[]; inserted: boolean; artifactVersionId: string }> {
    const { ref, verdict } = await assessMediaCompliance(
      { resolver: this.mediaResolver, reader: this.reader, expectedStudentId: input.studentUserId },
      input.objectKey,
      { note: input.note, ...(input.kind === undefined ? {} : { kind: input.kind }) },
    );
    const check = checkFromMediaVerdict({
      id: `check-${randomUUID()}`,
      schoolId: input.schoolId,
      projectId: input.projectId,
      studentUserId: input.studentUserId,
      artifactId: ref.artifactId,
      artifactVersionId: ref.artifactVersionId,
      verdict,
      now: new Date(),
    });
    const { inserted } = await this.store.upsertCheck(check);
    return { verdict: verdict.verdict, issues: verdict.issues, inserted, artifactVersionId: ref.artifactVersionId };
  }

  /* ==================== 3. 代码静态检查 ==================== */

  /**
   * 静态检查**不**产生候选、**不**写门禁。
   *
   * 它只留一条 `code_static` 结论行（含 `NOT_A_RUN_VERIFICATION` 声明）。
   * 「语法通过 ≠ 能运行 ≠ 可玩」——门禁 `code_playable_run_verified` 需要真实
   * 容器 runner，那是一项已声明的基础设施延后项。
   */
  async assessCodeStatic(input: {
    projectId: string;
    studentUserId: string;
    schoolId: string | null;
    artifactVersionId: string;
    entryFile: string;
    requiredFiles?: readonly string[];
  }): Promise<{ verdict: string; semanticScope: string; inserted: boolean }> {
    const report = await runCodeStaticCheck(
      { resolver: this.codeResolver, reader: this.reader, syntaxChecker: this.syntaxChecker },
      input.artifactVersionId,
      { entryFile: input.entryFile, ...(input.requiredFiles === undefined ? {} : { requiredFiles: input.requiredFiles }) },
    );
    const check = checkFromCodeReport({
      id: `check-${randomUUID()}`,
      schoolId: input.schoolId,
      projectId: input.projectId,
      studentUserId: input.studentUserId,
      artifactId: report.artifactId,
      artifactVersionId: input.artifactVersionId,
      report,
      now: new Date(),
    });
    const { inserted } = await this.store.upsertCheck(check);
    this.logger.log(
      `代码静态检查 ${input.artifactVersionId} verdict=${report.verdict} 语义范围=${report.semanticScope} key=${codeStaticCheckKey(report).slice(0, 48)}`,
    );
    return { verdict: report.verdict, semanticScope: report.semanticScope, inserted };
  }

  /* ==================== 4. AI 候选 + 确定性规则 ==================== */

  /**
   * 落库 AI 候选 → 跑确定性规则 → （仅当规则通过且门禁可写）写门禁。
   *
   * 三段职责严格分开：本方法**不**判定分数是否够、**不**挑选门禁、**不**改写候选
   * 状态；全部判定在 `evaluateAutomaticAcceptance` 里，本方法只做编排与留痕。
   *
   * 审计：每次候选写入与每次自动验收各写一行（`actorId: system:pbl-assessor`），
   * 因为自动验收去掉了唯一的人工复核点。
   */
  async recordAiCandidate(input: RecordAiCandidateInput): Promise<RecordAiCandidateResult> {
    const candidateKey = assessmentCandidateKey({
      projectId: input.projectId,
      artifactVersionId: input.artifactVersionId,
      rubricId: input.rubric.id,
      rubricVersion: input.rubric.version,
    });

    const existing = await this.store.findCandidateByKey(candidateKey);
    if (existing !== null) {
      // 重放：不重算、不重写门禁（门禁自身的幂等键在 team-runtime 里）。
      return {
        candidateKey,
        inserted: false,
        decision: evaluateAutomaticAcceptance({
          candidate: existing.candidate,
          rubric: input.rubric,
          evidenceRequirements: input.evidenceRequirements,
          availableEvidenceIds: input.availableEvidenceIds,
          evidenceProfile: input.evidenceProfile ?? null,
          deliverableType: input.deliverableType ?? null,
          ...(input.minimumCriterionLevel === undefined ? {} : { minimumCriterionLevel: input.minimumCriterionLevel }),
        }),
        gateWrite: { written: false, writeStatus: null, reason: 'candidate_already_recorded' },
      };
    }

    const candidate = toAiProjectReviewCandidate({
      candidateId: `cand-${randomUUID()}`,
      projectId: input.projectId,
      artifactVersionId: input.artifactVersionId,
      rubric: input.rubric,
      modelId: input.modelId,
      score: input.score,
      criteria: input.criteria,
      ...(input.missingEvidenceIds === undefined ? {} : { missingEvidenceIds: input.missingEvidenceIds }),
    });

    const decision = evaluateAutomaticAcceptance({
      candidate,
      rubric: input.rubric,
      evidenceRequirements: input.evidenceRequirements,
      availableEvidenceIds: input.availableEvidenceIds,
      evidenceProfile: input.evidenceProfile ?? null,
      deliverableType: input.deliverableType ?? null,
      ...(input.minimumCriterionLevel === undefined ? {} : { minimumCriterionLevel: input.minimumCriterionLevel }),
    });

    const evidenceRef = `candidate:${candidateKey}`;
    const now = new Date();
    const canAccept = decision.outcome === 'auto_accept' && decision.gate !== null;

    const { inserted } = await this.store.upsertCandidate({
      id: candidate.id,
      schoolId: input.schoolId,
      projectId: input.projectId,
      studentUserId: input.studentUserId,
      artifactId: input.artifactId,
      artifactVersionId: input.artifactVersionId,
      candidate,
      state: canAccept ? 'accepted' : toAutomaticAcceptanceState(candidate.status),
      evidenceRef,
      acceptedAt: canAccept ? now : null,
      acceptedByRule: canAccept ? 'automatic-acceptance:v1' : null,
      candidateKey,
      now,
    });

    await this.audit.write({
      actorId: ASSESSOR_INTERNAL_ACTOR.id,
      actorRole: ASSESSOR_INTERNAL_ACTOR.role,
      action: 'artifact.review_candidate_recorded',
      targetType: 'artifact',
      targetId: input.artifactId,
      idempotencyKey: `assessor:candidate:${candidateKey}`,
      detail: {
        projectId: input.projectId,
        artifactVersionId: input.artifactVersionId,
        modelId: input.modelId,
        outcome: decision.outcome,
        gate: decision.gate,
        score: candidate.score,
        trigger: input.trigger,
      },
    });

    let gateWrite: RecordAiCandidateResult['gateWrite'] = { written: false, writeStatus: null, reason: null };
    if (decision.outcome === 'auto_accept') {
      // 审计行**先于**门禁写入：自动验收去掉了人工复核点，留痕不能依赖写入结果。
      await this.audit.write({
        actorId: ASSESSOR_INTERNAL_ACTOR.id,
        actorRole: ASSESSOR_INTERNAL_ACTOR.role,
        action: 'artifact.automatic_acceptance',
        targetType: 'artifact',
        targetId: input.artifactId,
        idempotencyKey: `assessor:auto-accept:${candidateKey}`,
        detail: {
          projectId: input.projectId,
          artifactVersionId: input.artifactVersionId,
          state: canAccept ? 'accepted' : 'pending_automatic_acceptance',
          gate: decision.gate,
          gateDeferredReason: decision.gateDeferredReason,
          score: candidate.score,
          rule: 'automatic-acceptance:v1',
        },
      });
      gateWrite = await applyAutomaticAcceptance(
        this.teamRuntime,
        decision,
        { studentUserId: input.studentUserId, evidenceRef, source: 'works.publish-approved' },
      );
      if (gateWrite.written) {
        this.logger.log(
          `自动验收通过 project=${input.projectId} gate=${decision.gate} status=${gateWrite.writeStatus}`,
        );
      } else {
        this.logger.warn(
          `自动验收通过但门禁未写入 project=${input.projectId} reason=${gateWrite.reason}`,
        );
      }
    }

    return { candidateKey, inserted, decision, gateWrite };
  }

  /** 读取某项目的候选（脱敏投影：候选本身已不含正文）。 */
  async listCandidates(projectId: string): Promise<AssessmentCandidateRecord[]> {
    return this.store.listCandidates(projectId);
  }
}
