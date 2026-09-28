import { Module } from '@nestjs/common';
import { GrowthModule } from '../growth/growth.module';
import { DirectoryModule } from '../directory/directory.module';
import { DirectoryService } from '../directory/directory.service';
import { PlatformDataService } from './platform-data.service';

/**
 * 平台演示数据模块。
 *
 * 持有学生、教师、项目、介入请求、消息、工单等名册。
 * 导入 `GrowthModule`，使依赖本模块的家长端/管理后台控制器可以直接注入
 * `GrowthService` 读取成长记录真相，不另造一份。
 *
 * 被家长端模块与管理后台模块共同依赖。
 */
@Module({
  imports: [DirectoryModule, GrowthModule],
  providers: [
    PlatformDataService,
    {
      provide: 'DirectoryService',
      useExisting: DirectoryService,
    },
  ],
  exports: [PlatformDataService],
})
export class PlatformDataModule {}
