import { Module } from '@nestjs/common';
import type { Database } from '@qitu/database';
import { DATA_MODE_TOKEN, DATABASE_TOKEN, type DataMode } from '../../database';
import { AuthModule } from '../identity-auth/auth.module';
import { ExplorationStore, InMemoryExplorationStore } from './exploration.store';
import { PostgresExplorationStore } from './exploration.store.postgres';
import { ExplorationsController } from './explorations.controller';
import { LearningPlanStorageModule } from '../learning-plan/learning-plan-storage.module';
import { MasteryModule } from '../mastery/mastery.module';
import { TeamRuntimeModule } from '../team-runtime/team-runtime.module';
import { TemplatesModule } from '../templates/templates.module';
import { ProjectLifecycleController } from './project-lifecycle.controller';
import { ProjectLifecycleService } from './project-lifecycle.service';
import { ProjectsService } from './projects.service';
import { LearningPlanModule } from '../learning-plan/learning-plan.module';
import { LearningPlanController } from '../learning-plan/learning-plan.controller';
import { LearningSessionProgressController } from '../learning-plan/learning-session-progress.controller';
import { WorksModule } from '../works/works.module';
import { ProjectLearningLifecycleService } from './project-learning-lifecycle.service';
import { ProjectLearningLifecycleController } from './project-learning-lifecycle.controller';
import { ProjectHistoryStore } from './project-history.store';
import { PostgresProjectHistoryStore } from './project-history.store.postgres';
import { ProjectHistoryService } from './project-history.service';
import { ProjectHistoryController } from './project-history.controller';
import { StudentHistoryCleanupController } from './student-history-cleanup.controller';
import { StudentHistoryCleanupService } from './student-history-cleanup.service';
import { ProjectCoversService } from './project-covers.service';
import { VisualAssetsModule } from '../visual-assets/visual-assets.module';
import { ProjectTeachingPlanRecoveryService } from './project-teaching-plan-recovery.service';
import { LessonEvaluationRecoveryService } from './lesson-evaluation-recovery.service';

/**
 * 探索 / 意图确认模块（T6）。
 *
 * 存储引擎按数据模式选择，与 `DirectoryService` 的双引擎思路一致：
 * - 有数据库连接（`live` 必然有，`demo` / `test` 也允许）→ PostgreSQL 实现；
 * - 无数据库且非 `live` → 内存实现（仅测试与演示）；
 * - `live` 却没有连接 → 直接抛错，**绝不**退化成内存假装持久化。
 *
 * `IdempotencyModule` / `AuditModule` 是 `@Global()`，由 `AppModule` 统一导入，
 * 这里直接注入其抽象即可。
 *
 * T15：`TeamRuntimeModule` 提供 `recordGateForStudent`（服务端内部的门禁证据写入），
 * 学生确认意图是 `student_confirmed_intent` 门禁的唯一真源。
 * 该模块不反向依赖 ProjectsModule，因此无循环导入。
 */
@Module({
  imports: [AuthModule, LearningPlanStorageModule, MasteryModule, TeamRuntimeModule, TemplatesModule, LearningPlanModule, WorksModule, VisualAssetsModule],
  controllers: [LearningPlanController, LearningSessionProgressController, ExplorationsController, ProjectHistoryController, ProjectLifecycleController, ProjectLearningLifecycleController, StudentHistoryCleanupController],
  providers: [
    ProjectsService,
    ProjectLifecycleService,
    ProjectLearningLifecycleService,
    ProjectHistoryService,
    StudentHistoryCleanupService,
    ProjectCoversService,
    ProjectTeachingPlanRecoveryService,
    LessonEvaluationRecoveryService,
    { provide: ProjectHistoryStore, inject: [DATABASE_TOKEN], useFactory: (db: Database | null) => db ? new PostgresProjectHistoryStore(db) : null },
    {
      provide: ExplorationStore,
      inject: [DATABASE_TOKEN, DATA_MODE_TOKEN],
      useFactory: (db: Database | null, mode: DataMode): ExplorationStore => {
        if (db !== null) return new PostgresExplorationStore(db);
        if (mode === 'live') {
          // DatabaseModule 理论上已 fail fast；这里再挡一层，避免误配后静默丢数据。
          throw new Error('live 模式缺少 DATABASE_URL：探索存储不可用');
        }
        return new InMemoryExplorationStore();
      },
    },
  ],
  exports: [ProjectsService, ProjectLifecycleService, ProjectLearningLifecycleService, ProjectHistoryService],
})
export class ProjectsModule {}
