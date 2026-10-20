# 2026-10-21 工具与 MCP 历史绑定修复

用户报告工具页提示 9 个历史 ID 未在目录登记。本次运行代码为 `b912456048f810a90fa78e8fed28af379bc5a76c`；随后并行发布 `829f1cc` 保留本修复，更新了其他页面与固定界面素材。

## 线上结果

通过 Admin owner API 迁移 5 个助手的 9 项旧占位绑定；重新读取 17 个助手后，未登记工具数量为 **0**。不是仅隐藏提示，也没有把无执行器的 ID 登记成可调用工具。

| 助手 | 移除的无效调用声明 | 保留的工具 |
|---|---|---|
| 光学探究总导师 | learning_plan_advance | mastery_query、student_profile_get |
| 光学原理与概念教练 | mastery_assess | knowledge_search |
| 光学仿真与实验向导 | simulation_runner、data_analyzer | — |
| 光学探究答辩与评审导师 | artifact_review、growth_record_append | — |
| 飞书汇报助手 | student_status_summary、parent_status_summary、teacher_status_summary | — |

已登记工具与上述业务流程不是同一事实层。学习推进、掌握度、注册光学仿真、作品评审、成长写入和脱敏汇报继续由原服务负责；通用 data_analyzer 没有接入，不声称已实现。没有给模型新增写入事实或任意执行代码的权限。

5 条审计保留原/新工具集合与处理说明；同一幂等键重放返回相同回执，没有重复迁移或审计。比较确认其他助手字段、MCP 配置与既有不可变团队版本未改变，未写学生学习事实。详情见 [生产迁移回执](production-migration.json) 与 [迁移前目录](before-runtime.json)。

## 验证

- [源码核验](source-verification.json)：冻结副本 2,333 个 Git blob 与提交一致，没有包含同时进行的其他工作区修改。
- [并行修改清单与验证边界](concurrent-workspace.md)：保留其他工作流的修改，后续版本只在本任务依赖范围内单独复测。
- API/Worker 依赖图构建、管理端生产构建、全量已配置测试通过。API 1,221 项通过、10 项跳过；其中新增 PostgreSQL 集成测试在普通测试命令中按要求跳过，随后在隔离库实际执行。
- [真实 PostgreSQL 记录](postgres-tests.txt)：8 项通过，覆盖匿名/非管理员拒绝、旧预览冲突、字段保留、审计失败回滚、回读不符回滚、并发串行化和幂等重放。只复制 schema，业务记录复制数 0，fixture 数据库已删除。
- [浏览器结果](browser-results.json)：真实页面没有历史绑定提示，服务器读取的未知工具数为 0。请求拦截 fixture 验证预览失败/重试、409 冲突不报成功、保存后重新读取、提交成功但回读失败不报成功。fixture 没有向生产提交配置。
- 浏览器实际验证匿名 GET 为 401、学生 GET/PATCH 为 403，pageerror 为 0。`/admin/settings/tools`、`/admin/settings/skills`、`/login` 引用的全部 CSS/JS 通过检查。
- 并行 `829f1cc` 发布结束后再次执行上述工具页交互与鉴权检查，均通过；[最终服务状态](server-audit.json) 显示六个正式服务 active、readiness 为 live、数据库/Redis 为 ok。四角色测试账号入口仍保留。

## MCP

[IMA 实际探测](ima-validation.json) 完成握手/目录发现与只读列库调用，连接正常，发现 4 个只读工具。未导出知识库正文或凭据，也没有扩大任何项目 grant。不能据此宣称 4 个工具逐个完成业务调用或所有学生均有权限。

其他历史 fetch、Grok、browser 服务没有通用执行驱动，仍如实显示 disabled/not_configured。本次没有启用它们或添加授权。

## 截图

- [修复前的原提示](before-desktop.png)
- [真实迁移预览](migration-preview.png)
- [迁移后的桌面页](after-desktop.png)
- [迁移后的手机视口](after-mobile.png)

只截取管理配置界面，不保存学生原始对话、模型凭据或测试账号密码。手机为 Chromium 视口模拟。实施与 API 说明见 [迁移手册](../../admin/tool-bindings-migration.md)。
