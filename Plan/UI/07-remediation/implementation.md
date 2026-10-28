# 实现范围与权限影响

本次针对审查问题修改已有页面、共享显示工具、认证恢复和聚合读模型。工作区同时存在运行时治理、画像成长、视觉素材与飞书接入等其他修改，开始状态见 [workspace-before.txt](workspace-before.txt)。共同文件只合并本次所需改动，没有重置、清理或提交整棵工作区。

## 主要实现入口

| 范围 | 入口 |
|---|---|
| 登录与安全返回 | `packages/auth/src/login-routing.ts`、`packages/auth/src/index.tsx`、`apps/auth-portal/app/login/page.tsx` |
| 演示限制 | API `identity-auth/auth.service.ts`、`directory/directory.service.ts` |
| 显示映射与日期 | `packages/contracts/src/display.ts` |
| 当前项目 | API `projects/current-project.ts`、生命周期列表、Tutor 上下文与 Today 数据源 |
| 教师、家长读模型 | API teacher、parent、growth 模块 |
| 学生体验 | Today、Profile、ProjectCard、Inspiration、TutorPage、useTutorViewport、MilestoneBlock、ChatBubble、光学预览 |
| 管理体验 | Copilot、设置目录、技能和工具矩阵、`settings-compact.css` |
| 公共展示 | 官网 CTA、章节控制、ScrollReveal、独立补充样式、共享状态组件 |
| 验证 | `tooling/ui-remediation.test.mjs`、API `projects/ui-read-model.test.ts`、管家能力测试、浏览器证据 JSON |

旧工作台职责同步写入 `docs/student/workbench.md`。最终类型检查暴露团队历史加载 prop 未接线，已连接既有 AgentHistory 组件。提醒接缝测试改用仓库已有的隔离教学上下文 fixture，保留正式冻结绑定校验。

## 后端权限、错误与日志

- 登录限制沿用统一 `INVALID_CREDENTIALS`，不泄露账号类型。正式环境中的保留演示身份无法获得或继续使用会话。
- 家长聚合先校验监护关系，再读取项目和 Works owner 授权投影。未绑定孩子返回 403，不读取其项目。教师范围限制为当前名下学生。
- 聚合依赖不可用返回 503；未接入指标有明确可用状态，不能被解释为真实零值。
- Admin 技能/工具保存沿用幂等 PATCH 和服务端回读。只提交 canonical skill ID；目录不可用或有未知绑定时阻止覆盖。部分失败保留已确认结果。
- 管家调用模型或配置写入前验证供应商、模型可用性与文本输入输出能力。服务端 owner 仍校验权限，UI 选择不授予权限。
- 既有异常过滤器、认证失败记录与 owner 审计保留。新增聚合读取不写项目、掌握度、成长事实，不记录学生原文。

## 数据与发布

本次 UI 修复不需要数据迁移。其他任务新增的迁移需要各自验收，不随本次 UI 验证自动获得批准。

生产只读核查发现一个管理员且属于演示身份。发布前先建立正式管理员，确认登录、对象权限和恢复方式，再部署认证限制。不能通过生产造数、注入掌握度或放宽门禁完成验收。

发布后复验四端登录回跳、当前项目投影、未知统计、Admin 回读与手机 Tutor，并记录版本和生产截图。当前截图证明本地行为。
