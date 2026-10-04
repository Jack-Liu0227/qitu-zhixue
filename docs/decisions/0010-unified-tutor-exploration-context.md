# ADR 0010：统一 AI搭档会话与自由探索上下文

- 状态：Proposed（代码改动前须经独立 IA / 安全评审）
- 日期：2026-10-04
- 关联：ADR 0002、0003、0008、0009；GitHub Issue #14；产品文档 §4.1、§4.3、§4.4、§9.5

## 背景

学生端当前把推荐项目、自由探索与 AI搭档项目会话拆成不同界面和数据链路。本 ADR 只把自由探索并入 AI搭档；推荐项目继续保留在灵感空间的独立详情/确认流程。探索领域已由 Projects API 管理意图草稿与幂等确认，Tutor API 管理自由探索/项目会话与回合。

学生导航属于冻结 IA；本决策保留灵感空间的推荐项目入口和详情/确认流程，只把自由探索发起动作导向 AI搭档。推荐项目不进入 Tutor 页面。

## 决策

1. **一个自由探索对话表面**：AI搭档只有一个 composer/对话区和左侧上下文进度区。右侧重复能力面板及独立自由探索对话页面退出产品流程。已批准的 `灵感空间2.png` 保留为历史/内容视觉参考，不再代表独立路由或第二套运行链路。推荐项目继续使用灵感空间自己的详情/确认页面。导航名称和顺序不变。教学策略与 pedagogic move 留在服务端，不因删除快捷按钮而删除教学能力。
2. **显式判别式上下文**：Tutor 创建会话的请求在 `exploration` 与 `project` 上下文间二选一；只适用于自由探索和已有项目辅导。推荐项目不创建 Tutor session，继续由灵感空间/Projects owner 管理推荐来源和模板版本。探索 session 引用已创建的 free exploration 草稿；项目上下文携带 projectId。所有创建/变更有 `Idempotency-Key`。
3. **领域写入者不变**：Tutor application 可编排会话，但探索草稿创建/更新/关闭与意图确认仍由 Projects owner 写；项目实例只能在学生明确确认后由后端幂等创建。客户端不写项目阶段、掌握度、成长档案或审计。
4. **会话持久关联**：Tutor session 持久化关联 `explorationId` 或 `projectId`。数据库允许 exploration session 的 `projectId` 为空；关联须有约束/索引、所属学生校验和重启恢复测试。历史兼容值不得被猜测转换。
5. **统一回合 API**：回合以已授权 `sessionId` 为对象边界，通过单一 SSE 回合 endpoint 执行。服务端从持久 session 恢复 context；客户端不能提交 stage、hintLevel、project state 或强制 pedagogic move。
6. **进度投影**：左侧面板根据服务端 context discriminator 渲染：未确认探索显示探索/意图草稿进度，不显示项目阶段；项目 session 显示 owner 提供的项目阶段和当前任务。
7. **无假项目 fallback**：缺失、无效或越权的上下文返回稳定错误；不得默认指向 demo project。demo 数据仅可由显式 demo/test provider 注入。
8. **兼容清理按证据进行**：迁移所有仓库内调用方后，删除重复/死路由和只服务于旧 Live 面的代码。数据库历史迁移和外部 API 在没有消费者与数据证据前不删除。

## 合同草案

```typescript
type TutorContextRequest = {
  source: 'exploration' | 'project';
  explorationId?: string;
  projectId?: string;
  idempotencyKey: string;
};

interface CreateTutorSessionRequest extends TutorContextRequest {}
```

`source: 'exploration'` 必须带由 Projects owner 创建且属于当前学生的 exploration（自由探索由客户端在创建会话前幂等创建）；`source: 'project'` 必须带经对象级授权的 project。随后 `POST /api/v1/tutor/sessions` 或等价的恢复查询幂等创建/恢复 Tutor session。创建响应返回 `sessionId`、`projectId`、`explorationId`、source、服务端进度投影以及恢复游标。SSE 回合只接受已授权 session ID、学生文本和幂等键；pedagogic move、提示等级、阶段、工具准入和审计由服务端决定。探索确认继续使用 Projects owner 的幂等命令，不由 tutor 回合隐式触发。

## 安全与数据

- session、exploration、project 每个请求都按已认证学生重新做对象级授权；不信任 URL/query 中的 studentId。
- 未确认意图不能创建正式项目；重复确认只创建一个项目。
- 原始对话只按既有会话留存规则保存，不复制进 growth、普通日志或通用记忆；summary/session projection 遵循产品文档 §11.1 的最小字段可见性，默认不向家长或其他角色暴露原始学生对话。
- 会话启动顺序为：Projects owner 先幂等创建/恢复 exploration，再创建/恢复 tutor session 关联。若第二步失败，保留可重试 exploration；相同幂等键重试不得复制草稿或 session。
- 一项目仅一个活动 tutor session、一 exploration 仅一个 tutor session；数据库唯一约束作为并发创建的最终保护。历史无关联 tutor session 不可按 demo project 或猜测探索归属自动迁移。

- 退出探索/会话不得删改项目事实；删除政策由对应领域和留存政策决定。

## 后果

正面：学生只有一个对话入口；项目和探索复用流式、错误恢复和教学策略；服务端可区分探索草稿与正式项目；去除 demo fallback 的隐式污染风险。

成本：Tutor session 需要稳定的 exploration 关联和持久化创建幂等；旧前端路线、数据源与合同要一次性同步迁移；移动端/语音在后端未具备能力前只能作为不可用或隐藏的输入适配。

## 验收门槛

- `灵感空间2.png` 作为历史/内容视觉参考保留；§0.3 明确其独立页面 IA 被本决策取代，导航标签顺序不变。

- 跨学生读取探索/session 返回 403/统一拒绝；project/exploration context 互斥校验。
- session 创建/恢复幂等；服务重启后 session 与探索进度可恢复。
- 未确认前无正式项目；确认可重放且只创建一个项目。
- 无任何无上下文路径回退 demo 项目；生产模式无 mock fallback。
- UI loading/empty/error/offline/permission-denied 全覆盖；手机端只有一个可操作 composer。
- 全部 session 创建入口读取并校验 `Idempotency-Key`；context ownership 在 create 与每次 turn 时校验。
- 推荐项目继续使用 `recommended` 来源和固定模板版本；其确认动作不跳转 Tutor。
- 自由探索使用 `free` 来源，先创建 exploration 草稿，再创建/恢复 Tutor session。
- Tutor session API 只公布实际实现的 endpoint；本次不声明不存在的 feedback endpoint。


## 待评审问题

1. 真实语音 VAD/ASR/TTS 后端尚未形成可验证链路。本决策默认本期统一为文字对话；语音入口等服务端能力准备好后作为同一 composer 的输入适配，不保留 mock Live 假功能。
2. 推荐项目保留推荐卡和详情；确认由 Projects owner 的既有接口处理。推荐来源 `recommended` 与固定模板版本在推荐流程中保留，不进入 Tutor。
3. 自由探索按钮进入 `/student/tutor`，由 Tutor session 关联 `free` exploration 草稿。
3. 探索会话与 tutor session 一对一；关闭探索后再次开始必须创建新的探索草稿，不能重开已关闭 session。

## 回滚

恢复前端旧 route 只能作为暂时回滚代码，不能恢复 demo project fallback。API/DB 变更按 forward-only migration 规则提供显式 down 说明；不丢弃已存 session/turn/exploration 数据。切回时保留新字段并停止新流量，确认旧调用者恢复后再评估数据回填或弃用。
