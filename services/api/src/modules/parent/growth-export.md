# 家长成长数据导出（ISSUE-T5 / #7）

服务端独占的家长成长导出。目标是**在真实数据上跑通最小闭环**，同时把隐私约束
落在代码边界上，而不是靠前端隐藏或事后补救。

## 契约

契约在 `@qitu/contracts` 的 `parent.ts`（`ParentGrowthExport*` 系列）：

| 类型 | 说明 |
|---|---|
| `ParentGrowthExportRequest` | `{ confirmChildId, confirmGuardianEmail, reason }`，两个 confirm 字段必填 |
| `ParentGrowthExportJob` | 任务元数据：`exportId / childId / childDisplayName / status / createdAt / expiresAt`，**不含正文** |
| `ParentGrowthExportDocument` | 下载正文：`schemaVersion / exportId / generatedAt / expiresAt / truncated / summary / entries` |

`ParentGrowthExportStatus = 'pending' | 'ready' | 'expired'`。当前同步切片只产生
`ready`；`pending` 为未来异步 worker 预留，判定函数已覆盖（下载 `pending` → 409）。

## 接口

| 方法 | 路径 | 说明 |
|---|---|---|
| `POST` | `/parent/children/:childId/growth-exports` | 申请导出，要求 `Idempotency-Key`，返回任务元数据 |
| `GET` | `/parent/growth-exports/:exportId/download` | 下载正文，每次重新校验授权 / 归属 / 有效期 |

## 四条硬约束的落点

1. **对象级授权（请求 + 下载各一次）**
   两处都调用 `GrowthService.canParentReadChild`（底层是 `DirectoryService` 的
   active `guardian_links` 关系真源）。授权被撤销后下载返回 **403**
   （`PARENT_EXPORT_DENIED`），而不是空数据。别的家长的导出返回 **404**
   （`PARENT_EXPORT_NOT_FOUND`），不通过 403/404 差异泄露存在性。
2. **默认脱敏（白名单投影）**
   正文由 `buildParentGrowthExportDocument()` **逐字段重建**。原始 AI 对话、
   原始语音、内部风险标签、邮箱、任意模型推断都不在投影里；即使上游对象被扩宽
   也不会带出。测试对整份正文做深度 key 扫描。
3. **幂等**
   请求经 `IdempotencyStore.execute`（scope = `parent.growth_export.request:<childId>`）。
   同 key 同载荷重放返回第一次的任务，不落第二条记录、不重复写审计；同 key 不同
   载荷 → 409 `IDEMPOTENCY_CONFLICT`。
4. **审计（不含正文）**
   `parent.growth_export.requested` / `.downloaded` / `.denied`，`detail` 只记过程
   事实（`childId`、状态、条目数、拒绝原因码）。目的文本作为审计 `reason` 上下文，
   **不**写入导出正文。

最小化的身份确认是「路径 childId + 登录邮箱」双确认；不匹配返回 400
`PARENT_EXPORT_INVALID`，且不区分是哪一项不符。

## 状态 / 有效期判定

`decideGrowthExportAccess()` 是纯函数，优先级：`not_found`（不存在或不属于本人）→
`forbidden`（无 active 监护关系）→ `not_ready`（pending）→ `expired`（状态为
`expired` 或 `now >= expiresAt`）→ `ok`。有效期 `PARENT_GROWTH_EXPORT_TTL_MS = 24h`；
单次导出条目上限 `PARENT_GROWTH_EXPORT_MAX_ENTRIES = 100`，超出时正文
`truncated=true`。

## 持久化

迁移 `0003_glamorous_ulik`（`parent_growth_exports`）保存任务元数据与**已脱敏的**
正文快照。`GrowthExportStore` 是抽象接口，Postgres 实现为
`PostgresGrowthExportStore`；`parent.module.ts` 仅在 `DATABASE_TOKEN` 非空时提供它，
否则提供 `null`。此时两个接口都诚实返回 **503 `PARENT_EXPORT_UNAVAILABLE`**，
**不**退回内存假装成功。

## 如何运行测试

测试用 `node:test`，不依赖 Postgres（用进程内替身 store）：

```bash
cd services/api
npx tsc -p tsconfig.json
node --test dist/modules/parent/growth-export.projection.test.js \
           dist/modules/parent/growth-export.service.test.js
```

覆盖：白名单 / 禁区字段扫描、跨家长请求与下载、授权撤销后下载 403、确认信息
不匹配、目的校验、幂等重放与冲突、过期 410、未知 / 他人导出 404、pending 409、
无持久化 503。

## 已知阻塞（不含在本切片内）

- **异步 worker + 对象存储**：当前是同步生成 + 限时下载，正文随任务落库。
  大文件、真正的「导出为文件」、后台生成仍需 `services/workers` 的队列消费者与
  对象存储；`services/workers` 目前只是初始化日志桩。替换一个 `GrowthExportStore`
  实现即可接入，契约与 service 不动。
- **step-up 重新认证**：更强的二次认证（重新输入口令 / OTP）依赖跨角色账户面
  （见 `ISSUE-T4`），当前用「路径 childId + 登录邮箱」双确认替代。
- **保留与彻底删除策略**：`expires_at` 提供限时读取；到期行的清理 / 物理删除
  尚未接入定时任务（见 `docs/DATABASE.md` §9 未决事项）。
