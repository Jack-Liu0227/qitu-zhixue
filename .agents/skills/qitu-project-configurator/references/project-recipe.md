# 项目配置组合顺序

1. 读取当前模板、课时 profile、助手和团队目录，使用服务端 ID。
2. 通过 assistant.create/update 配置真实 provider/model 对、canonical 教学技能和工具；技能先审核发布。
3. 通过 team.create/update 维护团队成员和负责人。课程门禁与课时由现有模板 owner 管理。
4. 模板变更创建新 template.version，保留实际目标、curriculum、rubric 和 TheoryMastered 门禁。
5. 使用 binding.prepare 提交所选模板版本、teamId、scheduleProfileId、全部 sessions 及 teams 的 expectedUpdatedAt。每课明确选择团队或该团队的真实助手。
6. 服务端保存并回读新教学安排，自动冻结对应配置。没有独立团队版本发布或历史版本选择。
7. 如需调整知识库授权，读取该绑定实际 bundleDraft 后用 binding.draft 保存；新增权限不得超出当前 Admin 授权。
8. binding.validate 校验，模板通过原审核 owner 后 binding.activate。每一步分别报告回执，不以保存代表已启用或真实运行。

binding.prepare 输入形状：

```json
{"templateId":"<模板 ID>","versionId":"<课程版本 ID>","arrangement":{
  "teamId":"<默认团队 ID>","scheduleProfileId":"<实际排期 ID>",
  "sessions":[{"sessionIndex":1,"teamId":"<该课团队 ID>","kind":"assistant","assistantId":"<团队成员 ID>"}],
  "teams":[{"teamId":"<所有被使用的团队 ID>","expectedUpdatedAt":"<团队回读时间>"}]
}}
```

示例仅表示条目形状，sessions 必须覆盖实际 profile 的每一课，teams 必须覆盖全部选中团队。修改原安排时携带 sourceBinding:{id,updatedAt}，让 owner 保留原授权范围。不能把占位符、阶段序号或名称当作 ID。

学生确认后由既有 confirmIntent/confirmPlan 冻结教学绑定。管家不创建学生项目、学习证据、掌握度或第二套状态机。
