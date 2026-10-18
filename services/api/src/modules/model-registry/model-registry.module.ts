import { Module } from '@nestjs/common';
import { AuthModule } from '../identity-auth/auth.module';
import { ModelGateway, MODEL_RUNTIME_RESOLVER } from './model-gateway';
import { ModelRegistryController } from './model-registry.controller';
import { ModelRegistryService } from './model-registry.service';
import { QwenVoiceGatewayService } from './qwen-voice-gateway.service';
import { VoiceController } from './voice.controller';

/** Single owner of provider credentials, model catalogs and governed usage routes. */
@Module({
  imports: [AuthModule],
  controllers: [ModelRegistryController, VoiceController],
  providers: [
    ModelRegistryService,
    QwenVoiceGatewayService,
    { provide: MODEL_RUNTIME_RESOLVER, useExisting: ModelRegistryService },
    ModelGateway,
  ],
  exports: [ModelRegistryService, ModelGateway, QwenVoiceGatewayService],
})
export class ModelRegistryModule {}
