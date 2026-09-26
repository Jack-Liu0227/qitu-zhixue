import { Module } from '@nestjs/common';
import { HealthModule } from './health/health.module';
import { AiTutorModule } from './modules/ai-tutor/tutor.module';
import { GrowthModule } from './modules/growth/growth.module';
import { AuthModule } from './modules/identity-auth/auth.module';
import { ModelRegistryModule } from './modules/model-registry/model-registry.module';
import { ModelSettingsModule } from './modules/settings/model-config.module';

@Module({
  imports: [
    HealthModule,
    AuthModule,
    AiTutorModule,
    GrowthModule,
    ModelSettingsModule,
    ModelRegistryModule,
  ],
})
export class AppModule {}
