import { eq } from 'drizzle-orm';
import { projects as projectsTable, type Database } from '@qitu/database';
import type { ProjectStage } from '@qitu/contracts';

/**
 * 作品模块读取项目实例的最小端口。
 *
 * 只读，**绝不写** `projects`：作品与证据不能修改 `ProjectStatus`、
 * `progressPercent`、`currentStageIndex`，也不能改冻结的 `templateVersionId`。
 * 这样「项目阶段权威属于 projects / learning-plan」才不会被作品模块绕过。
 */
export interface WorksProjectRef {
  id: string;
  studentId: string;
  templateVersionId: string | null;
  status: ProjectStage;
}

export abstract class WorksProjectReader {
  abstract findProject(projectId: string): Promise<WorksProjectRef | null>;
}

/** demo / test 实现；生产用 `PostgresWorksProjectReader`。 */
export class InMemoryWorksProjectReader extends WorksProjectReader {
  private readonly projects = new Map<string, WorksProjectRef>();

  async findProject(projectId: string): Promise<WorksProjectRef | null> {
    return this.projects.get(projectId) ?? null;
  }

  /** 测试辅助：登记一个项目实例（只读投影）。 */
  seed(project: WorksProjectRef): void {
    this.projects.set(project.id, { ...project });
  }

  reset(): void {
    this.projects.clear();
  }
}

/** live 实现：只 `SELECT`，不 `UPDATE`。 */
export class PostgresWorksProjectReader extends WorksProjectReader {
  constructor(private readonly db: Database) {
    super();
  }

  async findProject(projectId: string): Promise<WorksProjectRef | null> {
    const [row] = await this.db
      .select({
        id: projectsTable.id,
        studentUserId: projectsTable.studentUserId,
        templateVersionId: projectsTable.templateVersionId,
        status: projectsTable.status,
      })
      .from(projectsTable)
      .where(eq(projectsTable.id, projectId))
      .limit(1);
    if (row === undefined) return null;
    return {
      id: row.id,
      studentId: row.studentUserId,
      templateVersionId: row.templateVersionId,
      status: row.status as ProjectStage,
    };
  }
}
