import { BadRequestException, Body, Controller, Get, Headers, HttpCode, Put } from '@nestjs/common';
import type { UpdateUserPreferencesRequest, UserPreferencesResponse } from '@qitu/contracts';
import { pickFields, requireAnyRole } from '../../common/access/request-auth';
import { AuthService } from '../identity-auth/auth.service';
import { AccountPreferencesService } from './account-preferences.service';

/**
 * 账号基础偏好接口（ISSUE-T4 / #9）。
 *
 * - 挂在顶层 `account` 路径下，是**跨角色账号能力**，不属于任何业务导航
 *   （ADR 0008）；四端外壳只在顶栏账号区放一个入口。
 * - 任意已登录角色都可访问，但**只能访问自己**：路由没有 `:userId`，
 *   服务端只用会话身份，请求体白名单会丢弃任何目标账号字段。
 * - 写接口要求 `Idempotency-Key`；同 key 重放返回第一次结果。
 */
@Controller('account')
export class AccountPreferencesController {
  constructor(
    private readonly authService: AuthService,
    private readonly preferences: AccountPreferencesService,
  ) {}

  /** 读取当前登录账号的偏好。 */
  @Get('preferences')
  async getPreferences(
    @Headers('cookie') cookieHeader: string | undefined,
  ): Promise<{ data: UserPreferencesResponse }> {
    const user = requireAnyRole(this.authService, cookieHeader);
    const preferences = await this.preferences.get(user);
    return { data: { preferences } };
  }

  /**
   * 局部更新当前登录账号的偏好。
   *
   * 仅接受 `fontSize` / `theme` / `reducedMotion` / `notifications` 四个字段；
   * 任何 `userId` / `targetUserId` 之类字段被白名单丢弃。
   */
  @Put('preferences')
  @HttpCode(200)
  async updatePreferences(
    @Headers('cookie') cookieHeader: string | undefined,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() body: unknown,
  ): Promise<{ data: UserPreferencesResponse }> {
    const user = requireAnyRole(this.authService, cookieHeader);
    if (idempotencyKey === undefined || idempotencyKey.trim().length === 0) {
      throw new BadRequestException({
        code: 'IDEMPOTENCY_KEY_REQUIRED',
        message: '缺少 Idempotency-Key 请求头',
      });
    }

    const input = pickFields<UpdateUserPreferencesRequest>(body, [
      'fontSize',
      'theme',
      'reducedMotion',
      'notifications',
    ]);
    const preferences = await this.preferences.update(user, input, idempotencyKey);
    return { data: { preferences } };
  }
}
