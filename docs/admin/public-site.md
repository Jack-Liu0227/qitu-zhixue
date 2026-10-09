# 公开官网与公开接口

> 实现：`apps/auth-portal/app/page.tsx`（首页）、`services/api/src/modules/public-content/`（公开接口）。
> 相关：[`deployment.md`](./deployment.md)、[`authentication.md`](./authentication.md)、[`database.md`](./database.md)。

## 1. 入口与路由

公开官网与统一登录都由 `apps/auth-portal`（Nginx 内网端口 `3100`）承载，二者在**同一应用内按路径区分**：

| 路径 | 页面 | 是否需登录 |
|---|---|---|
| `/` | 官网首页（营销摘要 + CTA） | 否 |
| `/learning` | 项目式学习（PBL 路径与阶段） | 否 |
| `/competencies` | 能力体系（六维能力说明） | 否 |
| `/showcase` | 项目展厅（公开模板） | 否 |
| `/about` | 关于我们（品牌与教育主张，纯静态） | 否 |
| `/contact` | 合作联系与预约咨询 | 否 |
| `/login` | 统一登录 | 否 |

首页使用正式页面路径导航，不再生成 `#pbl`、`#competency`、`#showcase`、`#about`、`#contact` 等旧锚点。首页只保留各主题摘要，完整内容分别位于 `/learning`、`/competencies`、`/showcase`、`/about` 与 `/contact`。

为兼容旧书签，首页挂载轻量客户端映射：访问 `/#pbl`、`/#competency`、`/#showcase`、`/#about`、`/#contact` 时分别替换到对应正式路径。由于 URL fragment 不会发送到服务器，这部分不能由 Nginx 直接完成 301。

首页、项目页面、关于页与联系页共享页脚内容源。公开联系地址统一为西安市碑林区创智天地科创中心 12 栋，邮箱与电话分别使用 `mailto:` 和 `tel:` 真实链接。
其他三端（`/student/`、`/parent/`、`/teacher/`）与管理端（`/admin/`）路径不变。

## 2. 首页数据来源

首页是**服务端渲染**页面，数据全部来自公开只读接口，不在前端硬编码业务数字：

| 展示位 | 来源 |
|---|---|
| 学习者 / 学校 / 公开模板 / 公开作品 计数 | `GET /api/v1/public/home` → `stats` |
| 热门项目展厅卡片（学科、适龄、难度、时长、阶段、参与人数、版本、更新时间） | `GET /api/v1/public/home` → `templates` |
| PBL 四阶段、6 维能力罗盘、学员与家长评价 | 静态文案（无对应后端真源，不属于统计口径） |
| 咨询表单提交 | `POST /api/v1/public/consultations` |

计数口径（**只算聚合数字，永不暴露个体**）：

| 字段 | 口径 |
|---|---|
| `learners` | `users` 中 `role='student'` 且 `disabled_at IS NULL` |
| `schools` | `schools` 中 `status='active'` |
| `publishedTemplates` | `project_templates` 中 `status='published'` **且 `school_id IS NULL`**（平台共享） |
| `publishedWorks` | `artifacts` 中 `status='published'` **且 `visibility IN ('school','public')`** |

`school_id IS NULL` 与 `visibility IN ('school','public')` 是刻意的最小可见范围：
校本模板与 `student_private` / `mentor_visible` / `class` 的作品**不计入**公开数字，
也不会出现在展厅里（AGENTS.md「涉及未成年人数据时默认最小化可见范围」）。

展厅模板同样只取平台共享且已发布的模板，卡片上的版本 / 阶段 / `publishedAt` 取该模板**最新已发布版本**
（与 `templates` 领域「当前版本 = 已发布版本中最新的一条」一致）；参与人数按模板对 `projects.student_user_id` 去重计数。

## 3. 公开接口合同

`GET /api/v1/public/home`（无鉴权，可缓存）

- 响应：`{ "data": { "stats": {...}, "templates": [...], "generatedAt": "..." } }`
- `Cache-Control: public, max-age=60, stale-while-revalidate=300`；首页自身 `revalidate = 60`。

`POST /api/v1/public/consultations`（无鉴权，**唯一刻意公开的写接口**）

- 头：`Idempotency-Key`（或 `X-Idempotency-Key`），必填，≤ 160 字符。
- 体：**白名单字段** `name` / `phone` / `identity` / `message`；多传字段按不合法字段拒绝。
  - `name` ≤ 40 字符；`message` ≤ 500 字符（可空）；`phone` 支持手机号与座机号，
    提交前去掉空格与 `-()（）·.` 分隔符；`identity` ∈ `student` / `parent` / `school`。
- 成功：`201` + `{ "data": { "id", "createdAt", "status" } }`——**不回显姓名与电话**。

错误码（统一 problem 信封，见 `services/api/src/common/http/problem-details.ts`）：

| 场景 | HTTP | `code` |
|---|---|---|
| 字段不合法 / 含未知字段 | `400` | `CONSULTATION_INVALID`（附 `errors: [{ path, message }]`） |
| 缺少或超长幂等键 | `400` | `IDEMPOTENCY_KEY_REQUIRED` |
| 同键不同载荷 | `409` | 幂等冲突 |
| 未连接数据库（`demo` / `test` 模式）或写入不可用 | `503` | `CONSULTATION_UNAVAILABLE` |

幂等：作用域 `public.consultation.submit`，走横切 `idempotency_keys`（`scope + key` 唯一，保留 24h），
指纹覆盖**完整载荷**——同一个键配不同号码必须报冲突，不能被当作重放静默丢弃。
`consultation_requests.idempotency_key` 的唯一索引是最终兜底：并发重复提交时回读首条记录，不产生第二行。
写入同时落审计 `action='public.consultation.submit'`。

## 4. 咨询线索数据

表 `consultation_requests`（迁移 `0018`），owner 为 `public-content` 模块。
只保存回访必需字段（姓名、电话、身份、留言、来源、幂等键、状态），
`status` 从 `received` 起步，由人工跟进更新；**不保存** IP、UA、访客标识等额外追踪信息。

- 未成年人信息：表单明确要求由监护人代为填写；页面上不回显已提交的姓名与电话。
- 保留与删除：当前无自动过期任务，删除请求由人工在受控环境执行；纳入数据保留策略时需同步更新本节。

## 5. 状态覆盖

| 状态 | 首页表现 |
|---|---|
| loading | `app/loading.tsx` 骨架屏（含 `role="status"` 与无障碍文本） |
| empty | 展厅无模板时展示空状态与「登录后探索」入口 |
| error | `app/error.tsx` 边界（只显示 `error.digest`，不泄露异常原文）；表单错误逐字段提示 |
| 断网 | 表单监听 `online` / `offline`，断网时暂停提交并保留已填内容；页面本身为 SSR 静态输出 |
| 权限失败 | 首页无需登录；受保护路径由各端 `AuthGuard` 处理 |
| 后端不可用（降级） | 统计位显示 `—` 并给出提示，不伪造数字；展厅回到空状态，60s 后自愈 |

`/about`（关于我们）是纯静态页面：不发请求、不读数据库，因此没有 empty 与降级分支；loading 与 error 走与首页共用的 `app/loading.tsx` / `app/error.tsx`。

它的样式分两层，且**全部限定在 `.about-page` 作用域内**：`app/about/about-base.css`（页头 / 页脚 / 展示动画，由 `app/about/layout.tsx` 挂载到该路由）与 `app/about/about.css`。
两层都**不得**使用 `body`、`a`、`footer`、`:root` 等全局选择器：这类规则会随客户端路由传播到 `/` 与 `/login`，改写它们的排版。

## 6. 未决事项

- [ ] 咨询提交的频次限制（当前仅靠幂等键与体积上限）。
- [ ] `consultation_requests` 的保留期与清理任务。
- [ ] 服务条款 / 隐私政策页面（当前页脚标注「整理中」，表单脚注覆盖最小告知）。
- [ ] 真实备案号替换（`陕ICP备2024018899号-1` / `公网安备 61011302005520号` 为占位）。
