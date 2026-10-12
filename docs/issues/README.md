# 启途智学待办登记册

核对基线：`origin/main` at `b1612f6`（2026-10-12）。状态以代码与服务端文档核对为准；仅有 UI 或本地状态不视为后端闭环。

## 已完成并关闭

| GitHub Issue | 范围 | 依据 |
| --- | --- | --- |
| [#41](https://github.com/Jack-Liu0227/qitu-zhixue/issues/41) | 公共首页与统一登录的代码改造 | `0952b4a`、`2751160`、`57bacd3` |
| [#46](https://github.com/Jack-Liu0227/qitu-zhixue/issues/46) | Admin AI 资源管理：模型、助手、团队、Skill、工具、模板的编辑/删除和团队成员设计 | `7aac299`、`2f36605`、`49758c8`、`1ce2a5b`、`b05f5de` |
| [#47](https://github.com/Jack-Liu0227/qitu-zhixue/issues/47) | 模型与 MCP 管理体验：NewAPI 模型同步、MCP 单项 JSON 编辑/预览、能力绑定矩阵 | `cce6974`、`334c4d4`、`0afaa51` |
| [#48](https://github.com/Jack-Liu0227/qitu-zhixue/issues/48) | AI 对话与跨端界面交互：统一主题、响应式布局、Markdown/公式输出、固定输入区及滚动区域调整 | `193ac97`、`568f579`、`89a4a82`、`0afaa51`、`b1612f6` |

以上关闭项仅代表表中明确范围已在当前代码实现，不代表整个多端 AI 业务链路已完成。

## 仍需完成

| GitHub Issue | 范围 | 备注 |
| --- | --- | --- |
| #14–#21、#34 | SDK、助手/团队/工具配置、项目模板、学生/教师/家长/管理员之间的真实数据闭环 | 继续按各 issue 的验收条件推进；不能仅凭 UI 或配置 CRUD 关闭 |
| #45 | 家长端背景与首页主题统一 | 当前家长端色彩 token 仍含紫绿渐变，issue 仍为 open |
| [#49](https://github.com/Jack-Liu0227/qitu-zhixue/issues/49) | 知识库上传/分类、团队与助手授权、嵌入与检索完整链路 | 当前知识模块有作用域治理和关键词检索；向量嵌入仍为 reserved placeholder |
| [#50](https://github.com/Jack-Liu0227/qitu-zhixue/issues/50) | 插件扩展框架 | 需要定义插件清单、参数/schema、安装与启停、授权、审计和版本兼容 |
| [#51](https://github.com/Jack-Liu0227/qitu-zhixue/issues/51) | 启途管家持久会话与真实 Agent 管理能力 | 当前 copilot 会话列表写入浏览器 `localStorage`；需服务端隔离存储、权限执行和跨端恢复 |
| [#52](https://github.com/Jack-Liu0227/qitu-zhixue/issues/52) | 端到端发布验收 | 覆盖生产环境登录跳转、Clash/study-remote 直连配置归属、桌面/手机全端真实数据与权限状态 |

## 已有关联 Issue

- #14：学生端自由探索与 AI 搭档统一及 SDK/文档收敛
- #15–#21：学生项目、推荐、教师处理、后台数据、学习计划和掌握度闭环
- #34：Agent 能力绑定、子 Agent 治理和运行时配置
- #41：公共首页与统一登录
- #45：家长端背景主题

## 状态规则

- GitHub issue `CLOSED` 只用于验收标准已满足并有代码或验证证据的范围。
- 跨端数据、权限与未成年人隔离未完成时，相关业务 issue 保持 `OPEN`。
- `study-remote` 与 Clash 的个人机器配置需要作为发布/环境验收记录，不把个人代理配置或凭据提交进仓库。
