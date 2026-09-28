# 四端基础偏好（ISSUE-T4 / #9）

跨角色的**账号基础能力**：字号、预设主题、减弱动效、通知开关。它挂在顶层
`account` 路径下，是账号能力而非任何业务导航（ADR 0008）。四端外壳只在顶栏账号区
放一个入口，不改动、不新增产品导航。

## 边界

允许：字号预设、设计令牌主题预设、减弱动效、通知开关。
**不允许**（本切片直接不做，而非前端隐藏）：任意颜色值、未成年人敏感数据、
风险设置、平台级 AI 设置、以及任何「读 / 写别人的偏好」的入口。

## 契约

契约在 `@qitu/contracts` 的 `preferences.ts`：

| 类型 | 说明 |
|---|---|
| `FontSizePreference` | `'sm' \| 'md' \| 'lg'`，与 `@qitu/design-tokens` 的 `preferenceFontSizes` 对应 |
| `ThemePreference` | `'default' \| 'focus' \| 'calm'`，每个 id 必须对应令牌里的 `preferenceThemes` |
| `UserPreferences` | `{ fontSize, theme, reducedMotion, notifications, updatedAt }` |
| `UpdateUserPreferencesRequest` | 四个字段均可选；**不含** `userId` |
| `DEFAULT_USER_PREFERENCES` | 无记录时的默认值，与数据库列默认值一致 |

主题**只存预设 id，不存颜色值**；颜色由客户端用 `@qitu/design-tokens` 展开成
CSS 变量。`tooling/validate-preferences.mjs` 会静态断言三处允许集合一致，且主题
预设只引用既有 `colors` / `semanticColors` 令牌、不出现 `#hex`。

## 接口

| 方法 | 路径 | 说明 |
|---|---|---|
| `GET` | `/account/preferences` | 读取当前登录账号偏好 |
| `PUT` | `/account/preferences` | 局部更新，要求 `Idempotency-Key`，返回更新后快照 |

## 权限

- **任意已登录角色**都可用（`requireAnyRole`），因为它就是账号自身的能力；
- **self-only**：路由没有 `:userId`，服务端只用会话身份 `actor.id`；控制器再经
  `pickFields` 白名单，请求体里的 `userId` / `targetUserId` 等字段一律丢弃。
  对象级判定（不是靠前端隐藏）在 `account-preferences.service.test.ts` 的
  「self-only」用例里覆盖。

## 幂等

写操作经 `IdempotencyStore.execute`，scope = `account.preferences.update:<actorId>`：

- 同 key 同载荷重放返回第一次快照，不重复写库、不重复写审计；
- 同 key 不同载荷 → 409 `IDEMPOTENCY_CONFLICT`；
- scope 带 `actorId`：不同账号即使撞 key 也各自独立执行，**绝不跨账号重放**。

## 存储与 fail-closed

`user_preferences` 表（迁移 `0005_t4_user_preferences`），主键即 `user_id`。
`account.module.ts` 只在 `DATABASE_TOKEN` 非空时提供 `PostgresPreferenceStore`，
否则提供 `null`：读 / 写都返回 **503 `PREFERENCE_UNAVAILABLE`**，不退回内存假装
成功。客户端据此降级为「仅本机」并在界面上显式标注（见 `@qitu/ui` 的
`PreferencesMenu`）。

## 审计与日志

- 审计 `account.preferences.updated`，`targetType = user_preferences`，
  `targetId = actorId`，`detail` 只记**变更字段名**（`changed: string[]`），
  不写任何值；
- 日志只打印 `actor` 与变更字段名，不打印偏好值以外内容（偏好值本身也非敏感）。

## 错误码

| 场景 | HTTP | code |
|---|---|---|
| 字号 / 主题不在允许集合，或开关非布尔，或空变更 | 400 | `PREFERENCE_INVALID` |
| 缺少 `Idempotency-Key` | 400 | `IDEMPOTENCY_KEY_REQUIRED` |
| 同 key 不同载荷 / 处理中 | 409 | `IDEMPOTENCY_CONFLICT` |
| 未配置持久化 | 503 | `PREFERENCE_UNAVAILABLE` |

## 测试

`services/api/src/modules/account/account-preferences.service.test.ts`（随
`pnpm --filter @qitu/api test` 运行，已加入 test 脚本 glob）：允许值校验、
self-only、幂等重放 / 冲突 / 按账号隔离、局部合并、审计、fail-closed 503。
`tooling/validate-preferences.mjs`（随 `@qitu/design-tokens` 的 `test` 运行）：
契约 / 令牌 / 服务端允许值三处一致 + 主题仅引用既有令牌。
