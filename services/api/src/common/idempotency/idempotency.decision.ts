import type { IdempotencyStatus } from './idempotency.types';

/**
 * 对「已存在的幂等记录」的状态机判定，**纯函数**。
 *
 * 从 service 里抽出来的原因：并发/重放/冲突的组合分支最容易出错，抽成纯函数后
 * 可以脱库穷举单测（见 `idempotency.decision.test.ts`），而不用起 Postgres。
 *
 * 判定矩阵（`requestHash` 与已存 `storedRequestHash` 比较）：
 *
 * | 已存 status   | hash 相同                                   | hash 不同 |
 * |---------------|---------------------------------------------|-----------|
 * | `succeeded`   | `replay`（返回首个 response，不再执行）      | `conflict`|
 * | `failed`      | `reclaim`（失败无成功结果，允许同键重试）    | `conflict`|
 * | `in_progress` | 租约未到（`now < expiresAt`）→ `conflict`；<br>租约已过期（`now >= expiresAt`）→ `reclaim` | `conflict` |
 *
 * 说明：`succeeded` 即使已过保留期也优先 `replay`（记录还在就重放，不重复副作用）；
 * 保留期只决定 `cleanupExpired()` 何时把它清掉，清掉之后才算「新请求」。
 */
export type IdempotencyDecision = 'replay' | 'conflict' | 'reclaim';

export interface IdempotencyDecisionInput {
  /** 记录里保存的请求指纹。 */
  storedRequestHash: string;
  /** 记录当前状态。 */
  storedStatus: IdempotencyStatus;
  /** 该记录当前租约 / 保留期的截止时间（`in_progress` 时即执行租约）。 */
  storedExpiresAt: Date;
  /** 本次请求的指纹。 */
  requestHash: string;
  /** 判定时刻（注入便于测试，生产传 `new Date()`）。 */
  now: Date;
}

export function decideIdempotencyAction(input: IdempotencyDecisionInput): IdempotencyDecision {
  // 指纹不一致：无论记录处于什么状态，都是同键不同载荷，必须冲突。
  if (input.storedRequestHash !== input.requestHash) {
    return 'conflict';
  }

  if (input.storedStatus === 'succeeded') {
    return 'replay';
  }

  if (input.storedStatus === 'failed') {
    // 失败没有可重放的成功结果；允许同键同载荷重试（重新认领）。
    return 'reclaim';
  }

  // in_progress：租约到期前冲突，到期后可回收重试。
  return input.storedExpiresAt.getTime() <= input.now.getTime() ? 'reclaim' : 'conflict';
}
