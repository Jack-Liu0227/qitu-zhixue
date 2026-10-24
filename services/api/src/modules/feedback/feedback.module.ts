import { Module } from '@nestjs/common';
import type { Database } from '@qitu/database';
import { DATA_MODE_TOKEN, DATABASE_TOKEN, type DataMode } from '../../database';
import { AuditWriter } from '../../common/audit/audit.service';
import { OutboxWriter } from '../../common/outbox/outbox.service';
import { DirectoryModule } from '../directory/directory.module';
import { AuthModule } from '../identity-auth/auth.module';
import { PlatformDataModule } from '../platform-data/platform-data.module';
import {
  FeedbackAttachmentRegistry,
  InMemoryFeedbackAttachmentRegistry,
} from './feedback.attachments';
import { FeedbackStore, InMemoryFeedbackStore } from './feedback.store';
import { PostgresFeedbackStore } from './feedback.store.postgres';
import { FeedbackService } from './feedback.service';
import { FeedbackAttachmentService } from './feedback-attachment.service';
import { FeedbackAttachmentController } from './feedback-attachment.controller';

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
 * 附件使用持久化的私有字节与归属登记；缺数据库时上传返回服务不可用。
 */
@Module({
  imports: [DirectoryModule, PlatformDataModule, AuthModule],
  controllers: [FeedbackAttachmentController],
  providers: [
    FeedbackService,
    FeedbackAttachmentService,
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
      inject: [DATABASE_TOKEN, DATA_MODE_TOKEN, FeedbackAttachmentService],
      useFactory: (db: Database | null, mode: DataMode, attachments: FeedbackAttachmentService): FeedbackAttachmentRegistry => {
        if (db || mode === 'live') return attachments;
        return new InMemoryFeedbackAttachmentRegistry();
      },
    },
  ],
  exports: [FeedbackService, FeedbackStore, FeedbackAttachmentRegistry],
})
export class FeedbackModule {}
