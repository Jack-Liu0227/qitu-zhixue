# 浏览器客户端 SDK

> 浏览器边界的公开 SDK 面：`@qitu/api-client`。
> 实现入口：`packages/api-client/src/**`。

## 1. 导出面

| 入口 | 导出 | 说明 |
|---|---|---|
| `.` | `createApiClient(baseUrl: string): ApiClient`、`ApiError`、`createQituReadSDK(options?): QituReadSDK`、`QituReadSDK`（type）、`createMasteryReadPort`、`MasteryTransport`（type） | `ApiClient` 有 `get` / `post` / `patch` 与只读 `mastery` |
| `./readonly` | 指向 `src/qitu-sdk.ts` | 只给只读 facade 的窄入口 |

- `QituReadSDK = { readonly mastery: MasteryReadPort }`；
  `createQituReadSDK` 返回 `Object.freeze(...)`，**没有** `evaluate` / `setLevel` / `advance` 等写入口。
- 浏览器可调用 `mastery.getCurrent` / `getTimeline` / `getSnapshot` / `getThreshold` /
  `getRegressionAlerts`。
- `ApiClient` 的写方法是 `post` / `patch`（学生自己的探索、意图确认等），
  但**不提供**掌握度或项目阶段写入。
- HTTP 传输固定 `credentials: 'include'`、`cache: 'no-store'`。

## 2. 只读保证

- 浏览器只有只读 mastery API；服务端 facade 才有 `evaluate`。
- 未成年人掌握度和项目状态只能由服务端写入。
- 截至 2026-10-04，仓库内没有应用代码导入 `QituReadSDK` / `createQituReadSDK`；
  它是保留的公开浏览器 SDK 面，由 `packages/api-client/src/qitu-sdk.test.ts` 覆盖类型约束。

## 3. 调用形状

```typescript
const api = createApiClient('/api/v1');
const current = await api.mastery.getCurrent({ studentId });   // 只读

const sdk = createQituReadSDK({ transport });
await sdk.mastery.getTimeline({ studentId, from, to });        // 只读
// sdk.mastery.evaluate(...)  // 编译期不存在
```

## 4. 相关文档

- [`overview.md`](./overview.md)
- [`domain-facade.md`](./domain-facade.md)
- [`../student/growth.md`](../student/growth.md)
