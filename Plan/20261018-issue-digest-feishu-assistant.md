> 状态：历史记录恢复（2026-10-26）。正文保留 df05d5b 中的原始日期与验收边界，不代表当前部署状态；现行规则见 [工程入口](../README.md) 和各责任域文档。

# 飞书汇报助手合并与问题总结能力实施任务

> 状态：`implemented（D1 聚合与范围 / D3 发送链路 / D5 测试已通过；真实验收 D5 末项仍待测试租户）`
> 评审基线：2026-10-18
> 责任域：`feedback` / `mentor` / `parent`（只读投影）/ `feishu` / `admin` / `workers`
> 专属实施代理：`.pi/agents/issue-digest-feishu.md`
> 上级基线：[`../../AGENTS.md`](../AGENTS.md)、[`../README.md`](../docs/README.md)

本文是需求拆解和验收台账，不把未完成的代码描述成已交付能力。实现合入 `main` 前必须逐项完成验收条件并同步状态。

## 1. 需求边界

用户需求原文：单独配置一个助手，总结学生、家长、教师遇到的问题，把总结内容发送到飞书机器人；通过二维码扫码完成绑定。

### 1.1 合并决策

`20261017-feishu-reporting-assistant.md` 已经交付（内置助手 ID：`feishu-reporting-assistant`）了 Feishu/Lark 基础设施（`feishu_bots`、`feishu_qr_sessions`、Device Flow 扫码、outbox 发送链路，迁移 0024–0027）。本任务是**新建一个独立的内置助手**，复用同一套飞书基础设施，但数据事实源不同：

2026-10-18 起两个助手合并为一个内置助手 `feishu-reporting-assistant`（后端默认值 `DEFAULT_FEISHU_ASSISTANT_ID`，六处引用见 `services/api/src/modules/feishu`），同时承担管理汇报与三端问题总结，全平台不保留第二个飞书助手。原 `feishu-issue-summary-assistant` 已从注册表、两份 seed、前端引用和 `qitu_dev` 库移除（seed 含幂等 DELETE 清理）。

| 输入 | 项目进度、家长授权投影、教师工作量 | 三端遇到的**问题**：反馈工单、教师问题列表、家长消息诉求、学生卡顿/升级信号 |
| 输出 | 管理汇报摘要 | 问题分类、频次、热点与待处理清单摘要 |
| 收件人 | 管理员 | 班主任（所带学生范围）与管理员（全局范围） |
| 绑定 | 助手级 Feishu/Lark 配置 + 扫码 | 同一机制，按 `assistant_id` 隔离配置 |

不新增第二份凭证存储、二维码会话表或发送 worker；差异只在聚合服务与范围校验。

### 1.2 必须交付

- 新增内置助手 `feishu-reporting-assistant`，登记进助手目录；模型取自已注册目录，不存在时返回配置错误。
- 问题事实源（只读聚合）：
  - 学生：`mentor`/`ai-tutor` 的 stall/escalation 信号、探索失败与重复卡顿；
  - 家长：`parent` 模块消息中的诉求/疑问（授权投影内、脱敏后计入）；
  - 教师：`teacher`/`feedback` 的问题列表与工单状态。
- 每个助手实例独立绑定一个 Feishu/Lark 机器人（`feishu_bots` 按 `assistant_id` 唯一），通过既有 Device Flow 二维码扫码完成绑定。
- 日报/周报可配置；摘要含时间范围、问题分类计数、脱敏示例、来源标记与「已脱敏」标记。
- 发送前重新校验助手启用状态、收件人授权范围、绑定状态与凭证；任一失败拒绝发送并记录可读错误码。
- 写操作幂等、留审计、明确错误码；凭证只在服务端加密保存。

### 1.3 不在本次范围

- 飞书机器人不成为学生/家长聊天入口，不改变四端导航。
- 飞书回调不修改项目状态、掌握度、成长档案或审计事实。
- 不外发原始未成年人对话、语音、内部风险标签、内部提示词。
- 不把 `open_id` 当作启途身份；必须映射到已认证管理员/班主任及其可管理范围。

## 2. 任务拆解

### D1. 助手登记与只读聚合合同（P0）

- [x] 助手合并完成：`feishu-reporting-assistant`（学生-家长-教师汇报与问题总结助手，模型 `gpt-6.1-sol`、权限 read-only、`team_selectable=false`、sort 90）已吸收三端问题总结职责（skills 增加 `issue-summary`），登记于 `packages/ai-client/src/assistant-registry.ts`、`database/seeds/feishu-reporting-assistant.sql`、`qitu_dev` 库；`database/seeds/admin-ai-config.sql` 移除独立行，seed 内含重复 ID 的幂等 DELETE。
- [x] 定义只读聚合服务：输入时间范围 + 收件人范围，输出分类计数、热点问题、待处理清单、数据来源与脱敏标记（`services/api/src/modules/feishu/report.ts` `aggregateReportFacts` + `resolveReportScope`）。
- [x] 摘要生成时重新解析收件人角色与范围：管理员按全局/显式名单（对象级校验），班主任从 `mentor_assignments` 重新解析所带学生范围、无分配 fail closed、显式名单越界整体拒绝（`reporting.service.ts` + `resolveReportScope` 纯函数及测试）。聚合源新增学生端未答题卡点（`pending_questions` awaiting）与家长端公开站咨询计数（`consultation_requests`，仅管理员、只输出计数）。
- [x] 越权对象返回 `403`（学生/家长角色在触碰存储前拒绝）；审计记录 actorRole、范围人数与计数，不记录原文。

**验收**：班主任账号聚合结果只含其学生范围；`403`/范围外对象不出现在摘要；审计可回答「谁、何时、聚合了哪个范围」。

### D2. 助手级 Feishu 绑定（P0，复用既有设施）

- [ ] 复用 `feishu_bots`/`feishu_qr_sessions` 与 Device Flow 扫码绑定；为 `feishu-reporting-assistant` 提供配置入口（沿用 `/admin/settings/feishu` 的助手选择与扫码流程，或在助手详情页提供「配置飞书」入口）。
- [ ] 二维码本地生成，禁止把授权 URL 发送到第三方二维码服务；会话状态机 `pending → bound | expired | cancelled` 保持不变。
- [ ] 班主任绑定时收件范围自动收敛为其所带学生；管理员可配置全局或组织范围，越界范围被拒绝。
- [ ] 重复绑定幂等：同一收件人去重，绑定动作写审计，旧会话不能再次应用。

**验收**：手机扫码成功后轮询返回 `bound`，刷新仍见 `connected`；过期/拒绝可重新开始。

### D3. 摘要生成、发送与回执（P1，复用 outbox/report-worker）

- [x] 通过 worker/outbox 生成并发送（既有 `report-worker.service.ts` 幂等/退避/死信链路不变）；消息含时间范围、来源标记与「已脱敏」标记（`issueSummary.formattedText`）。
- [ ] 发送前重新校验：助手启用、收件人授权范围、绑定状态、Feishu 凭证。
- [ ] 对 Feishu API 超时、限流、撤回授权实现指数退避、死信/人工重试与状态观测。
- [ ] 记录发送结果与哈希化收件人标识，不记录消息全文；管理端可查看最近发送状态。

**验收**：同一幂等键只产生一条外发消息；失败可重试且不越权扩大收件范围。

### D4. 设置页与状态（P0）

- [ ] 在冻结的 `/admin/settings` 信息架构内提供助手选择、Feishu/Lark 域名、启用开关、汇报范围与绑定状态；覆盖 loading/empty/error/断网/权限失败/二维码等待/过期/成功状态。
- [ ] PATCH/创建会话携带 `Idempotency-Key`；保存成功后以服务端状态为准。

### D5. 测试与验收（P0）

- [x] 聚合范围测试：班主任范围收敛、无分配 fail closed、越界名单拒绝、角色门（`report.test.ts`、`reporting.service.test.ts`）。
- [x] 脱敏测试：摘要不含 conversation/phone 等敏感字段（`report.test.ts`）。
- [x] 发送幂等与失败重试测试沿用既有用例（`report-worker.service.test.ts`）；数据库不可用 `503`。
- [ ] 前端状态测试：轮询停止、过期重试、助手切换、移动视口。
- [ ] 真实验收：测试租户完成一次扫码绑定与一次问题摘要发送。

## 3. 风险与红线

- 未成年人数据默认最小化：摘要只含计数与脱敏示例，示例需经家长授权投影或已脱敏工单文案。
- 学生/家长/教师端不开放管理摘要原文查看；只有绑定收件人收到。
- 密钥治理沿用 `20261017-feishu-reporting-assistant.md` F2 节：加密存储、轮换、GET 只回状态。

## 4. 相关文档

- [2026-10-17 汇报助手早期方案](archive/pre-20261018/plan/20261017-feishu-reporting-assistant.md)：飞书基础设施与验收设计的历史来源，不代表真实租户验收通过
- [`../teacher/dashboard.md`](../docs/teacher/dashboard.md)：教师问题列表事实源
- [`../parent/home.md`](../docs/parent/home.md)：家长消息与授权投影边界
