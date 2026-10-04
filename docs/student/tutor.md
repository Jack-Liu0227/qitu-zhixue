# AI搭档

> 学生端第 3 项（`/student/tutor`、`/student/tutor/[projectId]`）。唯一对话入口，
> 自由探索与项目辅导共用。责任域：AI Tutor（Tutor session / turn），
> **不写项目阶段、掌握度、成长档案或审计**。
> 实现入口：`apps/student-center/features/tutor/**`、`services/api/src/modules/ai-tutor`、
> `packages/ai-client/src/{pedagogy,context,escalation,context-packet}.ts`。

## 1. 页面构成

- 左侧：项目或探索进度（服务端 `context discriminator`）。
- 中间：单一文字对话 Composer + 对话线程。
- 回复为**结构化块**，不是纯 Markdown：`text` / `questions` / `options` / `hint` / `evidence`。

## 2. 上下文判别式（ADR 0010）

```typescript
type TutorContextRequest = {
  source: 'exploration' | 'project';
  explorationId?: string;   // source='exploration'
  projectId?: string;       // source='project'
  idempotencyKey: string;
};
```

- `exploration` 必须带由 Projects owner 创建且属于当前学生的 exploration。
- `project` 必须带经对象级授权的 project。
- 二者互斥；缺失 / 无效 / 越权返回稳定错误，**不得回退 demo project**。
- 一 exploration 一 session、一 project 一 session；数据库唯一约束防并发重复创建。

## 3. 服务端职责

- 组装 bounded context packet，模型只读取授权投影（画像 / 关系记忆 / 模板证据 / 知识证据 / 有限近期消息）。
- 教学策略与 pedagogic move 由服务端决定；客户端不能提交 stage、`hintLevel`、项目状态或强制 move。
- 提示阶梯默认苏格拉底式；答案泄露检查与班主任升级由服务端执行。
- 回合以已授权 `sessionId` 为对象边界，`Idempotency-Key` 必填。
- 序号、提示等级、卡顿计数和审计由服务端产生。
- **不向学生展示**其他学生信息、完整系统提示词、数据库查询或模型凭证。

### 3.1 教学动作词表

| 入口 | `pedagogic_move` | 提示等级 | 约束 |
|---|---|---|---|
| 给我提示 | `hint` | 1 → 3 | 一次只升一级 |
| 帮我拆解 | `scaffold` | 4 | 2–6 步，每步一个 goal |
| 解释这个概念 | `explain` | 5 | **唯一**允许讲解的入口 |
| 检查我的方案 | `review_work` | — | 只评审、不代做 |
| 帮我调试 | `debug_guide` | 1 → 3 | 引导定位，不给修好的代码 |
| 我卡住了 | `stall_signal` | — | 计入 4 轮卡顿窗口 → 班主任待办 |

**没有「直接给我答案」入口**——与默认禁止输出完整答案一致；Level 5 只能经「解释这个概念」进入。

## 4. 接口

```http
GET  /api/v1/tutor/templates                             可用模板 / 会话配置
GET  /api/v1/tutor/session                               当前会话
GET  /api/v1/tutor/project-context                       项目上下文（授权后）
POST /api/v1/tutor/sessions                              创建 / 恢复 session（幂等）
GET  /api/v1/tutor/sessions/:id                          会话详情 + 恢复游标
POST /api/v1/tutor/sessions/:id/turns                    单回合
POST /api/v1/tutor/sessions/:id/stream                   SSE 流式回合
GET  /api/v1/tutor/sessions/:id/summary                  会话摘要
```

SSE 回合只接受已授权 `sessionId`、学生文本和幂等键。

## 5. 语音（未实现）

- 语音输入只转成现有文字 draft，**不保存原始音频**，最终仍走 Tutor 文本提交链路。
- 真实 VAD / ASR / TTS 后端尚未形成可验证链路；本期统一为文字对话，
  **不保留 mock Live 假功能**。语音作为同一 composer 的输入适配，服务端能力就绪后再上。

## 6. 页面状态

| 状态 | 行为 |
|---|---|
| loading | 打字指示器 |
| empty | 无项目且无探索 → 引导去灵感空间 |
| error | 保留会话，可重试；不丢已输入内容 |
| offline | 保留文字输入 + 重连提示；重连后合并 |
| permission-denied | 403 页面，不泄露对象存在性 |

## 7. 未决事项

- [ ] 真实流式（当前一次 `ModelGateway.complete`，回答后分片）。
- [ ] 卡顿自动检测阈值是否适用于语音通道。
- [ ] 「卡顿已正确升级」的可观测验收口径。
- [ ] 会话摘要的生成与保留策略。

## 8. 相关文档

- [`learning-plan.md`](./learning-plan.md)（掌握度 / 题库 / 间隔复习）
- [`inspiration.md`](./inspiration.md)
- [`../sdk/agent-runtime.md`](../sdk/agent-runtime.md)
