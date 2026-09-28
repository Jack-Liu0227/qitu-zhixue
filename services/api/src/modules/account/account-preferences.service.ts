import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { CurrentUser, UserPreferences } from '@qitu/contracts';
import { IdempotencyStore } from '../../common/idempotency/idempotency.service';
import { hashIdempotentInput } from '../../common/idempotency/idempotency.hash';
import { throwHttpForIdempotencyError } from '../../common/idempotency/idempotency.errors';
import { AuditWriter } from '../../common/audit/audit.service';
import {
  DEFAULT_PREFERENCE_VALUES,
  parsePreferenceUpdate,
  type PreferencePatch,
} from './account-preferences.values';
import { PreferenceStore, type PreferenceRecord } from './account-preferences.types';

/**
 * 四端基础偏好服务（ISSUE-T4 / #9）。
 *
 * 硬约束：
 *  1. **self-only**：读 / 写都只认会话身份 `actor.id`，接口没有 `:userId`，
 *     客户端请求体里的 `userId` / `targetUserId` 会被白名单解析直接忽略；
 *  2. **幂等**：写操作经 `IdempotencyStore.execute`，幂等 scope 带上 `actor.id`，
 *     同 key 重放返回第一次结果、不重复写库、不重复写审计；不同账号即使撞 key
 *     也各自独立执行，绝不跨账号重放；
 *  3. **fail-closed**：未配置持久化时读 / 写都返回 503 `PREFERENCE_UNAVAILABLE`，
 *     不内存假装成功（客户端据此降级为「仅本机」并显式标注）；
 *  4. **审计**：`account.preferences.updated` 只记**变更字段名**，不记任何敏感内容。
 */
@Injectable()
export class AccountPreferencesService {
  private readonly logger = new Logger(AccountPreferencesService.name);

  constructor(
    private readonly idempotency: IdempotencyStore,
    private readonly audit: AuditWriter,
    @Inject(PreferenceStore) private readonly store: PreferenceStore | null,
  ) {}

  /** 读取当前账号偏好；无记录返回契约默认值（不落库）。 */
  async get(actor: CurrentUser): Promise<UserPreferences> {
    const store = this.requireStore();
    const record = await store.get(actor.id);
    return record === null ? defaultPreferences() : toUserPreferences(record);
  }

  /** 局部更新当前账号偏好。要求 `Idempotency-Key`（控制器保证非空）。 */
  async update(
    actor: CurrentUser,
    rawBody: unknown,
    idempotencyKey: string,
  ): Promise<UserPreferences> {
    const patch = parsePreferenceUpdate(rawBody);
    if (Object.keys(patch).length === 0) {
      throw new BadRequestException({
        code: 'PREFERENCE_INVALID',
        message: '至少需要提供一项偏好变更',
      });
    }

    const store = this.requireStore();
    // scope 带上 actor.id：幂等单元按账号隔离，避免跨账号重放。
    const scope = `account.preferences.update:${actor.id}`;
    const requestHash = hashIdempotentInput(scope, { userId: actor.id }, patch);

    try {
      const result = await this.idempotency.execute(
        scope,
        idempotencyKey,
        requestHash,
        async () => {
          // 在拿到执行权后再读取当前值，避免并发更新下合并到过期快照。
          const current = await store.get(actor.id);
          const merged = mergePreferences(current, patch);
          const saved = await store.upsert({ userId: actor.id, ...merged, updatedAt: new Date() });

          await this.audit.write({
            actorId: actor.id,
            actorRole: actor.role,
            action: 'account.preferences.updated',
            targetType: 'user_preferences',
            targetId: actor.id,
            idempotencyKey: `${scope}:${idempotencyKey}`,
            // 只记字段名：字号 / 主题 / 开关都不是敏感数据，但仍保持最小化。
            detail: { changed: Object.keys(patch).sort() },
          });

          this.logger.log(
            `账号偏好已更新（actor=${actor.id}, changed=${Object.keys(patch).sort().join(',')}）`,
          );

          return { status: 200, body: toUserPreferences(saved) };
        },
      );
      return result.body;
    } catch (error) {
      throwHttpForIdempotencyError(error);
      throw error;
    }
  }

  private requireStore(): PreferenceStore {
    if (this.store === null) {
      throw new ServiceUnavailableException({
        code: 'PREFERENCE_UNAVAILABLE',
        message: '偏好服务暂不可用：尚未配置持久化存储',
      });
    }
    return this.store;
  }
}

function mergePreferences(
  current: PreferenceRecord | null,
  patch: PreferencePatch,
): Omit<PreferenceRecord, 'userId' | 'updatedAt'> {
  const base = current ?? DEFAULT_PREFERENCE_VALUES;
  return {
    fontSize: patch.fontSize ?? base.fontSize,
    theme: patch.theme ?? base.theme,
    reducedMotion: patch.reducedMotion ?? base.reducedMotion,
    notifications: patch.notifications ?? base.notifications,
  };
}

function toUserPreferences(record: PreferenceRecord): UserPreferences {
  return {
    fontSize: record.fontSize,
    theme: record.theme,
    reducedMotion: record.reducedMotion,
    notifications: record.notifications,
    updatedAt: record.updatedAt.toISOString(),
  };
}

function defaultPreferences(): UserPreferences {
  return { ...DEFAULT_PREFERENCE_VALUES, updatedAt: null };
}
