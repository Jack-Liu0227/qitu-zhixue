import { Module } from '@nestjs/common';
import { AuthModule } from '../identity-auth/auth.module';
import { ModelGateway, MODEL_RUNTIME_RESOLVER } from './model-gateway';
import { ModelRegistryController } from './model-registry.controller';
import { ModelRegistryService } from './model-registry.service';

/**
 * 模型供应商注册表模块。
 *
 * 与 `ModelSettingsModule`（「我的模型 / Live 模型」两个插槽）的关系：
 * 本模块负责供应商与模型目录；Agent 的最终模型选择由 AI Runtime 保存，
 * 旧的用途绑定只在迁移和兼容旧 SDK 时读取。
 *
 * `ModelRegistryService` 被导出，供运行时解析供应商、模型和兼容用途；
 * `ModelGateway` 也被导出，作为业务调用 LLM 的唯一入口。
 */
@Module({
  imports: [AuthModule],
  controllers: [ModelRegistryController],
  providers: [
    ModelRegistryService,
    { provide: MODEL_RUNTIME_RESOLVER, useExisting: ModelRegistryService },
    ModelGateway,
  ],
  exports: [ModelRegistryService, ModelGateway],
})
export class ModelRegistryModule {}
