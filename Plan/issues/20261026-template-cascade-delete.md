# 项目模板及关联学习数据永久删除

2026-10-26，用户明确选择“同时删除关联学生项目、计划、作品等学习数据”。本需求取代原先“有历史引用只能归档”的后台交互限制。

## 行为与范围

- 项目模板库的删除操作先读取服务端影响清单，显示学生、项目、计划、作品、质量验证、探索、对话、成长等记录数量。管理员勾选同时删除学习数据，并输入完整课程名称后执行。
- 未发布草稿和归档课程可删除（包含曾发布的课程）；当前在架课程及恢复后带有历史发布版本的课程须先归档。
- 删除所有版本、质量验证及证据、教学配置，以及按版本外键、冻结绑定和来源探索定位的学生项目；复用现有项目清理 owner，处理计划/目标/课时/掌握度、作品版本/评价、对话、项目资料、成长记录与反馈。
- 使包含被删成长记录或作品的家长导出失效；清除关联幂等响应和待投递事件。关联 AI 记忆清空正文并产生既有索引删除任务。
- 学生账号、其他课程、全局团队/知识库和操作审计保留。质量验证引用的外部项目不会因引用关系被递归删除。项目资料库仍被范围外项目使用时拒绝删除，防止破坏另一课程。

## API、权限与一致性

- `GET /api/v1/admin/project-templates/:id/deletion-impact`：仅 Admin；返回名称、数量与范围指纹，不返回学生身份或原始学习正文。
- `DELETE /api/v1/admin/project-templates/:id/with-records`：仅 Admin；必须提供 `Idempotency-Key` 及 `includeLearningData: true`、`expectedFingerprint`、`confirmedTitle`。旧 DELETE 和 Copilot 删除路径保留历史保护，不能隐式扩大删除范围。
- 事务内锁定课程、版本、关联对象并重新核对指纹。范围变化返回 `TEMPLATE_DELETE_STALE`；缺确认返回 `TEMPLATE_DELETE_CONFIRMATION_REQUIRED`；在架返回 `TEMPLATE_DELETE_PROTECTED`；处理中的 AI 租约或锁冲突返回 `TEMPLATE_DELETE_BUSY`；跨课程引用返回 `TEMPLATE_DELETE_SHARED`，项目资料保留既有 `HISTORY_DELETE_BUSY` / `PROJECT_DELETE_SHARED_KNOWLEDGE`。
- 清理和 `template.delete` 审计在同一事务；任一步失败全部回滚。审计仅记录范围数量、状态和指纹。前端保留重试幂等键，成功响应后回读课程列表，确认不存在才移除卡片；断网、权限、读取和删除失败均可见。
- 本变更不增加表或迁移。对象存储文件的物理清理不在当前未配置的作品存储适配器能力内；现有数据库作品版本及访问入口一并删除。外部索引删除沿用现有异步 worker，数据库清理成功不等于远端索引即时完成。

## 验证

`tooling/test-template-cascade-postgres.mjs` 只使用内存中的可丢弃 PGlite，加载完整迁移。覆盖双学生课程关联、独立草稿计划/作品、冻结绑定、质量验证、答题/掌握度、课时、对话、知识资料、反馈、成长报告、记忆索引任务、缓存、审计回滚、忙碌租约、共享保护、范围过期、幂等重试和其他课程隔离。

运行时先按依赖顺序构建工作区包，再编译 API。原模板生命周期/删除/Copilot 57 项回归及前端删除回读测试继续执行。线上验证仅通过正式 API 创建临时课程和质量验证记录后删除；不制造学生学习事实，不删除用户现有课程。

## 发布与验收（2026-10-26）

已部署至 [项目模板库](http://122.51.130.204/admin/settings/templates)，Admin 构建 `_KJ8Snhb3gqCQa6ZttMLV`。发布前发现另一次后台构建未留下完整产物，先用现有线上源码重建完整基线，再备份并应用本次 13 个文件；没有覆盖并行任务的源码。发布前后另 1970 个源码文件哈希一致，无数据库迁移。

- 按工作区实际依赖图构建 API，通过 57 项原有行为回归、完整迁移 PGlite 级联检查、4 项前端回读测试；服务器 Admin 类型检查和生产构建通过。主 API、Admin、其他四个前端及两个原先启用的 worker 均恢复 active，readiness 与公网页面均返回 200。
- 线上通过正式 API 创建两门专用临时课程和真实质量验证记录，验证匿名 401、学生/教师/家长 403、缺确认 400、范围变化 409；桌面与 390px 手机端确认、实际删除、同键重放、回读失败保留卡片与重试均通过。136 次静态资源响应全部 200，无页面脚本错误。
- 两门临时课程及版本回读剩余均为 0，删除审计恰为 2 条；测试前后原有 12 门课程的 ID/状态一致。学生项目级联仅在隔离数据库中验证，线上未创建或删除真实学生学习记录。
- 本地依赖快照通过隔离包输出验证；全量 Admin 类型检查还遇到并行修改的 `MemberEditor.tsx` 与 `settings/tools/page.tsx` 类型错误。本次未改写这两个文件，正式发布基线的完整类型检查已通过。

匹配源码与运行产物备份：`/var/backups/qitu-template-cascade-delete-20261026-1310`；发布及检查日志：`/tmp/qitu-template-cascade-delete-20261026-1310`。回退需核对后续改动，停止对应服务并恢复匹配产物；不回滚数据库。构建保留旧静态资源。初次未进入源码替换的备份及不完整后台产物保留供追溯。

证据：[发布清单](assets/20261026-template-cascade-delete/release.json)、[数据库测试](assets/20261026-template-cascade-delete/cascade-postgres.json)、[浏览器验收](assets/20261026-template-cascade-delete/browser-result.json)、[最终健康检查](assets/20261026-template-cascade-delete/final-health.json)、[桌面确认窗口](assets/20261026-template-cascade-delete/cascade-confirm-desktop.png)、[手机确认窗口](assets/20261026-template-cascade-delete/cascade-confirm-mobile.png)。
