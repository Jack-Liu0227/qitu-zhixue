import { Injectable, UnauthorizedException } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import type { Role } from '@qitu/contracts';

export interface AuthUser {
  id: string;
  email: string;
  displayName: string;
  role: Role;
  password: string;
}

export interface PublicUser extends Omit<AuthUser, 'password'> {}

const users: AuthUser[] = [
  {
    id: 'student-demo',
    email: process.env.DEMO_STUDENT_EMAIL ?? 'student@qtzx.local',
    displayName: '演示学生',
    role: 'student',
    password: process.env.DEMO_STUDENT_PASSWORD ?? 'student123',
  },
  {
    id: 'parent-demo',
    email: process.env.DEMO_PARENT_EMAIL ?? 'parent@qtzx.local',
    displayName: '演示家长',
    role: 'parent',
    password: process.env.DEMO_PARENT_PASSWORD ?? 'parent123',
  },
  {
    id: 'teacher-demo',
    email: process.env.DEMO_TEACHER_EMAIL ?? 'teacher@qtzx.local',
    displayName: '演示班主任',
    role: 'teacher',
    password: process.env.DEMO_TEACHER_PASSWORD ?? 'teacher123',
  },
  {
    id: 'admin-demo',
    email: process.env.DEMO_ADMIN_EMAIL ?? 'admin@qtzx.local',
    displayName: '演示管理员',
    role: 'admin',
    password: process.env.DEMO_ADMIN_PASSWORD ?? 'admin123',
  },
];

@Injectable()
export class AuthService {
  private readonly sessions = new Map<string, PublicUser>();

  login(email: string, password: string): { token: string; user: PublicUser } {
    const user = users.find((candidate) => candidate.email === email && candidate.password === password);
    if (!user) throw new UnauthorizedException('邮箱或密码错误');
    const token = randomBytes(32).toString('hex');
    const publicUser = this.toPublicUser(user);
    this.sessions.set(token, publicUser);
    return { token, user: publicUser };
  }

  getUser(token?: string): PublicUser {
    const user = token ? this.sessions.get(token) : undefined;
    if (!user) throw new UnauthorizedException('登录已失效');
    return user;
  }

  logout(token?: string): void {
    if (token) this.sessions.delete(token);
  }

  private toPublicUser(user: AuthUser): PublicUser {
    const { password: _password, ...publicUser } = user;
    return publicUser;
  }
}
