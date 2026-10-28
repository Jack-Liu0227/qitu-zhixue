# 从使用说明分离的计划与执行记录

> 状态：2026-10-28 文档分类整理。保留原文日期、已完成项、待办与验收边界；不代表本次重新验证或实施。

[计划总入口](../README.md) · [目录整理 Issue](../issues/20261028-document-layout.md)

## docs/admin/authentication.md — 6. 未决事项


使用说明：[当前文档](../../docs/admin/authentication.md)。

- [x] 单 API 实例会话持久化及重启恢复。

- [ ] 跨实例轮换和即时撤销。

- [ ] MFA、会话轮换与撤销。

- [ ] 跨角色账户面（凭证、设备会话、退出）。

## docs/admin/database.md — 7. 未决事项

使用说明：[当前文档](../../docs/admin/database.md)。

- [ ] 将 API 当前进程内 session store 接入持久化 `sessions` 轮换和跨实例撤销。
- [ ] 完成学校隔离的 RLS / `SET LOCAL` 验证，并保留对象级权限的应用层校验。
- [ ] 为 `knowledge_chunks.embedding` 选择并验证 pgvector 索引策略。
- [ ] 完成 Tutor 旧适配层与领域真源的双写迁移计划，再删除兼容表。
- [ ] 完善数据保留、删除和未成年人敏感访问审批流程。

## docs/admin/directory-and-relationships.md — 6. 未决事项

使用说明：[当前文档](../../docs/admin/directory-and-relationships.md)。

- [ ] `roles` / `identities` / `sessions` / `consents` / `student_profiles` / `mentor_profiles` 正式结构与迁移。
- [ ] `student_profiles.school_id` 落表。
- [ ] 行级安全（RLS）/ `SET LOCAL` 会话变量与跨校写入强制校验。
- [ ] 数据保留与删除 / 匿名化策略。

## docs/admin/initialization.md — 8. 未决事项

使用说明：[当前文档](../../docs/admin/initialization.md)。

- [ ] 完成 live 用户邀请、密码轮换、MFA 和持久化 session 撤销。
- [ ] 为初始化任务补充可观测性、重试窗口和管理员审计查询。
- [ ] 建立生产数据保留、删除和恢复演练记录。

## docs/admin/knowledge-center.md — 账号与连接编辑发布回执

使用说明：[当前文档](../../docs/admin/knowledge-center.md)。

2026-10-23 16:57（Asia/Shanghai），`970ef40567cd218873cad0a38352d384210795b1` 已合入 `study-remote/main` 并在正式目录发布，Admin build ID 为 `0xaG8eb2Wclpn6Lqm0b83`。远端按 API/Admin 依赖图构建，API 全量类型编译、知识模块 106 项测试、Admin typecheck、双方 lint 与生产构建全部通过。

- 已发布页面使用隔离合成 API 通过 12 项账号/连接检查及 27 项文件工作区回归，浏览器异常为 0。全部配置写入均由浏览器拦截，不修改真实账号或知识库；此结果不代表真实外部账号的连接验收。
- 静态资源检查通过，匿名连接编辑 API 返回 401，API readiness 为 live/ready，database、redis 为 ok。Admin PID `2269676 → 2277765`，API PID `2259330 → 2277389`，其余八个受检服务 PID 未变化；没有数据库迁移。
- 合并前后已有远端修改与脚本 SHA-256 一致，构建过程中相关源码哈希无变化。备份 `/root/qitu-backups/knowledge-connections-20261023T085417Z/` 保存旧 Admin `.next`、API `dist`、构建/测试日志、服务与源码快照、浏览器脚本和验收结果。
- 本地并行课件、课时绑定、Tutor、知识检索及其合同/数据库修改均未纳入本次提交；`knowledge.module.ts`、`knowledge-retrieval.service.ts`、知识中心 `page.tsx` 等并行文件未覆盖。本次发布保留远端已有 Admin/学生页面修改；这些工作独立于本次知识连接验收。

## docs/admin/knowledge-center.md — 统一面板发布回执

使用说明：[当前文档](../../docs/admin/knowledge-center.md)。

2026-10-23 16:31（Asia/Shanghai），`eb67b1db8449c549dd844db0b35b3ea250b171af` 已合入 `study-remote/main`，正式目录 `/root/qitu-zhixue` 的 Admin build ID 为 `96EhqhJO3TqL4PcLvqO28`。Linux 依赖图构建、Admin typecheck、lint 和生产 build 全部通过，构建期间源码哈希无变化。

- 已发布页面配合隔离合成 API 通过 27 项交互检查，浏览器异常为 0；PDF 翻页额外确认画布像素变化。认证、教材和 11 次写入均为测试拦截响应，不代表真实管理员账号及真实云端原文验收。
- `/admin/settings/knowledge` 的 14 个 CSS/JS 引用和 `/admin/login` 的 11 个引用通过检查；匿名知识库 API 为 401，API readiness 为 live/ready，database、redis 均为 ok。
- 只重建并启动 `qitu-admin`，PID `2259259 → 2269676`；API、官网/认证、学生、家长、教师、IMA MCP、embedding、workers、profile-growth 的 PID 未变化。未执行数据库迁移或生产知识库写操作。
- 远端已有未提交改动，因此先推送临时分支，再快进合入 main；未使用 reset、stash 或覆盖同步。独立校验合并前后既有修改及未跟踪脚本的 SHA-256，一致。原运行产物、构建日志、源码快照、服务快照和浏览器脚本/结果保存在 `/root/qitu-backups/knowledge-workspace-20261023T083009Z/`。

并行修改未纳入本次提交：Admin 的 `settings/assistants/page.tsx`、`settings/teams/page.tsx`、`settings/templates/page.tsx`、`TemplateTeamBindingPanel.tsx`、`teaching-binding/TeachingRoleInspector.tsx`；学生端的 `TutorPage.tsx`、`LessonAssessmentCard.tsx`、`LessonLearningDock.tsx`；`Plan/codex/README.md`、课程团队方案的 `05`、`06`、`07` 和 `README.md`，以及 `Plan/student/template-session-openings-plan.md`、`docs/student/tutor.md`、`doc/e2e-dual-template-testing-v1.1.md`。本次只验证其内容被保留及 Admin 构建兼容，不将知识中心交互测试作为这些功能的验收。

## docs/admin/knowledge-center.md — 发布回执

使用说明：[当前文档](../../docs/admin/knowledge-center.md)。

2026-10-23 按用户要求同步至 `study-remote` 的 `main`，正式目录 `/root/qitu-zhixue`。Admin 运行构建包含 `06ad5df7f139da47bf5ad9c24f66e63980707dce`，Next build ID 为 `iBYLpIVv7O8smkABNac1x`。

- Linux 按依赖图构建 Admin 依赖，Admin typecheck、lint、生产 build 通过；先停止 `qitu-admin` 再构建，启动后为 active。
- 线上 `/admin/settings/knowledge` 的 14 个 CSS/JS 引用、`/admin/login` 的 11 个引用通过检查。匿名知识库 API 返回 401；API readiness 为 live/ready，database 和 redis 均为 ok。
- 已发布页面配合隔离合成 API，再次通过上述 16 项浏览器检查，页面异常为 0。生产 HTML、JavaScript、CSS 和 PDF worker/font 资源均实际加载；认证与教材内容是测试拦截响应，不代表真实管理员登录或云端原文验收。
- 只重建并启动 Admin。API、官网/认证、学生、家长、教师、IMA MCP、embedding、workers、profile-growth 的服务 PID 未变化；没有数据库迁移或知识库/助手授权写操作。
- 旧 Admin `.next`、发布日志、服务前后 PID 和浏览器回执保存在 `/root/qitu-backups/knowledge-files-20261023T074118Z/`。远程未跟踪的测试脚本及本地并行编辑的助手/团队/教学文档未纳入本次提交；并行修改的 `test_bindings.mjs` 保持其当前版本，没有用备份覆盖。

## docs/admin/knowledge-center.md — 历史回执

使用说明：[当前文档](../../docs/admin/knowledge-center.md)。

验收：知识模块 89 项测试、适配运行时 14 项测试通过，API 与管理员端 lint/typecheck/build 通过；真实 ima 四库列举、连接预检、隔离数据库关联及目录读取通过，桌面/390px 移动端和请求状态竞态检查通过。正式环境仅进行只读列库与预检，不创建验收库或改动现有助手绑定。


## docs/admin/knowledge-connection-checks-20261022.md — 发布回执


使用说明：[当前文档](../../docs/admin/knowledge-connection-checks-20261022.md)。

2026-10-22 已推送 `study-remote` 并在 `/root/qitu-zhixue` 发布包含 `198db3b` 的 Admin 构建。原远程 `ccbda5d` 及其教学、夜间模式和移动端提交全部保留。本地原始 UNC 工作区的未提交改动未参与提交或覆盖。



- Windows 和 Linux 的分类/范围测试均为 3 通过、0 失败；Linux 的 contracts 构建、Admin 类型检查、lint 和生产构建均通过。

- 实际线上前端构建配合合成 API 的浏览器验证为 14 通过、0 页面异常，含内部设置容器的横向溢出检查。视觉复核发现矩阵最小宽度撑开外层网格，已用知识中心单列网格约束修复，并重新构建发布与复测。

- `qitu-admin` 重启后为 active；API readiness 为 live/ready，数据库与 Redis 为 ok。匿名连接检查 POST 返回 401。

- API、Auth、Student、Parent、Teacher、IMA MCP 和本地 embedding 的服务 PID 均未因本次部署变化。只替换 Admin 构建，不迁移数据库，不修改 API 运行产物。

- 浏览器会话及所有诊断返回均为合成 fixture。未使用生产管理员会话执行真实连接检测，未为验收修改生产认证、逐库状态、助手绑定或教学事实。3 项测试验证诊断分类，真实认证状态须由管理员点击按钮后读取服务端回执。

- 没有改动 API，本次未重跑 API 全量测试；上一轮矩阵发布的既有基线失败不在本次修复范围内。



[截图与机器回执](../UI/knowledge-connection-checks-20261022/README.md)。Linux 构建日志位于 `/root/qitu-knowledge-batch-verify/.verification/`，最终部署备份位于 `/root/qitu-backups/knowledge-connection-checks-final-20261022T141331Z/`。保留旧 `.next` 与其他服务 PID 前后记录，可恢复 Admin 产物而不回滚源码或其他服务。

## docs/admin/model-registry.md — 7. 安全与未决事项


使用说明：[当前文档](../../docs/admin/model-registry.md)。

- live 模式使用 `QITU_MODEL_SECRET_KEY` 加密保存 API Key，只对外返回 configured 状态和指纹。

- Provider、Model、Agent 和测试操作写入审计；日志不得包含 API Key、原始模型响应或未脱敏学生对话。

- 删除或停用前检查 Agent 直接引用和旧兼容绑定，避免运行时出现悬空模型。

- [ ] 增加批量 Provider 健康检查和模型目录差异报告。

- [ ] 将旧 `model_usage_bindings` 迁移完成后删除兼容读取入口。

## docs/admin/permissions.md — 10. 未决事项


使用说明：[当前文档](../../docs/admin/permissions.md)。

- [x] 审计写入与查询接口已实现（敏感读查询在 live 模式要求数据库可用）。

- [ ] `support` 角色的具体授权范围未定。

- [ ] MFA、会话轮换与撤销（当前会话在进程内，过期即失效）尚未实现。

- [ ] AI 搭档会话的**对象级归属校验**（当前只校验 `student` 角色）。

- [ ] 原始对话 / 语音的敏感访问审批流程。

- [ ] 数据保留与删除策略落表。

- [ ] 管理员个别学生访问的范围 / 原因 / 二次确认 / 限时授权模型。

- [ ] 跨角色账户面（凭证、MFA、设备会话、退出）。

## docs/admin/public-site.md — 6. 未决事项


使用说明：[当前文档](../../docs/admin/public-site.md)。

- [x] 咨询线索的 Admin 受控跟进与审计，入口为现有运维页。

- [ ] 咨询线索导出与到期清理策略。

- [x] 提供经营主体、隐私政策、未成年人数据说明和备案信息的配置与展厅公示；正式文案及资质由经营者核实。

- [ ] 对公开作品和模板建立人工审核及撤回流程。



2026-10-26：展厅加入由服务端返回的项目包与条款，购买入口指向家长登录。按用户后续要求移除邀请制，首页和登录页提供 `/login?mode=register` 自助注册。`GET/POST /public/account-registration` 分别读取说明和创建个人账号；每次仅创建一个学生或家长账号，不接受特权角色、家庭联合注册字段或已有用户 ID。保留当前导航，注册表单覆盖说明加载、失败重试、断网禁写和注册后对应身份登录引导。详见[一人运营工作区](../../docs/admin/business-operations.md)。

## docs/admin/test-login.md — 历史回执

使用说明：[当前文档](../../docs/admin/test-login.md)。

2026-10-21 已部署 `3f9f995` 并启用远程四个既有测试身份，原密码未更改。四角色公网实际登录与会话校验全部通过，六个正式服务 active。验收记录与脱敏截图见 [Plan/UI/09-test-login](../UI/09-test-login/README.md)。这取代前次发布中“缺少正式管理员而无法测试后台”的限制；当前可以使用管理员测试账号继续测试。


## docs/admin/tool-bindings-migration.md — 历史回执

使用说明：[当前文档](../../docs/admin/tool-bindings-migration.md)。

2026-10-21 已部署 `b912456` 并通过 owner API 迁移远程 5 个助手的 9 项占位绑定，未登记工具回读为 0；审计、幂等重放和原有权限保留均已核验。IMA 实际连接/列库探测成功，发现四个只读工具。截图与机器回执见 [Plan/UI/10-tools-migration](../UI/10-tools-migration/README.md)。


## docs/parent/export.md — 5. 未决事项

使用说明：[当前文档](../../docs/parent/export.md)。

- [ ] 导出格式（PDF / Markdown / 结构化数据）与字段清单。
- [ ] 签名 URL 有效期与下载次数限制。
- [ ] 导出记录的保留与删除策略。
- [ ] 是否需要二次确认 / 水印。

## docs/parent/home.md — 7. 未决事项


使用说明：[当前文档](../../docs/parent/home.md)。

- [x] 家长可创建个人账号；注册不创建孩子或建立监护关系。未绑定时提供平台核验指引，现有账号与关系保留，不允许通过注册接管已有学生。

- [x] 首页项目包、开通步骤、订单、支付查询与退款申请。

- [ ] 多孩子切换体验。



2026-10-26 首页加入独立课程订单区，按当前孩子使用 request identity 和 abort 防止旧请求覆盖。家长须阅读当前条款并明确确认授权，支付及退款均以服务端回执为准。付款不代替孩子确认项目。详见[商业交付合同](../../docs/admin/business-operations.md)。

## docs/parent/messages.md — 5. 未决事项

使用说明：[当前文档](../../docs/parent/messages.md)。

- [ ] 通知渠道（站内 / 邮件 / 其他）与偏好设置。
- [ ] 消息模板与班主任发送入口。
- [ ] 工单 SLA 与升级规则。

## docs/parent/progress.md — 5. 未决事项


使用说明：[当前文档](../../docs/parent/progress.md)。

- [ ] 孩子「自述 / 反思」对家长是否全量可见（G2）。

- [ ] 成长档案三角色投影矩阵中家长列的正式批准（G4）。

- [ ] 退步 / 风险信号是否向家长展示（建议不展示）。

## docs/sdk/agent-memory.md — 7. 分阶段实施

使用说明：[当前文档](../../docs/sdk/agent-memory.md)。

| 顺序 | 交付 | 验证门 |
|---|---|---|
| 1 | 评审并统一架构文档；冻结 Partner / Memory / Context 合同 | 与冻结产品规则一致；合同可编译 |
| 2 | 知识准入统一、成长幂等修复、关系记忆数据模型 | null scope、跨学生、跨 Partner、重复事件测试 |
| 3 | 可靠 Outbox 消费者及 Mem0 小型准入试点 | 真 pgvector round-trip、原生依赖、模型出口、异常重试 |
| 4 | 候选抽取、批准、纠错 / 删除、关系与程序性记忆接线 | 无来源拒绝、可撤销、索引失效不可回读 |
| 5 | 灰度发布和比较验证 | 中文召回、误记忆、隐私、延迟 / 成本通过 |

拟新增 `services/api/src/modules/agent-memory/`；纯合同留共享 packages，
Mem0 第三方依赖放服务端 adapter / Worker，不进入学生端或纯教学函数包。

## docs/sdk/agent-memory.md — 9. 未决事项

使用说明：[当前文档](../../docs/sdk/agent-memory.md)。

- [ ] Mem0 `better-sqlite3` 原生依赖与 Node/OS/打包兼容性验证。
- [ ] pgvector 独立 schema / 数据库权限与命名空间；中文分词与召回基准。
- [ ] embedding port 与用途绑定、计费。
- [ ] 程序性记忆发布权限、学生查看 / 纠错入口、保留周期。
- [ ] 真实 pgvector round-trip、部署、权限回归、独立安全审计。

## docs/sdk/agent-runtime.md — 5. 未决事项


使用说明：[当前文档](../../docs/sdk/agent-runtime.md)。

- [ ] 真实 runtime resolver、capability 配置持久化。

- [ ] tool execution owner。

- [ ] 候选投影的领域 owner 接受、审核和正式写入流程。

- [ ] 把 Tutor provider executor 接入新 runtime。

## docs/student/growth.md — 6. 未决事项


使用说明：[当前文档](../../docs/student/growth.md)。

- [ ] 掌握度时间线的学生 / 家长 / 班主任字段投影矩阵（最高风险：学生行）。

- [ ] 孩子「自述 / 反思」对家长是否全量可见。

- [ ] 是否向学生展示风险信号（卡顿 / 情绪挫败 / 已升级班主任）——建议不可见。

- [ ] `level` 连续值 vs 离散等级；不同 `knowledgeType` 是否允许不同标尺。

- [ ] 快照生成频率、保留周期和删除策略。

- [ ] Graphiti 选 Neo4j / FalkorDB，以及是否允许外部 LLM / embedding。

- [ ] `KnowledgePoint` 独立表 vs 知识库 verified 文档结构化节点。

- [ ] 「AI 总结与建议」（RAG / `growth.summarize` 用途）接入方式。

- [ ] 六项导航在窄屏下的视觉验证。

## docs/student/inspiration.md — 6. 未决事项


使用说明：[当前文档](../../docs/student/inspiration.md)。

- [ ] 推荐算法、推荐理由生成用途与刷新策略。

- [ ] 品牌名「启途智学」vs 侧边栏「AI创造空间」的统一（`PRODUCT_NAME` 常量）。

- 推荐项目确认后进入 AI搭档，失败保留可恢复的探索记录；不以浏览器本地记录代替服务端确认。

## docs/student/projects.md — 7. 未决事项


使用说明：[当前文档](../../docs/student/projects.md)。

- [x] 正式项目的「进行中 / 已完成」与探索记录分开显示；兼容查询分类键不作为权限依据。

- [ ] 项目创建唯一路径：是否删除 `POST /api/v1/projects`，只留 `confirm-intent`。

- [ ] 列表标签语义与排序（最近活跃 vs 创建时间）。

## docs/student/today.md — 5. 未决事项


使用说明：[当前文档](../../docs/student/today.md)。

- [ ] 问候横幅姓名来源 `GET /api/v1/students/me` 的落地与缓存策略。

- [ ] 「AI搭档建议」的生成用途（`tutor.chat` / 专用建议用途）与刷新节奏。

- [ ] 「从一个想法开始」方向卡的数据源与推荐算法。

## docs/student/tutor.md — 7. 未决事项


使用说明：[当前文档](../../docs/student/tutor.md)。

- [ ] 上游原生 token 流与取消语义：当前 live 已使用生产 `ModelGateway.complete` 获取真实回复，再由服务端分块发出 SSE，不代表上游逐 token 流式已完成。

- [ ] 完善卡顿自动检测和教师干预建议的阈值验证。

- [ ] 将会话摘要接入明确的数据保留和学生可见范围策略。

## docs/student/workbench.md — 5. 未决事项


使用说明：[当前文档](../../docs/student/workbench.md)。

- [ ] 断网时是否允许编辑（建议：只读 + 本地暂存）。

- [ ] `preview` 同步返回还是异步轮询。

- [ ] 画布技术选型（自研只读渲染 + 简单拖拽 vs React Flow）。

- [ ] 离线草稿写入 `localStorage` 的未成年人数据合规确认。

## docs/student/works.md — 6. 未决事项


使用说明：[当前文档](../../docs/student/works.md)。

- [ ] 作品详情独立路由（`/works/[artifactId]`）与反思编辑接线。

- [ ] 「评论」是否开放给同学（未成年人社交面）。

- [ ] 展厅是否只展示已发布作品（与「我的项目」语义重叠）。

- [ ] 浏览计数的近似口径。

## docs/teacher/issues.md — 5. 未决事项


使用说明：[当前文档](../../docs/teacher/issues.md)。

- [ ] 「卡顿已正确升级」的可观测验收口径（G3）。

- [ ] 自动问题记录的频控与脱敏。

- [ ] 系统问题状态的来源与只读时间线口径。

- [ ] 反馈工单与学生端 / 家长端 `feedback` 的关联。

## docs/teacher/knowledge.md — 3. 未决事项

使用说明：[当前文档](../../docs/teacher/knowledge.md)。

- [ ] 是否为学生端 / 班主任端提供知识库浏览（需先改产品文档）。
- [ ] 知识文档的验证工作流与发布权限。
- [ ] pgvector 维度 / 索引（HNSW / IVFFlat）与中文召回验证。
- [ ] `KnowledgePoint`（canonical 知识点）与知识文档的映射（见 growth §3）。

## docs/teacher/statistics.md — 5. 未决事项

使用说明：[当前文档](../../docs/teacher/statistics.md)。

- [ ] 统计指标清单与口径（活跃定义、完成口径）。
- [ ] 时间窗口（周 / 月 / 自定义）。
- [ ] 是否导出。

## docs/teacher/students.md — 6. 未决事项


使用说明：[当前文档](../../docs/teacher/students.md)。

- [ ] 掌握度安全投影对学生详情页的字段范围。

- [ ] 干预动作的完整语汇与幂等范围。

- [ ] 反馈工单与 `feedback` 模块的合并 / 归属。

## docs/admin/copilot-catalog.md — 历史回执

2026-10-19 已随 `63e3be8` 上线，并完成真实目录及浏览器响应 fixture 验证，结果与范围见 [发布记录](../../Plan/releases/release-20261019-main.md)。

## docs/admin/mcp-json-tree.md — 验证回执

- API 完整测试：764 通过；目录权限、真实 schema、缓存与分页专项测试：8 通过。
- API/admin lint、admin typecheck、API/admin 生产构建通过。
- 候选地址浏览器：25 项通过，覆盖真实管理员登录、学生 403、匿名 401、未知目标 404、ima 四个真实 schema、项目工具 schema、修订保存、草稿保护、只读预览、新引擎草稿、刷新失败保留定义及 1440/768/390 宽度。
- 正式部署后的验收记录另附发布说明；不以候选验收代替正式验收。


## docs/admin/optics-16-session-template.md — 历史回执

> Release update (2026-10-19 21:39:47 +08:00): `63e3be8` is deployed, main is synchronized, and migration 0036 is applied. Earlier offline-only statements below describe the pre-release round. Full teaching acceptance and 16-session bootstrap activation are still not complete. [Release evidence](../../Plan/releases/release-20261019-main.md).

## docs/admin/optics-16-session-template.md — 历史回执

> 状态：2026-10-19，源码与隔离测试实现；未执行生产数据库迁移、模板初始化、绑定激活或部署。Admin 现有阶段编辑器尚不是逐课时编辑器。
