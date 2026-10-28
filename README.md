# 启途智学

> 面向中小学生的项目式 AI 学习平台：让 AI 参与学习过程，让人的好奇心、判断力、创造力和责任感在真实项目中成长。
>
> 文档校验基线：2026-10-10，`main@772c601`。

启途智学把一个问题变成可推进、可复盘、可展示的学习过程。学生从兴趣和真实问题出发，在 AI 搭档的启发式引导下完成理论学习、实践创作和作品反思；家长看到经过授权的成长投影，班主任处理需要人工介入的问题，管理员负责平台、模型和协同运行时治理。

## 从这里开始

1. [`AGENTS.md`](./AGENTS.md)：工程协作、安全和领域硬规则。
2. [`docs/README.md`](./docs/README.md)：项目使用说明、角色操作、部署配置和 SDK 接入。
3. [`docs/aboutus/README.md`](./docs/aboutus/README.md)：产品定位、主页信息和 AI 与人共成长的教育理念。
4. [`Plan/README.md`](./Plan/README.md)：研究、设计、实施计划、Issue、发布验收记录和历史归档。
5. 按责任域阅读：
   - 管理端：[`docs/admin/platform-governance.md`](./docs/admin/platform-governance.md)
   - 学生端：[`docs/student/today.md`](./docs/student/today.md)
   - 班主任端：[`docs/teacher/dashboard.md`](./docs/teacher/dashboard.md)
   - 家长端：[`docs/parent/home.md`](./docs/parent/home.md)
   - SDK 与 Agent：[`docs/sdk/overview.md`](./docs/sdk/overview.md)

## 当前实现基线

- Monorepo：`pnpm workspace + Turborepo`。
- 后端：NestJS 模块化单体，PostgreSQL 为业务真源，Redis/Worker 承担异步任务和 outbox 投影。
- 前端：一个公开官网与统一登录入口 `apps/auth-portal`，以及 student、parent、teacher、admin 四个角色应用。
- AI：Provider Registry 保存供应商、协议、模型目录和加密凭证；Agent 直接选择 `providerId + modelId`。
- 协同：Team Runtime 使用服务端 route、mailbox、租约、任务、事件和 worker；真实结果进入候选投影后再由领域 owner 校验、幂等接受和审计。
- 学习门禁：学生确认意图后才能形成正式项目，`TheoryMastered` 之前不能进入实践阶段，项目状态由服务端状态机推进。
- 公开站点：主页、学习路径、能力说明、作品展厅、关于我们、联系咨询均有正式路由；公开写入口只有带幂等键的咨询提交。

## 仓库结构

```text
apps/       auth-portal、student-center、parent-companion、teacher-workspace、admin-console
packages/   contracts、api-client、ai-client、auth、database、model-runtime、permissions、ui 等共享能力
services/   api（模块化单体）、workers、realtime-gateway、graphiti（可选投影）
database/   migrations、seeds、fixtures
tooling/    启动、同步、端口和部署辅助脚本
docs/       项目使用说明、角色操作、部署配置和 SDK/API 接入
Plan/       研究设计、实施计划、Issue、发布验收与历史归档
```

应用之间不互相导入业务代码；跨端共享只通过 `packages/*`。浏览器只能提交 API 合同允许的输入，不能直接写项目状态、AI 决策、成长档案或审计日志。

## 本地运行

```bash
pnpm install

# 依赖数据库的完整服务启动；端口见 tooling/qitu-ports.env.example
QITU_DATA_MODE=live bash tooling/start-qitu-services.sh start
bash tooling/start-qitu-services.sh status

# 仅本地演示或测试，不能用于生产
QITU_DATA_MODE=test bash tooling/start-qitu-services.sh start
```

Graphiti 默认关闭。需要外部 Neo4j 时，按 [`docs/sdk/agent-memory.md`](./docs/sdk/agent-memory.md) 和 [`docs/admin/deployment.md`](./docs/admin/deployment.md) 配置，不能把投影结果当作权限、项目状态或掌握度真源。

## 验证

```bash
pnpm typecheck
pnpm test
pnpm build
pnpm check:basepath
```

Windows UNC 工作目录可能导致 pnpm shim 无法切换到固定 pnpm 版本；遇到这种环境问题要记录为验证阻塞，不能把未执行的测试表述为通过。

## 文档规则

- `docs/` 只存储项目使用说明；所有计划、研究、设计、Issue、发布及验收记录统一存放于根目录 `Plan/`。
- 公开产品叙事放在 `docs/aboutus/`；责任域合同放在 `docs/admin/`、`docs/student/`、`docs/teacher/`、`docs/parent/`、`docs/sdk/`。
- 新增接口、权限、错误码、迁移或异步流程时，同时更新对应责任域文档和验证说明。
- 功能落地后更新 `docs/` 中的实际操作说明；实施过程与验证结果写入 `Plan/`，维护两侧索引和链接。目录与链接检查：`python -B tooling/validate-docs.py`。
- 不提交 `.env`、API Key、Token、密码、OAuth 文件、私钥和未脱敏的未成年人原始数据。
