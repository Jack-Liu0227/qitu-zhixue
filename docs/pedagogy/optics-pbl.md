# 光学 PBL 内容与模板引导运行手册（F5）

> 状态：`draft`（内容 + 试点引导已完成；发布 / 验证需人工走证据门）
>
> 基线：`agent/f5-optics-content`

## 1. 范围与内容清单

本期交付「物理光学」探究式 PBL 内容，作为可验证项目模板库（产品文档 7.4 /
ADR 0006）的模板内容，**不写任何 seed SQL**，内容只能经治理服务落库
（audited / idempotent / ordered）。

### 1.1 门禁承载理论概念（4 个，`concept_mastery`）

| 目标 id                 | 规范概念键                  | knowledgeType | 说明                                 |
| ----------------------- | --------------------------- | ------------- | ------------------------------------ |
| `opt-theory-reflection` | `optics.reflection.law`     | `memory`      | 反射定律：法线基准、角相等、光路可逆 |
| `opt-theory-refraction` | `optics.refraction.law`     | `memory`      | 折射定律与折射率 `n = c/v`           |
| `opt-theory-tir`        | `optics.tir.critical_angle` | `memory`      | 全反射条件与临界角 `sinC = n₂/n₁`    |
| `opt-theory-lens`       | `optics.lens.ray_rules`     | `procedure`   | 三条特殊光线作图定像                 |

### 1.2 质化波动模块（3 个，非门禁、不判分）

| 模块 | 概念键                     | knowledgeType |
| ---- | -------------------------- | ------------- |
| 干涉 | `optics.wave.interference` | `concept`     |
| 衍射 | `optics.wave.diffraction`  | `concept`     |
| 偏振 | `optics.wave.polarization` | `design`      |

### 1.3 目标树与排期

- 12 个目标、4 阶段：`exploration` → `concept_mastery` → `guided_practice` → `deliverable_review`。
- 排期：4 周 × 每周 2 节 × 60 分钟（`moduleCount: 4`）。
- 门禁：`concept_mastery` 的 4 个 `memory|procedure` 目标决定 `TheoryMastered`；
  在 `TheoryMastered` 之前不得进入 `guided_practice`。

### 1.4 题库扩展（8 条单选，服务端私有）

- 存量 3 条（`optics.reflection.q1` / `optics.refraction.q1` / `optics.lens.q1`）保持不变。
- 新增 8 条单选，每条含 `stem` / 3–4 `options` / 恰一个 `expectedKey` /
  `explanation` / `rationaleHint` / `misconceptionTag` / `errorTypeCode`。
- `expectedKeys` / `explanation` / `rationaleHint` / `misconceptionTag` /
  `errorTypeCode` 均为**服务端私有**字段：`toQuizBlockProjection` 不投影，
  任何读接口 / `tutor_turns.content` 都不得持久化答案与解析。

### 1.5 迷思 → 纠偏映射

`packages/ai-client/src/quiz-bank/optics/misconceptions.ts` 为每个
`misconceptionTag` 提供 `conceptId` + 苏格拉底式第一提示（问句收尾，不泄答案）。

## 2. 类型策略（硬约束）

- 门禁承载目标（`concept_mastery`）必须全部可被确定性判分打开，即
  `knowledgeType ∈ { memory, procedure }`。
- `concept` / `design` 目标（含 3 个波动模块）是质化目标，永不做门禁承载。
- `reflection` 目标 `knowledgeType = null`，永不判分、永不做门禁承载。
- 注意：`PblObjectiveKind` 没有 `memory`，记忆型目标在 PBL 分类里归
  `kind: 'concept'`，其「可量化判分」身份由独立的 `knowledgeType: 'memory'`
  表达；`assertOpticsObjectiveTypePolicy()` 在落库前校验该策略。

## 3. 模板引导（bootstrap）

### 3.1 编译并执行

```bash
pnpm --filter @qitu/ai-client build
pnpm --filter @qitu/api build
node services/api/dist/scripts/optics-template-bootstrap.js \
  --team-version-id <admin_team_versions.id> \
  [--admin-user-id <审计主体 id>] \
  [--pilot-reason "试点原因"]
```

脚本按序执行（全部经治理服务，可重复运行）：

1. `assertOpticsTemplateStructure()` 结构校验；
2. 校验 `team-version-id` 存在，否则 fail loudly；
3. 按 slug `optics-physical-inquiry` resolve-or-create 模板；
4. 按 `content.bootstrapKey = optics-physical-inquiry:v1` resolve-or-create 版本；
5. 版本若为 `draft` → `pilotVersion`；`piloting`/`published` 视为幂等 no-op；
   其余状态 fail loudly；
6. binding：resolve-or-create（先查 active，再 `listBindings` 去重）→
   `validateBinding` → `activateBinding`。

### 3.2 发布 / 验证是永久禁区

脚本**不调用** `publishVersion` / `verifyVersion`，且拒绝 `--publish` / `--verify`
参数（退出码 2）。发布必须由操作员带 5 项证据门手动执行（见 §4）。

### 3.3 幂等与恢复

- 版本解析键：`content.bootstrapKey`，跨进程重启稳定。
- 绑定解析：先查 `findActiveBinding`，再 `listBindings` 去重；中断后重跑会
  续跑 `draft → validated → active`，不产生第二个绑定。
- 治理服务的幂等键作用域去重 24h；bootstrap 的持久幂等依赖 store 级解析，
  不依赖幂等键残留。

## 4. 试点 → 发布操作步骤（人工，带证据门）

1. 试点观察至少覆盖一个完整 4 周周期，收集：
   - 掌握度判分正确率与错误类型分布（`errorTypeCode` 归因）；
   - `concept_mastery` 门禁打开率与 `guided_practice` 准入记录；
   - 3 个波动模块的质化观察（不参与门禁）；
2. 修复迷思高发项后重跑 bootstrap 校验（不改变已冻结的模板/版本内容时不重建）。
3. 用 `template-verification` 治理接口跑 5 项证据门（教学有效性 / 安全 /
   隐私 / 幂等 / 团队绑定），得到 `verifyVersion` 结果。
4. 证据齐全后由平台管理员 `publishVersion`；发布后不得再改内容，只能发新版本。

## 5. 验证命令

```bash
pnpm --filter @qitu/ai-client typecheck
pnpm --filter @qitu/ai-client test
pnpm --filter @qitu/api typecheck
pnpm --filter @qitu/api test
pnpm build
```

- 内容 / 题库 / 迷思不变量：`packages/ai-client/src/quiz-bank/optics-quiz-bank.test.ts`
- 引导幂等 / 发布拒绝：`services/api/src/scripts/optics-template-bootstrap.test.ts`

## 6. 数据与权限风险

- 模板 / 版本 / 绑定 / 试点 / 发布全部经治理服务写入，审计落
  `audit_logs`（`actor_id` 可为 null，合成管理员 id 安全）。
- 客户端只拿题库投影（`toQuizBlockProjection`），答案 / 解析 / 迷思归因不落
  会话正文；对象级权限仍在后端校验。
- 未成年人数据：仅教师 / 家长在授权范围内可见，最小化范围并保留审计。
