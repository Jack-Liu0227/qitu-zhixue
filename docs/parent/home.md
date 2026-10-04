# 家长端 · 首页

> Parent 面向**已授权监护人**，提供孩子学习过程的**最小化投影**。
> Parent **不直接读取** Tutor 数据库、Graphiti、Mem0 或原始对话。
> 实现入口：`apps/parent-companion/app/(protected)/**`、
> `services/api/src/modules/parent`、`services/api/src/modules/growth`、
> `services/api/src/modules/directory`。

## 1. 导航（3 项）

| 顺序 | 名称 | 路由 |
|---|---|---|
| 1 | 首页 | `/parent/` |
| 2 | 学习进展 | `/parent/progress` |
| 3 | 消息与反馈 | `/parent/messages` |

导航定义在 `apps/parent-companion/features/ParentShell.tsx`。

## 2. 首页构成

- 孩子的当前项目摘要（经授权的安全投影）。
- 成长里程碑 / 阶段摘要入口。
- 需要家长配合的提醒与明确行动。
- 进入学习进展 / 消息与反馈的导航。

## 3. 可见与不可见

**默认可见**：

- 经授权的孩子身份和当前项目摘要；
- 成长轨迹和阶段性里程碑；
- 作品、任务和掌握度的安全投影；
- 班主任或系统发送的消息与反馈；
- 需要家长配合的提醒。

**默认不可见**：

- 其他学生信息；
- 未脱敏原始 AI 对话和语音；
- Agent 完整系统提示词、策略记忆和模型凭证；
- 数据库连接、任意查询、Graphiti namespace 或 Mem0 索引内容。

## 4. 接口

```http
GET  /api/v1/parent/children/:childId/dashboard   首页聚合（授权后）
GET  /api/v1/parent/children/:childId/progress    学习进展
GET  /api/v1/parent/children/:childId/messages    消息
POST /api/v1/parent/children/:childId/encouragements   鼓励（幂等）
POST /api/v1/parent/children/:childId/messages/:messageId/ack   已读
```

## 5. 授权与数据

- 每次读取都必须校验 `guardian_link`（`status='active'`）、学生对象范围和数据用途。
- 家长端只能**消费服务端 projection**，不能写项目阶段、掌握度、成长事实或画像。
- 授权失败**不能**伪装成「没有数据」，也不能切换到共享或 demo 数据。
- 导出、敏感数据查看和撤销授权必须审计。

## 6. 页面状态

| 状态 | 行为 |
|---|---|
| loading | 骨架 |
| empty | 无孩子 / 无项目 → 明确引导，不虚构 |
| error | 重试 |
| offline | 不把缓存的旧摘要标为最新；投影过期必须显示时间和状态 |
| permission-denied | 403，不泄露孩子存在性 |

## 7. 未决事项

- [ ] 家长邀请 / 绑定流程（当前账号由演示种子或邀请流程创建）。
- [ ] 引导式首次使用。
- [ ] 多孩子切换体验。

## 8. 相关文档

- [`progress.md`](./progress.md)
- [`messages.md`](./messages.md)
- [`export.md`](./export.md)
- [`../admin/permissions.md`](../admin/permissions.md)
