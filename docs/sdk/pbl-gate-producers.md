# PBL 门禁真源调研：`code_playable_run_verified` 的真实产出方式

- 任务：T18（侦察 + 规格，禁止伪造）
- 侦察基线：`.worktrees/pbl-gate-wiring`，分支 `feature/pbl-gate-producers`，HEAD `a873600`
- 状态：仅规格文档，不改任何源码；实现另行派单
- 铁律回顾：门禁证据只能由服务端写入（AGENTS.md：项目状态流转/审计不得客户端直写）；
  「学生点一下就算验证通过」= 伪造通过，本文档所有方案均按此判据评审。

---

## 一、侦察结论（真实命令 + 真实输出）

### 1.1 `code_playable_run_verified` 在全仓没有任何产出方

命令：

```
$ git grep -n "code_playable_run_verified" -- . ':!node_modules'
```

全部命中（15 处）与逐条判定：

| 出处 | 性质 | 是否产出方 |
|---|---|---|
| `packages/contracts/src/team-runtime.ts:828` | `PblGateCondition` 类型枚举成员 | 否（类型声明） |
| `packages/contracts/src/team-runtime.ts:930` | 注释（PATCH 默认门禁映射说明） | 否 |
| `packages/ai-client/src/pbl-team.ts:50` | 雷霆战机种子 `gateCondition` 数据 | 否（规格种子，写入的是"阶段定义"，不是"门禁已达成"） |
| `services/api/src/modules/platform-registry/admin-ai-config.validation.ts:45` | 门禁字面量白名单 | 否（校验器） |
| `services/api/src/modules/platform-registry/admin-ai-config.validation.ts:53` | 阶段→默认门禁映射表 | 否（配置派生） |
| `services/api/src/modules/platform-registry/admin-ai-config.validation.test.ts:36/131` | 测试数据 | 否 |
| `services/api/src/modules/platform-registry/platform-registry.service.test.ts:252/343` | 测试断言/数据 | 否 |
| `services/api/src/modules/team-runtime/team-runtime.gate.test.ts:52` | 测试映射表 | 否 |
| `database/seeds/admin-ai-config.sql:151` | 种子 SQL 的团队 `pblSpec` JSON | 否（同 ai-client 种子） |
| `docs/sdk/team-runtime.md:277/306/335` | 文档 | 否 |
| `apps/student-center/features/tutor/data/teamFrames.ts:73` | 门禁名的学生可读中文映射（展示层） | 否 |

反向验证「谁写门禁达成事件」：

```
$ git grep -n "PBL_GATE_SATISFIED_TOPIC\|team.gate.satisfied" -- services packages ':!*test*''
```

命中仅 1 个文件：`services/api/src/modules/team-runtime/team-runtime.service.ts`
（L57 声明、L786 写入点、L990 重放读取点）。该写入点由**唯一公开函数**
`recordGateSatisfied`（L768）驱动，其调用方：

```
$ git grep -n "recordGateSatisfied" -- services ':!*test*'
team-runtime.controller.ts:154   ← POST /api/v1/admin/agent-runs/:runId/gates（仅 admin 角色，L140-160）
team-runtime.service.ts:52/768   ← 声明与实现本身
```

```
$ git grep -n "gate: '" -- services ':!*test*'
(无输出 → 没有任何服务端域逻辑自动为任何门禁写事件)
```

结论（独立复核结果，部分推翻 Lead 初查前提）：**Team PBL 门禁事件侧，四个门禁没有任何一个有自动产出方**。
`team.gate.satisfied` 的唯一写入路径是 admin 端点
（`POST /api/v1/admin/agent-runs/:runId/gates` → `recordGateSatisfied`，
`team-runtime.controller.ts:140-160`；仅 admin 角色、gate 过 `KNOWN_PBL_GATES` 白名单、
Idempotency-Key + 审计行）。其余三门只有**领域级证据源**，且均未桥接到团队门禁事件：

- `TheoryMastered`：`learning-plan` 掌握度引擎计算后发审计
  `learning_plan.theory_mastered` 与 outbox 事件 `learning.theory_mastered`
  （`learning-plan.service.ts:999-1035`）；全仓 grep 证实该 topic **没有任何消费方**：
  `git grep -n "learning.theory_mastered" -- . ':!node_modules' ':!*test*'` 仅命中写入点自身（L1024）；
- `student_confirmed_intent`：探索/项目域存在意图确认状态流转（领域落点），但未发现其写 team 门禁事件；
- `review_completed_and_archived`：依赖评审/归档动作（领域落点），同样未写 team 门禁事件；
- `services/workers/src/team-runtime-executor.ts` 无任何门禁写入（grep 仅命中路由委派 L164）。

所以 `code_playable_run_verified` 在 Team 侧不是孤例——但它的**领域证据源最弱（不存在）**：
workbench/works/templates 三个目录无任何真实执行能力（见 1.2），连「部分可信的自动信号」都拿不出。
这恰好强化方案 B 的必要性：零新端点即可诚实落地（admin 端点已可写白名单门禁值）；
其余三门禁后续接线时应复用同一事件形状（gate/phase/evidenceRef/source），不另造存储。

### 1.2 学生端/服务端均无真实代码执行能力

命令（限定三个目录，非测试文件）：

```
$ grep -rniE "pyodide|iframe|sandbox|runCode" apps/student-center/features/workbench \
    services/api/src/modules/works services/api/src/modules/templates \
    --include="*.ts" --include="*.tsx" | grep -v test
(无输出)

$ grep -rniE "execute|运行" <同上三目录> ... | grep -v test | head
→ 命中全部为：idempotency.execute(...) 管道噪声（works.service.ts:224/303/351/447/489、
  templates-governance.service.ts 多处）；
  apps/student-center/features/workbench/components/SimulatorPanel.tsx:20
  「运行记录**不进入项目证据**」；
  apps/student-center/features/workbench/types/workbench.ts:14
  「Kinds that can be executed by the preview endpoint (sim runs separately)」；
  services/api/src/modules/templates/template-verification.store.ts:9
  「模板验证运行/证据」（是**模板发布治理**的确定性评测，作用于模板作者，不作用于学生代码）。
```

补充关键事实——工作台客户端调用链终点是内存 mock，且其声明的两个"运行"端点在服务端不存在：

```
$ cat apps/student-center/features/workbench/data/index.ts   (L13-18)
export function createWorkbenchDataSource(...) { return createMockWorkbenchDataSource(...) }
export const workbenchDataSource: WorkbenchDataSource = createMockWorkbenchDataSource();

$ grep -n "preview\|simulator" apps/student-center/features/workbench/api/workbenchApi.ts
124: preview(...) → POST /api/v1/projects/:id/workbench/preview
131: runSimulator(...) → POST /api/v1/projects/:id/simulator-runs

$ git grep -ln "workbench/preview\|simulator-runs" -- services
(无输出 → 服务端没有这两个路由的实现；projects 模块无 workbench/* 控制器)
```

mock 的 `preview()`（`mockWorkbenchDataSource.ts:190-199`）返回拼造的
`previewUrl: https://preview.qitu.local/...` —— 纯模拟，不可作为任何验证证据。

### 1.3 学生实际能提交什么（真实链路）

```
$ grep -n "@Post\|@Controller" services/api/src/modules/works/works.controller.ts
78: @Controller('artifacts')      85: @Post()            （创建作品，学生角色）
105: @Get()                       119: @Get(':id')
137: @Patch(':id')                159: @Post(':id/publish')   173: @Post(':id/withdraw')
193: @Controller('files')         200: @Post('presign')      （文件直传签名）
```

链路：学生端「作品」提交 = `POST /api/v1/artifacts`（title/summary/version 等元数据，
`assertNoServerOwnedFields` 防客户端直写状态字段）+ 文件走 `/api/v1/files/presign` 直传，
发布/撤回为服务端状态机（works.service.ts 全程幂等）。**作品是可版本化的静态产物
（py 文件 / HTML / 打包物），服务端只登记与存取，从不执行它**；不存在任何
「运行成功」回执、退出码、日志或测试通过记录的概念。

---

## 二、规格：`code_playable_run_verified` 的可选产出方案

判据统一为：**证据链**（谁能证明"真的能跑"）与**可伪造性**（学生能否单方面制造假证据）。

### 方案 A：服务端真实沙箱执行（runner worker）

- 描述：作品提交（或工作台快照）触发一个隔离执行任务——容器/微 VM 内跑
  `python main.py`（或 headless 浏览器加载 HTML 过冒烟用例），捕获退出码/超时/stderr 摘要；
  成功后由**服务端域逻辑**调用 `recordGateSatisfied`
  （`source: 'runner'`，`evidenceRef: 'run:<executionId>'`）。
- 服务端真源：新增执行域（表：`code_runs(id, artifact_id, digest, exit_code, duration,
  log_ref, verdict)`；队列任务 + worker；事件 topic 建议 `code_run.succeeded`）。
  门禁写入复用既有 `recordGateSatisfied`，不新开端点。
- 客户端可见面：作品详情页「运行验证」卡（运行中/通过/失败 + 日志摘要），
  阶段推进时间线消费 `team.gate_blocked → phase_advanced` 帧（前端已具备，T7）。
- 证据链：服务端 runner 进程 → 执行记录行 → `team.gate.satisfied` 事件（可重放、可审计）。
- 学生可伪造？ **否**。学生无法控制 runner 的退出码；提交死循环只会超时失败。
- 工作量：**L**（镜像/隔离、资源配额、防恶意代码、日志脱敏、未成年人内容安全；
  依赖尚未存在的 worker 基础设施）。**超出本期范围**。

### 方案 B：班主任/管理员人工复核后经既有 admin 端点写入（诚实降级）✅本期推荐

- 描述：学生提交作品并申请「运行验证」→ 进入反馈/复核工单；班主任（经 admin 通道）
  审看学生上传的运行录屏、截图或本地运行日志（`/files/presign` 已是现成载体）后，
  调用**已存在**的端点写入门禁：
  `POST /api/v1/admin/agent-runs/:runId/gates`
  `{ gate: "code_playable_run_verified", evidenceRef: "review:<工单id>:<artifactId>@<version>", source: "mentor_review" }`
  （controller L140-160：admin-only、Idempotency-Key、`team.gate.satisfied` 落库 + audit 行，
  阶段判定从事件重放，多实例一致）。
- 服务端真源：**零新增端点**；可选增强为在反馈模块加一个「运行复核工单」类型，
  把 evidenceRef 与工单强关联（M）。
- 客户端可见面（关键诚实约束）：
  - 学生端阶段卡文案必须写「班主任已人工确认作品可运行（证据 <evidenceRef>）」，
    **禁止**出现「系统已验证可运行」「代码跑通了」等暗示自动化验证的措辞；
  - 复核中显示「运行验证待班主任确认」，未提交录屏等证据时显示 empty 引导。
- 证据链：录屏/截图/日志文件（对象存储）+ 复核工单（who/when/what）+
  `team.gate.satisfied` 事件 + 审计行。四方对齐。
- 学生可伪造？ **单方面有否**：学生无法触达 admin 端点（403）；但**审核人可能失职**——
  用「工单必填 evidence 文件、抽审、审计日志」压制，而非技术上消灭。
- 工作量：**S**（端点与事件已存在；主要是文案诚实化 + admin 侧一个写门禁的表单入口）。
  本期范围内。

### 方案 C：服务端静态/冒烟校验（弱验证，半自动）

- 描述：作品提交后由服务端跑纯静态检查：Python `py_compile`/AST 语法校验、
  入口文件存在性、依赖清单白名单、HTML 结构检查；通过则写
  `source: 'static_check'` 的门禁事件。
- 服务端真源：works 模块内新增校验函数（无新表也可，证据=校验运行行）。
- 客户端可见面：「语法/结构检查通过」卡。
- 证据链：校验器版本号 + 被检文件摘要（sha256）+ 结果行。
- 学生可伪造？ **技术上否，语义上有坑**：语法通过 ≠ 能运行 ≠ 可玩
  （`import pygame` 静态过、无显示器就崩）。若采用，门禁的**显示文案必须降级为
  「基础检查通过」**，不得宣称「已验证可运行」——这与门禁名
  `code_playable_run_verified` 语义冲突，需要门禁改名或引入中间态（另立契约评审）。
- 工作量：**M**。**可作 A/B 的补充信号，不推荐作真源单独使用**。

### 方案 D（记录备查）：外部评测平台（judge/CI 式）

- 描述：把作品打包提交给受控的外部评测环境（类似编程 OJ / 挑战平台的隐藏用例）
  判分回写。工作量 **L**、依赖外部面、本期不考虑；长期与 A 收敛为同一形态。

### 推荐与决策要点

1. **本期落地方案 B**（诚实降级）：零新端点、完整审计、符合「门禁证据仅服务端/管理员写入」
   的既有架构不变式；同时把方案 C 的语法检查留作 B 的辅助信号（不进门禁）。
2. **中期演进方案 A**：runner worker 上线后，门禁 `source` 从 `mentor_review` 升级为
   `runner`，B 自动退化为兜底路径；两方案共用同一写入函数与事件形状，无迁移成本。
3. **无论选哪个方案，立即应做的诚实化整改**（可单独派单）：
   - 学生端不得把「门禁未达成」文案写成鼓励「标记完成」的形式；
   - 任何 UI 不得为 `code_playable_run_verified` 提供学生可点的"验证"按钮
     （当前全仓无产出方 → 当前 UI 本来就没有，保持之，并在 QA 清单加回归项）。
4. 风险提示：既有 admin 门禁端点可写**任意白名单门禁**（含未来真源上线后的 B 路径并存），
   其防滥用完全依赖 admin 鉴权与审计；建议后续派单给它加「evidenceRef 必填 + 按 gate
   细分 source 白名单」校验（小改动，属 T14/内部 API 治理域，不在本文范围展开）。

---

## 附：本次侦察新增确认的事实

- `recordGateSatisfied` 对非 admin 抛 `GATE_WRITE_FORBIDDEN`、对未知 gate 抛
  `GATE_UNKNOWN`（`team-runtime.service.ts:777-780`），白名单为
  `KNOWN_PBL_GATES`（含全部四门禁值）。
- 阶段判定读取路径 `loadSatisfiedGates` 只信 `team.gate.satisfied` 事件重放
  （`team-runtime.service.ts:985-995`），客户端无任何直写路径——B 方案写入后
  `advancePhase` 即按既有累积门禁逻辑放行，无需任何新判定代码。
- 向 Lead 初查前提的修正：「其余三门禁有现成落点」仅在**领域证据源**意义上成立；
  在 **team 门禁事件写入**意义上，四门禁均无自动产出方（仅 admin 端点一条路）。
  若 T18 后续要接线 TheoryMastered，属「新增桥接」而非「复用已有接线」，工作量应据此重估。
- 本文档中所有命令均在 `.worktrees/pbl-gate-wiring`（HEAD a873600）真实执行；
  未执行的推断已在正文标注为「未发现/无消费方」等可证伪措辞。
