import { Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import type { CurrentUser } from '@qitu/contracts';
import type { Database } from '@qitu/database';
import { projects, users } from '@qitu/database';
import { AccessPolicy } from '../../common/access/access-policy';
import { DATABASE_TOKEN } from '../../database';
import type { KnowledgeActorContext } from './knowledge.scope-policy';

/** 单一学校演示部署的默认学校 id（与 `database/seeds/domain-foundation.sql` 一致）。 */
export const DEMO_SCHOOL_ID = 'school-demo';

/** 演示项目 → 学生归属；仅用于无数据库的 demo / test 引擎。 */
const DEMO_PROJECT_OWNERS: Readonly<Record<string, string>> = {
  'project-demo-001': 'student-demo',
};

/**
 * 解析作用域判定所需的关系事实：主体的学校归属、项目的学生归属。
 *
 * 与 `DirectoryService` 的分工：Directory 拥有人员与监护 / 班主任关系；学校归属与
 * 项目归属从领域表读取。把它单独抽成端口，便于在单测里替换、也便于未来接入
 * RLS / 多校切换而不改授权规则。
 */
export abstract class KnowledgeDirectoryPort {
  abstract schoolIdOf(userId: string): Promise<string | null>;
  abstract ownerOfProject(projectId: string): Promise<string | null>;
}

/** PostgreSQL 实现。 */
export class PostgresKnowledgeDirectory extends KnowledgeDirectoryPort {
  constructor(private readonly db: Database) {
    super();
  }

  async schoolIdOf(userId: string): Promise<string | null> {
    const rows = await this.db
      .select({ schoolId: users.schoolId })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    return rows[0]?.schoolId ?? null;
  }

  async ownerOfProject(projectId: string): Promise<string | null> {
    const rows = await this.db
      .select({ studentUserId: projects.studentUserId })
      .from(projects)
      .where(eq(projects.id, projectId))
      .limit(1);
    return rows[0]?.studentUserId ?? null;
  }
}

/**
 * 无数据库的 demo / test 实现。
 *
 * 首期是单校部署，所有演示账号归属 `school-demo`；演示项目归属固定学生。
 * 未知项目返回 `null`（fail closed），不会因为“找不到”而默认放行。
 */
export class DemoKnowledgeDirectory extends KnowledgeDirectoryPort {
  async schoolIdOf(_userId: string): Promise<string | null> {
    return DEMO_SCHOOL_ID;
  }

  async ownerOfProject(projectId: string): Promise<string | null> {
    return DEMO_PROJECT_OWNERS[projectId] ?? null;
  }
}

/**
 * 作用域授权解析端口。
 *
 * 服务层依赖它解析主体学校与项目可访问性；判定本身仍是
 * `knowledge.scope-policy.ts` 的纯规则，authorizer 只负责「查关系事实」。
 */
export abstract class KnowledgeScopeAuthorizer {
  abstract loadActorContext(actor: CurrentUser): Promise<KnowledgeActorContext>;
  abstract canAccessProject(actor: CurrentUser, projectId: string): Promise<boolean>;
}

/**
 * 默认实现。
 *
 * 项目访问矩阵（与 `AccessPolicy` 的关系真相保持一致）：
 * - student：项目归属就是本人；
 * - teacher / parent：项目归属学生是本人当前可读的学生（active 班主任 / 监护）；
 * - admin / support：**默认拒绝**（个别学生访问需显式授权，模型落地前 fail closed）。
 */
@Injectable()
export class DefaultKnowledgeScopeAuthorizer extends KnowledgeScopeAuthorizer {
  constructor(
    private readonly directory: KnowledgeDirectoryPort,
    private readonly accessPolicy: AccessPolicy,
  ) {
    super();
  }

  async loadActorContext(actor: CurrentUser): Promise<KnowledgeActorContext> {
    return {
      actorId: actor.id,
      role: actor.role,
      schoolId: await this.directory.schoolIdOf(actor.id),
    };
  }

  async canAccessProject(actor: CurrentUser, projectId: string): Promise<boolean> {
    const ownerId = await this.directory.ownerOfProject(projectId);
    if (ownerId === null) return false;
    if (actor.role === 'student') return actor.id === ownerId;
    if (actor.role === 'teacher' || actor.role === 'parent') {
      return this.accessPolicy.canReadStudent(actor, ownerId);
    }
    return false;
  }
}
