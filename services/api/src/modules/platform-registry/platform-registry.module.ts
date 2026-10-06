import { Module } from '@nestjs/common';
import { AuthModule } from '../identity-auth/auth.module';
import { PlatformRegistryController } from './platform-registry.controller';
import { PlatformRegistryService } from './platform-registry.service';
import { ModelRegistryModule } from '../model-registry/model-registry.module';

@Module({
  imports: [AuthModule, ModelRegistryModule],
  controllers: [PlatformRegistryController],
  providers: [PlatformRegistryService],
  exports: [PlatformRegistryService],
})
export class PlatformRegistryModule {}
