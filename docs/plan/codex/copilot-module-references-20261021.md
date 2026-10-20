# 配置管家的模块参考与读取工具

> 状态：模块参考已接线；生命周期验证见对应报告，线上资源需按权限配置。（2026-10-21）

> 本文保留 1.1.0、27 项动作阶段的实现与验证记录。后续 1.2.0、44 项动作的生命周期扩展及当前边界见 [生命周期测试报告](./copilot-lifecycle-verification-20261021.md)。

## 配置手册

入口为 [qitu-project-configurator/SKILL.md](../../../.agents/skills/qitu-project-configurator/SKILL.md)。参考 research-steward 的模块手册与只读资源读取方式，并按启途真实 API、动作目录、权限和领域 owner 编写内容。

| 文件 | 内容 |
| --- | --- |
| [protocol.md](../../../.agents/skills/qitu-project-configurator/references/protocol.md) | 请求形状、权限、幂等、引用、回读与错误 |
| [assistants.md](../../../.agents/skills/qitu-project-configurator/references/assistants.md) | 助手字段、模型、Skills、工具和 MCP 绑定 |
| [teams-workflows.md](../../../.agents/skills/qitu-project-configurator/references/teams-workflows.md) | 成员、四阶段工作流、不可变团队版本 |
| [templates-bindings.md](../../../.agents/skills/qitu-project-configurator/references/templates-bindings.md) | 模板正文、排期、角色/成员字段衔接及绑定生命周期 |
| [skills.md](../../../.agents/skills/qitu-project-configurator/references/skills.md) | 草稿、摘要发布、新 ID 修订与撤销 |
| [mcp.md](../../../.agents/skills/qitu-project-configurator/references/mcp.md) | MCP 登记、IMA 四工具和授权范围 |
| [knowledge.md](../../../.agents/skills/qitu-project-configurator/references/knowledge.md) | 引擎配置、空库创建、逐库授权和索引状态 |
| [models.md](../../../.agents/skills/qitu-project-configurator/references/models.md) | 提供商、模型登记与助手选模 |
| [growth-projection.md](../../../.agents/skills/qitu-project-configurator/references/growth-projection.md) | 画像与成长用途助手配置 |
| [project-recipe.md](../../../.agents/skills/qitu-project-configurator/references/project-recipe.md) | 光学项目组合顺序与依赖回执 |

各模块提供字段、action 示例、真实 owner HTTP 路径和回读方式，明确 action input 与直接 HTTP body 的差异。示例中的占位符须由当轮目录替换。覆盖当前 27 个动作，目录在 [catalog.json](../../../.agents/skills/qitu-project-configurator/references/catalog.json)，与服务端共享操作版本和摘要校验。

## 运行时接入

此前管家只加载 SKILL.md。本轮为 qitu-assistant 配置对话注入 `skill_read`，模型可批量读取当轮目录中的模块正文，再生成 actions：

```json
{"skill_id":"qitu-project-configurator","resources":["references/mcp.md","references/knowledge.md"]}
```

能力 API 的 references 返回资源路径、操作映射和摘要，正文通过只读工具按需读取。每种写动作的对应模块须先读，未读时在执行前返回 `COPILOT_REFERENCE_REQUIRED`。其他助手预览不注入这个工具；所有入口继续校验 Admin 身份。

资源仅允许固定 Skill 下 references 目录声明的 Markdown。拒绝父目录、绝对路径、目录/文件链接、未知路径、重复请求和超长内容；目录必须完整覆盖当前操作合同。单文件最多 8000 字符且不超过 32768 字节，总正文最多 40000 字符。工具既不执行 HTTP，也不执行文件脚本。

资源摘要包含清单元数据与每份正文 hash，进入计划幂等记录和审计元数据；重试及每步写入前重新检查。正文变更会使旧计划停止，避免沿用过时调用方法。Admin context 另提供 runtimePolicy 的版本/hash，以及已发布技能 packageDigest，供教学包引用真实来源。

主要实现为 [copilot.references.ts](../../../services/api/src/modules/admin-copilot/copilot.references.ts) 和 [copilot.service.ts](../../../services/api/src/modules/admin-copilot/copilot.service.ts)。没有扩展写动作白名单或新增学习状态存储。

## 能力边界

参考中明确区分现有管家动作与后台专用操作。MCP 登记继续是 disabled/not_configured；通用驱动安装、凭据设置、真实探测、教材上传与索引、模板审核发布、团队任务执行未因此获得新的动作。不能把列出 HTTP 路径当模型已拥有请求工具，也不能把保存配置当生产请求成功。

## 验证

本轮运行 `node tooling/verify-admin-copilot.mjs`，按依赖顺序构建 contracts/database/infra/agent-memory/ai-client/model-runtime。常规 API 编译遇到工作区并行新增 Feishu 模块的 `@larksuiteoapi/node-sdk` 解析失败。实物包 1.76.0 已安装在 .pnpm，但 services/api/node_modules 缺少链接；本轮没有修改依赖安装快照或包清单。

在同一隔离运行目录显式映射真实 SDK 的 types/index.d.ts 后，API 编译通过；管家、注册表及运行时技能 **109 项行为测试全部通过，0 跳过**。Admin 管家/Skills import graph 最初也解析到旧 contracts 安装快照，改为本轮实际构建的共享包声明后类型检查通过。失败日志仍保留，不把快照错误当作业务修复或常规全仓构建成功。

最终验证记录为 `services/api/.tmp/copilot-module-references-verification.json`，运行 ID 为 `run-1792530132229-82240`；其中记录实际依赖映射、通过步骤和此前失败记录。验证覆盖完整正文读取、27 个操作的参考覆盖、缺失/损坏/超长/漂移资源、跨目录/链接拒绝、未读手册禁止写入、只读/预览隔离、已有幂等/权限/回读/发布链路。正文变更会改变资源包身份，代码据此拒绝继续旧计划。

文档检查通过：114 个当前/索引文档、781 个本地链接，0 个问题。本次文件的空白字符与 2500 行限制检查通过。

Skill 自身链接检查覆盖全部 10 份参考。通用 Codex quick_validate 不接受项目既有的 version/runtime/status 顶层元数据，原文件保留产品合同；仅去掉这三项的临时 Codex 元数据投影通过通用验证。真实 Admin scope、发布状态、能力摘要与正文加载由项目运行时和行为测试验证。

工作区已有广泛的页面、教学、知识库、成长、素材和 Feishu 并行修改，本轮仅增补上述 Skill 资源、管家读取链路、能力返回字段与相关测试/文档；其余修改保留。测试使用临时文件和合成 owner，无生产配置写入或真实模型/MCP 验收。
