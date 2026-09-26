import { Module } from '@nestjs/common';
import { GrowthModule } from '../growth/growth.module';
import { PlatformDataService } from './platform-data.service';

/**
 * 平台演示数据模块。
 *
 * 持有学生、教师、项目、介入请求、消息、工单等名册。
 * 注入 `GrowthService` 以共享成长记录真相，不另造一份。
 *
 * 被家长端模块与管理后台模块共同依赖。
 */
@Module({
  imports: [GrowthModule],
  providers: [PlatformDataService],
  exports: [PlatformDataService],
})
export class PlatformDataModule {}
