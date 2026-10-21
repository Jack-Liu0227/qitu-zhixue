import { HttpException, HttpStatus, Injectable, Inject, UnauthorizedException } from '@nestjs/common';
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import type { CurrentUser, LoginResponse } from '@qitu/contracts';
import type { DirectoryService } from '../directory/directory.service';
import { allowsConfiguredTestLogin, testLoginOptions } from './test-login';

export interface AuthUser extends CurrentUser {
  passwordHash: string;
}

/** 公开投影：与契约中的 `CurrentUser` 一致，绝不包含口令或会话内部字段。 */
export type PublicUser = CurrentUser;

interface SessionRecord {
  id: string;
  user: CurrentUser;
  deviceId: string;
  deviceName: string;
  createdAt: number;
  lastSeenAt: number;
  /** 会话过期时间（Unix 毫秒）。 */
  expiresAt: number;
}

export interface StudentDeviceSession {
  id: string;
  deviceName: string;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
  current: boolean;
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
const DUMMY_PASSWORD_HASH = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

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

  constructor(
    @Inject('DirectoryService') private readonly directory: Pick<DirectoryService, 'findCredentialByEmail' | 'allowsDemoLogin' | 'findUser'>,
  ) {}

  testLoginOptions() {
    return testLoginOptions(this.directory);
  }

  /**
   * 校验口令并签发会话。
   *
   * `clientKey` 用于按来源限流（控制器传入客户端地址）。未提供时只按邮箱限流。
   */
  async login(
    email: string,
    passwordPlain: string,
    rememberMe = false,
    clientKey = '',
    device: { id?: string; userAgent?: string } = {},
  ): Promise<{ token: string } & LoginResponse> {
    this.assertWithinRateLimit(email, clientKey);

    // 凭据从目录取：身份与口令是同一份真相。
    // 从前这里是两张硬编码表（EMAIL_TO_USER_ID + PASSWORD_STORE），
    // 结果是数据库里新增的用户永远登不进来。
    const credential = await this.directory.findCredentialByEmail(email);

    // Hash the provided password and compare with stored hash
    const providedHash = createHash('sha256').update(passwordPlain, 'utf8').digest('hex');
    // 账号不存在时也要跑一次同代价的比较，否则响应时间会泄露账号是否存在。
    const expectedHash = credential?.passwordHash ?? DUMMY_PASSWORD_HASH;
    const passwordMatches = safePasswordEqual(providedHash, expectedHash);

    const demoAccount = credential && (credential.user.userId.endsWith('-demo') || /@qtzx\.local$/i.test(credential.user.email));
    if (credential === null || !passwordMatches || (demoAccount && !this.directory.allowsDemoLogin() && !allowsConfiguredTestLogin(credential.user))) {
      this.recordFailure(email, clientKey);
      throw new UnauthorizedException({
        code: 'INVALID_CREDENTIALS',
        message: '邮箱或密码错误',
      });
    }

    const user: CurrentUser = {
      id: credential.user.userId,
      email: credential.user.email,
      displayName: credential.user.displayName,
      role: credential.user.role,
    };

    this.attempts.delete(this.emailKey(email));
    this.attempts.delete(this.clientKeyOf(clientKey));
    this.pruneSessions();

    const deviceId = normalizeDeviceId(device.id) ?? randomUUID();
    const limit = deviceLimit();

    // 先清理当前设备的旧会话（同一设备重复登录刷新会话）
    const sameDeviceTokens = [...this.sessions.entries()]
      .filter(([, session]) => session.user.id === user.id && session.deviceId === deviceId)
      .map(([activeToken]) => activeToken);
    for (const activeToken of sameDeviceTokens) this.sessions.delete(activeToken);

    // 统计该用户在其他设备上的活跃会话
    const otherDeviceSessions = [...this.sessions.entries()]
      .filter(([, session]) => session.user.id === user.id && session.deviceId !== deviceId);

    // 按设备分组并找出各设备最早登录时间
    const deviceEarliestMap = new Map<string, number>();
    for (const [, session] of otherDeviceSessions) {
      const prev = deviceEarliestMap.get(session.deviceId);
      if (prev === undefined || session.createdAt < prev) {
        deviceEarliestMap.set(session.deviceId, session.createdAt);
      }
    }

    // 若其他设备数达到上限，按 FIFO 规则挤掉最早登录的设备
    if (deviceEarliestMap.size >= limit) {
      const sortedDevices = [...deviceEarliestMap.entries()].sort((a, b) => a[1] - b[1]);
      const evictCount = deviceEarliestMap.size - (limit - 1);
      const devicesToEvict = new Set(sortedDevices.slice(0, evictCount).map(([dId]) => dId));
      for (const [activeToken, session] of otherDeviceSessions) {
        if (devicesToEvict.has(session.deviceId)) {
          this.sessions.delete(activeToken);
        }
      }
    }

    const token = randomBytes(32).toString('hex');
    const ttlMs = rememberMe ? REMEMBER_ME_TTL_MS : DEFAULT_SESSION_TTL_MS;
    const now = Date.now();
    const expiresAt = now + ttlMs;

    this.sessions.set(token, {
      id: randomUUID(),
      user,
      deviceId,
      deviceName: getDeviceName(device.userAgent),
      createdAt: now,
      lastSeenAt: now,
      expiresAt,
    });

    return {
      token,
      user,
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
    if ((record.user.id.endsWith('-demo') || /@qtzx\.local$/i.test(record.user.email)) && !this.directory.allowsDemoLogin()
      && !allowsConfiguredTestLogin({ userId: record.user.id, role: record.user.role })) {
      this.sessions.delete(token as string);
      throw new UnauthorizedException({ code: 'UNAUTHENTICATED', message: '登录已失效' });
    }
    record.lastSeenAt = Date.now();
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

  listStudentDevices(userId: string, currentToken?: string): StudentDeviceSession[] {
    const now = Date.now();
    return [...this.sessions.entries()]
      .filter(([, session]) => session.user.id === userId && session.user.role === 'student' && session.expiresAt > now)
      .map(([token, session]) => ({
        id: session.id,
        deviceName: session.deviceName,
        createdAt: new Date(session.createdAt).toISOString(),
        lastSeenAt: new Date(session.lastSeenAt).toISOString(),
        expiresAt: new Date(session.expiresAt).toISOString(),
        current: token === currentToken,
      }))
      .sort((left, right) => right.lastSeenAt.localeCompare(left.lastSeenAt));
  }

  revokeStudentDevice(userId: string, sessionId: string): boolean {
    for (const [token, session] of this.sessions) {
      if (session.id === sessionId && session.user.id === userId && session.user.role === 'student') {
        this.sessions.delete(token);
        return true;
      }
    }
    return false;
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
}

function normalizeDeviceId(value: string | undefined): string | null {
  if (typeof value !== 'string' || value.length < 8 || value.length > 120) return null;
  return /^[a-zA-Z0-9._:-]+$/.test(value) ? value : null;
}

export function deviceLimit(raw = process.env.MAX_DEVICES ?? process.env.STUDENT_MAX_DEVICES): number {
  const parsed = Number.parseInt(raw ?? '', 10);
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, 10) : 2;
}

export const studentDeviceLimit = deviceLimit;

function getDeviceName(userAgent: string | undefined): string {
  const value = userAgent ?? '';
  const browser = /Edg\//.test(value) ? 'Edge'
    : /Firefox\//.test(value) ? 'Firefox'
      : /Chrome\//.test(value) ? 'Chrome'
        : /Safari\//.test(value) ? 'Safari' : '浏览器';
  const platform = /iPhone|iPad/.test(value) ? 'iOS'
    : /Android/.test(value) ? 'Android'
      : /Windows/.test(value) ? 'Windows'
        : /Macintosh|Mac OS/.test(value) ? 'macOS'
          : /Linux/.test(value) ? 'Linux' : '设备';
  return `${browser} · ${platform}`;
}
