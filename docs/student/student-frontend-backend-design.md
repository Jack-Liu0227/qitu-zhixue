# 学生端前后端设计（基于 UI 图片 + 产品文档 v1.0）

> 输入基线：
> - UI 图片：`../qitu-zhixue/UI图片/学生区/` 共 7 张（dashboard、灵感空间、灵感空间2、AI搭档、我的项目、我的项目2、作品展厅）
> - 产品文档：`docs/student/STUDENT.md`。
> - 导师引擎与学习计划设计：`tutor-curriculum-design.md`、`student-agent-design.md`
>
> **图片与文档冲突时，本文标注为「确认门」，不自行裁决。**第 9 节列了裁决状态。

---

## 0. 结论先行

1. **图片给信息架构，文档给接口与规则；两者在 4 处冲突**，必须先裁决，否则前端会白做。
2. **后端当前是空骨架**（185 行 TS、无 ORM、无 schema、无数据库包、无文件存储）。
   第一件该做的事不是写页面，而是**定持久化层 + 建「项目实例 / 阶段 / 任务」主干**。
3. **图片揭示了 5 个文档没覆盖的能力**，是本次设计的主要增量：
   制作工作台（流程图 DSL + 模拟器 + 自动保存/版本）、项目证据三元组、版本历程、
   我的反思、作品互动计数。
4. **两个设计上必须守住的做法：**
   - 「项目证据」三列**必须服务端聚合**，学生与客户端都不可写（否则成长档案可伪造）；
   - 工作台草稿用 **revision + `If-Match` 乐观锁**（图片里「已自动保存 10:24」意味着高频 PATCH）。
5. **AI搭档右侧 6 个入口就是导师引擎的 pedagogic move 词表**——UI 与 `tutor-pedagogy` 天然对齐。

---

## 1. 已核实的代码现状（本次侦察）

| 位置 | 事实 |
|---|---|
| `services/api/src` | 共 **185 行** TS；只有 `health`、`identity-auth` 有实现 |
| `services/api/src/modules/` | `admin` / `ai-tutor` / `mentor` / `parent` / `projects` **只有 `.gitkeep`** |
| 持久化 | **无 ORM、无 `schema.prisma`、无数据库包**；`services/api` 依赖只有 `@nestjs/*` + `@qitu/contracts` |
| `packages/ui/src` | 只有 `AppShell`、`StatCard` 两个占位组件 |
| `packages/design-tokens/src` | 9 个颜色，与图片色板一致（`primary #2878F0`、`completed #18B7AC`、`attention #FF8A3D`） |
| `packages/contracts/src` | `index.ts` + `auth.ts` |
| `packages/api-client/src` | 空 barrel |
| `apps/student-center` | 只有 `app/layout.tsx` + `app/page.tsx`（`AuthGuard expectedRole="student"`） |
| `database/` | 已存在：`README.md` + `migrations/`、`seeds/`、`fixtures/`（均只有 `.gitkeep`） |
| `docs/decisions/` | 已有 ADR 0001（工程架构）、0002（领域边界与单一写入者） |

`services/api/src/common/{access,audit,idempotency,outbox}` 是**占位目录**，无实现。
结论：项目处于 **M0 骨架**，学生端前后端均为从零建设。

### 1.1 仓库里已定、容易漏读的约束（直接影响设计）

| 来源 | 约束 |
|---|---|
| `database/README.md` | PostgreSQL 是 system of record；迁移是**单向 SQL + 回滚说明**，由拥有该表的模块一起评审；**M1 先建 identity / household / guardian link / session / audit，再建项目表** |
| ADR 0001 第 5 条 | PostgreSQL / Redis / 对象存储 / 队列通过基础设施边界接入，**不绑云厂商** |
| ADR 0002 | 领域模块是各自数据的**单一写入者**；`projects` 独占项目状态转换；`ai-tutor` **不得**直接改项目状态或成长档案；家长只读脱敏投影 |
| `pnpm-workspace.yaml` | pnpm 10 默认**不跑依赖 postinstall**，`onlyBuiltDependencies` 只白名单了 3 个包 |
| 产品文档 3.3 | 「一个学生一个当前班主任」用**部分唯一索引**实现（已给出 SQL） |

→ 因此本设计的「`student-api` 单写者」不是新发明，而是 ADR 0002 在学生数据面上的落实。

---

## 2. 图片读出的信息架构（权威 UI 基线）

### 2.1 全局壳

- **左侧固定侧边栏**：logo「AI创造空间」+ 副标「用想象力 创造更大的可能」+ 5 项导航。
- **5 项导航（图片实际文字）**：今天 · 灵感空间 · **AI搭档** · 我的项目 · 作品展厅。
- **顶部横幅**：头像 + 「你好，继续创造吧」+ 「每一个想法，都可能改变世界」+ 山川背景 + 机器人吉祥物 + 手写体标语。
- **例外**：制作工作台页把横幅换成**面包屑**（`我的项目 / 桌面AI陪伴机器人 / 制作工作台`）。
  → 横幅是**布局槽位**，页面可替换，不是每页硬编码。

### 2.2 逐页区块与所需数据

| 页面 | 图片 | 关键区块 | 需要的数据 |
|---|---|---|---|
| 今天 | `dashboard.png` | 从一个想法开始（3 张方向卡）· 当前项目（阶段条 + 进度 40% + 4 步）· 今日任务（含「今日重点」标记）· AI搭档建议 | 活跃项目、当前阶段、今日任务、建议 |
| 灵感空间（推荐） | `灵感空间.png` | 3 张推荐方向卡：**为什么可能适合你** / **预计 4 周** / **最终作品** / 「查看推荐项目」· 独立详情；确认由 Projects owner 处理 | 推荐列表、模板元数据、推荐理由、模板版本 |


| 灵感空间（自由探索） | `灵感空间2.png` | 「还没有想好？开始自由探索」进入 AI搭档；统一文字对话与探索进度 | exploration 草稿、Tutor session、意图确认 |
| AI搭档 | `AI导师.png` | 左：项目/探索进度 · 中：单一文字对话 Composer | Tutor session、轮次、项目或探索上下文 |
| 我的项目（列表） | `我的项目2.png` | 「我的项目」+ 副标 · 标签 **进行中 / 草稿 / 已完成** · 搜索 · 项目卡（封面、标题、副标、第 N 阶段/共 M 阶段、进度条、进度%、标签）· 右侧「下一步」橙色卡 · 「**创建新项目**」→ 去灵感空间 | 项目列表、标签、下一步任务 |
| 制作工作台 | `我的项目.png` | 面包屑 · 项目头（封面 + 4 步阶段条）· 左栏「**项目阶段**」**5 步**纵向时间轴 + 「当前处于第 2 阶段」提示 · 中栏**制作工作台**：标签 `流程设计 / 代码 / 模拟器 / 测试`、画布（开始 → AI回复 → 用户意图分支 → 动作节点 → 结束）、缩放 100%、撤销/重做、右侧**模拟器**（重置对话 + 试聊） · 右栏 AI搭档（换话题 + 「我可以帮你」4 图标 + 「结合当前项目的建议」编号 1–4 + 输入框）· 底部状态条「**已自动保存 10:24**」+ 预览效果 / 保存成果 / **完成后进入作品展厅** | 阶段、画布文档、模拟器会话、建议 |
| 作品详情 | `作品展厅.png` | 视频封面 + 播放 · 已完成徽章 · 描述 + 标签 · **运行Demo / 分享作品** · 互动计数 **喜欢 326 / 评论 48 / 浏览 1.2k** · 右栏「**我的反思**」（可编辑，引用「来自我的创作日记」）· **版本历程** 4 步（想法 3/12 → 第一次原型 3/28 → 测试修改 4/10 → 最终版本 4/25，带缩略图）· **项目证据** 三列：**我独立完成的** / **AI帮助我的** / **我遇到的困难**（各带勾选清单与截图） | 作品、版本、证据、统计、反思 |

---

## 3. 与产品文档的 4 处冲突 → 已裁决 2 处

| # | 冲突 | 文档说法 | 图片说法 | 裁决 |
|---|---|---|---|---|
| 1 | **导航第三项命名** | 4.1 与第 56 行：「AI**导师**」 | 侧边栏与页面标题均为「AI**搭档**」；文件名却叫 `AI导师.png` | ✅ **已定：AI搭档。2026-09-26 全量回写完成**：产品文档 4.1 / 第 56 行已改，全仓产品名统一为「AI搭档」（45 处）。“AI 导师”不再作为任何名称使用；`AI导师.png` 仅为**已批准的图片文件名**，保留不改 |
| 2 | **项目阶段模型** | 4.5 / 9.1 / `packages/contracts/src/index.ts:5-15` 三处一致给出 **10 个英文状态**（`exploration`→`completed`） | 今天页/我的项目页是 **4 阶段**；工作台左栏是 **5 阶段**（同一张图内自相矛盾） | ✅ **已定：分层并存**，见下 |
| 3 | **品牌名** | `PRODUCT_NAME = '启途智学'`（design-tokens） | 侧边栏「AI创造空间」 | ⬜ 待定 |
| 4 | **图片文件名与内容对调** | 第 36–37 行：`我的项目.png`=项目列表、`我的项目2.png`=制作工作台 | **实际相反** | ⬜ 建议直接修正文档行号引用 |

### 3.1 阶段模型的分层（已采纳）

三层各司其职，互不冒充：

| 层 | 内容 | 权威性 |
|---|---|---|
| **服务端状态机** | **10** 个英文状态（`exploration` → `completed`），已落在 `packages/contracts/src/index.ts:5-15` 的 `ProjectStage` | **唯一权威**；客户端不可写，只能由 `projects` 领域转 |
| **展示阶段** | `TemplateStage[]`，4 或 5 个，随 `ProjectTemplateVersion` 冻结 | 模板自定义；**不进全局常量** |
| **展示位置** | `currentStageIndex` / `stageTotal` / `progressPercent` | 服务端计算，纯展示，**不参与权限判定** |

推论：「桌面AI机器人」模板之所以有「角色设计」这种阶段名，是因为阶段名是模板内容；
别的模板不会有。因此 4 阶段 / 5 阶段的分歧不再是架构问题。
**任何权限或阶段门判定都必须读服务端状态机的状态，不得读 `currentStageIndex`。**

---

## 4. 前端设计

### 4.1 路由树（沿用文档 4.1，按图片补工作台）

```
/student/today                                  今天
/student/inspiration                            灵感空间（推荐项目 + 自由探索入口）
/student/inspiration/recommended/:templateId    推荐项目详情（确认由 Projects owner 处理）
/student/tutor                                  AI搭档（自由探索或项目上下文）
/student/tutor/:projectId                       AI搭档（绑定项目）
/student/projects                               我的项目（进行中/草稿/已完成）
/student/projects/:projectId                    项目详情
/student/projects/:projectId/workbench          制作工作台   ← 图片新增
/student/projects/:projectId/theory             理论学习
/student/projects/:projectId/practice           实践
/student/projects/:projectId/reflection         反思
/student/works                                  作品展厅
/student/works/:artifactId                      作品详情（版本历程 + 项目证据）
```

### 4.2 目录结构

```
apps/student-center/
├── app/                          # 薄：只放路由、布局、metadata、AuthGuard
│   ├── layout.tsx                # StudentShell（侧边栏 + 横幅槽位 + AuthGuard）
│   └── (routes)/...
├── features/<module>/            # 每个模块自治：components / hooks / api / types
│   ├── today/
│   ├── inspiration/
│   ├── tutor/
│   ├── projects/
│   ├── workbench/                # 图片新增
│   └── works/
└── lib/                          # 跨模块：query client、鉴权态、错误映射、断网探测
```

**约定：** `app/**` 只做接线（由 `student-integrator` 独占），业务逻辑与组件一律在 `features/**`
（由 `student-feature` 独占）。这条边界正是 `/student-module` 工作流的并行前提。

### 4.3 需要新增到 `packages/ui` 的共享组件

当前 `packages/ui` 只有 `AppShell`、`StatCard`，以下**全部缺失**（括号内为该组件出处图片）：

```text
壳层：  StudentShell(全图) · NavSidebar(dashboard) · GreetingBanner(全图)
        BreadcrumbBar(我的项目) · RobotMascot(全图) · HandwrittenNote(全图手写体)

进度：  StageStepper4(我的项目2) · StageRail5(我的项目) · ProgressBar(全图)
        StageBadge(进行中/草稿/已完成)

对话：  ChatThread(统一AI搭档对话) · ChatBubble · Composer
        NumberedQuestionList(1/2/3 提问) · OptionChips(A/B/C 与 引导选项)
        TypingIndicator(…)

卡片：  DirectionCard(灵感空间) · ProjectCard(我的项目2) · TaskCard(今天/AI搭档)
        SuggestionCard(AI搭档建议) · InfoRow(正在形成的方向)
        EvidenceColumn(项目证据三列) · VersionStep(版本历程) · ReflectionQuote(我的反思)

工作台：FlowCanvas(节点+连线) · NodePalette · SimulatorPanel · WorkbenchTabs
        ZoomUndoBar · AutosaveStatus(已自动保存 10:24)

通用：  SectionCard · TagChips · StatTriple(喜欢/评论/浏览) · EmptyState · ErrorState
        OfflineBanner · SkeletonBlock · PermissionDenied
```

`FlowCanvas` 是唯一需要引入第三方库的组件（建议先用只读渲染 + 简单拖拽自研，
或评估 React Flow；**这是技术选型，见设计文档第 9 节待定项 4**）。

### 4.4 server / client 边界

| 区域 | 渲染 | 理由 |
|---|---|---|
| 列表页、详情页外壳、阶段条 | RSC（服务端取数） | 首屏快、SEO 无关但 TTFB 敏感 |
| 对话（AI搭档） | client | 自由探索/项目辅导流式文本对话 |

| 制作工作台画布 | client，仅 SSR 初始 revision | 重交互；画布不进 RSC |
| 作品详情 | RSC + client 岛（视频、点赞、反思编辑） | 混合 |

### 4.5 每页必须实现的 5 种状态（AGENTS.md 硬要求）

| 页面 | loading | empty | error | 断网 | 权限失败 |
|---|---|---|---|---|---|
| 今天 | 骨架屏 | 无项目 → 引导去灵感空间（**图片已给出该分支**） | 重试按钮 | 只读缓存 + 顶部横幅 | 403 页 |
| 灵感空间 | 卡片骨架 | 无推荐仍可开始自由探索 | 重试 | 禁用自由探索，保留推荐详情 | 403 页 |
| AI搭档 | 打字指示器 | 无项目且无探索 → 引导去灵感空间 | 保留会话 | 保留文字输入 + 重连 | 403 页 |
| 我的项目 | 卡片骨架 | 「创建新项目」空态 | 重试 | 只读列表 | 403 页 |
| 制作工作台 | 画布骨架 | 新项目 → 初始节点模板 | **不丢草稿**（本地暂存 + 冲突提示） | **强制只读 + 本地暂存 + 恢复后合并提示** | 403 页 |
| 作品展厅 | 骨架 | 无作品 → 去项目 | 重试 | 只读 | 403 页 |

工作台是**唯一不能「出错即丢」**的页面，必须本地暂存。

---

## 5. 后端设计

### 5.1 模块划分

| 模块 | 覆盖内容 | 现状 |
|---|---|---|
| `identity-auth` | 认证 | ✅ 已有 |
| `students` | 今日聚合、通知、活跃项目、画像/兴趣 | ❌ 缺 |
| `inspiration` | 推荐项目详情 + 自由探索入口 | 🟡 推荐详情已接线；确认由 Projects owner 处理；自由探索由 Tutor 承载 |


| `projects` | 项目实例 / 阶段 / 任务 / 提交 / 反思 | 🟡 空目录 |
| `workbench` | 流程图 DSL / 代码 / 模拟器 / 草稿版本 | ❌ 缺（图片新增） |
| `ai-tutor` | 会话 / 轮次 / 流式 | 🟡 空目录 |
| `learning-plan` | 4/8 周计划 / 掌握度 / 答题 / `TheoryMastered` | ❌ 缺（上一轮已设计） |
| `works` | 作品 / 版本 / 证据 / 发布 / 互动 | ❌ 缺 |
| `mentor` · `parent` · `admin` | 其他端 | 🟡 空目录（不在本次范围） |

### 5.2 持久化层（已出选型建议 → ADR 0003）

`database/` 目录、PostgreSQL、单向 SQL 迁移、按模块评审这些**已经定了**（见 1.1）。
缺的只是「用哪个 ORM」，已写成 **[ADR 0003](../decisions/0003-database-access-layer.md)（Proposed）**：

- **建议 Drizzle ORM + drizzle-kit + `pg`**，schema 代码放 `packages/database/src/schema/**`，
  迁移产物输出到 `database/migrations/`。
- 三条决定性理由：① `database/README.md` 要求的就是「单向 SQL + 回滚说明」，drizzle-kit 直接产出这个；
  ② **零 postinstall**，不用动 `onlyBuiltDependencies` 白名单（Prisma 要动）；
  ③ 类型从 TS schema 直接推导，`pnpm typecheck` **不需要额外的 codegen 前置步骤**——
  在多 agent 并行写入的环境下少一个失败模式。
- Prisma 是**合格备选**（`migrations.path` 能写到 `database/migrations/`），
  只有「要动白名单」与「pgvector 仍走 raw SQL」两个否决点。

仍缺的基础设施（与选型无关，必须做）：

1. **`common/{access,audit,idempotency,outbox}`**：目前是空占位。
   对象级权限（`资源归属 + 家长授权 + 班主任分配 + 可见性`，文档 3.4）、
   审计日志、幂等键、事务性 outbox 都依赖它。
2. **文件存储**：作品封面/视频/证据截图需要**对象存储 + 签名 URL**（文档 4.6 已要求 `POST /api/v1/files/presign`）。

### 5.3 数据模型主干

```ts
// ---- 学生与兴趣 ----
interface StudentProfile { id; userId; displayName; avatarUrl; gradeBand; createdAt }
interface InterestTag { id; studentId; tag; source: 'intake'|'exploration'|'ai_inferred'; evidenceRef: string|null; weight: number }
// 注意：ai_inferred 不得直接覆盖长期档案（文档 4.3）

// ---- 模板（版本化）----
interface ProjectTemplate { id; name; summary; coverUrl; themeColor; directionTag }
interface ProjectTemplateVersion { id; templateId; version; weeks: 4|8; finalDeliverable; whyFit; frozenAt }
interface TemplateStage { id; templateVersionId; index; name; description }  // 4 或 5 个，模板自定义

// ---- 探索与意图 ----
interface Exploration { id; studentId; source: 'recommended'|'free'; templateVersionId: string|null; status; createdAt }
interface ExplorationTurn { id; explorationId; role; content; audioRef: string|null; createdAt }
interface IntentDraft {                                  // 「正在形成的方向」右栏
  id; explorationId;
  goalUser: string|null; coreInterests: string[]; preferredForm: string|null;
  targetBeneficiary: string|null; confirmedAt: string|null; updatedAt
}

// ---- 项目实例 ----
interface ProjectInstance {
  id; studentId; templateVersionId;          // 冻结引用
  sourceExplorationId: string|null;
  status: ProjectStatus;                     // 10 个服务端状态（文档 4.5/9.1，已落在 ProjectStage）
  // 注：本文早前版本误写为 11 个，2026-09-26 经 spec 审查纠正。
  currentStageIndex: number; stageTotal: number; progressPercent: number;
  title; subtitle; coverUrl; tags: string[];
  createdAt; completedAt: string|null
}
interface ProjectStage { id; projectId; index; name; description; status: 'done'|'active'|'pending' }
interface Task { id; projectId; stageId; title; description; status; isTodayFocus: boolean; order }
interface TaskSubmission { id; taskId; idempotencyKey; content; artifactRefs: string[]; createdAt }

// ---- 制作工作台（图片新增）----
interface WorkbenchDraft {
  projectId; kind: 'flow'|'code'|'sim'|'test';
  revision: number;                          // 乐观锁
  content: unknown;                          // flow: 节点/边；code: 文本；sim: 配置
  updatedAt; updatedBy
}
interface WorkbenchSnapshot { id; projectId; kind; revision; content; createdBy; createdAt }
interface SimulatorRun { id; projectId; draftRevision; input; transcript; createdAt }

// ---- 作品（图片新增字段）----
interface Artifact {
  id; projectId; studentId; title; summary; description;
  coverUrl; videoUrl; demoRef: string|null; durationSeconds: number|null;
  tags: string[]; status: 'draft'|'reviewing'|'published'|'withdrawn';
  reflection: string|null; visibility: 'private'|'class'|'school'|'public';
  createdAt; publishedAt
}
interface ArtifactVersion { id; artifactId; index; title; note; thumbnailUrl; capturedAt }
interface ArtifactStat { artifactId; likes; comments; views }        // 浏览可近似，点赞需幂等
interface ArtifactLike { artifactId; studentId; createdAt }          // 唯一约束 (artifactId, studentId)

// ---- 项目证据（服务端聚合，只读）----
interface ProjectEvidence {
  independent: EvidenceItem[];   // 来自 Task 完成 + TaskSubmission
  aiHelped:    EvidenceItem[];   // 来自 TutorTurn（hint level ≥3 / scaffold / explain）
  difficulties: EvidenceItem[];  // 来自 EscalationEvent + 错误分类 + Reflection
}
interface EvidenceItem { label: string; status: 'done'; ref: string; occurredAt: string }

interface Reflection { id; projectId; stageId; text; visibility; createdAt; updatedAt }
interface AuditLog { id; actorId; actorRole; action; targetType; targetId; reason; createdAt }
```

### 5.4 服务端强制的不变量

1. **未确认意图不得创建项目实例**：唯一入口是
   `POST /api/v1/explorations/:id/confirm-intent`，且必须带幂等键；重复确认只产生一个实例（文档 4.3）。
2. **`TheoryMastered` 前不得进入实践**：由 `learning-plan` 计算并落事件，`projects` 只读该事件。
3. **「项目证据」三列服务端聚合、只读**。
   `aiHelped` 必须从 `TutorTurn` 记录推导，`independent` 必须从 `TaskSubmission` 推导。
   学生与客户端**都不能直接 POST 证据**。这是本设计最重要的一条——
   否则「AI帮助我的」可以手填，整个成长档案就失去证据价值。
4. **工作台并发**：`PATCH /projects/:id/workbench/:kind` 必须带 `If-Match: <revision>`，
   不匹配返回 **409 + 当前服务端 revision**，由前端提示「已自动保存 10:24 的他人/他端版本」。
5. **幂等**：`TaskSubmission`、`confirm-intent`、`ArtifactLike`、`Artifact` 发布/撤回全部带幂等键。
6. **模板冻结**：实例创建后 `templateVersionId` 不可变；阶段名来自模板，**不进全局常量**。
7. **未成年人最小可见**：`Artifact.visibility` 默认 `class`；评论默认关闭（图片里的「评论 48」需你决定是否保留）；
   作品发布走 `draft → reviewing → published` 状态机，撤回可逆但不删历史。
8. **客户端不可写**：`ProjectStatus`、`progressPercent`、`currentStageIndex`、`ArtifactStat.views`、
   `AuditLog` 一律服务端计算。

### 5.5 图片有、文档缺的接口（本次新增）

```http
# 工作台
GET    /api/v1/projects/:id/workbench/:kind
PATCH  /api/v1/projects/:id/workbench/:kind          # If-Match: revision
POST   /api/v1/projects/:id/workbench/:kind/snapshots
POST   /api/v1/projects/:id/workbench/preview
POST   /api/v1/projects/:id/simulator-runs

# 证据与版本历程
GET    /api/v1/projects/:id/evidence                 # 服务端聚合，只读
GET    /api/v1/artifacts/:id/versions
GET    /api/v1/projects/:id/next-step                # 我的项目右栏「下一步」

# 作品互动
POST   /api/v1/artifacts/:id/like                    # 幂等
DELETE /api/v1/artifacts/:id/like
GET    /api/v1/artifacts/:id/stats
```

文档已有、本设计沿用：`/students/me/today`、`/inspiration/recommendations`、
`/explorations/*`、`/projects/*`、`/tutor/*`、`/artifacts/*`、`/files/presign`。

### 5.6 权限矩阵（文档 3.4 的五段式检查）

| 资源 | 学生本人 | 当前班主任 | 家长（已授权） | 其他学生 |
|---|---|---|---|---|
| 项目实例 / 任务 / 提交 | 读写（受限字段） | 只读 | 摘要只读 | **403** |
| 工作台草稿 / 快照 | 读写 | 只读 | ✗ | **403** |
| 导师会话 / 轮次 | 读（原始） | 读（摘要 + 待办） | ✗ | **403** |
| 项目证据 三列 | 只读 | 只读 | 只读（脱敏） | **403** |
| 作品（已发布） | 读写 | 只读 | 只读 | 按 `visibility` |
| 反思 | 读写 | 只读 | ✗ | ✗ |
| 审计日志 | ✗ | ✗ | ✗ | ✗ |

---

## 6. AI搭档 6 个入口 ↔ 导师引擎映射（关键接口）

图片右栏的 6 个入口**就是** `tutor-pedagogy` 的 move 词表，UI 与引擎天生对齐：

| UI 入口 | `pedagogic_move` | 提示等级 | 约束 |
|---|---|---|---|
| 给我提示 | `hint` | 1 → 3 | 一次只升一级 |
| 帮我拆解 | `scaffold` | 4 | 2–6 步，每步一个 goal |
| 解释这个概念 | `explain` | 5 | **唯一**允许讲解的入口 |
| 检查我的方案 | `review_work` | — | 只评审、不代做 |
| 帮我调试 | `debug_guide` | 1 → 3 | 引导定位，不给修好的代码 |
| **我卡住了** | `stall_signal` | — | 直接计入 4 轮卡顿窗口 → 班主任待办 |

反向缺口：图片**没有**暴露「直接给我答案」入口——这与「默认禁止输出完整答案」一致，
应保持。`Level 5` 只能经由「解释这个概念」进入。

### 6.1 AI 回复的渲染契约（从图片反推）

图片里 AI 的输出**不是纯 Markdown**，而是结构化块：编号问题列表（1/2/3）、
A/B/C 选项、以及续问。因此 `TutorTurn` 的 assistant 内容应为**判别联合**：

```ts
type TutorReplyBlock =
  | { kind: 'text';      text: string }
  | { kind: 'questions'; items: string[] }                        // 「1/2/3 个提问」
  | { kind: 'options';   items: { label: string; text: string }[]; allowOther: boolean }  // A/B/C
  | { kind: 'hint';      level: 1|2|3|4|5; text: string }         // 驱动 HintLevelIndicator
  | { kind: 'evidence';  ref: string };
```

这样前端可以原生渲染，并且 `hint` 块与 `HintLevelIndicator`（文档 4.4）一一对应。
同时因为块类型是封闭的，**泄露完整答案的路径被类型系统收窄**（与 `question-bank` 的答案边界同源思路）。

---

## 7. 构建顺序（按依赖，不按页面好看程度）

| 步 | 内容 | 前置 | 可验证结果 |
|---|---|---|---|
| **0** | 确认 ADR 0003 → `packages/database` + `database/migrations/` 首批迁移 + `common/*` 四件套 + `POST /files/presign` | 待定项 5 | migration 可在空库重放、审计/幂等有测试 |
| **1** | 壳层 + 今天 + 我的项目列表 + 项目详情（只读阶段条） | 步 0 | 能看到真实项目与阶段（`dashboard.png`/`我的项目2.png` 对齐） |
| **2** | 灵感空间推荐 + 澄清对话 + **意图确认** → 创建项目实例 | 步 1 | 打通「未确认不建项目」硬规则 |
| **3** | AI搭档 + 导师引擎（接 `curriculum` 切片） | 步 2 | 6 个入口可用、提示等级可见、4 轮卡顿出待办 |
| **4** | 制作工作台（流程图 + 模拟器 + autosave/version） | 步 1 | 草稿不丢、409 冲突可恢复 |
| **5** | 作品展厅 + 证据聚合 + 版本历程 + 发布/撤回 | 步 1–4 | `作品展厅.png` 全量对齐 |

每步用 `/student-module <module>`（前端）+ 对应 API 切片（后端）推进。
**步 1 之前不要写任何页面**——没有项目实例与阶段，页面只能画假数据。

---

## 8. 角色映射（谁做哪一块）

| 模块 | 前端 owner | 后端 owner |
|---|---|---|
| 壳层 + 今天 | `student-feature`(today) + `student-integrator`(app/**) | `student-api`(students) |
| 灵感空间 | `student-feature`(inspiration) | `student-api`(inspiration) |
| 我的项目 | `student-feature`(projects) | `student-api`(projects) |
| 制作工作台 | `student-feature`(workbench) | `student-api`(workbench) |
| 作品展厅 | `student-feature`(works) | `student-api`(works) |
| AI搭档 UI | `student-feature`(tutor) | `tutor-api`（已有） |
| 学习计划/掌握度 | — | `plan-api` + `mastery-engine` 等（已有） |
| 共享合同 | `contract-owner` | `contract-owner` |

`student-api` 是**新增的单写者**（`.pi/agents/student-api.md`），覆盖
`services/api/src/modules/{students,inspiration,projects,workbench,works}/**`。
它是学生数据面（不含 `ai-tutor` 与 `learning-plan`），串行执行；
若要并行，再按模块拆成多个 agent。新增后共 **17 个** project 级角色。

---

## 9. 确认门登记册

2026-09-26 由 6 份模块规格的产出过程汇总。

### 9.0 进度

| 规格 | 状态 |
|---|---|
| `today-spec.md` | ✅ 完成（14 验收 / 10 OQ / 4 确认门） |
| `projects-spec.md` | ✅ 完成（15 验收 / 7 OQ / 3 确认门） |
| `voice-spec.md` | ✅ 完成（11 验收 / 8 OQ / 2 P0 + 6 合规确认门） |
| `tutor-ui-spec.md` | ✅ 完成（329 行 / 16 验收 / 7 OQ / 3 确认门） |
| `workbench-spec.md` | ✅ 完成（277 行 / 18 验收 / 6 确认门） |
| `growth-spec.md` | ✅ 完成（388 行 / 14 验收 / 6 OQ / 5 确认门） |

共同结论：**全部接口目前都是 `gap`**。`services/api` 里 `students / inspiration / projects / workbench / works / ai-tutor` 均为 `.gitkeep` 占位；`packages/realtime/src/index.ts` 也是占位。

### 9.1 已裁决

| # | 事项 | 结论 |
|---|---|---|
| A1 | 导航第三项 | 「**AI搭档**」。2026-09-26 起为全仓唯一产品名，产品文档 4.1 与第 56 行已回写 |
| A2 | 阶段模型分层 | 服务端状态机（**10** 个）/ 模板自定义展示阶段 / 服务端计算的展示位置，见 3.1 |
| A3 | 服务端状态数量 | **10 个**。本文早前版本误写 11，经 `smod-plan-2` 审查纠正；三处权威源一致 |
| A4 | 成长轨迹的架构形态 | **不是两端同一份数据**，而是单一服务端成长档案模型 + 三角色投影 |
| A5 | 成长轨迹不加导航项（暂） | 先做 `/student/growth` 子路由，从「今天」与「我的项目」进入；是否加第 6 项见 9.2 |

### 9.2 待你拍板（阻塞实现）

| # | 事项 | 阻塞什么 | 备注 |
|---|---|---|---|
| B1 | **后端选型**：旁挂 Python / 移植 TS 保持 NestJS（建议）/ 整体换 FastAPI | **全部后端**，因此「完成」无从谈起 | 与 ADR 0001 第 4 条冲突，需你裁决 |
| B2 | **成长轨迹是否新增学生端导航第 6 项** | 冻结 IA 变更 | 加则必须先改产品文档并评审 |
| B3 | **学生端可见的风险信号范围**：卡顿 / 情绪挫败 / 已升级班主任 | 成长轨迹页的学生投影 | 教学策略取舍，建议不可见 |
| B4 | **语音的未成年人数据策略**：是否存原始音频、是否只存转写、谁可读、ASR/TTS 供应商、是否允许客户端兜底 ASR、服务端 VAD 是否强制 | 语音实现 | 隐私/合规决策，非工程决策。`voice-spec.md` 列了 6 条相关确认门 |
| B5 | **数据库访问层**：确认 [ADR 0003](../decisions/0003-database-access-layer.md) | M1 硬前置；**从属于 B1**，B1 选 Python 则本文作废 | Drizzle（建议）还是 Prisma |
| B6 | 「进行中 / 草稿 / 已完成」标签 ↔ `ProjectStatus` 的映射 | 我的项目列表 | `smod-plan-2` Q2 |
| B7 | 项目创建路径：`POST /api/v1/projects` 是否保留 | 我的项目 / 灵感空间 | `smod-plan-2` Q3；与硬规则「未确认意图不得建项目」冲突，建议只留 confirm-intent |
| B8 | 卡顿自动检测阈值是否适用于语音通道（语音发言也能否进 4 轮窗口） | 语音 + 班主任升级 | `voice-spec.md` |
| B9 | **班主任升级的验收口径**：什么算"卡顿已正确升级"、以什么可观测断言验收 | AI搭档 + 升级链路 | `tutor-ui-spec.md` G3 |
| B10 | 工作台**断网时是否允许编辑**（建议：只读 + 本地暂存，不再允许新编辑） | 制作工作台 | `workbench-spec.md` ②；影响「出错即丢草稿」的实现形态 |
| B11 | `POST /projects/:id/workbench/preview` 是**同步返回**还是**异步轮询** | 制作工作台 | `workbench-spec.md` ③ |
| B12 | **成长档案三角色投影矩阵批准**（学生/家长/班主任 × 9 个敏感字段组） | 成长轨迹全部 | `growth-spec.md` G4；学生行是最高风险部分 |
| B13 | 孩子的「自述/反思」对家长是否全量可见 | 成长轨迹 | `growth-spec.md` G2 |
| B14 | 成长轨迹页的**视觉设计批准**（无 UI 图，现为提案） | 成长轨迹前端 | `growth-spec.md` G5 |
| B15 | 项目创建的**唯一路径**：是否删除 `POST /api/v1/projects`，只留 confirm-intent | 我的项目 / 灵感空间 | 与硬规则「未确认意图不得创建正式项目」直接相关 |
| B16 | 顶部问候横幅的**学生姓名与文案来源**：需要 `GET /api/v1/students/me`，当前接口不存在。姓名是服务端所有，前端不得编造，故 `StudentShell.header` 暂为 `null` | 全部页面（壳层槽位） | 被 **B1 阻塞**；`TodayGreetingBanner` 已写好但未挂载 |
| B17 | 离线草稿写入 `localStorage` 是否允许：workbench 存流程/代码草稿、projects 存反思草稿。**均只含孩子自己写的内容**，不含任何对话或语音转写；但落在未成年人数据最小化规则下 | workbench / projects | 从属 B10；若禁止则断网时只能纯只读 |
| B18 | 「灵感空间」「作品展厅」目前**既无规格也无模块**，`app/inspiration`、`app/works` 是诚实占位页（声明规格待开发，不编造内容） | 学生端导航 2/5 项 | 需决定是否补规格 |

### 9.2.1 实现期发现并已修复的真缺陷（2026-09-26）

两份均为**会打死整条链路**的缺陷，由不同的子代理独立撞到，父会话复核后修复：

1. **`packages/ui` 未声明 `@qitu/design-tokens` 依赖。** pnpm 严格隔离 `node_modules`，
   导致 `shell.tsx` / `primitives.tsx` 的 import 全部无法解析，**6 个模块会整体编译失败**。
   已补 `workspace:*` 声明并 `pnpm install`。
2. **路由目录重复了 `basePath` 前缀。** `next.config.ts` 设了 `basePath: '/student'`，
   按仓库既有约定（`parent-companion` = `/parent`、`admin-console` = `/admin`、
   `teacher-workspace` = `/teacher`，**app 目录都不重复前缀**），学生端路由必须是
   `app/today/page.tsx` 而非 `app/student/today/page.tsx`。原写法会把 15 条路由全部暴露到
   `/student/student/*`，导航里写的 `/student/today` 一律 404。已整体上移一层并同步修正
   import 深度。

> 附带记明：`@qitu/ui` 的 `NavSidebar` 用**裸 `<a href>`**而非 `next/link`，因此
> Next **不会**自动为导航 href 叠加 `basePath`——壳层传进去的 `href` 必须是完整外部路径。
> `usePathname()` 是否包含 `basePath` 存在版本差异，`app/student-shell.tsx` 已做归一化，
> 两种行为下高亮都正确。

### 9.3 产品文档与 UI 图片的冲突（同一类，需文档修订）

**系统性现象：文档 4.2 要求的模块在 `dashboard.png` 里没有；图片有的模块文档里没有。**
由 `smod-plan-1` 提出，均为确认门：

| # | 冲突 |
|---|---|
| C1 | 文档要求的 `RecentWorks` / `LearningSummary` / `QuickStartLive` / `NotificationEntry`（含强制语音入口）在 `dashboard.png` 中全部不存在 |
| C2 | 图片独有的「从一个想法开始」三张方向卡，文档无模块、无接口、数据源未定 |
| C3 | 图片独有的「AI搭档建议」无文档模块与接口 |
| C4 | 语音/Live 入口：文档 4.2 要求，图片无麦克风 |
| C5 | 工作台**头部 4 步阶段条** vs **左栏 5 步纵向轨**（同一张图内数目不一致）——已由 `workbench-spec.md` 按 3.1 处理：**同一份冻结的 `TemplateStage[]`，不硬编码数目**，两处渲染同一数据源的两种视图 |
| C6 | **语音入口在已批准图片中完全不存在**：`dashboard.png` 无麦克风、`AI导师.png` 无可语音频控件。文档 4.2（强制语音入口）、4.4（文本/语音切换）、9.5（语音 Live）三者要求它。**两个 planner（`smod-plan-1`、`smod-plan-5`）独立发现**。→ 语音是本项目**唯一无 UI 视觉依据**的模块，其交互契约现阶段全靠文档文字推导，需你确认是按现状开工还是先补设计图 |
| C7 | 学生端自由探索与项目辅导统一进入 `/student/tutor`，流式通道为 `POST /api/v1/tutor/sessions/:id/stream`；不再维护独立 exploration stream。 |

### 9.4 次要（可稍后）

- 品牌名：`PRODUCT_NAME`「启途智学」vs 侧边栏「AI创造空间」。**不阻塞**：实现统一引用常量，一行可换
- 作品「评论」是否开放给同学（未成年人社交面）
- `作品展厅` 的「进行中」标签是否保留（与「我的项目」语义重叠，建议展厅只展示已发布）
- 制作工作台工作量最大，画布技术选型（自研 vs React Flow）与对象存储

### 9.5 需回写产品文档但不改变导航

- ✅ 第 56 行「AI导师」→「AI搭档」（2026-09-26 完成）
- 第 36–37 行 `我的项目.png` / `我的项目2.png` 的内容描述**互换了**，需对调
- 文档 4.2 的模块清单需按 `dashboard.png` 重写（见 9.3）
