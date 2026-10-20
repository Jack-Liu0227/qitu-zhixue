# 光学项目组合配置示例

输入目标：“为已有光学模板配置教学技能、知识库、团队与课时，供学生确认项目后使用。”先核对所选模板版本、用户授权范围和真实课程正文，读取涉及的模块手册。不要因为标题叫光学就选择任意团队或模板。

建议按依赖组织 actions；各步只在用户明确要求且当前目录支持时执行：

1. 检查可用 provider/model 对、教学 Skill、注册工具与知识引擎。缺凭据/驱动/教材时明确缺口。
2. 新技能用 skill.create → skill.publish。已有技能直接用已发布 canonical ID。
3. assistant.create/update 配置概念教练、探究教练、评审等实际需要的角色，并分别绑定模型、Skills、工具/MCP。成员可以少于角色槽数量，以实际模板角色合同为准。
4. 需要新本地空库时 knowledge.create → knowledge.bind。现有库合并授权；平台总授权与 IMA 配置属于 global，不能在 selected_template 越权修改。
5. team.create/update + workflow.update 保留四阶段与 TheoryMastered 门禁，随后 team.version 冻结真实成员配置。
6. template.version 从选定版本克隆，保留课程 objectives、themes、sessions、排期 profile 与 rubric，只修改目标字段。新增 16 课时是新版本。
7. binding.create 引用模板版本 ID 与团队版本 ID，binding.draft 写 roleMap、skillPins、toolIds、知识 grant 和各用途模型，binding.validate 校验。
8. 用 template.test 检查课时合同，template.verify 检查既有真实发布证据；只有原 owner 的 template.publish 通过后再 binding.activate。未发布模板不能靠管家生成证据绕过原审核 owner。

关键引用：

```json
[
  {"id":"publish_team","kind":"team.version","label":"发布团队版本","input":{
    "id":{"$ref":"team.id"},"expectedUpdatedAt":{"$ref":"workflow.updatedAt"}
  }},
  {"id":"binding","kind":"binding.create","label":"创建教学绑定","input":{
    "templateId":"<选定模板 ID>","versionId":{"$ref":"version.id"},"teamVersionId":{"$ref":"publish_team.id"}
  }}
]
```

这是依赖片段，team/workflow/version 必须已在同一计划前序声明；不要直接当独立计划提交。所有“<...>”均需替换为实际目录或 owner 返回值，不能把占位符送入执行器。

新建团队回执中的 slotId、发布后的 Skill digest、课程角色槽或排期详情只有在 owner 返回后才完整可知时，分轮保存、回读、再生成教学包。不要凭空构造快照 hash。当前管家 context 提供已发布 teamVersions 的实际成员 pins；先复用已有合格版本通常更直接。

最终分别报告：助手/团队配置是否保存、Skill 是否发布、知识库是否有内容且索引就绪、MCP 是否有真实驱动、团队版本是否发布、模板是否审核、绑定是否 active。不要把这些状态合并为“学生端已全部可用”。

学生确认项目后由原 confirmIntent/confirmPlan 冻结模板/绑定/团队/hash。自由探索仍由启途智学助手处理。教学课时路由取冻结课程任务，实验交互和题目判分走原 action/evidence/answer owner；管家不创建第二套学习状态机。
