import { Module } from '@nestjs/common';
import type { Database } from '@qitu/database';
import { DATA_MODE_TOKEN, DATABASE_TOKEN, type DataMode } from '../../database';
import { AuthModule } from '../identity-auth/auth.module';
import { ExplorationStore, InMemoryExplorationStore } from './exploration.store';
import { PostgresExplorationStore } from './exploration.store.postgres';
import { ExplorationsController } from './explorations.controller';
import { ProjectsService } from './projects.service';

/**
 * 探索 / 意图确认模块（T6）。
 *
 * 存储引擎按数据模式选择，与 `DirectoryService` 的双引擎思路一致：
 * - 有数据库连接（`live` 必然有，`demo` / `test` 也允许）→ PostgreSQL 实现；
 * - 无数据库且非 `live` → 内存实现（仅测试与演示）；
 * - `live` 却没有连接 → 直接抛错，**绝不**退化成内存假装持久化。
 *
 * `IdempotencyModule` / `AuditModule` 是 `@Global()`，由 `AppModule` 统一导入，
 * 这里直接注入其抽象即可。
 */
@Module({
  imports: [AuthModule],
  controllers: [ExplorationsController],
  providers: [
    ProjectsService,
    {
      provide: ExplorationStore,
      inject: [DATABASE_TOKEN, DATA_MODE_TOKEN],
      useFactory: (db: Database | null, mode: DataMode): ExplorationStore => {
        if (db !== null) return new PostgresExplorationStore(db);
        if (mode === 'live') {
          // DatabaseModule 理论上已 fail fast；这里再挡一层，避免误配后静默丢数据。
          throw new Error('live 模式缺少 DATABASE_URL：探索存储不可用');
        }
        return new InMemoryExplorationStore();
      },
    },
  ],
  exports: [ProjectsService],
})
export class ProjectsModule {}
