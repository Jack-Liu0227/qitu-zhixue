import { HttpException, HttpStatus, Injectable, UnauthorizedException } from '@nestjs/common';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { CurrentUser, LoginResponse, Role } from '@qitu/contracts';

export interface AuthUser extends CurrentUser {
  password: string;
}

/** 公开投影：与契约中的 `CurrentUser` 一致，绝不包含口令或会话内部字段。 */
export type PublicUser = CurrentUser;

interface SessionRecord {
  user: CurrentUser;
  /** 会话过期时间（Unix 毫秒）。 */
  expiresAt: number;
}

/** Fixed-window failure counter for one key (client address or email). */
interface AttemptRecord {
  count: number;
  /** Window start (Unix ms). */
  since: number;
}

const DEFAULT_SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const REMEMBER_ME_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * 登录限流：同一来源 / 同一邮箱在窗口内的失败次数上限。
 *
 * 演示口令是固定的公开值，因此没有限流的登录接口等于把爆破成本降到零。
 * 这里用一个进程内的固定窗口计数器（单实例模块化单体足够；多副本部署时
 * 应换成共享存储，见 `AuthService` 类注释）。
 */
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
// 按邮箱严格限制：演示口令是公开固定值，针对性爆破必须被卡住。
const MAX_ATTEMPTS_PER_EMAIL = 8;
// 按来源宽一些：主要用来拦自动化枚举，同时给正常的输错口令留余量。
const MAX_ATTEMPTS_PER_CLIENT = 60;

/** 进程内会话表上限；超过后优先清理最早过期的记录。 */
const MAX_SESSIONS = 5_000;

// 邮箱不存在时也执行一次相同代价的安全比较，避免通过响应时间枚举账号。
const DUMMY_PASSWORD = 'dummy-password-for-timing';

const users: AuthUser[] = [
  {
    id: 'student-demo',
    email: process.env.DEMO_STUDENT_EMAIL ?? 'student@qtzx.local',
    displayName: '演示学生',
    role: 'student',
    password: process.env.DEMO_STUDENT_PASSWORD ?? 'student123',
  },
  {
    id: 'student-demo-2',
    email: process.env.DEMO_STUDENT2_EMAIL ?? 'student2@qtzx.local',
    displayName: '演示学生二',
    role: 'student',
    password: process.env.DEMO_STUDENT2_PASSWORD ?? 'student123',
  },
  {
    id: 'parent-demo',
    email: process.env.DEMO_PARENT_EMAIL ?? 'parent@qtzx.local',
    displayName: '演示家长',
    role: 'parent',
    password: process.env.DEMO_PARENT_PASSWORD ?? 'parent123',
  },
  {
    id: 'parent-demo-2',
    email: process.env.DEMO_PARENT2_EMAIL ?? 'parent2@qtzx.local',
    displayName: '演示家长二',
    role: 'parent',
    password: process.env.DEMO_PARENT2_PASSWORD ?? 'parent123',
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
  {
    id: 'teacher-demo-2',
    email: process.env.DEMO_TEACHER2_EMAIL ?? 'teacher2@qtzx.local',
    displayName: '演示班主任二',
    role: 'teacher',
    password: process.env.DEMO_TEACHER2_PASSWORD ?? 'teacher123',
  },
  {
    id: 'student-demo-3',
    email: process.env.DEMO_STUDENT3_EMAIL ?? 'student3@qtzx.local',
    displayName: '演示学生三',
    role: 'student',
    password: process.env.DEMO_STUDENT3_PASSWORD ?? 'student123',
  },
  {
    id: 'student-demo-4',
    email: process.env.DEMO_STUDENT4_EMAIL ?? 'student4@qtzx.local',
    displayName: '演示学生四',
    role: 'student',
    password: process.env.DEMO_STUDENT4_PASSWORD ?? 'student123',
  },
];

/**
 * 定时安全比较。两个输入的长度不同时也会补齐到相同长度后比较，
 * 保证比较代价不随内容长度或匹配进度变化。
 *
 * 使用 SHA-256 摘要后再比较，使不同长度的输入也走完全相同的
 * 分配 / 拷贝 / 比较路径（直接补齐原始字节时，代价仍会随长度轻微变化）。
 */
function safePasswordEqual(actual: string, expected: string): boolean {
  const actualDigest = createHash('sha256').update(actual, 'utf8').digest();
  const expectedDigest = createHash('sha256').update(expected, 'utf8').digest();
  return timingSafeEqual(actualDigest, expectedDigest);
}

@Injectable()
export class AuthService {
  private readonly sessions = new Map<string, SessionRecord>();
  private readonly attempts = new Map<string, AttemptRecord>();

  /**
   * 校验口令并签发会话。
   *
   * `clientKey` 用于按来源限流（控制器传入客户端地址）。未提供时只按邮箱限流。
   */
  login(
    email: string,
    password: string,
    rememberMe = false,
    clientKey = '',
  ): { token: string } & LoginResponse {
    this.assertWithinRateLimit(email, clientKey);

    const candidate = users.find((user) => user.email === email);
    // 即使用户不存在也执行一次相同代价的比较，然后才看 `candidate`，
    // 否则「账号不存在」会比「口令错误」快，可被用来枚举账号。
    const expectedPassword = candidate?.password ?? DUMMY_PASSWORD;
    const passwordMatches = safePasswordEqual(password, expectedPassword);
    if (candidate === undefined || !passwordMatches) {
      this.recordFailure(email, clientKey);
      throw new UnauthorizedException({
        code: 'INVALID_CREDENTIALS',
        message: '邮箱或密码错误',
      });
    }

    this.attempts.delete(this.emailKey(email));
    this.attempts.delete(this.clientKeyOf(clientKey));
    this.pruneSessions();

    const token = randomBytes(32).toString('hex');
    const ttlMs = rememberMe ? REMEMBER_ME_TTL_MS : DEFAULT_SESSION_TTL_MS;
    const expiresAt = Date.now() + ttlMs;

    this.sessions.set(token, {
      user: this.toPublicUser(candidate),
      expiresAt,
    });

    return {
      token,
      user: this.toPublicUser(candidate),
      expiresAt: new Date(expiresAt).toISOString(),
    };
  }

  getSession(token?: string): LoginResponse {
    const record = token ? this.sessions.get(token) : undefined;
    if (!record) {
      throw new UnauthorizedException({
        code: 'UNAUTHENTICATED',
        message: '登录已失效',
      });
    }
    if (record.expiresAt <= Date.now()) {
      this.sessions.delete(token as string);
      throw new UnauthorizedException({
        code: 'UNAUTHENTICATED',
        message: '登录已失效',
      });
    }
    return {
      user: record.user,
      expiresAt: new Date(record.expiresAt).toISOString(),
    };
  }

  logout(token?: string): void {
    if (token) {
      this.sessions.delete(token);
    }
  }

  private emailKey(email: string): string {
    return `email:${email.toLowerCase()}`;
  }

  private clientKeyOf(clientKey: string): string {
    return `client:${clientKey}`;
  }

  /** 固定窗口内超过上限则直接拒绝（429），避免固定演示口令被爆破。 */
  private assertWithinRateLimit(email: string, clientKey: string): void {
    const now = Date.now();
    for (const key of [this.emailKey(email), this.clientKeyOf(clientKey)]) {
      const record = this.attempts.get(key);
      if (record === undefined) continue;
      if (now - record.since > LOGIN_WINDOW_MS) {
        this.attempts.delete(key);
        continue;
      }
      const limit = key.startsWith('email:') ? MAX_ATTEMPTS_PER_EMAIL : MAX_ATTEMPTS_PER_CLIENT;
      if (record.count >= limit) {
        throw new HttpException(
          { code: 'RATE_LIMITED', message: '尝试过于频繁，请稍后再试' },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
    }
  }

  private recordFailure(email: string, clientKey: string): void {
    const now = Date.now();
    for (const key of [this.emailKey(email), this.clientKeyOf(clientKey)]) {
      const record = this.attempts.get(key);
      if (record === undefined || now - record.since > LOGIN_WINDOW_MS) {
        this.attempts.set(key, { count: 1, since: now });
        continue;
      }
      record.count += 1;
    }
  }

  /**
   * 进程内会话表不会自动收缩：清掉已过期的记录，并在超过上限时
   * 优先丢弃最早过期的会话，避免长期运行下内存无界增长。
   */
  private pruneSessions(): void {
    const now = Date.now();
    for (const [token, record] of this.sessions) {
      if (record.expiresAt <= now) this.sessions.delete(token);
    }
    if (this.sessions.size < MAX_SESSIONS) return;
    const byExpiry = [...this.sessions.entries()].sort(
      (left, right) => left[1].expiresAt - right[1].expiresAt,
    );
    for (const [token] of byExpiry.slice(0, this.sessions.size - MAX_SESSIONS + 1)) {
      this.sessions.delete(token);
    }
  }

  private toPublicUser(user: AuthUser): CurrentUser {
    return {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      role: user.role,
    };
  }
}
