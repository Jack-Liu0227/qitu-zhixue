import { Body, Controller, Get, Headers, Ip, Post, Res, UnauthorizedException } from '@nestjs/common';
import type { Response } from 'express';
import type { LoginResponse } from '@qitu/contracts';
import { AuthService } from './auth.service';

const SESSION_COOKIE = 'qitu_session';
const DEFAULT_MAX_AGE_MS = 8 * 60 * 60 * 1000;
const REMEMBER_ME_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * 是否给会话 Cookie 加上 `Secure`。
 *
 * 不能只看 `NODE_ENV`：生产环境跑 HTTPS 但忘记设变量时，Cookie 会静默降级为
 * 明文可发。优先信 `X-Forwarded-Proto`（本部署由 nginx 反代并设置该头），
 * 并允许 `SESSION_COOKIE_SECURE` 显式覆盖。
 */
function isCookieSecure(forwardedProto?: string): boolean {
  const override = process.env.SESSION_COOKIE_SECURE;
  if (override === 'true') return true;
  if (override === 'false') return false;
  return (
    forwardedProto !== undefined &&
    forwardedProto.split(',')[0]?.trim().toLowerCase() === 'https'
  );
}

interface LoginBody {
  email?: unknown;
  password?: unknown;
  rememberMe?: unknown;
}

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('login')
  login(
    @Body() body: LoginBody,
    @Ip() ip: string,
    @Headers('x-forwarded-for') forwardedFor: string | undefined,
    @Headers('x-forwarded-proto') forwardedProto: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ) {
    const email = this.readEmail(body);
    const password = this.readPassword(body);
    const rememberMe = body.rememberMe === true;
    // 直连时 `@Ip()` 是真实地址；经 nginx 反代时它是代理地址，
    // 因此优先使用 `X-Forwarded-For` 的第一段。
    const clientKey =
      forwardedFor?.split(',')[0]?.trim() || ip || 'unknown';

    const result = this.authService.login(email, password, rememberMe, clientKey);

    response.cookie(SESSION_COOKIE, result.token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: isCookieSecure(forwardedProto),
      maxAge: rememberMe ? REMEMBER_ME_MAX_AGE_MS : DEFAULT_MAX_AGE_MS,
      path: '/',
    });

    return { data: { user: result.user, expiresAt: result.expiresAt } };
  }

  @Get('me')
  me(@Headers('cookie') cookieHeader?: string) {
    const session = this.authService.getSession(this.readSession(cookieHeader));
    // 保持向后兼容：旧客户端在 `data` 上直接读取 `role` / `id`。
    return { data: { ...session.user, user: session.user, expiresAt: session.expiresAt } };
  }

  @Get('session')
  session(@Headers('cookie') cookieHeader?: string): { data: LoginResponse } {
    return { data: this.authService.getSession(this.readSession(cookieHeader)) };
  }

  @Post('logout')
  logout(@Headers('cookie') cookieHeader: string | undefined, @Res({ passthrough: true }) response: Response) {
    this.authService.logout(this.readSession(cookieHeader));
    response.clearCookie(SESSION_COOKIE, { path: '/' });
    return { data: { ok: true } };
  }

  private readEmail(body: LoginBody): string {
    if (typeof body.email !== 'string' || !body.email.trim()) {
      throw new UnauthorizedException({
        code: 'INVALID_CREDENTIALS',
        message: '请输入邮箱和密码',
      });
    }
    return body.email.trim().toLowerCase();
  }

  private readPassword(body: LoginBody): string {
    if (typeof body.password !== 'string' || body.password.length === 0) {
      throw new UnauthorizedException({
        code: 'INVALID_CREDENTIALS',
        message: '请输入邮箱和密码',
      });
    }
    return body.password;
  }

  private readSession(cookieHeader?: string): string | undefined {
    return cookieHeader
      ?.split(';')
      .map((part) => part.trim().split('='))
      .find(([key]) => key === SESSION_COOKIE)?.[1];
  }
}
