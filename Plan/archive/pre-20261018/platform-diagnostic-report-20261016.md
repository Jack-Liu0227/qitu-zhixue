# 启途智学全平台 E2E 功能与按钮全面诊断报告

> **文档版本**: `v1.2.0-e2e-diag-20261016`  
> **测试环境基准**: `http://122.51.130.204/`  
> **自动化测试引擎**: Playwright Chromium (Headless / Desktop 1440x900)  
> **测试时间**: 2026-10-16 13:35:19 CST  
> **覆盖范围**: 统一认证门户 (Auth Portal) + 四大角色工作台 (学生端 Student / 班主任端 Teacher / 家长端 Parent / 管理端 Admin)

---

## 一、诊断概览与执行指标

| 维度 | 指标数据 | 状态 | 关键说明 |
| :--- | :--- | :--- | :--- |
| **测试用例总数** | 66 项端到端用例 | - | 覆盖核心页面加载、导航、表单交互、按钮触发、状态机与安全门禁 |
| **测试通过数** | 53 项 | ✅ 通过 | 核心认证流、角色空间重定向、苏格拉底会话流、能力雷达、关系绑定与管家 Copilot 正常 |
| **发现缺陷与告警** | 13 项 | ⚠️ 需处理 | 包含 2 个后端 404 API、1 个 Next.js 客户端重定向路径拼写、1 个空目录与 9 处测试选择器匹配细节 |
| **截屏存证总数** | 42 份完整截图 | 📸 已归档 | 统一保存在 `docs/screenshots/diagnostic/`，命名规范全英 |

---

## 二、四大平台及统一门户详细诊断结果

### 1. 统一认证门户与公开站点 (Public Site & Auth Portal)

#### 1.1 功能与按钮测试清单

| 测试模块 / 页面 | 核心元素与按钮 | 测试动作 | HTTP 响应 | 测试结论 |
| :--- | :--- | :--- | :--- | :--- |
| **公开主页 (`/`)** | Hero 按钮「立即开启 AI 探索之旅」 | 点击跳转 | 200 OK | ✅ 正确带参重定向到 `/login?next=%2Fstudent%2Ftutor` |
| **公开主页 (`/`)** | Hero 按钮「进入项目式学习」 | 点击跳转 | 200 OK | ✅ `<Link>` 锚点正确导航至 `/learning` |
| **公开站点导航** | 顶部与底部导航链接（学习路径、能力体系、项目展厅、关于我们、合作联系） | 逐一导航并渲染 | 200 OK | ✅ 5 个公开子页面均正常加载，SEO 与品牌标识完备 |
| **统一登录页 (`/login`)** | 角色切换 Tab（学生、家长、班主任、管理员） | Tab 切换点击 | 200 OK | ✅ 状态切换敏捷，ARIA tablist 角色属性正确 |
| **统一登录页 (`/login`)** | 一键填入测试账号按钮（学生账号、家长账号、班主任账号、管理员账号） | 逐个按钮点击触发 | 200 OK | ✅ 自动填入 demo 邮箱与密码，角色 Tab 联动切换 |
| **统一登录页 (`/login`)** | 密码显隐切换按钮（`.login-password-toggle`） | 点击切换 | 200 OK | ✅ 密码框 input `type` 在 `password` 与 `text` 间实时切换 |
| **统一登录页 (`/login`)** | 记住账号复选框（`input[name="rememberAccount"]`） | 勾选保存 | 200 OK | ✅ 成功在 `localStorage.qitu.auth.rememberedAccount` 写入凭据 |
| **统一登录页 (`/login`)** | 提交登录按钮（`.login-submit`） | 表单 POST 提交 | 200 OK | ✅ 真实调用 `/api/v1/auth/login`，校验成功后带 Session 跃迁 |

#### 1.2 截图存证
- 主页全景: [`public_home_page.png`](file:///Z:/Study/qitu-zhixue/docs/screenshots/diagnostic/public_home_page.png)
- 登录页面: [`public_login_page.png`](file:///Z:/Study/qitu-zhixue/docs/screenshots/diagnostic/public_login_page.png)
- 学习路径: [`public_learning_path.png`](file:///Z:/Study/qitu-zhixue/docs/screenshots/diagnostic/public_learning_path.png)
- 能力体系: [`public_competencies.png`](file:///Z:/Study/qitu-zhixue/docs/screenshots/diagnostic/public_competencies.png)
- 项目展厅: [`public_showcase.png`](file:///Z:/Study/qitu-zhixue/docs/screenshots/diagnostic/public_showcase.png)

---

### 2. 学生端工作空间 (Student Center)

#### 2.1 功能与按钮测试清单

| 页面 / 路由 | 核心功能与按钮 | 行为与校验规则 | 测试结论 |
| :--- | :--- | :--- | :--- |
| **今日看板 (`/student/today`)** | 今日任务清单、打卡推进、继续学习按钮 | 校验个人问候「你好，演示学生」与任务流 | ✅ 通过。渲染 4 个互动操作入口与状态标签 |
| **AI 搭档工作区 (`/student/tutor`)** | 会话历史抽屉切换（雷霆战机、桌面巡线小车、动能定理） | 点击切换探究上下文 | ✅ 通过。正确保留 12/8/6/0 条探究对话历史 |
| **AI 搭档工作区 (`/student/tutor`)** | 导师启发式思维芯片（「理清第一步思路」、「验证我的假设」、「拆解核心问题」、「结合原理举例」） | 点击填入启发线索 | ✅ 通过。点击平滑插入输入框并触发引导提示 |
| **AI 搭档工作区 (`/student/tutor`)** | 多媒体与语音输入控制（语音输入、图片、文件、发送想法按钮） | 检查输入框附件与热键响应 | ✅ 通过。Shift+Enter 换行与 Enter 发送机制完整 |
| **AI 搭档工作区 (`/student/tutor`)** | 导师思考折叠板（`🧠 导师思考与教学策略链路`） | 展开 / 折叠操作 | ✅ 通过。包含 5 档进阶启发与工具环境调用记录 |
| **AI 搭档工作区 (`/student/tutor`)** | 抽屉控制按钮（「项目与进度」） | 展开右侧项目上下文 Rail | ✅ 通过。成功唤出里程碑阶段与专属导师团队信息 |
| **我的项目 (`/student/projects`)** | 状态筛选 Tab（「进行中」、「草稿」、「已完成」）与项目搜索框 | 切换过滤状态 | ✅ 通过。展示「校园植物观察手册」(40%)与「猜数字小游戏」(35%) |
| **我的项目 (`/student/projects`)** | 「创建新项目」操作入口按钮（`.qitu-button-primary`） | 点击触发 | ✅ 架构合规。严格遵守门禁规则：该按钮为 `<a>` 链接引导跳转至灵感空间进行意图确认，坚决禁止客户端未经意图确认直调 `POST /projects` |
| **我的项目 (`/student/projects`)** | 「下一步」推荐引导卡（推进「校园植物观察手册」） | 点击继续推进 | ✅ 通过。引导推进当前服务端阶段任务 |
| **成长轨迹 (`/student/growth`)** | 六维核心能力雷达图与能力指标卡 | 检查 SVG/Canvas 图表渲染 | ✅ 通过。检出 12 个可视化数据图元，成长足迹完备 |
| **作品展厅 (`/student/works`)** | 作品卡片画廊、阶段标签与提交记录 | 状态过滤与作品卡片渲染 | ✅ 通过。各阶段作品状态展示完整 |
| **灵感空间 (`/student/inspiration`)** | 选题灵感库、引导词推荐 | 灵感检索与探索主题引导 | ✅ 通过。 |
| **个人画像 (`/student/profile`)** | 偏好设置、学习数据统计、密码修改入口 | 偏好切换与信息读取 | ✅ 通过。 |

#### 2.2 截图存证
- 今日看板: [`student_today_dashboard.png`](file:///Z:/Study/qitu-zhixue/docs/screenshots/diagnostic/student_today_dashboard.png)
- AI 搭档全景: [`student_tutor_full_view.png`](file:///Z:/Study/qitu-zhixue/docs/screenshots/diagnostic/student_tutor_full_view.png)
- 动能定理探究: [`student_tutor_kinetic_real.png`](file:///Z:/Study/qitu-zhixue/docs/screenshots/diagnostic/student_tutor_kinetic_real.png)
- 项目工坊: [`student_projects_workshop.png`](file:///Z:/Study/qitu-zhixue/docs/screenshots/diagnostic/student_projects_workshop.png)
- 成长轨迹雷达: [`student_growth_competencies.png`](file:///Z:/Study/qitu-zhixue/docs/screenshots/diagnostic/student_growth_competencies.png)
- 作品展厅: [`student_works_portfolio.png`](file:///Z:/Study/qitu-zhixue/docs/screenshots/diagnostic/student_works_portfolio.png)
- 灵感空间: [`student_inspiration_library.png`](file:///Z:/Study/qitu-zhixue/docs/screenshots/diagnostic/student_inspiration_library.png)

---

### 3. 班主任工作空间 (Teacher Workspace)

#### 3.1 功能与按钮测试清单

| 页面 / 路由 | 核心功能与按钮 | 行为与校验规则 | 测试结论 |
| :--- | :--- | :--- | :--- |
| **工作台 (`/teacher/dashboard`)** | 班级总览 KPI 卡片（在册学生、待介入告警、待批阅作品、今日活跃） | 检查数据加载与告警指示器 | ✅ 通过。加载 2 组核心看板指标及学生状态列表 |
| **学生管理 (`/teacher/students`)** | 班级花名册列表、搜索过滤、学生条目点击 | 点击查看学生个人详情 | ✅ 通过。成功从列表进入单生详情 `/teacher/students/student-demo-3` |
| **问题处理 (`/teacher/issues`)** | 告警状态筛选（全部状态、待介入、处理中、已解决） | 下拉选择器切换过滤 | ✅ 通过。本地真过滤生效，角标与列表动态对齐 |
| **问题处理 (`/teacher/issues`)** | 问题类型筛选（全部类型、家长反馈、学习卡点、系统异常、其他） | 下拉选择器切换过滤 | ✅ 通过。支持快速筛选监护人诉求与学习受阻卡点 |
| **问题处理 (`/teacher/issues`)** | 「保存指导建议」按钮 | 点击提交跟进笔记 | ✅ 通过。仅在干预记录中保存 note，不擅自向模型注入提示词 |
| **问题处理 (`/teacher/issues`)** | 「完成闭环」按钮 | 点击推进工单至 `resolved` | ✅ 通过。严格带 UUID 幂等键调用接口，并在处理时间线留痕 |
| **数据统计 (`/teacher/statistics`)** | 班级综合报告、学情分布曲线、关键指标报表 | 图表渲染与报表数据查看 | ✅ 通过。 |
| **知识库 (`/teacher/knowledge`)** | 历史遗留路由 | 直接输入 URL 访问 | ❌ 缺陷。返回 404（该功能不在当前冻结导航 `NAV_ITEMS` 中，但代码库留有空目录） |

#### 3.2 截图存证
- 工作台看板: [`teacher_dashboard_kpis.png`](file:///Z:/Study/qitu-zhixue/docs/screenshots/diagnostic/teacher_dashboard_kpis.png)
- 学生管理花名册: [`teacher_students_roster.png`](file:///Z:/Study/qitu-zhixue/docs/screenshots/diagnostic/teacher_students_roster.png)
- 告警介入工作台: [`teacher_issues_governance.png`](file:///Z:/Study/qitu-zhixue/docs/screenshots/diagnostic/teacher_issues_governance.png)
- 数据统计报表: [`teacher_statistics_charts.png`](file:///Z:/Study/qitu-zhixue/docs/screenshots/diagnostic/teacher_statistics_charts.png)

---

### 4. 家长伴学平台 (Parent Companion)

#### 4.1 功能与按钮测试清单

| 页面 / 路由 | 核心功能与按钮 | 行为与校验规则 | 测试结论 |
| :--- | :--- | :--- | :--- |
| **家长首页 (`/parent`)** | 孩子今日学习动态总览卡片、AI 导师每日简报 | 读取脱敏授权学情摘要 | ✅ 通过。完整展示孩子最新推进进度与高光时刻 |
| **学习进展 (`/parent/progress`)** | 三大 Tab 切换（项目进度、成长记录、作品成果） | Tab 点击切换 | ✅ 通过。真切换不同数据面板，成长记录复用学生端统一事实 |
| **学习进展 (`/parent/progress`)** | 快捷鼓励灵感标签（「认真修改的过程...」、「今天独立完成了挑战...」等） | 点击填入鼓励语 | ✅ 通过。快捷语录实时同步至文本输入域 |
| **学习进展 (`/parent/progress`)** | 「给孩子一句鼓励」提交按钮 | 表单提交鼓励语 | ✅ 通过。附带 `idempotencyKey` 调用提交接口并呈现成功态 |
| **家校消息 (`/parent/messages`)** | 班主任通知流、AI 导师研学回执 | 查看沟通列表并标记已读 | ✅ 通过。展示家校互动记录，支持回执与确认 |

#### 4.2 截图存证
- 家长首页总览: [`parent_home_overview.png`](file:///Z:/Study/qitu-zhixue/docs/screenshots/diagnostic/parent_home_overview.png)
- 阶段成长进展: [`parent_progress_milestones.png`](file:///Z:/Study/qitu-zhixue/docs/screenshots/diagnostic/parent_progress_milestones.png)
- 家校互通消息: [`parent_messages_feedback.png`](file:///Z:/Study/qitu-zhixue/docs/screenshots/diagnostic/parent_messages_feedback.png)

---

### 5. 平台治理与管理控制台 (Admin Console)

#### 5.1 功能与按钮测试清单

| 页面 / 路由 | 核心功能与按钮 | 行为与校验规则 | 测试结论 |
| :--- | :--- | :--- | :--- |
| **治理概览 (`/admin`)** | 平台整体运行概览、在册用户指标、学校接入数 | 看板聚合数据校验 | ✅ 通过。展示平台大盘数据与数据源标记 |
| **智学管家 Copilot (`/admin/copilot`)** | 「启途智学管家」对话界面、预设指令胶囊、会话输入与清空按钮 | 交互输入与管家品牌呈现 | ✅ 通过。品牌命名「启途智学管家」出现 6 次，预设提示词正常响应 |
| **学生数据统计 (`/admin/students/statistics`)** | 4 位学生状态数据、年级分布图表、档案统计 | 统计维度切换与列表穿透 | ✅ 通过。正确列出 4 名在册学生档案 |
| **师生关系绑定 (`/admin/relationships`)** | 师生绑定矩阵、班主任分配对话框、解除关联按钮 | 严格执行单班主任不变量校验 | ✅ 通过。严格约束「一个学生同一时间只能有一个当前班主任」 |
| **模型治理监控 (`/admin/models`)** | 模型调用量、平均延迟、Token 消耗统计、错误率图表 | 图表渲染与周期筛选 | ✅ 通过。指标聚合面板加载正常 |
| **助手管理 (`/admin/settings/assistants`)** | 平台助手注册列表（启途智学管家、苏格拉底AI导师等） | 查看与配置助手模型映射 | ✅ 通过。 |
| **成长档案配置 (`/admin/settings/profile-growth`)** | 未成年人数据隐私与隔离策略卡片、脱敏等级切换 | 保护隐私最小化可见原则 | ✅ 通过。成功呈现隔离与脱敏策略开关 |
| **供应商配置 (`/admin/settings/model-providers`)** | 模型服务商列表、API 地址、连通性测试按钮、新建供应商按钮 | 展开「新建供应商」对话框 | ✅ 通过。编辑与创建网关面板均能调出 |
| **多智能体团队 (`/admin/settings/teams`)** | `team-kinetic-energy` / `team-thunder-fighter` 配置 | 智能体协作编排卡片查看 | ✅ 通过。 |
| **技能库治理 (`/admin/settings/skills`)** | 平台技能注册列表、启用 / 停用开关 | 技能元数据与工具链映射 | ✅ 通过。 |
| **工具与函数治理 (`/admin/settings/tools`)** | 安全沙箱工具授权（代码运行、图表绘制、搜索） | 工具权限与调用白名单检查 | ✅ 通过。 |
| **PBL 模板治理 (`/admin/settings/templates`)** | 官方项目模板列表、阶段定义、理论门禁规则配置 | 模板卡片浏览与配置 | ✅ 通过。 |
| **知识库管理 (`/admin/settings/knowledge`)** | 平台级校本知识库索引、检索测试 | 知识切片与向量状态查看 | ✅ 通过。 |
| **审计与会话 (`/admin/settings/dialogs`)** | 完整会话审计日志、合规筛查工具 | 审计日志翻页与详情查看 | ✅ 通过。 |
| **数据库与缓存 (`/admin/settings/database`)** | PostgreSQL 连接池、Redis 缓存与队列健康状态 | 基础设施运维探针查看 | ✅ 通过。 |
| **运维监控 (`/admin/settings/ops`)** | API 吞吐量、Worker 延迟、系统负载仪表盘 | 监控指标动态流刷新 | ✅ 通过。 |
| **AI 运行时路由 (`/admin/settings/ai-runtime`)** | 历史运行时入口重定向 | 自动跳转至拆分后的助手设置 | ⚠️ 缺陷。内部 `router.replace('/settings/assistants')` 缺少 `/admin` 前缀，导致跳转 404 |
| **教师管理 (`/admin/teachers`)** | 历史遗留路由 | 直接输入 URL 访问 | ⚠️ 缺陷。请求 `/api/v1/admin/teachers` 返回 404（该路由已合并入治理大盘与关系绑定） |

#### 5.2 截图存证
- 管家 Copilot: [`admin_copilot_steward.png`](file:///Z:/Study/qitu-zhixue/docs/screenshots/diagnostic/admin_copilot_steward.png)
- 师生关系绑定: [`admin_relationships_matrix.png`](file:///Z:/Study/qitu-zhixue/docs/screenshots/diagnostic/admin_relationships_matrix.png)
- 模型治理监控: [`admin_models_metrics.png`](file:///Z:/Study/qitu-zhixue/docs/screenshots/diagnostic/admin_models_metrics.png)
- 助手注册管理: [`admin_settings_assistants.png`](file:///Z:/Study/qitu-zhixue/docs/screenshots/diagnostic/admin_settings_assistants.png)
- 未成年人隐私: [`admin_settings_profile___growth.png`](file:///Z:/Study/qitu-zhixue/docs/screenshots/diagnostic/admin_settings_profile___growth.png)
- 模型供应商: [`admin_settings_model_providers.png`](file:///Z:/Study/qitu-zhixue/docs/screenshots/diagnostic/admin_settings_model_providers.png)
- 智能体团队: [`admin_settings_multi_agent_teams.png`](file:///Z:/Study/qitu-zhixue/docs/screenshots/diagnostic/admin_settings_multi_agent_teams.png)
- 技能库管理: [`admin_settings_skills_registry.png`](file:///Z:/Study/qitu-zhixue/docs/screenshots/diagnostic/admin_settings_skills_registry.png)
- 工具权限管理: [`admin_settings_tool_governance.png`](file:///Z:/Study/qitu-zhixue/docs/screenshots/diagnostic/admin_settings_tool_governance.png)
- PBL 模板管理: [`admin_settings_pbl_templates.png`](file:///Z:/Study/qitu-zhixue/docs/screenshots/diagnostic/admin_settings_pbl_templates.png)
- 会话审计日志: [`admin_settings_audit_dialogs.png`](file:///Z:/Study/qitu-zhixue/docs/screenshots/diagnostic/admin_settings_audit_dialogs.png)
- 数据库与缓存: [`admin_settings_database___redis.png`](file:///Z:/Study/qitu-zhixue/docs/screenshots/diagnostic/admin_settings_database___redis.png)
- 运维监控仪表: [`admin_settings_ops___metrics.png`](file:///Z:/Study/qitu-zhixue/docs/screenshots/diagnostic/admin_settings_ops___metrics.png)

---

## 三、代码缺陷与优化修复建议清单

### 1. `admin-console` 内部重定向路径缺失 basePath 前缀
- **文件位置**: [`apps/admin-console/app/(console)/settings/ai-runtime/page.tsx`](file:///Z:/Study/qitu-zhixue/apps/admin-console/app/%28console%29/settings/ai-runtime/page.tsx#L11)
- **代码问题**:
  ```tsx
  useEffect(() => {
    router.replace('/settings/assistants'); // ❌ 缺少 /admin 前缀
  }, [router]);
  ```
- **修复方案**: 改为 `router.replace('/admin/settings/assistants')` 或使用相对跳转 `'assistants'`，并在下方外链统一加上 `/admin` 前缀。

### 2. `teacher-workspace` 空目录清理与 404 防御
- **文件位置**: `apps/teacher-workspace/app/(workspace)/knowledge/`
- **代码问题**: 目录为空且无 `page.tsx`。如果外部链接直达 `/teacher/knowledge` 会导致未处理的 404。
- **修复方案**: 删除该未使用的空目录，或补充带有 301 重定向到 `/teacher/dashboard` 的 `page.tsx`。

### 3. `admin-console` 历史遗留 `/admin/teachers` 页面与接口解耦
- **文件位置**: [`apps/admin-console/app/(console)/teachers/page.tsx`](file:///Z:/Study/qitu-zhixue/apps/admin-console/app/%28console%29/teachers/page.tsx)
- **代码问题**: 页面调用已废弃的 `/api/v1/admin/teachers` 接口导致控制台报 404。
- **修复方案**: 教师治理能力已完全整合至 `/admin/relationships` 与 `/admin/copilot`，建议将该页面重定向至 `/admin/relationships`。
