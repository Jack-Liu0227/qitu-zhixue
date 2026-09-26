import { Module } from '@nestjs/common';
import { AuthModule } from '../identity-auth/auth.module';
import { GrowthModule } from '../growth/growth.module';
import { PlatformDataModule } from '../platform-data/platform-data.module';
import { ModelRegistryModule } from '../model-registry/model-registry.module';
import { AdminController } from './admin.controller';

/**
 * 平台管理后台模块。
 *
 * 挂载六个端点：概览、学生列表/详情、教师列表/详情、设置索引。
 * 全部要求 `role === 'admin'`。
 */
@Module({
  imports: [AuthModule, GrowthModule, PlatformDataModule, ModelRegistryModule],
  controllers: [AdminController],
})
export class AdminModule {}
