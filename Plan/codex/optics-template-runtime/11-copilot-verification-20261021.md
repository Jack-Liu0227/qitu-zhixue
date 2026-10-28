> 状态：历史记录恢复（2026-10-26）。正文保留 df05d5b 中的原始日期与验收边界，不代表当前部署状态；现行规则见 [工程入口](../../../README.md) 和各责任域文档。

# 管家配置实施验证

> 状态：2026-10-21 / 验证记录；仅隔离源码和测试 fixture，不包含生产模型、数据库写入或教学效果验收。

## 初版实施验证（目录合并前）

| 验证 | 结果 |
| --- | --- |
| contracts、database、infra、agent-memory、ai-client、model-runtime 隔离依赖构建 | 通过 |
| API 编译 | 修正本轮测试 fixture 的 CurrentUser 字段后通过 |
| 管家与注册表行为测试 | 66 项通过，其中本轮新增 16 项 |
| 既有管家目录与模型二元组测试 | 9 项通过 |
| 管家页面导入图类型检查 | 通过；已替换 ES2023 findLast，符合现有 ES2022 配置 |
| 初版管理 Skill 格式校验 | 初版独立目录的 `quick_validate.py` 校验通过；当前已迁入 `.agents/skills/qitu-project-configurator`，范围/发布元数据改由项目运行时测试验证，见下节 |
| `git diff --check` | 通过；既有 CSV 有 CRLF 提示，不是空白错误 |

完整的定向验证入口：`node tooling/verify-admin-copilot.mjs`。

输出位置：

- `services/api/.tmp/copilot-verification.json`：独立依赖构建、API 编译、行为测试、管家页面导入图类型检查。
- `services/api/.tmp/copilot-behavior.log`：66 项定向测试明细。
- `.tmp` 中的构建产物和日志不作为源代码提交。

## 全仓验证边界

本轮较早的 `node tooling/verify-pbl-capability.mjs` 完成 API 编译和应用 DI 启动检查，API 行为测试为 **995 通过 / 27 失败，共 1022 项**。

失败集中在 Tutor 的既有 fixture、学习计划和光学 bootstrap。运行目录：
`services/api/.tmp/pbl-capability/run-1792520955528-79048`。
当时工作树正在并行修改教学包/session-route 接线；该结果是那次构建的证据，不能宣称后续修改已全部通过，也不能将这些失败归为已复现的管家功能错误。

Admin 全量类型检查还报告两个已有依赖错误：

- `PdfDocumentPreview.tsx` 无法解析 `pdfjs-dist`。
- 同文件无法解析 `pdfjs-dist/legacy/build/pdf.mjs`。

本轮没有替换共享 `node_modules`、伪造 PDF 类型或修改锁文件来掩盖依赖缺失。管家自身导入图另行检查。

## 工作树保留情况

开始时已有两份问题审计目录的文档改动，以及 `snap.bat`、`test_courseware.bat`、`test_tutor_chat.bat`、`trigger_tutor_experiment.bat`、`view_theory.bat` 未跟踪文件；本轮没有运行或覆盖这些脚本。

实施过程中又出现了其他并行修改：光学实验协议与卡片、works 证据、教学包目录与绑定、模板 bootstrap、部分 Tutor 测试、parent 画像接口、contracts 的实验/画像/绑定字段、API package.json 与 pnpm-lock.yaml 等。它们保留在工作树中；全仓验证记录包含其当时状态。

本轮直接修改的业务范围为：

- 管家页面、项目选择 Hook 与 API 客户端；
- 新增 Admin Copilot 合同、API 模块与管理 Skill；
- Platform Registry 的可选稳定创建 ID、可选更新时间校验；
- 定向验证脚本和本目录实施/架构报告。

## 尚未作为成功验收的内容

- 生产数据库中创建完整光学资源包。
- 真实供应商模型生成计划及真实 IMA 工具调用。
- 通用团队版本发布、教学包激活后学生全流程学习。
- 多副本部署的 Skill 持久化、故障恢复与制品分发。

## 浏览器验证限制

已准备使用拦截 API 的虚构数据验证项目/版本、模型 pair、同键重试和页面错误状态，但本机 UNC 工作区无法完成 Next 页面编译。默认监听出现 `Watchpack UNKNOWN`；改用轮询后，webpack 仍出现重复服务器路径 `\\192.168.137.2\192.168.137.2\…` 和 manifest 缺失。**浏览器验收未通过，不记录为功能成功。** 本轮启动的临时服务已停止。

页面导入图类型检查和 API 行为测试通过，不能替代上述浏览器验收，也不能替代真实模型/数据库验证。

最终定向结果：`run-1792521910759-69148`，追加修正后的前端检查、API 编译和 66 项行为复核，`copilot-verification.json` 的最终 success 为 true；先前失败步骤保留在历史中。

## Skills 统一目录修正验证

针对管理技能不在 Skills 中心显示的问题，已把管理包迁入 `.agents/skills/qitu-project-configurator`，移除原来的空目录；通过 `runtime: admin` 实现服务端范围限制。加载方式见 [实施说明](./09-copilot-implementation-20261021.md)。

本次运行：`node tooling/verify-admin-copilot.mjs`，目录 `services/api/.tmp/pbl-capability/run-1792523090323-111748`，全部步骤退出码为 0，`copilot-verification.json` 的 `success: true`。

| 验证 | 结果 |
| --- | --- |
| 依赖按顺序隔离构建、API 编译 | 通过 |
| 管家、注册表、技能发现与加载行为 | 77 项通过，0 失败 |
| 管家页与 Skills 页导入图类型检查 | 通过 |
| 文档校验 | 95 份 current/index 文档、376 个本地链接，0 问题 |
| `git diff --check` | 通过；CRLF 提示不影响结果 |

关键行为覆盖：

- 管理目录快照返回管理技能的 `runtime: admin`、发布状态和正文。
- 管家正文与 digest 和统一目录一致；教学发现结果不包含管理技能。
- 即使把完整目录传入教学提示构建，或明确传入管理技能 ID，也不注入管理正文。
- 普通助手创建、更新及存量错误绑定都不能获得管理技能；允许移除错误绑定。
- 管理技能缺失、未发布、撤销、正文为空或范围错误时，返回 `COPILOT_SKILL_UNAVAILABLE`。
- 未知范围不能回退到教学；旧版未声明范围的教学技能仍可发现。

本次修改涉及公共技能目录解析、Admin 目录投影、管家加载、技能中心范围标识与绑定限制、相应合同和测试。保留此前教学包、学生实验、画像、锁文件等并行修改；其中 `runtime-source.ts` 原有的 publicationStatus / requiredToolIds 扩展也保留。

这里验证的是源码和隔离 fixture，未部署运行服务，也未新增浏览器或真实模型请求验收。上文全仓与浏览器限制仍按原次运行记录，不代表此次全部重跑。
