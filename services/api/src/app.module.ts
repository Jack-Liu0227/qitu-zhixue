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
import { PublicContentModule } from './modules/public-content/public-content.module';
import { InitializationModule } from './modules/initialization/initialization.module';
import { ModelSettingsModule } from './modules/settings/model-config.module';
import { TeamRuntimeModule } from './modules/team-runtime/team-runtime.module';

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
    PublicContentModule,
    InitializationModule,
    // 旧 `/admin/models/:slot` 兼容读取模块；新运行时事实源是
    // ModelRegistryModule 保存供应商/模型；Agent Runtime 负责最终模型选择。
    ModelSettingsModule,
    TeamRuntimeModule,
  ],
})
export class AppModule {}
