# 2026-10-21 光学全流程 main 发布

光学全流程和配置生命周期代码已同步 GitHub main，并在正式主工作树 `/root/qitu-zhixue` 构建、迁移和重启。本次核心代码为 `fc9384040d2adb4f6ff94a76d5372cf48a24504e`，配套文档校验修正为 `ae7631b9f20bbbda7f121c5aca910ccdb2d56345`。

发布期间另一个执行会话完成了测试登录修复。最终 HTTP 与进程核验时，服务器为 `3f9f9957fd310024b7aef7401ad7f447e16b4b42`；该提交包含本次全部核心代码。后续发布记录只更新文档和契约注释，不需要重新构建业务产物。测试登录的授权、配置与验证另见[独立记录](../UI/09-test-login/README.md)。

## 服务和数据库

- 13 个原有 Qitu 应用单元均已重启，核对了新 PID、active 状态和原有 WorkingDirectory：正式 API 与五端、eye 五端、IMA MCP 和本地 embedding。正式六个单元继续使用主工作树；eye 工作树的代码与归属保持原配置。
- 按实际依赖图构建 API/Worker，再逐一停止、构建和启动五个正式前端。没有新增第二套正式运行目录。独立 Worker 单元原本不存在，本次仅构建和测试。
- API readiness 为 `live/ready`，数据库和 Redis 均为 `ok`。IMA healthz 正常；embedding 匿名健康检查返回 401，服务器本地认证的健康检查返回 ready、512 维。认证信息没有导出，未触发模型生成或外部检索。
- Nginx 配置检查与 reload 通过。数据库、Redis 保持运行，没有为代码发布重启基础数据库。
- 生产标准迁移增加 `0045_learning_session_progress`；账本共 47 条，最大时间戳 `1792540800001`，课时进度表存在。没有 seed、掌握度注入、作品通过注入或代学生创建项目。
- 迁移前加密备份位于服务器 `/var/lib/postgresql/qitu-backups/release-20261021-optics-fc9384040d2a/qitu-20261020T220834Z.dump.enc`，已完整验证解密流和 PostgreSQL 归档目录；密钥仅保存在服务器受保护目录。旧前端构建保留在本次受限证据目录的 `build-backup/`。

## 验证

| 范围 | 结果与边界 |
|---|---|
| 光学发布候选 API 全量 | 1,211 通过、0 失败、9 项数据库测试默认跳过 |
| 补跑 9 项数据库测试 | 独立飞书 PostgreSQL fixture 全部通过；发送 provider 使用替身，临时库已删除 |
| 光学真实 PostgreSQL | 12 项检查通过：真实 Nest/事务冻结、计划附着、重试、并发、失败回滚与零孤儿记录；仅合成隔离数据，临时库已删除 |
| 光学能力专项 | 599 项 owner 行为测试通过，12 个源码/构建/应用类型检查步骤通过 |
| 管家生命周期专项 | 专项验证通过，Admin 类型检查通过 |
| 其他 workspace | 全部已配置测试通过，Worker 34 项；依赖图构建、全 workspace 类型检查与 lint、basePath、部署脚本检查均通过 |
| 文档证据检查 | 46 个文档、215 个本地链接，0 个问题；零来源检索仍标为不可作证据 |
| 测试登录增量 | 最新业务代码的完整 CI 通过；该轮 API 1,217 通过、9 项默认跳过，详见独立测试登录记录 |
| 线上 HTTP | 11 个页面、72 个 CSS/JS 资源通过；项目、Admin、教师 roster 三个匿名 API 均返回 401；7 个额外应用上游检查通过 |
| 公网浏览器 | 1440px 与 390px；31 个操作通过，8 次页面断言无横向溢出，四端匿名入口回到登录页，pageerror 为 0 |

[光学候选 CI](https://github.com/Jack-Liu0227/qitu-zhixue/actions/runs/39505693589) 与[包含登录修复的业务代码 CI](https://github.com/Jack-Liu0227/qitu-zhixue/actions/runs/39506862723) 均已完成，structure 和 quality 成功。机器汇总见[本次验证数据](./release-20261021-optics-verification.json)。

API 测试编译首次因 768 MB 堆限制失败，改为 1,536 MB 后通过；原失败日志保留。运行构建发现 dist 中混有 root 所有的旧文件，只修复了依赖图内 8 个 dist 目录的归属，再以 postgres 构建成功；没有批量改变源码、配置或数据库所有权。

## 发布边界与回滚

本次部署代码和迁移，没有自动发布或启用光学 v3 模板、团队绑定、TeachingBundle 或知识库授权。此前的[光学全流程隔离验收](../codex/optics-template-runtime/06-fullflow-implementation-20261021.md)仍是对应时间点的测试记录；这里新增生产部署证据，不能把隔离教学成功当成真实学生学习完成。

生产浏览器本轮仅验证匿名入口。独立测试登录任务已验证四角色登录，但未代学生运行光学项目、调用真实模型/IMA 或写入学习结果。新模板启用后，真实 Agent 生成课件、知识库题目和跨角色学习流程仍需单独验收。

服务器受限证据目录为 `.runtime/release-20261021-optics-fc9384040d2a/`，包含完整日志、备份校验、迁移、进程及 HTTP 记录，不进入 Git。根目录 `snap.bat`、`test_courseware.bat`、`test_tutor_chat.bat`、`trigger_tutor_experiment.bat`、`view_theory.bat` 属于本地调试文件，保留且未提交。

回滚遵循[正式部署流程](../../docs/admin/deployment.md)：在主工作树检出已验证版本并逐服务重建、重启。不要恢复并行正式目录，也不要把删除课时证据表当成无损回退。
