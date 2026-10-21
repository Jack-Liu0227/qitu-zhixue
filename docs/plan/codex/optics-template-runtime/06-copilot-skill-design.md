# 管家项目选择与管理 Skill 设计

> 状态：待实施或部分实现的方案；当前完成情况以本目录 00-completion-audit.md 为准。

> 待实施。建议 ID `qitu-admin-project-configurator`，尚未创建、评测、进入 runtime catalog 或发布，不得直接写入 enabledSkills。

## 工作对象

沿用 `/admin/copilot`，增加真实对象选择：

- **项目模板及版本**：默认用于管理光学等课程的团队和能力配置。
- **学生项目实例**：只读诊断上下文，不把模板编辑误用成修改历史项目快照。

服务端返回对象 ID、版本、binding/teamVersion、revision 与允许动作。名称只显示，不作为授权。目录刷新使用 request identity/abort；删除、停用、断网和 403 禁用操作；发送前复核 revision。切换项目不能被旧请求覆盖。

## Skill 与工具边界

Skill 理解意图、提出结构化变更、调用受限工具和总结回读；服务端校验权限、引用、版本、幂等和审计。仅向 Admin runtime 发布，学生助手不可绑定管理能力。

建议实施时创建：

```text
.agents/skills/qitu-admin-project-configurator/
  SKILL.md
  references/resource-actions.md
  references/optics-configuration.md
  references/error-recovery.md
  evals/cases.json
```

| 资源 | 复用 owner | 所需操作 | 成功证据 |
| --- | --- | --- | --- |
| 助手 | platform-registry | 列表/创建/编辑/启停/绑定 | 持久化 ID、revision、字段回读 |
| 团队成员 | platform-registry/templates-binding | 创建、改成员角色、发布新版本 | teamVersion 与成员快照 |
| 工作流 | 已有 PBL workflow/模板 | 编辑阶段、课时角色、门禁/交付物 | 经过验证的新版本 |
| Skill | runtime catalog/bindings | 查已发布、绑定、内容草稿/发布 | canonical ID、制品版本/hash |
| 模板 | templates/governance | 创建、编辑、验证、试点/发布/退役 | templateVersion 与状态 |
| MCP | tools/knowledge governance | 注册支持的连接、发现/探测/授权 | server/tool ID、真实探测结果 |
| 知识库 | knowledge center | 建支持的库、连接外部库、导入/索引 | KB ID、job ID、真实任务状态 |
| 模型 | model-registry/gateway | 管理非秘密配置、模型及用途绑定 | provider/model 二元组与回读 |

外部 IMA 若不支持创建库，应明确仅能连接/授权已有库，不用本地 JSON 冒充远端创建。密钥沿用专用配置入口，不进入对话或 Skill。

## 一条综合指令的执行

```mermaid
flowchart LR
  A[选择模板版本] --> B[读取真实目录]
  B --> C[Skill 生成结构化差异]
  C --> D[服务端校验]
  D --> E[按依赖创建或修改]
  E --> F[编译校验教学包]
  F --> G[发布并回读]
  G --> H[逐项结果与失败恢复]
```

命令包含 operationId、scope、expectedRevision、idempotencyKey 和闭合 actions。独立读取可并行，团队依赖成员、绑定依赖模板/团队版本，必须依次执行。外部动作不能伪装成单个数据库事务，用 operationId 记录部分成功及恢复点。

重复指令复用已有 ID；失败展示实际创建的资源和未完成项，不自动删除既有配置。工具不得执行任意 SQL/shell/HTML/JS，不能由模型临时定义新权限。

## 光学配置验收

选择现有光学及排期 → 读真实成员/Skill/MCP/KB/模型 → 生成差异 → 校验 roleMap 和权限 → 编译实际模板正文/hash → validate/activate → 回读。

16 课时使用新版本身份，不原地改旧 v1。后续修改生成新版本，旧项目保持冻结上限，撤权即时生效。用一句包含团队、成员、技能、MCP、KB、课时和模型的指令验收；每项必须有服务端回执。助手测试也必须真实走 runtime。
