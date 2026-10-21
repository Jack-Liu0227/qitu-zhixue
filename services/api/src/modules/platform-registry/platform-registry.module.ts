import { Module, forwardRef } from '@nestjs/common';
import { TeamVersionService } from './team-version.service';
import { TeamVersionController } from './team-version.controller';
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
  controllers: [ToolBindingMigrationController, TeamVersionController, PlatformRegistryController, ImaSettingsController],
  providers: [ToolBindingMigrationService, TeamVersionService, PlatformRegistryService, ImaSettingsService],
  exports: [TeamVersionService, PlatformRegistryService, ImaSettingsService],
})
export class PlatformRegistryModule {}
