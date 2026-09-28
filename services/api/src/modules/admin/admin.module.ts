import { Module } from '@nestjs/common';
import { AuthModule } from '../identity-auth/auth.module';
import { GrowthModule } from '../growth/growth.module';
import { PlatformDataModule } from '../platform-data/platform-data.module';
import { ModelRegistryModule } from '../model-registry/model-registry.module';
import { DirectoryModule } from '../directory/directory.module';
import { AdminController } from './admin.controller';
import { DirectoryAdminController } from './directory-admin.controller';

/**
 * 平台管理后台模块。
 *
 * 端点：概览、学生列表/详情、教师列表/详情、设置索引、关系绑定、学生统计。
 * 全部要求 `role === 'admin'`。
 *
 * `controllers` 的顺序有意义：Nest 按声明顺序注册路由，先注册的先匹配。
 * `DirectoryAdminController` 里的 `GET students/statistics` 必须排在
 * `AdminController` 的 `GET students/:studentId` 之前，否则后者会把
 * `statistics` 当成某个学生 ID 吃掉（表现为 404「学生不存在」）。
 */
@Module({
  imports: [AuthModule, GrowthModule, PlatformDataModule, ModelRegistryModule, DirectoryModule],
  controllers: [DirectoryAdminController, AdminController],
})
export class AdminModule {}
