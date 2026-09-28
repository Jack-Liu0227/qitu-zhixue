import { Module } from '@nestjs/common';
import { AuthModule } from '../identity-auth/auth.module';
import { ModelRegistryModule } from '../model-registry/model-registry.module';
import { PlatformDataModule } from '../platform-data/platform-data.module';
import { RemindersModule } from '../reminders/reminders.module';
import { TutorWorkspaceService } from './tutor-workspace.service';
import { TutorController } from './tutor.controller';
import { TutorService } from './tutor.service';

/**
 * AI 搭档模块。
 *
 * 依赖 `RemindersModule` 只为拿到 `LearningStallSignalSink` 抽象：当会话内
 * 连续卡顿越过升级阈值时，把「学习进度停滞」这一服务端事实交给提醒模块。
 * 提醒是否真的投递由提醒模块的评审门禁决定（默认关闭，fail-closed）。
 */
@Module({
  imports: [AuthModule, ModelRegistryModule, PlatformDataModule, RemindersModule],
  controllers: [TutorController],
  providers: [TutorService, TutorWorkspaceService],
  exports: [TutorService],
})
export class AiTutorModule {}
