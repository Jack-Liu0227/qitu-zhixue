import { BadRequestException, Injectable } from '@nestjs/common';

/**
 * 附件归属校验的端口（seam）。
 *
 * 背景：`packages/file-uploader` 目前只有一个 `PresignedUpload` 类型，并没有
 * 真正的对象存储与「谁能引用哪个附件」的登记表。但反馈工单一旦允许附件，
 * 归属校验就不能省略——否则任何家长都能把别人（甚至别的班级）的附件 id
 * 挂到自己的工单上，形成越权读取。
 *
 * 因此这里定义一个最小端口：
 * - 上传服务在「签发上传 / 确认上传」时调用 `register(attachmentId, ownerUserId)`；
 * - 反馈服务在写入工单前调用 `assertOwnedBy(actorId, attachmentIds)`。
 *
 * 默认实现是进程内登记表，与平台其它演示域（Directory / PlatformData）一致，
 * 仅用于 demo/test。生产接入对象存储时应替换为一张持久化的附件归属表。
 *
 * 无论哪种实现，校验失败都必须抛 `FEEDBACK_ATTACHMENT_INVALID`，且消息不区分
 * 「不存在」「不属于自己」「未确认」——避免用错误文案探测他人附件是否存在。
 */
export abstract class FeedbackAttachmentRegistry {
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
