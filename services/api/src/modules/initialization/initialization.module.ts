import { Module } from '@nestjs/common';
import { AuthModule } from '../identity-auth/auth.module';
import { PlatformRegistryModule } from '../platform-registry/platform-registry.module';
import { InitializationController } from './initialization.controller';
import { InitializationService } from './initialization.service';

@Module({
  imports: [AuthModule, PlatformRegistryModule],
  controllers: [InitializationController],
  providers: [InitializationService],
})
export class InitializationModule {}
