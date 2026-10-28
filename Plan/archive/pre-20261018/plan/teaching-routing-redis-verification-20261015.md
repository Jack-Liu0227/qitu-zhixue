# 教学入口、模型路由、关注学生与 Redis 验证

日期：2026-10-15。关联 #52、#53、#54、#56、#57。代码版本：`eeb15d8`、`945171c`、`9954fd2`、`fcd81bf`。

## 范围与根因

- 模型用途卡片改为真实配置读写；供应商工作区统一维护用途模型与 Agent 链路。保留专属覆盖，管理员选择用途后才清空；主导师与 mailbox worker 每次重新解析，不能静默换模。旧 `/admin/settings/models` 重定向到工作区，不增加导航。
- AI 搭档此前绕过真实会话，用浏览器凭据、无效接口和本地回答模拟教学。现在使用已有会话、SSE、权限及幂等边界。
- 正式项目仍卡住的第二层根因：Tutor 查询演示名册，而项目列表从学习计划反推。新确认的项目尚无计划，既无法读取上下文，也不出现在列表。现在从持久化项目表读取，查询受学生归属约束。
- 关注学生由宽表改为身份、项目、关注原因、活跃/任务指标和学情入口的共享卡片。修复窄屏隐式栅格溢出，不改变教师导航或可见数据范围。
- 手机导航抽屉与桌面侧栏偏好解耦，默认关闭，切页和断点变化时关闭，防止遮住教学输入区。
- Redis 使用系统服务、回环监听、认证、AOF 和 noeviction；凭据仅在服务器受限配置，未提交。

## 本地验证

| 检查 | 结果 |
| --- | --- |
| API 测试 | 709 passed / 0 failed |
| 学生端测试 | 11 + 5 passed / 0 failed |
| worker 测试 | 16 passed / 0 failed |
| API、student、admin、teacher、workers 类型检查 | 通过 |
| API、student、admin、teacher、workers 构建 | 通过 |
| 工作区基线、basePath、teacher 链接 guard、diff check | 通过 |

新增 API 覆盖包括：无学习计划的新项目可建立会话、跨学生拒绝、项目列表不依赖计划、PostgreSQL 查询绑定归属谓词。worker 测试包含可控 HTTP 上游验证用途绑定变化，不能将它冒充真实供应商推理验收。本轮未运行完整生产数据库集成测试。

## 服务器与浏览器验收

目标 `http://122.51.130.204/`；SSH 和可见 Chromium 均直连。仅使用站点自带测试账号与合成学习内容，不持久化测试凭据。

- 学生：真实 Composer 提交，HTTP 200，收到 `tutor.delta`、`tutor.block`、`turn.done`；没有旧 `chat/completions` 请求或 error 帧。探索刷新恢复，断网保留未提交草稿且禁发。
- 确认意图：HTTP 201，相同幂等键重试返回同一项目；进入正式项目后再次通过 Composer 调用真实模型，刷新仍恢复服务端历史。项目保持 `intent_confirmed`，不能由聊天解锁实践。
- 权限/阶段：学生修改管理员模型绑定被拒；无计划项目 `can-advance` 不允许，直接 advance 返回 409，阶段不变。此项不等于完整线上 TheoryMastered 正向流程验收。
- 管理员：真实用途绑定保存、Agent 改跟用途、重载持久化与有效模型解析通过。临时测试的 Agent 策略在 finally 中恢复，未擅自覆盖现有选模。
- 教师：总览/统计 1440 与 390 宽检查通过，无横向文档溢出，学情链接可达，无 JS/CSS 失败和页面异常。截图已复核。
- 手机：抽屉默认/切页/刷新/断点变化均关闭，菜单可打开，桌面偏好不被改写，输入框宽度和中心点 hit-test 通过，实际无遮挡。
- 服务：API、workers、auth、student、parent、teacher、admin 状态正常；readiness 为 `live`，database / redis 均为 `ok`。

Redis 业务适配器实测：JSON 缓存往返与 TTL、锁互斥和错误 token 不能释放、队列 enqueue/reserve/ack 全部通过；合成测试键已清理。未认证连接返回 NOAUTH，6379 仅监听 IPv4/IPv6 回环；配置文件权限 600，systemd enabled/active。

脱敏日志在服务器 `.runtime/verification/teaching-routing-20261015/`；本机浏览器日志和截图位于 Windows 临时目录，文件名前缀 `qitu-`，不提交截图、认证状态或原始对话。截图脚本只保存在临时目录；单元回归测试已入库。

## 边界与剩余风险

- 教师当前数据仍明确标记 demo 投影，UI 修复不等于所有教师数据已迁移到 live。
- 向量协议未可靠声明，embedding 绑定保持禁用；实时语音需兼容音频输入与输出。本轮没有验收语音、所有供应商或所有模型。
- Tutor 使用真实 `ModelGateway.complete` 后服务端分块 SSE，不是上游原生逐 token 流。
- 代码隔离沙箱、视频分析及完整全自动 PBL 验收不在本次完成范围，不用静态检查声明运行通过。
- Redis 是单机，AOF everysec 仍有约一秒崩溃丢失窗口；监控、异机备份和高可用尚未完成，PostgreSQL outbox 保持事实源。
- 保留当前 API watch 部署；本次只构建和重启必要服务。启动后的瞬时 000 必须等真实 readiness，不能凭 PID 判断成功。

以上均为推送 GitHub 前的本地与服务器验收，不预先宣称 GitHub CI 通过；CI 状态以实际运行结果为准。
