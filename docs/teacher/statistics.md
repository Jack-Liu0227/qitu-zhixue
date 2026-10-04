# 数据统计

> Teacher 第 4 项（`/teacher/statistics`）。只做**聚合视图**，不进入个别学生的日常处理。
> 实现入口：`apps/teacher-workspace/app/(workspace)/statistics/page.tsx`、
> `services/api/src/modules/teacher`。

## 1. 页面构成

- 负责学生范围的聚合：项目阶段分布、待办 / 干预量、反馈工单量、近期活动。
- 统计是**治理 / 概览投影**，不替代学生详情页。

## 2. 接口

```http
GET /api/v1/teacher/statistics   负责学生范围的聚合统计
```

## 3. 规则

- 统计只在当前有效 mentor assignment 覆盖的学生范围内计算。
- 无权学生不得通过**分页计数**或空状态推断其存在——聚合口径要避免泄露边界。
- 统计只读，不产生写操作。
- 不展示无意义的排名 / 分数语义（成长与反馈不使用分数 / 排名 / 百分位 / 等级）。

## 4. 页面状态

| 状态 | 行为 |
|---|---|
| loading | 卡片骨架 |
| empty | 无数据 → 明确「暂无统计数据」 |
| error | 重试 |
| offline | 只读缓存，标注数据时间 |
| permission-denied | 403 页面 |

## 5. 未决事项

- [ ] 统计指标清单与口径（活跃定义、完成口径）。
- [ ] 时间窗口（周 / 月 / 自定义）。
- [ ] 是否导出。

## 6. 相关文档

- [`students.md`](./students.md)
- [`dashboard.md`](./dashboard.md)
