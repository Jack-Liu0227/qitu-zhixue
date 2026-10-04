import { Module } from '@nestjs/common';
import { AuthModule } from '../identity-auth/auth.module';
import { ModelRegistryModule } from '../model-registry/model-registry.module';
import { ModelConfigController } from './model-config.controller';
import { ModelConfigService } from './model-config.service';

/**
 * 模型配置模块（管理员端「我的模型 / Live 模型」）。
 *
 * `ModelConfigService` 被导出，供 AI搭档与实时语音链路注入使用：
 * provider seam 通过它拿模型标识与密钥，密钥永远不经过 HTTP 层。
 */
@Module({
  imports: [AuthModule, ModelRegistryModule],
  controllers: [ModelConfigController],
  providers: [ModelConfigService],
  exports: [ModelConfigService],
})
export class ModelSettingsModule {}
