import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  Post,
} from '@nestjs/common';
import type {
  CurrentUser,
  DismissReminderResponse,
  GetStudentRemindersResponse,
  ReminderPreferenceView,
  SetReminderPreferenceRequest,
} from '@qitu/contracts';
import { pickFields, requireRole } from '../../common/access/request-auth';
import { AuthService } from '../identity-auth/auth.service';
import { ReminderService } from './reminder.service';

/**
 * 学生端「学习进度提醒」接口（ISSUE-T2 / #6）。
 *
 * - `GET    /api/v1/reminders`                  读取可投递提醒 + 偏好
 * - `POST   /api/v1/reminders/:id/dismiss`      「知道了」（需幂等键）
 * - `POST   /api/v1/reminders/preference`       关闭 / 重新打开（需幂等键）
 *
 * 三条不可越界：
 * 1. 只向 `student` 角色开放（`requireRole`，服务端判定）；
 * 2. 请求体经 `pickFields` 白名单，客户端**塞不进** `templateId` / `source` /
 *    `trigger` / `title` / `body` 等任何服务端字段；
 * 3. 两个写接口都必须带 `Idempotency-Key` 请求头。
 */
@Controller('reminders')
export class RemindersController {
  constructor(
    private readonly reminders: ReminderService,
    private readonly auth: AuthService,
  ) {}

  @Get()
  async list(
    @Headers('cookie') cookieHeader: string | undefined,
  ): Promise<{ data: GetStudentRemindersResponse }> {
    const user = this.requireStudent(cookieHeader);
    return { data: await this.reminders.listForStudent(user.id) };
  }

  @Post('preference')
  @HttpCode(200)
  async setPreference(
    @Headers('cookie') cookieHeader: string | undefined,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() body: unknown,
  ): Promise<{ data: ReminderPreferenceView }> {
    const user = this.requireStudent(cookieHeader);
    // 白名单只有 `optedOut`：模板、触发源、原因都无法从请求体进入。
    const request = pickFields<SetReminderPreferenceRequest>(body, ['optedOut']);
    const key = requireIdempotencyKey(idempotencyKey);
    return { data: await this.reminders.setPreference(user.id, request, key) };
  }

  @Post(':id/dismiss')
  @HttpCode(200)
  async dismiss(
    @Headers('cookie') cookieHeader: string | undefined,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Param('id') id: string,
  ): Promise<{ data: DismissReminderResponse }> {
    const user = this.requireStudent(cookieHeader);
    const key = requireIdempotencyKey(idempotencyKey);
    return { data: await this.reminders.dismiss(user.id, id, key) };
  }

  private requireStudent(cookieHeader: string | undefined): CurrentUser {
    return requireRole(this.auth, cookieHeader, 'student', '学习进度提醒仅向学生开放');
  }
}

/** `Idempotency-Key` 有值且去掉空白后非空，否则 400 + 稳定错误码。 */
function requireIdempotencyKey(raw: string | undefined): string {
  const key = typeof raw === 'string' ? raw.trim() : '';
  if (key.length === 0) {
    throw new BadRequestException({
      code: 'IDEMPOTENCY_KEY_REQUIRED',
      message: '该接口必须携带 Idempotency-Key 请求头',
    });
  }
  return key;
}
