import { Module } from '@nestjs/common';
import { DirectoryModule } from '../directory/directory.module';
import { PlatformDataModule } from '../platform-data/platform-data.module';
import { FeedbackAttachmentRegistry, InMemoryFeedbackAttachmentRegistry } from './feedback.attachments';
import { FeedbackService } from './feedback.service';

/**
 * 统一反馈工单模块。
 *
 * 家长端与班主任端共用同一个 `FeedbackService`：家长读/写自己的工单，班主任读/
 * 回复自己学生的工单。`IdempotencyStore` 与 `AuditWriter` 是全局模块提供的横切
 * 能力，这里无需（也不应）再次 import。
 *
 * `FeedbackAttachmentRegistry` 通过抽象类注入，默认是进程内实现；未来上传服务
 * 接入后，只需在 UploadModule 里 `register()`，或把 provider 换成持久化实现，
 * 反馈服务无需改动。
 */
@Module({
  imports: [DirectoryModule, PlatformDataModule],
  providers: [
    FeedbackService,
    { provide: FeedbackAttachmentRegistry, useClass: InMemoryFeedbackAttachmentRegistry },
  ],
  exports: [FeedbackService, FeedbackAttachmentRegistry],
})
export class FeedbackModule {}
