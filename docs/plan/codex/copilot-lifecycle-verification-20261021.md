# 配置管家生命周期测试与能力边界

## 结论与事实层

配置管家已从 27 项动作扩展到 44 项，Skill 与参考目录的合同版本为 1.2.0。新增创建后测试、受治理删除、模板证据验证/发布及归档入口，继续复用原领域 owner。**这表示配置生命周期的源码接通，不能据此宣称所有外部运行、资料处理和线上验收均已完成。**

本轮不写生产配置，不创建真实学生项目，不制造掌握度或作品审核证据。测试采用真实 Skill 文件加载器、临时技能目录、真实模板/知识库 owner 的隔离替身存储，以及合成模型和 MCP 探测回执。

## 逐模块能力

下表“支持”描述当前管家动作和后端约束，不代表生产环境已经启用或真实请求成功。

| 模块 | 创建与修改 | 测试 | 删除与退出 | 当前边界 |
| --- | --- | --- | --- | --- |
| 课时模板 | 元数据、新版本及 content.pbl.curriculum 排期；沿用 profiles/themes/sessions 合同 | template.test 校验真实课时与四阶段；template.verify 读取已有发布证据；template.publish 仍由原 owner 重评 | 未发布、未引用草稿可物理删除；历史模板 archive；绑定 retire | 不注入发布证据，不改写历史冻结项目；不把课时完成当 mastery |
| 助手 | 提示词、模型对、技能、工具与 MCP 绑定 | configuration 检查准入；model_connection 调用所选模型探测 owner | 无引用用户助手可删；内置/管家助手停用；引用中的来源拒绝物理删除 | 模型探测不是整个助手工具链的真实运行 |
| 团队/工作流 | 成员与稳定 slotId、四阶段工作流、不可变团队版本 | team.test 检查配置及成员运行时 | 无版本/模板引用才可删除；历史来源停用 | 尚无独立的管家 Team Run 执行动作，真实协作须在原冻结项目范围运行 |
| Skills | 隔离草稿、精确摘要发布、新 ID 修订、助手绑定 | skill.test 验证真实来源的发布与教学准入 | revoke 收紧执行；delete 软删除为 deprecated，保留正文/ID | 不执行任意脚本；加载通过不等于完整教学效果验收 |
| MCP | 自定义登记/修改、助手绑定、IMA 统一配置开关 | 登记配置检查；IMA 走真实 probe；自定义无驱动连接测试失败 | 无引用、停用、无驱动凭据的自定义登记可删除；IMA 停用 | 通用 MCP transport/驱动仍未接入；删除登记不删除上游服务 |
| 知识库 | 空平台库、引擎/名称等设置、平台与逐库授权 | configuration 单列 indexReady；engine_connection 调原引擎 check | 原 owner 软删除，取消任务、撤销来源/连接并保留历史记录 | 上传、连接已有远端库、重建索引等仍走后台专用 API，尚无管家 action |
| 模型 | 提供商非秘密配置、模型登记/修改、助手选模 | model.test 走原探测 owner | 模型工作区原 owner 有删除路径，尚未接入管家动作 | 不通过聊天接收密钥，不改模板中的私有路由 |

知识库本地条目与上游 IMA KB 是两个命名空间。删除本地镜像或连接条目，不会自动删除远端教材，也不能代替撤销独立的 IMA 全局 allowedKnowledgeBaseIds。需要撤销共享上游授权时，使用带 revision 的 knowledge.configure 明确修改该范围。

## 安全与状态修复

- 助手删除已取消自动移交负责人和清理其他团队的行为。owner 在事务中锁定来源，核对可选 revision，检查当前成员、工作流分配、冻结团队版本、画像/成长用途、知识库授权及子 Agent；引用中返回 ASSISTANT_IN_USE。无引用删除还清理该助手自己的 Agent 配置与出站绑定，避免目录中留下仍可用的孤立运行时。
- 团队删除同样锁定来源并核对 revision，阻止已有不可变团队版本或模板引用的删除。不会删除成员助手。
- 模板删除只接受 draft。PostgreSQL store 再次锁定模板及版本、检查实际状态，避免检查后被发布；引用外键继续阻止抹除历史项目、计划、绑定或验证记录。删除与审计在同一事务提交，审计故障回滚删除，内存测试 owner 也保留原来源。
- Skill 删除使用精确摘要、与发布共享的文件锁、原子替换、审计及回读，只写 deprecated，不递归删除目录。管理 Skill 不可删除。
- MCP 删除仅管理无引用自定义登记；助手、Agent、冻结成员快照或驱动凭据都会阻止删除。
- 删除动作仅 global 可用；模板/助手配置测试仍校验选定对象范围。readonly 不执行 actions。所有入口保留 Admin 身份、步骤幂等和回读确认。
- 测试区分 configuration、model_connection、engine_connection、connection 和 publication_evidence。失败探测产生失败回执并阻止依赖，不被记作“已保存”。同键重试复用探测回执，配置摘要变化则要求重新测试。
- IMA 开关迁移到统一知识配置 owner：ima.configure 现在要求 expectedRevision 和 enabled，避免继续调用已在统一知识模式中拒绝写入的旧 IMA settings.update。助手授权通过 assistant.update，平台授权通过 knowledge.configure。

关键实现：[copilot.lifecycle.ts](../../../services/api/src/modules/admin-copilot/copilot.lifecycle.ts)、[copilot.skill-archive.ts](../../../services/api/src/modules/admin-copilot/copilot.skill-archive.ts)、[Skill 入口](../../../.agents/skills/qitu-project-configurator/SKILL.md)。各模块手册已补充测试/删除参数、对应 owner API 与退出边界。

## 验证方法与结果

执行 `node tooling/verify-copilot-lifecycle.mjs`：先向独立目录构建 contracts/database/infra/agent-memory/ai-client/model-runtime，再编译 API，运行管家、注册表、Skills、模板回归及 Admin 管家/Skills import graph 类型检查。

工具显式使用本轮共享包声明；若复制的 node_modules 缺少 Feishu SDK 链接，隔离 API 编译映射实际安装且版本与 package.json 完全一致的 SDK 类型文件。不会写安装快照或伪造声明。最终记录为 `services/api/.tmp/copilot-lifecycle-verification.json`，本轮结果完成后补记。

新增场景包含：实际 16 课时版本创建/检查、缺真实证据时拒绝发布、归档保留正文、未使用草稿删除、技能草稿不准入/发布后准入/移除后拒绝、探测失败和来源变化、MCP 缺驱动、引用保护、知识库软删除撤权和取消任务、失败探测幂等及依赖阻断。

## 尚需完成的运行验收

完整管理入口还需补充知识资料上传/连接/索引动作、通用 MCP 驱动、原项目范围的团队真实运行与模型删除适配。真实上游请求、部署后的版本同步、浏览器操作和生产数据保留策略需要独立验收；本次隔离测试不替代这些结果。

工作区已有页面、教学、知识库、成长、素材及 Feishu 并行修改，均保留。本轮只修改配置管家、其引用手册和删除所需的对应 owner 保护，不将其他改动归为本次成果。
