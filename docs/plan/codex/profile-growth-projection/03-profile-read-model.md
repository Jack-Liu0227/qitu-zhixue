# 03 · Profile Read Model

## 学生响应

`GET /api/v1/students/me/profile` 返回：

- 画像：先备知识、目标层级、每周时间预算、偏好、兴趣、优势、待探索问题。
- 成长：来自 Growth 记录的最近时间线、摘要计数和 `growth_trajectory`。
- `freshness`：`fresh` 或 `unavailable`。
- provenance：固定的 `learner-profile` 与 `growth-analyst` canonical ID。
- 证据：只返回 opaque `evidenceRefs`，不返回原文。

前端必须在 `trajectory === null` 或 `freshness === unavailable` 时使用诚实空态；不能展示旧 mock 雷达图、分数、排名或模型推测。

## 家长投影

家长读取同一 accepted projection，但只显示已审定的 `summaryParent`、项目阶段和更新时间。默认不返回 `evidenceRefs`、原始对话、内部置信度和风险字段。对象级权限继续由 API 复核，不能靠前端学生切换器控制。

## 并发与缓存

- `version` 和 `updatedAt` 必须来自服务端 accepted 行。
- 孩子切换时使用 request identity/abort；旧响应不得覆盖当前学生。
- 离线时仅展示最近一次已确认数据，禁止把本地草稿标成新画像。
