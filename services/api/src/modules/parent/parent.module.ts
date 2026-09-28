import { Module } from '@nestjs/common';
import { AuthModule } from '../identity-auth/auth.module';
import { DirectoryModule } from '../directory/directory.module';
import { GrowthModule } from '../growth/growth.module';
import { PlatformDataModule } from '../platform-data/platform-data.module';
import { FeedbackModule } from '../feedback/feedback.module';
import { ParentController } from './parent.controller';

/**
 * 家长陪伴中心模块。
 *
 * 挂载三个读页面（dashboard / progress / messages）与写入口
 * （鼓励 / 消息确认 / 反馈）。
 *
 * 对象级权限在每个 `:childId` 路由再次校验：家长只能读自己绑定的孩子；
 * 反馈工单还额外校验家长确实绑定了工单所属的孩子（在 `FeedbackService` 中）。
 */
@Module({
  imports: [AuthModule, DirectoryModule, GrowthModule, PlatformDataModule, FeedbackModule],
  controllers: [ParentController],
})
export class ParentModule {}
