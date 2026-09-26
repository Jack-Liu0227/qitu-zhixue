import { Module } from '@nestjs/common';
import { AuthModule } from '../identity-auth/auth.module';
import { ModelRegistryController } from './model-registry.controller';
import { ModelRegistryService } from './model-registry.service';

/**
 * 模型供应商注册表模块。
 *
 * 与 `ModelSettingsModule`（「我的模型 / Live 模型」两个插槽）的关系：
 * 本模块是更细的那一层——它管**有哪些供应商、各自有哪些模型、每个用途用哪个**。
 * 老的两个插槽暂时保留可用，待 AI搭档链路改为按用途取模型后再迁移，
 * 避免一次改动同时动到学生端、管理员端和鉴权。
 *
 * `ModelRegistryService` 被导出，供后续按用途取模型的调用方注入。
 */
@Module({
  imports: [AuthModule],
  controllers: [ModelRegistryController],
  providers: [ModelRegistryService],
  exports: [ModelRegistryService],
})
export class ModelRegistryModule {}
