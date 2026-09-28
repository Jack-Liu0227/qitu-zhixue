import { RedisKeyError } from './errors';

/** 允许出现在键里的简单值类型。 */
export type RedisKeyPart = string | number;

/** 默认命名空间前缀；可通过 `REDIS_KEY_PREFIX` 覆盖。 */
export const DEFAULT_REDIS_NAMESPACE = 'qitu';

/**
 * 禁止出现在键段中的字符。
 *
 * - `:` 是结构化分隔符，出现会破坏「namespace:scope:section:part」的边界；
 * - `*` `?` `[` `]` `{` `}` 是 Redis 通配 / 集群 hash tag 语法，禁止可避免
 *   调用方把用户输入直接拼进键里造成越权扫描或跨 slot 归并；
 * - 空白字符会让日志与运维排查产生歧义。
 */
const FORBIDDEN_KEY_CHARS = /[:*?[\]{}\s]/;

function normalizePart(value: RedisKeyPart, label: string): string {
  const text = typeof value === 'number' ? String(value) : value;
  if (typeof text !== 'string' || text.trim() === '') {
    throw new RedisKeyError(`Redis 键段 "${label}" 不能为空。`);
  }
  const normalized = text.trim();
  if (FORBIDDEN_KEY_CHARS.test(normalized)) {
    throw new RedisKeyError(`Redis 键段 "${label}" 含非法字符（不允许 : * ? [ ] { } 或空白）。`);
  }
  return normalized;
}

/** 学校 / 学生两级作用域；学生作用域必须同时带学校，避免跨校撞键。 */
export interface RedisKeyScope {
  schoolId: string;
  studentId?: string;
}

/**
 * 带命名空间的 Redis 键构造器。
 *
 * 结构（school + student 作用域）：
 * `qitu:school:<schoolId>:student:<studentId>:<section>:<name>[:part...]`
 *
 * 只带学校时省略 student 段。跨校 / 跨学生的相同业务键互不相同，这是
 * 未成年人数据隔离在缓存 / 锁 / 队列层的第一道边界。
 */
export class RedisKeyBuilder {
  readonly namespace: string;

  constructor(namespace: string = DEFAULT_REDIS_NAMESPACE) {
    this.namespace = normalizePart(namespace, 'namespace');
  }

  /** 全局键（不涉及具体学校 / 学生），例如跨租户 outbox：`qitu:queue:outbox:...`。 */
  global(section: string, ...parts: RedisKeyPart[]): string {
    return this.compose([], section, parts);
  }

  /** 学校作用域键：`qitu:school:<schoolId>:<section>[:parts]`。 */
  school(schoolId: string, section: string, ...parts: RedisKeyPart[]): string {
    return this.compose(['school', normalizePart(schoolId, 'schoolId')], section, parts);
  }

  /** 学校 + 学生作用域键：`qitu:school:<schoolId>:student:<studentId>:<section>[:parts]`。 */
  student(schoolId: string, studentId: string, section: string, ...parts: RedisKeyPart[]): string {
    return this.compose(
      [
        'school',
        normalizePart(schoolId, 'schoolId'),
        'student',
        normalizePart(studentId, 'studentId'),
      ],
      section,
      parts,
    );
  }

  /** 返回绑定到固定作用域的便捷构造器。 */
  forScope(scope: RedisKeyScope): ScopedRedisKeyBuilder {
    return new ScopedRedisKeyBuilder(this, scope);
  }

  private compose(scope: string[], section: string, parts: RedisKeyPart[]): string {
    const segments = [
      this.namespace,
      ...scope,
      normalizePart(section, 'section'),
      ...parts.map((part, index) => normalizePart(part, `part[${index}]`)),
    ];
    return segments.join(':');
  }
}

/** 绑定了学校 / 学生作用域的键构造器。 */
export class ScopedRedisKeyBuilder {
  constructor(
    private readonly builder: RedisKeyBuilder,
    private readonly scope: RedisKeyScope,
  ) {}

  /** 缓存键：`...:<section=cache>:<name>[:parts]`。 */
  cache(name: string, ...parts: RedisKeyPart[]): string {
    return this.key('cache', name, ...parts);
  }

  /** 分布式锁键。 */
  lock(name: string, ...parts: RedisKeyPart[]): string {
    return this.key('lock', name, ...parts);
  }

  /** 队列键（不含 pending/processing/dead 后缀，由队列追加）。 */
  queue(name: string, ...parts: RedisKeyPart[]): string {
    return this.key('queue', name, ...parts);
  }

  /** 自定义 section 的键。 */
  key(section: string, name: string, ...parts: RedisKeyPart[]): string {
    const { schoolId, studentId } = this.scope;
    return studentId === undefined || studentId === ''
      ? this.builder.school(schoolId, section, name, ...parts)
      : this.builder.student(schoolId, studentId, section, name, ...parts);
  }
}
