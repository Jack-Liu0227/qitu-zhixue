import { Module } from '@nestjs/common';
import type { Database } from '@qitu/database';
import { DATA_MODE_TOKEN, DATABASE_TOKEN, type DataMode } from '../../database';
import { AuthModule } from '../identity-auth/auth.module';
import { LearningPlanController } from './learning-plan.controller';
import { LearningPlanService } from './learning-plan.service';
import { InMemoryLearningPlanStore, LearningPlanStore } from './learning-plan.store';
import { PostgresLearningPlanStore } from './learning-plan.store.postgres';
import { DeterministicPlanGenerator, PlanGenerator } from './plan-generator';

/**
 * 学习计划模块（4/8 周计划 + 掌握度 + 先理论后实践门禁）。
 *
 * 双引擎选择与 `ProjectsModule` 一致：
 * - 有数据库连接 → PostgreSQL 实现（`live` 必须有）；
 * - 无数据库且非 `live` → 内存实现（仅测试 / 演示）；
 * - `live` 却无连接 → 直接抛错，绝不退化。
 *
 * `AccessModule` / `AuditModule` / `IdempotencyModule` / `OutboxModule` 均为
 * `@Global()`，由 `AppModule` 统一导入，此处直接注入抽象即可。
 */
@Module({
  imports: [AuthModule],
  controllers: [LearningPlanController],
  providers: [
    LearningPlanService,
    {
      provide: PlanGenerator,
      useFactory: (): PlanGenerator => new DeterministicPlanGenerator(),
    },
    {
      provide: LearningPlanStore,
      inject: [DATABASE_TOKEN, DATA_MODE_TOKEN],
      useFactory: (db: Database | null, mode: DataMode): LearningPlanStore => {
        if (db !== null) return new PostgresLearningPlanStore(db);
        if (mode === 'live') {
          throw new Error('live 模式缺少 DATABASE_URL：学习计划存储不可用');
        }
        return new InMemoryLearningPlanStore();
      },
    },
  ],
  exports: [LearningPlanService],
})
export class LearningPlanModule {}
