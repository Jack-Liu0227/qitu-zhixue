# 灵感空间

> 学生端第 2 项（`/student/inspiration`）。承载「推荐项目」和「自由探索」两个入口。
> 实现入口：`apps/student-center/features/inspiration/**`、`services/api/src/modules/templates`、
> `services/api/src/modules/ai-tutor`。

## 1. 页面构成

| 区块 | 内容 |
|---|---|
| 推荐方向 | 3 张推荐卡：**为什么可能适合你** / **预计 4 周或 8 周** / **最终作品** / 「查看推荐项目」 |
| 推荐详情 | `/student/inspiration/recommended/[templateId]`：模板元数据、模板版本、推荐理由 |
| 自由探索入口 | 「还没有想好？开始自由探索」→ 进入 `/student/tutor` |

## 2. 两个来源的区别（ADR 0010）

| 来源 | 流程 | Tutor 会话 |
|---|---|---|
| `recommended`（推荐项目） | 灵感空间推荐详情 → 学生确认 → Projects owner 幂等创建正式项目 | **不创建** Tutor session |
| `free`（自由探索） | 点击「自由探索」→ 先由 Projects owner 创建 exploration 草稿 → 创建 / 恢复 Tutor session（`source: 'exploration'`） | 创建，关联 `explorationId` |

导航名称与顺序不变；`灵感空间2.png` 仅作为历史 / 内容视觉参考，不再代表独立路由或第二套运行链路。

## 3. 关键约束

- **学生未确认意图不得创建正式项目**。推荐卡与详情只是入口，确认动作仍由 Projects owner 的
  幂等命令（`POST /api/v1/projects/:id/confirm-intent` 等）处理（见 [`projects.md`](./projects.md)）。
- 推荐项目使用固定模板版本，不进入 Tutor。
- 推荐理由由服务端生成，属于学生可读投影；不得包含其他学生信息。
- 兴趣标签不得直接覆盖学生长期兴趣档案（`ai_inferred` 不能覆盖 `intake`）。

## 4. 接口

```http
GET  /api/v1/inspiration/recommendations       推荐列表 + 推荐理由
GET  /api/v1/inspiration/templates/:id          推荐详情（含冻结模板版本）
POST /api/v1/explorations                       创建自由探索草稿（Projects owner）
POST /api/v1/tutor/sessions                     创建 / 恢复 Tutor session（自由探索）
```

## 5. 页面状态

| 状态 | 行为 |
|---|---|
| loading | 卡片骨架 |
| empty | 无推荐仍可开始自由探索 |
| error | 重试，不清空已加载卡片 |
| offline | 禁用自由探索创建，保留已加载推荐详情 |
| permission-denied | 403 页面 |

## 6. 未决事项

- [ ] 推荐算法、推荐理由生成用途与刷新策略。
- [ ] 品牌名「启途智学」vs 侧边栏「AI创造空间」的统一（`PRODUCT_NAME` 常量）。
- [ ] 推荐项目确认后是否停留在灵感空间（当前：由 Projects owner 处理，不跳转 Tutor）。

## 7. 相关文档

- [`today.md`](./today.md)
- [`tutor.md`](./tutor.md)
- [`projects.md`](./projects.md)
