import { BadRequestException, Injectable } from '@nestjs/common';
import type { FeedbackAttachmentInfo } from '@qitu/contracts';

/** Persistent uploads implement this port; the in-memory registry is only for isolated fixtures. */
export abstract class FeedbackAttachmentRegistry {
  async describe(_attachmentIds: readonly string[]): Promise<FeedbackAttachmentInfo[]> { return []; }
  /** 校验每个附件 id 都存在且属于 `ownerUserId`；否则抛 `FEEDBACK_ATTACHMENT_INVALID`。 */
  abstract assertOwnedBy(ownerUserId: string, attachmentIds: readonly string[]): Promise<void>;

  /** 登记一个附件的归属。由上传服务在附件落定后调用。 */
  abstract register(attachmentId: string, ownerUserId: string): void;
}

function attachmentInvalid(): never {
  throw new BadRequestException({
    code: 'FEEDBACK_ATTACHMENT_INVALID',
    message: '附件不存在或不属于当前账号',
  });
}

/** 进程内附件归属登记表；仅 demo/test 使用。 */
@Injectable()
export class InMemoryFeedbackAttachmentRegistry extends FeedbackAttachmentRegistry {
  private readonly owners = new Map<string, string>();

  async assertOwnedBy(ownerUserId: string, attachmentIds: readonly string[]): Promise<void> {
    for (const attachmentId of attachmentIds) {
      if (this.owners.get(attachmentId) !== ownerUserId) {
        attachmentInvalid();
      }
    }
  }

  register(attachmentId: string, ownerUserId: string): void {
    this.owners.set(attachmentId, ownerUserId);
  }

  /** 测试 / 演示辅助：清空登记表。 */
  clear(): void {
    this.owners.clear();
  }
}
