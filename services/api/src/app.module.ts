import { Module } from '@nestjs/common';
import { DatabaseModule } from './database';
import { AccessModule } from './common/access/access.module';
import { AuditModule } from './common/audit/audit.module';
import { IdempotencyModule } from './common/idempotency/idempotency.module';
import { OutboxModule } from './common/outbox/outbox.module';
import { QueueModule } from './common/queue/queue.module';
import { RedisModule } from './common/redis/redis.module';
import { HealthModule } from './health/health.module';
import { AiTutorModule } from './modules/ai-tutor/tutor.module';
import { AgentMemoryModule } from './modules/agent-memory/agent-memory.module';
import { GrowthModule } from './modules/growth/growth.module';
import { LearningPlanModule } from './modules/learning-plan/learning-plan.module';
import { AuthModule } from './modules/identity-auth/auth.module';
import { ModelRegistryModule } from './modules/model-registry/model-registry.module';
import { MasteryModule } from './modules/mastery/mastery.module';
import { QituSDKModule } from './modules/qitu-sdk/qitu-sdk.module';
import { PlatformDataModule } from './modules/platform-data/platform-data.module';
import { ParentModule } from './modules/parent/parent.module';
import { ProjectsModule } from './modules/projects/projects.module';
import { RemindersModule } from './modules/reminders/reminders.module';
import { AdminModule } from './modules/admin/admin.module';
import { DirectoryModule } from './modules/directory/directory.module';
import { TeacherModule } from './modules/teacher/teacher.module';
import { AccountModule } from './modules/account/account.module';
import { TemplatesModule } from './modules/templates/templates.module';
import { KnowledgeModule } from './modules/knowledge/knowledge.module';
import { WorksModule } from './modules/works/works.module';
import { PlatformRegistryModule } from './modules/platform-registry/platform-registry.module';
import { InitializationModule } from './modules/initialization/initialization.module';
import { ModelSettingsModule } from './modules/settings/model-config.module';

@Module({
  imports: [
    DatabaseModule,
    AccessModule,
    AuditModule,
    IdempotencyModule,
    OutboxModule,
    RedisModule,
    QueueModule,
    DirectoryModule,
    HealthModule,
    AuthModule,
    AiTutorModule,
    AgentMemoryModule,
    GrowthModule,
    LearningPlanModule,
    MasteryModule,
    QituSDKModule,
    ModelRegistryModule,
    PlatformDataModule,
    ParentModule,
    ProjectsModule,
    RemindersModule,
    AdminModule,
    TeacherModule,
    AccountModule,
    TemplatesModule,
    KnowledgeModule,
    WorksModule,
    PlatformRegistryModule,
    InitializationModule,
    // 「我的模型 / Live 模型」两个插槽。
    // 管理员端 `apps/admin-console/lib/api/settings.ts` 会 PATCH `/api/v1/admin/models/:slot`，
    // 在学生/家长/班主任端读取「当前跑哪个模型」。本模块构造无依赖
    // （`ModelConfigService` 只读环境变量与内存态），注册后会从「隐式 404」
    // 变为真实可用；密钥只进内存、不落盘（见 `model-config.service.ts`）。
    ModelSettingsModule,
  ],
})
export class AppModule {}
