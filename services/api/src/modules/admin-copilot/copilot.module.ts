import { Module } from '@nestjs/common';
import { GrowthModule } from '../growth/growth.module';
import { AuthModule } from '../identity-auth/auth.module';
import { PlatformRegistryModule } from '../platform-registry/platform-registry.module';
import { TemplatesModule } from '../templates/templates.module';
import { KnowledgeModule } from '../knowledge/knowledge.module';
import { ModelRegistryModule } from '../model-registry/model-registry.module';
import { CopilotController } from './copilot.controller';
import { CopilotService } from './copilot.service';
import { CopilotOperations } from './copilot.operations';
import { CopilotResources } from './copilot.resources';

@Module({
  imports: [GrowthModule, AuthModule, PlatformRegistryModule, TemplatesModule, KnowledgeModule, ModelRegistryModule],
  controllers: [CopilotController],
  providers: [CopilotService, CopilotOperations, CopilotResources],
})
export class CopilotModule {}
