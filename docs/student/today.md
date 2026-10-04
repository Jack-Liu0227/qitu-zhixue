# 今天

> 学生端入口页（`/student/today`）。责任域：Projects & Learning，聚合读模型。
> 实现入口：`apps/student-center/features/today/**`、`services/api/src/modules/platform-data`、
> `services/api/src/modules/projects`、`services/api/src/modules/ai-tutor`。

## 1. 页面构成

| 区块 | 内容 | 数据来源 |
|---|---|---|
| 问候横幅 | 「你好，继续创造吧」+ 学生姓名 + 手写体标语 | `GET /api/v1/students/me`（学生姓名由服务端所有，前端不得编造） |
| 从一个想法开始 | 3 张方向卡（兴趣方向） | 推荐 / 模板方向 |
| 当前项目 | 阶段条（4 步视图）+ 进度 + 任务 | `projects` 读模型，`progressPercent` 服务端计算 |
| 今日任务 | 任务卡，含「今日重点」标记 | 项目当前阶段任务 + `isTodayFocus` |
| AI搭档建议 | 建议卡，点击进入 `/student/tutor` | `ai-tutor` 建议投影 |

横幅是**布局槽位**，制作工作台页会把它换成面包屑。

## 2. 路由与入口

- `/student/today` 是导航第 1 项（冻结顺序）。
- 「无项目」空态必须给出「开始探索 →」入口到 `/student/inspiration`，不允许虚构本地项目。
- 「创建新项目」始终导向灵感空间；学生不能在本页直接创建项目。

## 3. 硬规则

- 阶段条与进度只做展示，**不参与权限或阶段门判定**。任何推进逻辑必须读服务端状态机
  （见 [`projects.md`](./projects.md) §3）。
- 学生姓名、进度百分比、今日重点均由服务端计算，客户端不可写。

## 4. 页面状态

| 状态 | 行为 |
|---|---|
| loading | 稳定骨架屏（`TodayLoading`）；切换项目期间不闪空 |
| empty | 无项目 → 引导去灵感空间；无任务 → 明确「今天没有待办」 |
| error | 服务端错误显示重试，不虚构本地成功 |
| offline | 顶部横幅提示；只读缓存，禁止提交写操作 |
| permission-denied | 403 页面，不泄露对象存在性 |

## 5. 未决事项

- [ ] 问候横幅姓名来源 `GET /api/v1/students/me` 的落地与缓存策略。
- [ ] 「AI搭档建议」的生成用途（`tutor.chat` / 专用建议用途）与刷新节奏。
- [ ] 「从一个想法开始」方向卡的数据源与推荐算法。

## 6. 相关文档

- [`inspiration.md`](./inspiration.md)
- [`projects.md`](./projects.md)
- [`tutor.md`](./tutor.md)
