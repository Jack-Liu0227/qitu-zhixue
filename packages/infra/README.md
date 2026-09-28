# @qitu/infra

启途智学共享基础设施：Redis 客户端、键作用域、JSON 缓存、分布式锁与面向 outbox
worker 的轻量队列。被 `services/api`、`services/workers`、`services/realtime-gateway`
共用。

## 设计原则

- **按需失败**：`live` 模式下未配置 `REDIS_URL` 时，应用仍能启动；只有真正请求
  缓存 / 锁 / 队列能力时才抛 `RedisUnavailableError`，绝不静默降级。
- **诚实降级**：`demo` / `test` 且未配置 `REDIS_URL` 时使用显式 `NoopRedisAdapter`：
  缓存不保存、队列不落盘、**锁永远获取失败**（不产生假互斥）。
- **作用域隔离**：所有键都带命名空间，支持「全局 / 学校 / 学校 + 学生」三级作用域，
  跨校、跨学生不会串键。
- **框架无关**：核心逻辑不依赖 Nest；Nest 接线在 `services/api/src/common/redis`
  与 `services/api/src/common/queue`。

## 环境变量

| 变量                 | 说明                                                    | 默认     |
| -------------------- | ------------------------------------------------------- | -------- |
| `REDIS_URL`          | Redis 连接串，如 `redis://localhost:6379/0`             | 无       |
| `REDIS_KEY_PREFIX`   | 键命名空间前缀                                          | `qitu`   |
| `REDIS_CACHE_TTL_MS` | 缓存默认 TTL（毫秒，仅正整数生效）                      | 不设过期 |
| `REDIS_LOCK_TTL_MS`  | 分布式锁默认 TTL（毫秒，仅正整数生效）                  | `30000`  |
| `QITU_DATA_MODE`     | `live` / `demo` / `test`，决定无 `REDIS_URL` 时的适配器 | `live`   |

### 适配器选择矩阵

| `REDIS_URL` | `live`                                        | `demo` / `test`                  |
| ----------- | --------------------------------------------- | -------------------------------- |
| 有          | 真实 ioredis 适配器                           | 真实 ioredis 适配器              |
| 无          | `UnavailableRedisAdapter`（请求时 fail-fast） | `NoopRedisAdapter`（显式 no-op） |

## 用法示例

### 键作用域

```ts
import { RedisKeyBuilder } from '@qitu/infra';

const keys = new RedisKeyBuilder('qitu');
keys.global('queue', 'outbox', 'feedback.submitted');
// qitu:queue:outbox:feedback.submitted
keys.school('school-a', 'cache', 'stats');
// qitu:school:school-a:cache:stats
keys.forScope({ schoolId: 'school-a', studentId: 'stu-1' }).cache('profile');
// qitu:school:school-a:student:stu-1:cache:profile
```

### JSON 缓存（带 TTL）

```ts
const cache = new JsonCache(adapter, { defaultTtlMs: 60_000 });
await cache.set('qitu:school:school-a:cache:plan', { weeks: 4 }, { ttlMs: 300_000 });
const plan = await cache.get<{ weeks: number }>('qitu:school:school-a:cache:plan');
const fresh = await cache.remember('qitu:...', () => loadPlan(), { ttlMs: 60_000 });
```

### 分布式锁

```ts
const lock = new DistributedLock(adapter, { defaultTtlMs: 30_000 });
const handle = await lock.acquire('qitu:lock:project:p1', { ttlMs: 10_000 });
if (!handle) return; // 已被占用（或 no-op）
try {
  await doCriticalWork();
} finally {
  await handle.release(); // 仅释放自己的 token
}
```

### 队列（at-least-once）

```ts
const queue = new RedisQueue(adapter);
await queue.enqueue({ key: 'qitu:queue:outbox:t', topic: 't', payload: { id: 'x' } });
const reserved = await queue.reserve('qitu:queue:outbox:t');
if (reserved) {
  try {
    await handle(reserved.job);
    await queue.ack('qitu:queue:outbox:t', reserved);
  } catch (error) {
    await queue.fail('qitu:queue:outbox:t', reserved, error); // 重试或进死信
  }
}
```

### 测试工具

```ts
import { InMemoryRedisAdapter } from '@qitu/infra/testing';
const adapter = new InMemoryRedisAdapter();
```

## 测试

```bash
pnpm --filter @qitu/infra typecheck
pnpm --filter @qitu/infra test
```
