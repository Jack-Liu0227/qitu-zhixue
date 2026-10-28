import { Module } from '@nestjs/common';
import type { Database } from '@qitu/database';
import { DATA_MODE_TOKEN, DATABASE_TOKEN, type DataMode } from '../../database';
import { AuthModule } from '../identity-auth/auth.module';
import { ModelRegistryModule } from '../model-registry/model-registry.module';
import { PlatformDataModule } from '../platform-data/platform-data.module';
import { ProjectsModule } from '../projects/projects.module';
import { RemindersModule } from '../reminders/reminders.module';
import { TutorWorkspaceService } from './tutor-workspace.service';
import { TutorController } from './tutor.controller';
import { InMemoryTutorSessionStore, TutorSessionStore } from './tutor-session.store';
import { PostgresTutorSessionStore } from './tutor-session.store.postgres';
import { QituSDKModule } from '../qitu-sdk/qitu-sdk.module';
import { PlatformRegistryModule } from '../platform-registry/platform-registry.module';
import { TutorService } from './tutor.service';
import { ImaMcpClient } from './ima-mcp.client';
import { TeamRuntimeModule } from '../team-runtime/team-runtime.module';
import { LearningPlanModule } from '../learning-plan/learning-plan.module';
import { KnowledgeModule } from '../knowledge/knowledge.module';
import { TemplatesModule } from '../templates/templates.module';
import { MasteryModule } from '../mastery/mastery.module';
import { PlanAdjustmentModule } from '../plan-adjustment/plan-adjustment.module';
import { TeacherModule } from '../teacher/teacher.module';
import { InMemoryTutorQuizStore, TutorQuizStore } from './tutor-quiz.store';
import { PostgresTutorQuizStore } from './tutor-quiz.store.postgres';
import { TutorQuizService } from './tutor-quiz.service';
import { TutorExperimentService } from './tutor-experiment.service';
import { WorksModule } from '../works/works.module';
import { TutorTeamHistoryService } from './tutor-team-history.service';
import { TutorLessonAssessmentService } from './tutor-lesson-assessment.service';
import { TutorLessonAssessmentController } from './tutor-lesson-assessment.controller';
import { TutorLessonCollaborationController } from './tutor-lesson-collaboration.controller';
import { TutorLessonCollaborationService } from './tutor-lesson-collaboration.service';
import { TutorCoursewareController } from './tutor-courseware.controller';
import { TutorCoursewareService } from './tutor-courseware.service';
import { LearningReplyInterpreter, TutorLearningReplyService } from './tutor-learning-reply.service';

/**
 * AI 搭档模块。
 *
 * 依赖 `RemindersModule` 只为拿到 `LearningStallSignalSink` 抽象：当会话内
 * 连续卡顿越过升级阈值时，把「学习进度停滞」这一服务端事实交给提醒模块。
 * 提醒是否真的投递由提醒模块的评审门禁决定（默认关闭，fail-closed）。
 *
 * 会话/回合存储按数据模式选择，与 `ProjectsModule` 的双引擎思路一致：
 * - 有数据库连接 → `PostgresTutorSessionStore`（`tutor_sessions` / `tutor_turns`）；
 * - 无数据库且非 `live` → 内存实现（仅测试与演示）；
 * - `live` 却没有连接 → 直接抛错，**绝不**退化成内存假装持久化。
 *
 * `IdempotencyModule` / `AuditModule` 是 `@Global()`，由 `AppModule` 统一导入，
 * 这里直接注入其抽象即可。
 */
@Module({
  imports: [AuthModule, ModelRegistryModule, PlatformDataModule, ProjectsModule, RemindersModule, QituSDKModule, PlatformRegistryModule, TeamRuntimeModule, LearningPlanModule, KnowledgeModule, TemplatesModule, MasteryModule, PlanAdjustmentModule, TeacherModule, WorksModule],
  controllers: [TutorController, TutorLessonAssessmentController, TutorLessonCollaborationController, TutorCoursewareController],
  providers: [
    { provide: ImaMcpClient, useFactory: () => new ImaMcpClient() },
    TutorService,
    TutorWorkspaceService,
    TutorQuizService,
    TutorExperimentService,
    TutorTeamHistoryService,
    TutorLessonAssessmentService,
    TutorLessonCollaborationService,
    TutorCoursewareService,
    LearningReplyInterpreter,
    TutorLearningReplyService,
    {
      provide: TutorQuizStore,
      inject: [DATABASE_TOKEN, DATA_MODE_TOKEN],
      useFactory: (db: Database | null, mode: DataMode): TutorQuizStore => {
        if (db !== null) return new PostgresTutorQuizStore(db);
        if (mode === 'live') {
          throw new Error('live 模式缺少 DATABASE_URL：AI搭档判分存储不可用');
        }
        return new InMemoryTutorQuizStore();
      },
    },
    {
      provide: TutorSessionStore,
      inject: [DATABASE_TOKEN, DATA_MODE_TOKEN],
      useFactory: (db: Database | null, mode: DataMode): TutorSessionStore => {
        if (db !== null) return new PostgresTutorSessionStore(db);
        if (mode === 'live') {
          // DatabaseModule 理论上已 fail fast；这里再挡一层，避免误配后静默丢数据。
          throw new Error('live 模式缺少 DATABASE_URL：AI搭档会话存储不可用');
        }
        return new InMemoryTutorSessionStore();
      },
    },
  ],
  exports: [TutorService],
})
export class AiTutorModule {}
