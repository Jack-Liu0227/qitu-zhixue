import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import type { TutorExperimentActionResponse } from '@qitu/contracts';
import { randomUUID } from 'node:crypto';
import type { ArtifactRecord, ArtifactVersionRecord, MentorReviewRecord } from './works.store';
import {
  ProjectEvidenceSource,
  ProjectEvidenceStore,
  assertProjectEvidenceFact,
  toProjectEvidenceView,
  type ProjectEvidenceFact,
  type ProjectEvidenceView,
} from './project-evidence.store';

/**
 * 项目证据物化器 —— **仅服务端内部接口**。
 *
 * 这是「项目证据服务端聚合、只读」这条硬规则的唯一写入入口：
 * - 只有服务端模块（任务提交、AI turn、升级、反思、判分、作品发布）可以注入并
 *   调用 `ingestServerFacts()` / `refreshFromSources()`；
 * - 没有任何控制器暴露「写证据」的路由，客户端 `POST` 证据只会 404；
 * - 读取投影在 `toProjectEvidenceView` 里再次脱敏（不含 detail）。
 */
@Injectable()
export class ProjectEvidenceMaterializer {
  private readonly logger = new Logger(ProjectEvidenceMaterializer.name);

  constructor(
    private readonly store: ProjectEvidenceStore,
    private readonly source: ProjectEvidenceSource,
  ) {}

  /** 服务端直接注入权威事实（其它模块产生的真实记录）。 */
  async ingestServerFacts(facts: readonly ProjectEvidenceFact[]): Promise<number> {
    // Validate the complete batch before writing so one malformed fact cannot
    // leave a partially materialised evidence set behind.
    for (const fact of facts) assertProjectEvidenceFact(fact);
    const inserted = await this.store.upsertFacts(facts);
    if (inserted > 0) {
      this.logger.log(`项目证据新增 ${inserted} 条（服务端物化）`);
    }
    return inserted;
  }

  /** Simulation observations are evidence, never a mastery/artifact acceptance decision. */
  async saveExperimentObservation(input: {
    studentId: string;
    receipt: NonNullable<TutorExperimentActionResponse['observationReceipt']>;
    objectiveId: string;
    parameters: Record<string, number>;
    observation: string;
  }): Promise<NonNullable<TutorExperimentActionResponse['observationReceipt']>> {
    const receipt = input.receipt;
    await this.ingestServerFacts([{
      projectId: receipt.projectId, studentUserId: input.studentId, schoolId: null, artifactId: null,
      columnKind: 'independent', sourceKind: 'experiment_observation', sourceId: receipt.observationId,
      label: '已保存模拟观察（非真实测量）',
      detail: JSON.stringify({ receipt, objectiveId: input.objectiveId, parameters: input.parameters, observation: input.observation }),
      occurredAt: new Date(receipt.savedAt),
    }]);
    const saved = (await this.store.listByProject(receipt.projectId)).find((record) =>
      record.sourceKind === 'experiment_observation' && record.sourceId === receipt.observationId
      && record.studentUserId === input.studentId);
    if (!saved?.detail) throw new ServiceUnavailableException({ code: 'OBSERVATION_RECEIPT_UNAVAILABLE', message: '观察保存回读失败，请重试' });
    const persisted = JSON.parse(saved.detail) as typeof input;
    if (persisted.receipt?.parameterDigest !== receipt.parameterDigest ||
      persisted.receipt?.runActionId !== receipt.runActionId) {
      throw new ServiceUnavailableException({ code: 'OBSERVATION_RECEIPT_INVALID', message: '观察回执不匹配' });
    }
    return persisted.receipt;
  }

  async experimentReceipts(projectId: string, studentId: string, sessionId: string) {
    const rows = await this.store.listByProject(projectId);
    return rows.flatMap((row) => {
      if (row.sourceKind !== 'experiment_observation' || row.studentUserId !== studentId || !row.detail) return [];
      const stored = JSON.parse(row.detail) as { receipt?: TutorExperimentActionResponse['observationReceipt'] };
      return stored.receipt?.sessionId === sessionId ? [stored.receipt] : [];
    });
  }

  /** Freeze the exact immutable version presented to the assigned reviewer. */
  async recordArtifactReviewRequest(artifact: ArtifactRecord, version: ArtifactVersionRecord, review: MentorReviewRecord): Promise<void> {
    if (!artifact.projectId) return;
    const sourceId = `review:${review.id}`;
    const detail = JSON.stringify({ schema: 'qitu.artifact-review-request.v1', reviewId: review.id,
      artifactVersionId: version.id, versionOrdinal: version.ordinal });
    await this.ingestServerFacts([{
      projectId: artifact.projectId, studentUserId: artifact.studentId, schoolId: artifact.schoolId,
      artifactId: artifact.id, columnKind: 'independent', sourceKind: 'task_submission', sourceId,
      label: '作品版本已送审', detail, occurredAt: review.requestedAt,
    }]);
    const saved = (await this.store.listByProject(artifact.projectId)).find((row) =>
      row.sourceKind === 'task_submission' && row.sourceId === sourceId && row.studentUserId === artifact.studentId
      && row.artifactId === artifact.id);
    if (saved?.detail !== detail) throw new ServiceUnavailableException({
      code: 'ARTIFACT_REVIEW_VERSION_MISMATCH', message: '送审版本回读不一致，请刷新后重试',
    });
  }

  async hasArtifactReviewRequest(artifact: ArtifactRecord, version: ArtifactVersionRecord, review: MentorReviewRecord): Promise<boolean> {
    if (!artifact.projectId) return false;
    return (await this.store.listByProject(artifact.projectId)).some((row) => {
      if (row.sourceKind !== 'task_submission' || row.sourceId !== `review:${review.id}`
        || row.studentUserId !== artifact.studentId || row.artifactId !== artifact.id || !row.detail) return false;
      try {
        const data = JSON.parse(row.detail) as Record<string, unknown>;
        return data.schema === 'qitu.artifact-review-request.v1' && data.reviewId === review.id
          && data.artifactVersionId === version.id && data.versionOrdinal === version.ordinal;
      } catch { return false; }
    });
  }

  /** 从已注册的服务端来源采集并物化（如 `tutor_turns` 的 ai_helped）。 */
  async refreshFromSources(projectId: string): Promise<number> {
    const facts = await this.source.collect(projectId);
    return this.ingestServerFacts(facts);
  }

  /** 作品发布时物化一条 `artifact` 证据，证明「我独立完成并沉淀了作品」。 */
  async materializeArtifactPublished(artifact: ArtifactRecord, now: Date = new Date()): Promise<number> {
    if (artifact.projectId === null) return 0;
    return this.ingestServerFacts([
      {
        projectId: artifact.projectId,
        studentUserId: artifact.studentId,
        schoolId: artifact.schoolId,
        artifactId: artifact.id,
        columnKind: 'independent',
        sourceKind: 'artifact',
        sourceId: artifact.id,
        label: `发布作品《${artifact.title}》`,
        detail: null,
        occurredAt: now,
      },
    ]);
  }

  /** 脱敏读投影。 */
  async read(projectId: string): Promise<ProjectEvidenceView> {
    const records = await this.store.listByProject(projectId);
    return toProjectEvidenceView(projectId, records);
  }

  /** 测试 / 内部辅助：生成不透明事实 id。 */
  static nextFactId(): string {
    return randomUUID();
  }
}
