import { Module } from '@nestjs/common';
import { AuthModule } from '../identity-auth/auth.module';
import { GrowthController, ParentGrowthController } from './growth.controller';
import { GrowthService } from './growth.service';

/**
 * 成长轨迹模块。
 *
 * 同时挂载学生端投影（`/students/me/...`）与家长端投影（`/parent/children/...`）。
 * 两者共用同一个 `GrowthService` 实例，所以「学生看到什么、家长就同步看到什么」
 * 是构造上成立的，而不是靠两边各自轮询对齐。
 *
 * `GrowthService` 被导出：未来 AI 导师 / 项目模块在服务端记录成长事件时注入它，
 * 但 HTTP 层永远不提供写接口。
 */
@Module({
  imports: [AuthModule],
  controllers: [GrowthController, ParentGrowthController],
  providers: [GrowthService],
  exports: [GrowthService],
})
export class GrowthModule {}
