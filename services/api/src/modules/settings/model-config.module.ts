import { Module } from '@nestjs/common';
import { AuthModule } from '../identity-auth/auth.module';
import { ModelRegistryModule } from '../model-registry/model-registry.module';
import { ModelConfigController } from './model-config.controller';
import { SettingsRegistryController } from './settings-registry.controller';
import { SettingsRegistryService } from './settings-registry.service';

/** Settings navigation and authenticated runtime capability projections. */
@Module({
  imports: [AuthModule, ModelRegistryModule],
  controllers: [ModelConfigController, SettingsRegistryController],
  providers: [SettingsRegistryService],
})
export class ModelSettingsModule {}
