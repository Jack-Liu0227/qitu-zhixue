# Student 学生学习中心

## 责任范围

Student 面向学生，承载兴趣探索、AI 搭档、项目式学习、制作工作台、作品展厅和成长轨迹。客户端只提交学生意图和输入，服务端决定项目状态、掌握度、提示阶梯、成长记录和审计。

实现入口：`apps/student-center`、`services/api/src/modules/ai-tutor`、`services/api/src/modules/projects`、`services/api/src/modules/works`、`services/api/src/modules/growth`。

## 导航与页面

导航顺序固定为：

1. 今天
2. 灵感空间
3. AI 搭档
4. 我的项目
5. 作品展厅
6. 成长轨迹

自由探索不再拥有独立 Live 页面或第二套会话链路。灵感空间发起探索后进入 `/student/tutor`，以 `source: exploration` 创建 Tutor session；正式项目必须经过学生明确确认。

## 核心流程

```text
灵感空间 / 自由探索
  -> exploration 草稿
  -> AI 搭档统一会话
  -> 学生确认意图
  -> Projects owner 幂等创建正式项目
  -> theory_learning
  -> TheoryMastered
  -> practice_ready / practice_building
  -> 作品评审、反思、发布
```

规则：

- 学生未确认意图不得创建正式项目。
- `TheoryMastered` 前不得进入实践阶段。
- 项目阶段和掌握度由服务端领域服务判定，客户端不能传入最终值。
- Tutor 回合必须使用幂等键；序号、提示等级、卡顿计数和审计由服务端产生。
- 语音输入只转成现有文字 draft，不保存原始音频；最终仍走 Tutor 文本提交链路。

## AI 搭档

- 单一对话入口，项目学习和自由探索共用 Composer。
- 服务端组装 bounded context，模型只读取授权 projection。
- 默认使用苏格拉底式提示阶梯，答案泄露检查和教师升级由服务端执行。
- 不向学生展示其他学生信息、完整系统提示词、数据库查询或模型凭证。

## 页面状态

每个学生端模块必须覆盖：

- `loading`：首次加载和切换项目期间显示稳定骨架。
- `empty`：无项目、无作品、无成长记录时提供下一步入口。
- `error`：服务端错误提供重试，不虚构本地成功。
- `offline`：断网时禁止提交写操作，并保留未提交 draft。
- `permission-denied`：越权项目或会话显示无权访问，不泄露对象存在性。

## 关联文档

- [SDK.md](../sdk/SDK.md)
- [TEACHER.md](../teacher/TEACHER.md)
- [PARENT.md](../parent/PARENT.md)
- [0009 mastery ADR](../decisions/0009-mastery-timeline-and-graphiti.md)
- [0010 unified tutor context ADR](../decisions/0010-unified-tutor-exploration-context.md)
