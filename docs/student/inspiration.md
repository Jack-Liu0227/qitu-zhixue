# 灵感空间

## 2026-10-24 探索记录

用户已确认在“自由探索”入口下展示探索记录，支持恢复对话、搜索和分页。包含已有学生输入或意图内容的未确认探索，以及尚未确认的学习计划。空会话和仅有助手自动开场的会话不显示。确认后由服务端创建正式项目，记录转入“我的项目”。权限、断网、加载和错误状态沿用项目历史接口，未确认记录不展示项目进度或继续学习项目选择。

> 文档基线：`2026-10-19`，版本标识：`v2026.10.19`。
> 核心定位：**项目式学习（PBL）驱动的 AI 育人共成长**。
> 学生端第 2 项（`/student/inspiration`）。承载「推荐项目」和「自由探索」两个入口，自由探索直接跳转至学生端核心对话入口 **AI搭档（`/student/tutor`）**。
> 实现入口：`apps/student-center/features/inspiration/**`、`services/api/src/modules/templates`、
> `services/api/src/modules/ai-tutor`。

## 1. 页面构成

| 区块 | 内容 |
|---|---|
| 推荐方向 | 按服务端可见模板目录展示推荐卡：**为什么可能适合你** / **预计课时数与每课时分钟数** / **最终作品** / 「查看推荐项目」；数量不固定 |
| 推荐详情 | `/student/inspiration/recommended/[templateId]`：模板元数据、模板版本、推荐理由 |
| 自由探索入口 | 「还没有想好？开始自由探索」→ 进入 `/student/tutor` |

## 2. 两个来源的区别（ADR 0010）

| 来源 | 流程 | Tutor 会话 |
|---|---|---|
| `recommended`（推荐项目） | 灵感空间卡片或详情 → 学生点击「与AI搭档开始」→ 创建关联模板版本的探索草稿 → Projects owner 确认意图并创建正式项目 → 进入 AI搭档 | 正式项目由既有 Tutor 路径创建/恢复会话；确认失败保留探索草稿 |
| `free`（自由探索） | 点击「自由探索」→ 先由 Projects owner 创建 exploration 草稿 → 创建 / 恢复 Tutor session（`source: 'exploration'`） | 创建，关联 `explorationId` |

导航名称与顺序不变；`灵感空间2.png` 仅作为历史 / 内容视觉参考，不再代表独立路由或第二套运行链路。

## 3. 关键约束

- **学生未确认意图不得创建正式项目**。推荐卡与详情只是入口，确认动作仍由 Projects owner 的
  幂等命令（`POST /api/v1/projects/:id/confirm-intent` 等）处理（见 [`projects.md`](./projects.md)）。
- 推荐项目使用明确模板版本与服务端冻结教学绑定，确认后进入 AI搭档；预览卡片不创建正式项目。
- 推荐理由由服务端生成，属于学生可读投影；不得包含其他学生信息。
- 兴趣标签不得直接覆盖学生长期兴趣档案（`ai_inferred` 不能覆盖 `intake`）。

## 4. 接口

```http
GET  /api/v1/project-templates                 学生作用域内已发布/试点模板列表
GET  /api/v1/project-templates/:id              模板详情
GET  /api/v1/project-templates/:id/versions/:v  明确版本内容
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

## 6. 当前能力与限制

- 推荐项目确认后进入 AI搭档，失败保留可恢复的探索记录；不以浏览器本地记录代替服务端确认。

[相关计划与执行记录](../../Plan/maintenance/usage-records-20261028.md)。

## 2026-10-24 跨领域目录扩展

本轮实施新增生命科学、环境与可持续、数据探究、公共服务设计、历史文化、语文叙事、信息核验、经济启蒙八类课程。每类对应现有 Admin 模板库中的独立模板及领域 AI 团队，首版排期为八课时。原光学与雷霆战机继续使用各自冻结配置。

是否可选以模板/版本 published 或 piloting、有效教学绑定及服务端对象授权的实际回读为准。内容源码存在、配置草稿、试点可选、正式发布和真实课堂效果分别记录。新增资料、模拟材料和示例不是学生实际学习证据。详见[实施范围与验收记录](../../Plan/issues/20261024-inspiration-eight-projects.md)。

用户随后明确要求立即上架并简化展示。新增八项目已使用原治理流程进入 piloting，教学绑定全部 active，学生目录共十项。界面以“已上架”呈现可选状态，未提交内容使用“编辑中/未提交”等明确提示。卡片仅保留分类、简介、课时与入口，完整目标和成果说明放详情。课时来自冻结生效教学安排，不按标题、slug 或总时长推算。目录使用学生只读接口、不缓存结果；页面回到前台、恢复联网及可见状态每 30 秒刷新，旧响应不能覆盖最新目录。发布目录读取、浏览详情与意图确认分别处理，不因刷新创建正式项目。

## 7. 相关文档

- [`today.md`](./today.md)
- [`tutor.md`](./tutor.md)
- [`projects.md`](./projects.md)
