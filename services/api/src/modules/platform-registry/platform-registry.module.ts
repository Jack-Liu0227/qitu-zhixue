import { Module, forwardRef } from '@nestjs/common';
import { TeachingTeamCaptureService } from './teaching-team-capture.service';
import { AuthModule } from '../identity-auth/auth.module';
import { PlatformRegistryController } from './platform-registry.controller';
import { PlatformRegistryService } from './platform-registry.service';
import { ModelRegistryModule } from '../model-registry/model-registry.module';
import { ImaSettingsService } from './ima-settings.service';
import { ImaSettingsController } from './ima-settings.controller';
import { KnowledgeModule } from '../knowledge/knowledge.module';
import { ToolBindingMigrationController } from './tool-binding-migration.controller';
import { ToolBindingMigrationService } from './tool-binding-migration.service';

@Module({
  imports: [AuthModule, ModelRegistryModule, forwardRef(() => KnowledgeModule)],
  controllers: [ToolBindingMigrationController, PlatformRegistryController, ImaSettingsController],
  providers: [ToolBindingMigrationService, TeachingTeamCaptureService, PlatformRegistryService, ImaSettingsService],
  exports: [TeachingTeamCaptureService, PlatformRegistryService, ImaSettingsService],
})
export class PlatformRegistryModule {}
