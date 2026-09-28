import {
  PROJECT_EVIDENCE_COLUMN_KINDS,
  PROJECT_EVIDENCE_SOURCE_KINDS,
} from '@qitu/database';

/**
 * 项目证据（三列）持久化边界。
 *
 * 硬规则（学生前后端设计 §5.4.3）：证据**服务端聚合、只读**，学生与客户端都
 * 不能直接 POST。真实事实来源（任务提交 / AI turn / 升级事件 / 反思 / 判分）
 * 由各自模块通过 `ProjectEvidenceMaterializer` 服务端接口写入，本存储只负责
 * 幂等落库与读取——没有任何控制器路径接收客户端证据。
 *
 * 幂等：靠 `project_evidence` 的
 * `(project_id, column_kind, source_kind, source_id)` 唯一索引，重复聚合
 * `ON CONFLICT DO NOTHING`，与 schema 注释完全一致。
 */

export const PROJECT_EVIDENCE_COLUMNS = PROJECT_EVIDENCE_COLUMN_KINDS;
export const PROJECT_EVIDENCE_SOURCES = PROJECT_EVIDENCE_SOURCE_KINDS;

export type ProjectEvidenceColumnKind = (typeof PROJECT_EVIDENCE_COLUMN_KINDS)[number];
export type ProjectEvidenceSourceKind = (typeof PROJECT_EVIDENCE_SOURCE_KINDS)[number];

export interface ProjectEvidenceFact {
  projectId: string;
  studentUserId: string;
  schoolId: string | null;
  artifactId: string | null;
  columnKind: ProjectEvidenceColumnKind;
  sourceKind: ProjectEvidenceSourceKind;
  /** 被引用事实的不透明 id；不承载原始对话 / 语音。 */
  sourceId: string;
  label: string;
  /** 可选摘要，不含原始对话 / 语音。 */
  detail: string | null;
  occurredAt: Date;
}

export interface ProjectEvidenceRecord extends ProjectEvidenceFact {
  id: string;
  createdAt: Date;
}

/** 读取投影（脱敏）：三列，只暴露 label / ref / occurredAt。 */
export interface ProjectEvidenceItem {
  label: string;
  status: 'done';
  ref: string;
  occurredAt: string;
}

export interface ProjectEvidenceView {
  projectId: string;
  independent: ProjectEvidenceItem[];
  aiHelped: ProjectEvidenceItem[];
  difficulties: ProjectEvidenceItem[];
}

export abstract class ProjectEvidenceStore {
  /** 幂等写入；返回实际新增行数（已存在的行不重复插入）。 */
  abstract upsertFacts(facts: readonly ProjectEvidenceFact[]): Promise<number>;
  abstract listByProject(projectId: string): Promise<ProjectEvidenceRecord[]>;
}

export function factKey(fact: ProjectEvidenceFact): string {
  return `${fact.projectId}:${fact.columnKind}:${fact.sourceKind}:${fact.sourceId}`;
}

function cloneFact<T extends ProjectEvidenceFact>(fact: T): T {
  return { ...fact };
}

/** 内存实现：demo / test 用；live 由模块工厂选择 Postgres。 */
export class InMemoryProjectEvidenceStore extends ProjectEvidenceStore {
  private readonly facts = new Map<string, ProjectEvidenceRecord>();

  async upsertFacts(facts: readonly ProjectEvidenceFact[]): Promise<number> {
    let inserted = 0;
    for (const fact of facts) {
      const key = factKey(fact);
      if (this.facts.has(key)) continue;
      this.facts.set(key, {
        ...cloneFact(fact),
        id: `evidence-${key}`,
        createdAt: new Date(),
      });
      inserted += 1;
    }
    return inserted;
  }

  async listByProject(projectId: string): Promise<ProjectEvidenceRecord[]> {
    return [...this.facts.values()]
      .filter((fact) => fact.projectId === projectId)
      .map(cloneFact)
      .sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());
  }

  /** 测试辅助。 */
  reset(): void {
    this.facts.clear();
  }
}

/** 事实来源端口：其它服务端模块可注册/实现，向 materializer 提供权威事实。 */
export abstract class ProjectEvidenceSource {
  abstract collect(projectId: string): Promise<ProjectEvidenceFact[]>;
}

/** 默认空来源：demo / test 以及尚未接入事实表的项目使用。 */
export class EmptyProjectEvidenceSource extends ProjectEvidenceSource {
  async collect(_projectId: string): Promise<ProjectEvidenceFact[]> {
    return [];
  }
}

/** 把记录按三列分组，构造脱敏读投影（无 detail，避免越界暴露）。 */
export function toProjectEvidenceView(
  projectId: string,
  records: readonly ProjectEvidenceRecord[],
): ProjectEvidenceView {
  const view: ProjectEvidenceView = {
    projectId,
    independent: [],
    aiHelped: [],
    difficulties: [],
  };
  for (const record of records) {
    const item: ProjectEvidenceItem = {
      label: record.label,
      status: 'done',
      ref: `${record.sourceKind}:${record.sourceId}`,
      occurredAt: record.occurredAt.toISOString(),
    };
    if (record.columnKind === 'independent') view.independent.push(item);
    else if (record.columnKind === 'ai_helped') view.aiHelped.push(item);
    else if (record.columnKind === 'difficulty') view.difficulties.push(item);
  }
  return view;
}
