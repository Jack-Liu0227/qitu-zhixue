import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { ArtifactRecord } from './works.store';
import {
  ProjectEvidenceSource,
  ProjectEvidenceStore,
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
    const inserted = await this.store.upsertFacts(facts);
    if (inserted > 0) {
      this.logger.log(`项目证据新增 ${inserted} 条（服务端物化）`);
    }
    return inserted;
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
