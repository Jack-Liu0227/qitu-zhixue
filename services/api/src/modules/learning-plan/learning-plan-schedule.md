# Learning plan schedule: lesson-first contract

当前产品的教学时间单位是“课时”，不是“周”。新模板必须把每一节课作为
`curriculum.profiles[].sessions[]` 的一条冻结内容，并使用 `PblLessonSchedule`：

```ts
{ lessonCount: 16, lessonMinutes: 60 }
```

## 1. 当前模板路径

- `lessonCount` 是课时总数，范围由合同校验（当前为 1..128）。
- `lessonMinutes` 只能是 60 或 120，并且每个 session 的 `durationMinutes` 必须一致。
- 每个 session 必须有连续、唯一的 `sessionIndex`（1..`lessonCount`）。
- 模板可以保留 `exploration`、`concept_mastery`、`guided_practice`、`deliverable_review` 作为治理元数据，但阶段不能替代课时内容，也不能生成模块。
- 计划投影为一课时一个 module/session：使用 `lessonIndex`，不写 `weeks`、`weekIndex`、`week` 或 `day`。
- 第 8、14、16 课时只是 checkpoint 提示；它们不会自动写入 `TheoryMastered`、作品通过或归档事实。

以 16 课时光学模板为例，生成请求必须是：

```json
{
  "interest": "光学证据链",
  "lessonCount": 16,
  "lessonMinutes": 60,
  "curriculumSlug": "optics-physical-inquiry-16s"
}
```

服务端从已解析并冻结的模板版本读取 session、objective、block 和 checkpoint，然后再生成计划；不会按阶段拼装课时，也不会从 `lessonCount` 反推周数。

## 2. 数据与接口边界

- `learning_plans`：新记录写 `lesson_count`、`lesson_minutes`，`weeks` 为 `NULL`。
- `learning_modules`：新记录写 `lesson_index`，`week_index` 为 `NULL`。
- `learning_sessions`：写 `lesson_index`；响应只返回 `lessonIndex`。
- 数据库约束禁止同一条记录同时拥有 weekly 和 lesson-first 排期字段。
- 幂等签名使用 `(student, templateVersion, interest, lessonCount, lessonMinutes)`，不包含伪造的 compatibility weeks。

## 3. 遗留周排程边界（待统一迁移）

新模板只接受 lesson-first 合同。旧周字段不再参与模板解析、生成或校验；历史数据如需读取，必须由明确的离线迁移处理，不能在读路径中推导或伪造课时。

## 4. 每课时内容与复习

每个课时仍由 `review`、`theory`、`check`、`practice`、`reflect` 等受控 block 组成，block 分钟数合计必须等于 `lessonMinutes`。复习间隔使用课时序号，不再把“第几周”作为教学语义；若未来需要自然日提醒，应另建日历投影，不修改模板合同。
