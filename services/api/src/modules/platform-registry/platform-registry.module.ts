import { Module } from '@nestjs/common';
import { AuthModule } from '../identity-auth/auth.module';
import { PlatformRegistryController } from './platform-registry.controller';
import { PlatformRegistryService } from './platform-registry.service';
import { ModelRegistryModule } from '../model-registry/model-registry.module';
import { ImaSettingsService } from './ima-settings.service';
import { ImaSettingsController } from './ima-settings.controller';
import { KnowledgeModule } from '../knowledge/knowledge.module';

@Module({
  imports: [AuthModule, ModelRegistryModule, KnowledgeModule],
  controllers: [PlatformRegistryController, ImaSettingsController],
  providers: [PlatformRegistryService, ImaSettingsService],
  exports: [PlatformRegistryService, ImaSettingsService],
})
export class PlatformRegistryModule {}
