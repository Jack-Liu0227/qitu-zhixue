import { Module } from '@nestjs/common';
import { DatabaseModule } from './database';
import { AccessModule } from './common/access/access.module';
import { AuditModule } from './common/audit/audit.module';
import { IdempotencyModule } from './common/idempotency/idempotency.module';
import { OutboxModule } from './common/outbox/outbox.module';
import { HealthModule } from './health/health.module';
import { AiTutorModule } from './modules/ai-tutor/tutor.module';
import { GrowthModule } from './modules/growth/growth.module';
import { AuthModule } from './modules/identity-auth/auth.module';
import { ModelRegistryModule } from './modules/model-registry/model-registry.module';
import { PlatformDataModule } from './modules/platform-data/platform-data.module';
import { ParentModule } from './modules/parent/parent.module';
import { ProjectsModule } from './modules/projects/projects.module';
import { RemindersModule } from './modules/reminders/reminders.module';
import { AdminModule } from './modules/admin/admin.module';
import { DirectoryModule } from './modules/directory/directory.module';
import { TeacherModule } from './modules/teacher/teacher.module';
import { AccountModule } from './modules/account/account.module';
import { TemplatesModule } from './modules/templates/templates.module';

@Module({
  imports: [
    DatabaseModule,
    AccessModule,
    AuditModule,
    IdempotencyModule,
    OutboxModule,
    DirectoryModule,
    HealthModule,
    AuthModule,
    AiTutorModule,
    GrowthModule,
    ModelRegistryModule,
    PlatformDataModule,
    ParentModule,
    ProjectsModule,
    RemindersModule,
    AdminModule,
    TeacherModule,
    AccountModule,
    TemplatesModule,
  ],
})
export class AppModule {}
