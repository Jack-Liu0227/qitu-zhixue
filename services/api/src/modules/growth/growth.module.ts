import { Module } from '@nestjs/common';
import type { Database } from '@qitu/database';
import { DATA_MODE_TOKEN, DATABASE_TOKEN, type DataMode } from '../../database';
import { AuthModule } from '../identity-auth/auth.module';
import { MasteryModule } from '../mastery/mastery.module';
import { GrowthController, ParentGrowthController } from './growth.controller';
import { GrowthService } from './growth.service';
import { DirectoryModule } from '../directory/directory.module';
import { DirectoryService } from '../directory/directory.service';
import { GROWTH_RECORD_STORE, InMemoryGrowthRecordStore } from './growth.persistence';
import { PostgresGrowthRecordStore } from './growth.persistence.postgres';

/**
 * 成长轨迹模块。
 *
 * 同时挂载学生端投影（`/students/me/...`）与家长端投影（`/parent/children/...`）。
 * 两者共用同一个 `GrowthService` 实例，所以「学生看到什么、家长就同步看到什么」
 * 是构造上成立的，而不是靠两边各自轮询对齐。
 *
 * 存储引擎按数据模式选择，与 `DirectoryService` / `FeedbackStore` 的双引擎思路一致：
 * - 有数据库连接（`live` 必然有，`demo` / `test` 也允许）→ `PostgresGrowthRecordStore`
 *   读写规范表 `growth_records`（迁移 0008）；
 * - 无数据库且非 `live` → `InMemoryGrowthRecordStore` + 演示 fixture；
 * - `live` 却没有连接 → 直接抛错，**绝不**退化成内存假装持久化。
 *
 * `GrowthService` 被导出：未来 AI搭档 / 项目模块在服务端记录成长事件时注入它，
 * 但 HTTP 层永远不提供写接口。
 */
@Module({
  imports: [DirectoryModule, AuthModule, MasteryModule],
  controllers: [GrowthController, ParentGrowthController],
  providers: [
    GrowthService,
    {
      provide: 'DirectoryService',
      useExisting: DirectoryService,
    },
    {
      provide: GROWTH_RECORD_STORE,
      inject: [DATABASE_TOKEN, DATA_MODE_TOKEN],
      useFactory: (db: Database | null, mode: DataMode) => {
        if (db !== null) return new PostgresGrowthRecordStore(db);
        if (mode === 'live') {
          // DatabaseModule 理论上已 fail fast；这里再挡一层，避免误配后静默丢数据。
          throw new Error('live 模式缺少 DATABASE_URL：成长档案存储不可用');
        }
        return new InMemoryGrowthRecordStore();
      },
    },
  ],
  exports: [GrowthService],
})
export class GrowthModule {}
