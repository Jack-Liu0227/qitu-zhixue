import { Body, Controller, Get, Headers, Post, Res, UnauthorizedException } from '@nestjs/common';
import type { Response } from 'express';
import { AuthService } from './auth.service';

interface LoginBody {
  email?: string;
  password?: string;
}

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('login')
  login(@Body() body: LoginBody, @Res({ passthrough: true }) response: Response) {
    if (!body.email || !body.password) {
      throw new UnauthorizedException('请输入邮箱和密码');
    }
    const result = this.authService.login(body.email.trim().toLowerCase(), body.password);
    response.cookie('qitu_session', result.token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: 1000 * 60 * 60 * 8,
      path: '/',
    });
    return { data: result.user };
  }

  @Get('me')
  me(@Headers('cookie') cookieHeader?: string) {
    return { data: this.authService.getUser(this.readSession(cookieHeader)) };
  }

  @Post('logout')
  logout(@Headers('cookie') cookieHeader: string | undefined, @Res({ passthrough: true }) response: Response) {
    this.authService.logout(this.readSession(cookieHeader));
    response.clearCookie('qitu_session', { path: '/' });
    return { data: { ok: true } };
  }

  private readSession(cookieHeader?: string): string | undefined {
    return cookieHeader
      ?.split(';')
      .map((part) => part.trim().split('='))
      .find(([key]) => key === 'qitu_session')?.[1];
  }
}
