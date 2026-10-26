> 状态：历史记录恢复（2026-10-26）。正文保留 df05d5b 中的原始日期与验收边界，不代表当前部署状态；现行规则见 [工程入口](../../../README.md) 和各责任域文档。

# 当前实施与文档验证记录

> Release update (2026-10-19 21:39:47 +08:00): `63e3be8` is deployed, main is synchronized, and migration 0036 is applied. Earlier offline-only statements below describe the pre-release round. Full teaching acceptance and 16-session bootstrap activation are still not complete. [Release evidence](../../admin/release-20261019-main.md).

> 状态：首批源码已实现，focused 通过，本地全量离线回归 1040 项通过；未进行本轮生产发布。2026-10-19。
> 历史原始记录见 [更新前验证快照](../../archive/codex-before-capability-20261019/snapshot/validation-20261019.md)，历史发布见 [发布基线](./takeover-validation-20261019.md)。

## 1. 当前范围和事实层

当前基线 `43a0307eb776185d7561f213d75b3d7312616aa9`，首批改动以工作树交付，提交 SHA 由发布步骤记录。用户已确认 README、architecture、七份删除文档以及 archive/source-lock/skills/MCP 文档均为预期改动。恢复当前文档时不回滚这些内容，不改归档字节。

UTF-8 检查使用 Node `readFileSync(..., 'utf8')` 与严格解码。PowerShell 终端显示乱码不构成文件损坏证据。来源锁是已有联网研究轮次的记录，本轮未重新联网、不把其 HTTP 成功写为本轮抓取。

证据分为源码、离线行为、真实数据库、配置回读、发布启用、真实请求和学习效果。编译通过不替代行为测试，协议 fixture 不替代真实供应商，匿名 readiness 不替代认证教学流程。

## 2. 文档检查命令

```powershell
node tooling/check-codex-plan.mjs
node tooling/check-codex-plan.mjs --self-test
python tooling/validate-docs.py
python tooling/validate-docs.test.py
git diff --check
```

`check-codex-plan.mjs` 只读当前 Markdown、JSON 和所有归档 manifest。它检查必需当前文件、本地链接、UTF-8、归档快照 SHA-256、来源锁和状态证据结构，不访问网络、不执行文档命令、不改 archive。历史快照内的相对链接按原位置理解，不重写历史正文。

2026-10-19 文档轮次实际执行结果如下。结果记录时间为 `2026-10-19T10:06:13.988Z`，源码基线加当前工作树，不是冻结发布 SHA。

| 检查 | 结果 | 边界 |
| --- | --- | --- |
| Codex 方案 checker | 12 份当前/归档索引，74 个本地链接，2 JSON，1 manifest，9 个归档 hash，0 问题 | 历史正文不重写，远程 URL/锚点不探测 |
| checker 自测 | 11 项通过 | 含越界/缺文件、换行改变 hash、无行为证据却 verified、无发布证据、Grok 零来源误用 |
| 全站文档 validator | 67 份当前/索引，298 个链接，0 问题 | 不检查历史正文和远程内容 |
| 原 validator 回归 | 11 项通过 | 独立于业务测试 |
| scoped `git diff --check` | 通过 | 当前方案与 checker，无空白错误；LF/CRLF 提示不是失败 |

脚本成功只说明文档结构和声明证据符合检查，不证明业务、来源内容或生产授权正确。[交付状态](./delivery-status.json) 保留未完成项，不允许把全部 M0/M1 提前标为已完成。后续补实测可能改变链接数量，应重新运行并追加对应轮次。

源码实况同步后的复跑为 12 份方案/归档索引、77 个方案本地链接、2 JSON、1 manifest、9 hash、0 问题；全站 validator 为 67 份、301 个链接、0 问题。checker 自测与原 validator 回归均仍为 11 项通过，scoped diff check 通过。数量变化来自新增实现/测试边界的本地链接，不是删除历史快照。

## 3. 首批业务验证

当前源码包括唯一 `ProjectTemplateSpec` strict parser、新 16 节独立 identity/profile 与显式 bootstrap、新 slug 实际正文草稿生成、反思 block kind 保存、纯能力编译器，以及 Tutor/SDK 真实助手身份与每轮配置 hash/model pair 检查。课时标题与活动指导已有保存/回读源码（0036 迁移未部署），profile/content digest/Skill artifact 未冻结，完整能力/知识链未接。没有发布候选技能。

可重跑命令：

```powershell
node tooling/verify-pbl-capability.mjs --focused
node tooling/verify-pbl-capability.mjs
```

runner 依次构建 contracts、database、infra、agent-memory、ai-client、model-runtime，再编译 API。test-only workspace loader 和 declaration paths 避免 UNC 安装快照混用，不修改 `node_modules`。最终版 runner 改为每次 run 的独立 fresh 包输出，API 测试 cwd 必须为 `services/api`；这样既避免残留旧产物，也满足读取源码的既有测试。具体实测报告在 `services/api/.tmp/pbl-capability/verification.json` 及 run 日志，属于本机可重跑产物，不提交秘密或声称日志永远保留。

| 轮次 | 实际结果 | 结论范围 |
| --- | --- | --- |
| 纯编译器独立检查 | 54 项通过 | 主线程早期单切片结果，最终统一 runner 仍需覆盖 |
| pre-final focused runner | 6 workspace 构建、API tsc、352 API tests、19 suites、0 fail；ai-client assertions 与文档 checker，共 11 步 exit 0 | 最近小改前的工作树，不冒称最终全量验收 |
| 首轮 full runner | 1026 tests，1025 pass，1 fail | 未通过。唯一 `growth.controller.readonly.test` 用 `process.cwd()/src` 查源码，但 runner cwd=root，实际应为 services/api；不为迎合测试修改业务逻辑 |
| 16 课时补齐后的 full runner | 6 workspace 构建、API tsc、1040 API tests、78 suites、1040 pass、0 fail；ai-client assertions 与文档 checker 通过，共 11 步 exit 0 | 2026-10-19 20:59:40 +08:00 完成，基于 `43a0307` 加当前全部工作树；包括既有并行改动，不代表均由本任务编写 |

本次 16 课时按表对齐了标题、顺序、阶段、目标、活动分钟与证据要求，补齐计划标题/指导回读和 0036 可空标题迁移。测试覆盖解析版本正文投影、12 目标覆盖、四理论目标门禁、散射/衍射非新增门禁、幂等草稿、对象权限、历史版本不变、Postgres adapter 映射和 bootstrap 正文漂移拒绝。前置 focused 轮次为 355 API tests、19 suites、0 fail。

最终 run ID：`run-1792414414619-75500`；报告 `services/api/.tmp/pbl-capability/verification.json` 的 `mode=full`、`success=true`，各步骤 exit 0。真实 PostgreSQL 集成因未设置 `DATABASE_URL` 未执行，adapter fixture 不代替真实迁移。没有生产初始化、绑定激活、真实模型/实验请求或部署。

附加检查：`node tooling/lint-baseline.mjs --workspace` 通过；`python tooling/validate-docs.py` 为 69 文档、307 本地链接、0 问题；两个文档 checker 自测各 11 项通过，`git diff --check` 通过。

上述 offline fixtures 覆盖实际模板/profile、确定性 digest、真实成员/role、模型 pair、Skill 精确 refs、tool schema/KB ceilings、身份一致、缺依赖拒绝和输入不变性。它们不证明生产 Admin 配置、新模板已发布、真实供应商请求或学习效果，不复制历史 947 项等数字。

跨 workspace 先按依赖图构建，再运行 API/应用测试并记录解析路径。UNC 安装快照、旧 dist 或错误 cwd 引起的失败应记录原因，不能当业务已经修复，也不能跳过后续行为检查。

## 4. 当前未覆盖

- 不可变制品数据库写入、validate/activate/confirm 接线与真实事务并发。
- 旧项目迁移、项目级 IMA 四工具/provenance、撤权完整链和 Worker 工具执行。
- 实验 action 实例、持久 observations、CER/作品引用及受控真实模型教学请求。
- 全 16 课时、真实学生/教师试点、生产配置、数据迁移、Git 推送和 `study-remote` 部署。

没有新安装/发布教学 Skills，没有读取/导出秘密或原始未成年人对话，没有注入 mastery/TheoryMastered、运行生产 seed 或教学造数。首批源码通过后也仍需完成后续里程碑。

## 5. 远端修改与发布授权

只读核查发现 `study-remote` 两处 preferences 未提交改动，不属于本轮。曾按协作规则暂停；用户已授权继续并保留/隔离发布，不回滚、不把它们顺手提交。本轮 release/push 尚无完成证据，`delivery-status.json` 的 deployed/pushed 保持 false。后续须填冻结代码 SHA、构建/测试、独立运行目录、服务切换和权限/健康检查，不能把授权写成已完成。
