import { Module } from '@nestjs/common';
import { AuthModule } from '../identity-auth/auth.module';
import { PlatformRegistryController } from './platform-registry.controller';
import { PlatformRegistryService } from './platform-registry.service';

@Module({
  imports: [AuthModule],
  controllers: [PlatformRegistryController],
  providers: [PlatformRegistryService],
  exports: [PlatformRegistryService],
})
export class PlatformRegistryModule {}
