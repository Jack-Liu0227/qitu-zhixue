import { Module } from '@nestjs/common';
import type { Database } from '@qitu/database';
import { DATA_MODE_TOKEN, DATABASE_TOKEN, type DataMode } from '../../database';
import { PublicContentController } from './public-content.controller';
import { PublicContentService } from './public-content.service';
import { InMemoryPublicContentStore, PublicContentStore } from './public-content.store';
import { PostgresPublicContentStore } from './public-content.store.postgres';
import { DEMO_FEATURED_TEMPLATES } from './public-content.demo-seed';

/**
 * 公开站点模块（营销首页数据 + 咨询线索）。
 *
 * 存储引擎按数据模式选择，与 `TemplatesModule` / `ProjectsModule` 一致：
 * - 有数据库连接（`live` 必然有）→ PostgreSQL 实现；
 * - 无数据库且非 `live` → 内存实现（仅测试 / 演示）；
 * - `live` 却没有连接 → fail fast，绝不退化成内存假装持久化。
 *
 * `IdempotencyStore` / `AuditWriter` 由 `@Global()` 模块提供；本模块不 import `AuthModule`，
 * 因为两个接口都刻意不鉴权（见 `PublicContentController` 的注释）。
 */
@Module({
  controllers: [PublicContentController],
  providers: [
    PublicContentService,
    {
      provide: PublicContentStore,
      inject: [DATABASE_TOKEN, DATA_MODE_TOKEN],
      useFactory: (db: Database | null, mode: DataMode): PublicContentStore => {
        if (db !== null) return new PostgresPublicContentStore(db);
        if (mode === 'live') {
          throw new Error('live 模式缺少 DATABASE_URL：公开站点内容存储不可用');
        }
        return new InMemoryPublicContentStore({ templates: DEMO_FEATURED_TEMPLATES });
      },
    },
  ],
  exports: [PublicContentService],
})
export class PublicContentModule {}
