import { Module } from '@nestjs/common';
import type { Database } from '@qitu/database';
import { DATA_MODE_TOKEN, DATABASE_TOKEN, type DataMode } from '../../database';
import { AuditWriter } from '../../common/audit/audit.service';
import { OutboxWriter } from '../../common/outbox/outbox.service';
import { DirectoryModule } from '../directory/directory.module';
import { PlatformDataModule } from '../platform-data/platform-data.module';
import {
  FeedbackAttachmentRegistry,
  InMemoryFeedbackAttachmentRegistry,
  RejectingFeedbackAttachmentRegistry,
} from './feedback.attachments';
import { FeedbackStore, InMemoryFeedbackStore } from './feedback.store';
import { PostgresFeedbackStore } from './feedback.store.postgres';
import { FeedbackService } from './feedback.service';

/**
 * 统一反馈工单模块。
 *
 * 家长端与班主任端共用同一个 `FeedbackService`：家长读/写自己的工单，班主任读/
 * 回复自己学生的工单。`IdempotencyStore` / `AuditWriter` / `OutboxWriter` 是全局
 * 模块提供的横切能力，这里无需（也不应）再次 import。
 *
 * 存储引擎按数据模式选择，与 `DirectoryService` / `ExplorationStore` 的双引擎思路
 * 一致：
 * - 有数据库连接（`live` 必然有，`demo` / `test` 也允许）→ `PostgresFeedbackStore`；
 * - 无数据库且非 `live` → `InMemoryFeedbackStore`（仅测试与演示）；
 * - `live` 却没有连接 → 直接抛错，**绝不**退化成内存假装持久化。
 *
 * 附件归属在 live 下失败关闭（`RejectingFeedbackAttachmentRegistry`）：对象存储
 * 与归属表尚未接入，无法证明附件归属时宁可拒绝，也不退回进程内登记表。
 */
@Module({
  imports: [DirectoryModule, PlatformDataModule],
  providers: [
    FeedbackService,
    {
      provide: FeedbackStore,
      inject: [DATABASE_TOKEN, DATA_MODE_TOKEN, AuditWriter, OutboxWriter],
      useFactory: (
        db: Database | null,
        mode: DataMode,
        audit: AuditWriter,
        outbox: OutboxWriter,
      ): FeedbackStore => {
        if (db !== null) return new PostgresFeedbackStore(db, audit, outbox);
        if (mode === 'live') {
          // DatabaseModule 理论上已 fail fast；这里再挡一层，避免误配后静默丢数据。
          throw new Error('live 模式缺少 DATABASE_URL：反馈工单存储不可用');
        }
        return new InMemoryFeedbackStore(audit, outbox);
      },
    },
    {
      provide: FeedbackAttachmentRegistry,
      inject: [DATA_MODE_TOKEN],
      useFactory: (mode: DataMode): FeedbackAttachmentRegistry =>
        mode === 'live'
          ? new RejectingFeedbackAttachmentRegistry()
          : new InMemoryFeedbackAttachmentRegistry(),
    },
  ],
  exports: [FeedbackService, FeedbackStore, FeedbackAttachmentRegistry],
})
export class FeedbackModule {}
