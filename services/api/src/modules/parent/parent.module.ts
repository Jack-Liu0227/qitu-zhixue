import { Module } from '@nestjs/common';
import type { Database } from '@qitu/database';
import { AuthModule } from '../identity-auth/auth.module';
import { DirectoryModule } from '../directory/directory.module';
import { GrowthModule } from '../growth/growth.module';
import { PlatformDataModule } from '../platform-data/platform-data.module';
import { FeedbackModule } from '../feedback/feedback.module';
import { DATABASE_TOKEN } from '../../database';
import { ParentController } from './parent.controller';
import { ParentGrowthExportService } from './growth-export.service';
import { PostgresGrowthExportStore } from './growth-export.store';
import { GrowthExportStore } from './growth-export.types';

/**
 * 家长陪伴中心模块。
 *
 * 挂载三个读页面（dashboard / progress / messages）、写入口
 * （鼓励 / 消息确认 / 反馈）与成长导出（ISSUE-T5）。
 *
 * 对象级权限在每个 `:childId` 路由再次校验：家长只能读自己绑定的孩子；
 * 反馈工单还额外校验家长确实绑定了工单所属的孩子（在 `FeedbackService` 中）。
 *
 * 成长导出存储：`GrowthExportStore` 抽象类作为注入令牌，仅在配置了
 * `DATABASE_URL`（`DATABASE_TOKEN` 非空）时提供 Postgres 实现，否则提供 `null`，
 * 由 `ParentGrowthExportService` 诚实返回 503——不退回内存假装成功。
 */
@Module({
  imports: [AuthModule, DirectoryModule, GrowthModule, PlatformDataModule, FeedbackModule],
  controllers: [ParentController],
  providers: [
    ParentGrowthExportService,
    {
      provide: GrowthExportStore,
      useFactory: (db: Database | null): GrowthExportStore | null =>
        db === null ? null : new PostgresGrowthExportStore(db),
      inject: [DATABASE_TOKEN],
    },
  ],
})
export class ParentModule {}
