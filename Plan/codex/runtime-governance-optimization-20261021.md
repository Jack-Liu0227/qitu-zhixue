> 状态：历史记录恢复（2026-10-26）。正文保留 df05d5b 中的原始日期与验收边界，不代表当前部署状态；现行规则见 [工程入口](../../README.md) 和各责任域文档。

# Skills、MCP 与工具加载优化（2026-10-21）

> 状态：运行时治理源码和对应隔离验证记录；线上生效以发布快照为准。（2026-10-21）

## 范围与事实层

本次针对 [上一轮审计](./skills-mcp-tools-sdk-audit-20261021.md) 修改源码。隔离测试不调用生产数据库、模型或 MCP，不代表线上已部署、已配置或连接成功。原有管家、Skills 页面、产品需求文档和用户脚本的未提交改动均保留。

## 已实施

| 范围 | 改动 |
| --- | --- |
| SDK | 删除无执行器时的成功回显；未知、未配置、拒绝分别返回稳定错误。每次执行先授权，固定 student/project scope；目录不暴露 execute closure |
| SDK 目录 | 去掉硬编码 Skills、助手和团队回退，使用异步 catalog 端口。API factory 接入实际技能、选定助手、工具描述，以及掌握度和画像只读 owner |
| 工具定义 | `RUNTIME_TOOL_CATALOG` 统一 6 个领域服务、2 个 SDK 只读接口、2 个知识工具的 canonical 定义；Admin、知识工具 schema、SDK 共用 |
| Skills 准入 | API/Worker 共用解析、范围、发布状态与总预算。Admin/dev-only/未知范围/草稿/撤销/重复元数据/损坏文件不能进入教学；超过 8000 字符的正文不执行截断规则，总正文预算 24000 字符 |
| 旧技能兼容 | 18 个既有教学来源按 canonical ID + LF 内容 SHA-256 清单兼容。文件不变，修改过的旧文件必须显式发布；没有全局缺省发布规则 |
| 生命周期 | 管家新增 `skill.revoke`，要求当前 digest、Admin 身份、文件锁、审计、原子替换与回读，支持重复调用。撤销后不能原地重发旧草稿；修订继续使用新 ID |
| 模型执行 | complete/stream 共用工具循环、JSON Schema 校验、8 次调用上限、超时与取消、相同 call ID 回执复用；拒绝调用也有事件，用量累计各轮结果 |
| Provider 事件 | Provider 层可在模型等待工具期间产出 call/result，失败前的事件保持顺序；Tutor 服务仍按持久化回合缓冲，尚不能据此宣称页面已实时显示 |
| 知识范围 | 正式项目读取核验后的冻结教学配置，与当前 Admin 授权求交集；缺快照不回退到 active binding。自由探索使用显式探索范围和当前对象权限 |
| IMA 四工具 | 列库过滤；搜索、列文档约束 KB；读文档要求本轮检索来源；调用后再检查授权。最多保存 64 条、15 分钟的引用元数据，跨回合重新检索 |
| 平台知识工具 | 每次调用检查助手工具开关和对象权限；正式项目的 IMA 链接库还须匹配冻结 scope；远端 citation 缓存增加 student/project/assistant 范围摘要 |
| Worker | 统一项目根目录查找，拒绝越界链接。当前候选结果 Worker 没有工具执行器，Skill 声明必需工具时明确报 `TEAM_AGENT_TOOL_NOT_CONFIGURED` |
| 工具管理页 | 区分调用入口，显示最近 MCP 探测时间和未登记的历史 ID；目录读取失败禁止写入，写入后回读再更新，失败不覆盖前面已确认的其他项 |

## 接入注意

### 当前内置能力清单

| 调用入口 | canonical ID |
| --- | --- |
| 领域服务，由对应服务端 owner 调用 | `tutor.context_packet`、`tutor.pedagogy_move`、`tutor.mastery_gate`、`tutor.escalation`、`agent-memory.index`、`project.next_step` |
| SDK 只读工具，需显式绑定并逐次授权 | `mastery_query`、`student_profile_get` |
| Tutor 模型工具，受知识库范围与对象权限约束 | `knowledge_search`、`knowledge_read` |

上述 10 项共用目录定义。IMA 的四个远程只读工具通过独立 MCP 客户端接入，不计入这 10 个内置定义；Pi 的 `read/write/edit/bash/grep/find/ls` 没有作为产品工具接入。

SDK 的 `tools/skills/assistants/teams.list/get` 现在是异步目录，应使用 `await`。仓库调用点已扫描；原领域 `mastery/project/profile/agent` 方法继续走原 owner。空团队目录表示组合方未提供经授权的冻结团队投影，不能按名称回退。

正式项目当前可核验的知识合同是 `knowledgeGrant.serverId = ima-knowledge`。正式项目只接受匹配该 grant 的 IMA 链接库，不能把上游 KB ID 当成本地库 ID。**本地索引库的项目冻结授权合同尚需补齐**。缺有效范围的旧项目会明确报告不能核验教材，需要通过受治理模板版本与项目确认流程解决，不能在读取时自动扩权。

Student 的原始 IMA 调用必须传入 `imaKnowledgeScope`；Admin 探测和知识引擎适配器由各自 owner 授权。新工具必须具备 canonical 定义、schema、授权 closure 和真实执行器；仅登记名称不授予能力。

## 当前仍未具备的能力

- Pi Coding Agent 文件、终端工具及通用 MCP transport 未接入学生运行时。
- Worker 仍生成候选结果，尚无完整知识/实验工具组合器。
- Tutor 的 SDK 与持久化层仍缓冲回合事件。页面实时工具状态需要继续接入既有团队事件 owner 的增量记录与 SSE，不能提前把未提交回合事件当作已保存历史。
- Skills 中心的正文编辑仍是草稿；持久化新版本、发布与撤销走管家 owner，完整版本编辑 UI 尚未接线。
- 其余历史助手工具 ID 尚未逐项映射成执行器，管理页保留并提示。
- 本次没有部署、生产数据回填或真实上游连通性验收；没有替换项目、掌握度、作品和成长事实 owner。

## 验证

运行 `node tooling/verify-runtime-governance.mjs`：按依赖顺序构建到独立目录，编译 API/Worker，运行 SDK、模型运行时、Worker、API 回归，以及三个 Admin 页面 import graph 类型检查。

最终完整验证通过：模型运行时 35 项、Worker 15 项、API 202 项，共 **252 项**；SDK 断言、API/Worker 编译和 Admin 管家/Skills/Tools 三个页面的类型检查通过。运行 ID 为 `run-1792527576747-112836`，结果写入 `services/api/.tmp/runtime-governance-verification.json`。该轮包含新增的引用权限与模块循环引用测试，并覆盖此前因旧 contracts 构建快照而失败的引用专项编译。范围与路径收紧曾另做 29 项针对性复核，记录在 `services/api/.tmp/runtime-governance-final-check.json`。测试只使用合成数据、临时技能目录、本地 HTTP fixture 和内存 owner；没有浏览器端到端或生产连通性验收。

文档验证通过：112 个当前/索引文档、760 个本地链接、0 个问题。本次代码范围的 `git diff --check` 通过，相关代码文件均未超过 2500 行。全工作区检查另发现并行修改的 `apps/admin-console/app/(console)/settings/settings-compact.css` 有末尾空行；该文件未由本次修改，保持原状。


### 引用入口与并行工作区修改

学生引用详情接口也接入相同范围解析：先校验项目归属，远端引用从缓存取得真实来源助手，再校验冻结项目范围、当前助手开关和 citation provenance；不按当前模板猜引用来源。Knowledge/Templates 模块使用显式 forwardRef 导入，并补充运行时模块引用检查。

验证期间发现独立修改：登录页与 packages/auth、学生首页/项目/AI搭档页面、packages/ui、contracts 的 display/project/parent/teacher，以及 API directory/growth/auth/parent/project/teacher 模块。这些修改均保留，重新构建共享依赖以消除旧快照缺少 projectStageLabel 的错误；不把这些功能算成本次实现，也未宣称完成这些页面的浏览器验收。用户的 .bat 调试脚本未执行。
