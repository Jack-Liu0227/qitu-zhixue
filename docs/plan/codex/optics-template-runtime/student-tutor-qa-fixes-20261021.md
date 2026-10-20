# Student Tutor QA 修复与验证（2026-10-21）

对应 [05-student-tutor-flow-qa.md](./05-student-tutor-flow-qa.md) 的六项问题。以下结果来自源码构建、隔离 PostgreSQL 和可见 Chromium；不是生产验收，也不是学习效果评估。

## 修复结果

| 问题 | 本次结果 | 仍需区分的边界 |
| --- | --- | --- |
| 依赖快照与编译阻塞 | 在 study-remote 本地磁盘新建工作树，离线冻结安装依赖，按依赖顺序构建。修复 `modelByPurpose` 只读索引写入 TS2542，并补齐 API 直接导入但未声明的 `express` 依赖。 | TS2542 在原始提交的干净 Linux 工作树也可复现，不能全部归因于 UNC。 |
| Teaching Bundle 未接编译 | `TeachingBundleCatalog` 接入校验和激活：读取模板实际内容、团队成员 `slotId`、运行时策略/技能、助手、模型提供商与模型对、工具及 IMA 目录；编译并持久化 payload/digest/hash，激活前重新核验目录。 | 可读取的技能源码不等于已发布；缺发布元数据的 pin 继续拒绝。真实模型与 IMA 连接未在本次验证中调用。 |
| Tutor → Growth 引用 | 保留已有 opaque `help_request` 投影边界；Worker 类型检查和 24 项测试通过。 | 不把内部回合 ID 或模拟观察摘要直接变成成长事实。 |
| 观察缺 owner 回执 | 新增独立实验服务，验证对象权限、理论门禁、协议、冻结课时与计划 revision、参数域、预测和对应 run；经既有 ProjectEvidenceMaterializer 持久化，再返回带 provenance、CER/rubric 和 run 引用的回执。 | 只有模拟观察证据；不写 mastery、作品通过或成长事实。真实实验仍需教师安全审核。 |
| 家长 accepted 投影 | 新增 `GET /api/v1/parent/children/:childId/profile`；每次校验当前监护关系，筛选 accepted、已审核的 growth_trajectory，记录读取/拒绝审计。 | 仅返回版本、更新时间、可用状态、里程碑数量和固定交流提示；无原始对话、自由文本、KB 全文或证据 ID。未改导航或接入家长页面。 |
| 只有 fetch stub 测试 | 完成真实 API + PostgreSQL 持久化检查，以及浏览器保存、断网、权限、刷新、确认重试、SSE 重放。 | 模型使用 test 模式确定性 provider；目录和实践门禁有显式隔离夹具，不代表生产发布、真实 provider 成功或学生已通过 TheoryMastered。 |

附带修复：未确认的推荐探索继续使用 intake 身份，避免因为没有正式项目团队而阻断对话；正式项目仍要求冻结绑定。

## 数据、权限与并发

- 复用既有 `project_evidence`，新增 `experiment_observation` 来源类型；该列为 text，不新增平行数据库或状态机，不需要枚举迁移。
- 保存观察前必须提供本次 run 的稳定 ID、相同参数摘要及学生观察文本。重试复用幂等键，回读持久化回执；会话重载会带回已保存观察。
- 浏览器拒绝只有 `accepted: true` 的观察响应，也拒绝错误 session/run/provenance/ref。参数或模型变化清除旧运行结果；模型切换重新要求预测；请求期间锁定参数操作。
- 编译写入、校验和激活增加版本条件，防止并发草稿覆盖已校验内容。正式项目读取校验冻结 payload 与 digest 一致。
- 家长接口只允许当前监护关系；pending、rejected、superseded、未审核、错学生和非法内容不进入投影。读取只增加审计，不修改成长候选。

## 验证环境与结果

基础提交：`9550cc8`。

隔离工作树：`/root/qitu-worktrees/optics-flow-qa-20261021`。
PostgreSQL：回环地址、端口 `55439`、库名 `qitu_optics_qa`。
API / 学生页面：回环端口 `44100` / `43101`，通过 SSH 隧道访问。
没有向生产数据库写入测试身份、掌握度或实验数据。

| 检查 | 结果 |
| --- | --- |
| contracts → database → infra → agent-memory → ai-client → model-runtime → API 源码构建 | 全部通过 |
| templates、learning-plan、parent、works、实验门禁、项目上下文、运行身份、bootstrap 行为测试 | 320/320 通过 |
| 学生端组件 / API 边界 | 23/23、7/7 通过 |
| 学生端类型检查 | 通过 |
| Worker 类型检查 / 行为测试 | 通过，24/24 |
| PostgreSQL fixture | 9 类断言通过；可重复运行 |
| 可见 Chromium + 真实 API / DB | 10 类断言通过，无 pageerror |
| 全量 API | 1025 项：1008 通过，17 失败；不标记为全量通过 |

PostgreSQL 断言：编译—激活—冻结、确认重放、理论门禁拒绝、预测—运行—观察、持久化回执、重复提交、参数篡改拒绝、重载回执、跨学生拒绝。

浏览器断言：已有观察回显、保存响应丢失后同键重试、模型切换重新锁定预测、断网禁用提交、刷新恢复回执、跨学生 403、家长最小读取与 403、真实 SSE 回合、确认响应丢失后只创建一个项目、SSE 响应丢失后重放不重复追加回合。

浏览器通过真实后端完成保存后主动丢弃响应，再重试；没有用成功响应 stub 代替保存。教学文字由 test provider 生成。实践分支由一次性夹具预置 `practice_ready`，因此该测试不证明真实学习门禁已完成。

## 全量测试的基线失败

对照工作树 `/root/qitu-worktrees/optics-qa-baseline-20261021`：

1. 原始 `9550cc8` 在 API 编译阶段报 TS2542。
2. 仅应用只读 builder 类型修正后，原始行为测试为 1019 项，992 通过、27 失败。
3. 本次最终源码为 1025 项，1008 通过、17 失败。剩余失败均在对照运行中复现。

剩余 17 项来自：

- `tutor-quiz.service.test.ts`：2 项，旧夹具缺冻结绑定依赖。
- `tutor.ownership.test.ts`：1 项，同上。
- `tutor.persistence.test.ts`：7 项，同上。
- `tutor.service.test.ts`：4 项，同上。
- `reminder.stall-wiring.test.ts`：2 项，同上。
- `tutor.team-resolution.test.ts`：1 项，旧 LearningPlanStore 替身缺 `listPlansByStudent`。

本次没有放宽正式项目的绑定校验来迎合这些旧夹具，也没有删除失败测试。它们仍需补齐测试依赖后才可宣称全量绿色。

## 复跑

在本地磁盘独立工作树安装锁定依赖后：

```sh
pnpm install --offline --frozen-lockfile
node tooling/verify-pbl-capability.mjs
pnpm --filter '@qitu/student-center^...' -r build
pnpm --filter @qitu/student-center test
pnpm --filter @qitu/student-center typecheck
pnpm --filter '@qitu/workers^...' -r build
pnpm --filter @qitu/workers typecheck
pnpm --filter @qitu/workers test
```

全量 API 命令会如实因上述 17 项失败退出非零；构建产物和分步日志位于 `services/api/.tmp/pbl-capability/verification.json` 指向的目录。

`tooling/test-optics-postgres.cjs` 是可丢弃集成夹具，入口强制同时校验 `QITU_DISPOSABLE_FIXTURE=yes`、`QITU_DATA_MODE=test`、数据库回环地址、端口和测试库名。先在该测试库迁移并加载 demo seed，再使用同一次源码构建的 run ID：

```sh
QITU_DISPOSABLE_FIXTURE=yes QITU_DATA_MODE=test \
DATABASE_URL=postgresql://postgres@127.0.0.1:55439/qitu_optics_qa \
QITU_SOURCE_RUN_ID=<verification.json 中 runDirectory 的最后一段> \
node --import ./tooling/verify-workspace-source.mjs tooling/test-optics-postgres.cjs
```

该脚本不应进入生产迁移或发布启动脚本。结果默认写入 `/tmp/qitu-optics-fixture.json`，仅包含合成对象标识与检查名。

浏览器回归脚本为 `tooling/test-optics-browser.cjs`，需要提供 Playwright、可见 Chromium、SSH 隧道及 `FIXTURE_REPORT`（上一步报告的本地副本）。设置 `QITU_DISPOSABLE_FIXTURE=yes`、`QITU_TEST_STUDENT_PASSWORD`、`QITU_TEST_PARENT_PASSWORD`，使用隔离 seed 账号的口令；不从生产环境读取凭据。`TARGET_URL` / `API_ORIGIN` 默认指向回环端口 `43101` / `44100`，脚本拒绝非回环目标。可通过 Playwright skill 的 `run.js` 执行该文件。

本轮远端日志：`/tmp/qitu-optics-verification-final.log`、`/tmp/qitu-optics-focused-final.log`、`/tmp/qitu-optics-student-final.log`、`/tmp/qitu-optics-worker-tests.log`、`/tmp/qitu-optics-postgres-final.log`。

## 提交范围与发布边界

仅提交本次学生端、实验 owner、编译接线、家长读取合同、相关测试及本报告。工作区已有文档修改、Admin Copilot、admin-skills 和其他未跟踪脚本保留，不混入本次提交；隔离工作树验证没有包含这些并行改动。

本次结果支持上述修复的合并与测试环境使用。不能据此宣称完整生产验收：真实模型/IMA、技能发布状态、完整学生学习门禁链和家长可见策略仍需对应治理和生产验收。
