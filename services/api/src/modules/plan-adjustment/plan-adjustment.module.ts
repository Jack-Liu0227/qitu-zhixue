import { Module } from '@nestjs/common';
import type { Database } from '@qitu/database';
import { DATA_MODE_TOKEN, DATABASE_TOKEN, type DataMode } from '../../database';
import { PlanAdjustmentService } from './plan-adjustment.service';
import {
  InMemoryPlanAdjustmentStore,
  PlanAdjustmentStore,
} from './plan-adjustment.store';
import { PostgresPlanAdjustmentStore } from './plan-adjustment.store.postgres';
import { StuckSignalService } from './stuck-signal.service';

/**
 * 宏观调谐（计划调整）模块。
 *
 * `AuditModule` / `OutboxModule` / `DatabaseModule` 都是 `@Global()`，这里直接
 * 注入其抽象即可。存储按数据模式选择，与 `LearningPlanStorageModule` 的双引擎
 * 思路一致：有数据库 → Postgres；无数据库且非 live → 内存（仅测试 / 演示）；
 * live 却没有连接 → 直接抛错，绝不退化成内存假装持久化。
 */
@Module({
  providers: [
    PlanAdjustmentService,
    StuckSignalService,
    {
      provide: PlanAdjustmentStore,
      inject: [DATABASE_TOKEN, DATA_MODE_TOKEN],
      useFactory: (db: Database | null, mode: DataMode): PlanAdjustmentStore => {
        if (db !== null) return new PostgresPlanAdjustmentStore(db);
        if (mode === 'live') {
          throw new Error('live 模式缺少 DATABASE_URL：计划调整存储不可用');
        }
        return new InMemoryPlanAdjustmentStore();
      },
    },
  ],
  exports: [PlanAdjustmentService, StuckSignalService],
})
export class PlanAdjustmentModule {}
