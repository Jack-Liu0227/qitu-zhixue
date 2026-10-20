# 学习计划、掌握度与先理论后实践

> 文档基线：`2026-10-20`，版本标识：`v2026.10.20`。
> 核心定位：**项目式学习（PBL）驱动的 AI 育人共成长**。
> 学习计划统一使用课时模型：兴趣 → 按课时生成计划 → 先理论后实践 → 完成作品。

实现入口：`packages/ai-client/src/curriculum.ts`、
`packages/ai-client/src/{mastery,questions,grading}/**`、
`services/api/src/modules/learning-plan`。

## 1. 课时模型

```text
LearningGoal（兴趣 + 目标作品 + lessonCount + lessonMinutes）
└── Outline（确认时派生，确认后不可变）
    └── Lesson（第 N 课时）
        ├── reviewBlock    复习 / 导入
        ├── theoryBlock    理论学习
        ├── checkBlock     检查与服务端判分
        ├── practiceBlock  实践与证据
        └── reflectBlock   反思复盘
```

- `lessonCount` 是计划中的课时总数，取 1–128；`sessionCount` 必须与它相等。
- `lessonMinutes` 是每课时分钟数，只允许 60 或 120；每节分块合计必须等于该值。
- 模块与课次都使用从 1 开始且连续的 `lessonIndex`；不保存周、日或自然日排课字段。
- 阶段（`exploration`、`concept_mastery`、`guided_practice`、`deliverable_review`）只承担治理元数据，不承担排程。
- 第 8、14、16 课时是检查点，不会自动写入掌握、作品通过或归档事实。

## 2. 生成与冻结

- `exploreCurriculumInterest` 收集兴趣、目标、`lessonCount` 与 `lessonMinutes`。
- `planCurriculum` / `generateCurriculumPlan` 生成逐课时模块、目标、分块和前置关系。
- 服务端 `session-plan-validator.ts` 是唯一结构校验入口：检查课时数量、连续索引、分块总时长、目标覆盖率和前置 DAG。
- 计划生成只创建 `projectId = null` 的草稿；学生确认后，服务端事务冻结模板版本、绑定和团队版本，再创建正式项目。
- 计划生成幂等签名为 `(studentId, templateVersion, interest, lessonCount, lessonMinutes)`。

## 3. 接口

```http
POST /api/v1/learning-plans
POST /api/v1/learning-plans/:id/confirm
GET  /api/v1/learning-plans/:id
GET  /api/v1/learning-plans/:id/sessions
POST /api/v1/learning-plans/:id/sessions/:sessionId/start
GET  /api/v1/learning-plans/:id/sessions/:sessionId/next-step
POST /api/v1/learning-plans/:id/sessions/:sessionId/answers
POST /api/v1/learning-plans/:id/sessions/:sessionId/evidence
```

生成请求白名单：`interest`、`lessonCount`、`lessonMinutes`、`goal`、`sessionCount`、`curriculumSlug`。
任何旧日历字段或服务端状态字段都会被拒绝；服务端不做旧周排期兼容投影。

## 4. 掌握度与门禁

| 类型 | 门槛 |
|---|---|
| `memory` / `procedure` | 近期加权掌握度 ≥ 0.9 |
| `concept` / `design` | 服务端质化掌握布尔 |

实践目标必须以前置理论目标为依赖；服务端在开始实践课、实践分块和提交证据时再次检查 `TheoryMastered`。
题面投影不包含答案或解析，判分、掌握度、阶段推进、作品通过和成长记录只能由对应服务端 owner 写入。

## 5. 光学课程

`optics-physical-inquiry-16s` 是 16 课时模板：每课时一个模块与一个 session，阶段仅用于治理和助手路由。散射与衍射属于实践/非门禁波动模块，不新增 `TheoryMastered` 目标。

## 6. 相关文档

- [`tutor.md`](./tutor.md)
- [`projects.md`](./projects.md)
- [`growth.md`](./growth.md)
- [`../sdk/domain-facade.md`](../sdk/domain-facade.md)
