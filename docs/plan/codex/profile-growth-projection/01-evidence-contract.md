# 01 · Evidence Contract

> 状态：待实施或部分实现的方案；当前完成情况以本目录 00-completion-audit.md 为准。

## 允许的证据引用

只允许 `packages/contracts/src/growth.ts` 中的来源种类：

```text
student_answer:<opaque-id>
theory_check:<opaque-id>
artifact:<opaque-id>
reflection:<opaque-id>
help_request:<opaque-id>
```

引用只用于回溯 owner 记录，不携带原始对话、语音、全文教材或页码。没有证据时状态必须是 `pending_observation`，不能写 0 分、负面标签或“未掌握”。

## 助手输入

- `learner-profile`：已完成的 tutor turn 元数据、学生确认的兴趣/目标、answer/theory-check/artifact/reflection 的 evidence refs。
- `growth-analyst`：项目阶段 owner 事件、作品发布、反思、mastery assessment 和已接受的画像版本。

输入必须携带 `studentUserId`、`projectId`（可空）、`sourceEventId`、`sourceTopic`、`evidenceRefs` 和 contract version；禁止发送原始聊天正文。

## 输出 schema

`learner_profile` 只允许：`version`、`priorKnowledge`、`targetLevel`、`timeBudgetMinutesPerWeek`、`preferences`、`interests`、`strengths`、`nextQuestions`。

`growth_trajectory` 只允许：`version`、`milestones`、`strengths`、`nextQuestions`、`studentSummary`、`evidenceRefs`、`confidence`。

数组长度、单项字符数和证据引用数量必须有界；输出不得包含 score、rank、percentile、riskSignal、rawConversation 或 parent-only 字段。
