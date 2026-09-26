import { Module } from '@nestjs/common';
import { HealthModule } from './health/health.module';
import { AiTutorModule } from './modules/ai-tutor/tutor.module';
import { GrowthModule } from './modules/growth/growth.module';
import { AuthModule } from './modules/identity-auth/auth.module';
import { ModelRegistryModule } from './modules/model-registry/model-registry.module';
import { ModelSettingsModule } from './modules/settings/model-config.module';
import { PlatformDataModule } from './modules/platform-data/platform-data.module';
import { ParentModule } from './modules/parent/parent.module';
import { AdminModule } from './modules/admin/admin.module';

@Module({
  imports: [
    HealthModule,
    AuthModule,
    AiTutorModule,
    GrowthModule,
    ModelSettingsModule,
    ModelRegistryModule,
    PlatformDataModule,
    ParentModule,
    AdminModule,
  ],
})
export class AppModule {}
