import { Injectable } from '@nestjs/common';
import type { CurrentUser } from '@qitu/contracts';
import type { FeishuInboundMessage } from './feishu-inbound';
import { DEFAULT_FEISHU_ASSISTANT_ID } from './feishu.service';
import { ReportingService } from './reporting.service';
import { formatFeishuReport } from './feishu-api';

export interface FeishuAssistantHandler {
  reply(input: { actor: CurrentUser; command: FeishuInboundMessage['command'] }): Promise<string>;
}

/** Only server modules register handlers. A bot binding grants no domain permissions. */
@Injectable()
export class FeishuAssistantHandlers {
  private readonly handlers = new Map<string, FeishuAssistantHandler>();
  constructor(reporting: ReportingService) {
    this.register(DEFAULT_FEISHU_ASSISTANT_ID, {
      reply: async ({ actor, command }) => command === 'report'
        ? formatFeishuReport(await reporting.buildReport(actor, DEFAULT_FEISHU_ASSISTANT_ID))
        : '发送“汇报”或“问题总结”，获取学生、家长与教师的脱敏汇总。仅向已绑定的平台管理员私聊回复。',
    });
  }

  register(assistantId: string, handler: FeishuAssistantHandler): void {
    if (this.handlers.has(assistantId)) throw new Error(`Feishu handler already registered: ${assistantId}`);
    this.handlers.set(assistantId, handler);
  }

  reply(assistantId: string, input: Parameters<FeishuAssistantHandler['reply']>[0]): Promise<string> {
    const handler = this.handlers.get(assistantId);
    return handler ? handler.reply(input) : Promise.resolve('此助手已绑定飞书机器人，尚未接入消息处理功能。请在启途智学中使用该助手。');
  }
}
