# 启途智学夜间暗色护眼模式改造守则

> 文档定位：记录学生端 AI 搭档、家长陪伴中心、教师工作台及全站主外壳在实现“夜间暗色护眼模式”过程中的核心设计标准、技术踩坑经验与不可破坏的修改守则。
> 适用范围：`apps/student-center`（学生端）、`apps/parent-companion`（家长端）、`apps/teacher-workspace`（教师端）、`apps/admin-console`（平台管理后台）、`packages/ui`（外壳与基础组件）。

---

## 一、背景与设计基线

夜间暗色护眼模式旨在为长时段进行项目式探究学习（PBL）的学生、伴学支持的家长以及教学管理的教师提供温润、低眩光、沉浸式的视觉环境。设计基线参考标准色谱（色温区间 2700K~3200K，有效滤除高能蓝光刺激，降低视觉疲劳度）。

### 1.1 标准色阶规范

| 色彩角色 | 色值 | 用途与约束 |
| :--- | :--- | :--- |
| **画布底色 (Canvas)** | `#121417` | 页面最底层底色，消除一切白底漏光 |
| **表面底色 (Surface)** | `#181B20` | 主侧边栏、对话历史侧边栏、各端顶栏 |
| **卡片底色 (Card)** | `#1E2228` | 消息气泡、对话卡片、仿真框、白板、各类 Panel / 表格底色 |
| **激活深绿 (Primary Soft)** | `#112F24` | 导航激活项底色、状态徽标底色、开关按钮开启态 |
| **边框暗线 (Border Subtle)**| `#252A33` / `#2E3540` | 分割线、卡片边框、浅灰色弱对比边缘 |
| **边框微绿 (Border Accent)**| `#195A3B` | 激活项边框、护眼开启态边框 |
| **翡翠主绿 (Accent Emerald)**| `#10B981` | 激活光标条（Indicator Bar）、悬停强调、呼吸光点 |
| **浅薄荷绿 (Mint Light)** | `#34D399` | 激活文字、状态字样、绿色高亮强调文本、操作链接 |
| **高对比纯白 (Heading White)**| `#FFFFFF` | 左上角“启途智学”平台品牌名称、核心层级标题 |
| **次级浅灰 (Text Main)** | `#E2E8F0` / `#F1F5F9` | 消息正文、卡片正文、输入框录入文字、表格正文 |
| **弱化灰阶 (Text Muted)** | `#94A3B8` / `#CBD5E1` | 次要描述、占位符、未激活图标、标签说明 |

---

## 二、核心修改守则

### 守则 1：零布局抖动原则 (Zero Layout Shift)

> [!CAUTION]
> **绝对禁止因开关护眼模式而产生任何页面高度、外边距、内边距或元素布局的跳动（Cumulative Layout Shift, CLS）。**

- **历史教训**：在早期实现中，开启护眼模式后在页面顶部插入了“夜间暗色护眼模式已开启 · 柔光低眩光暗色显示…”的大型信息横幅，导致整个三栏工作台下沉数十像素，用户来回切换时发生剧烈抖动。
- **治理守则**：
  1. 状态提示必须**内聚于右上角切换按钮**本身（例如：按钮文案变为 `护眼模式 (已开启)`、带绿色微光呼吸点 `qitu-eyecare-pulse-dot`）。
  2. 严禁在工作区视口内新增或移除占位 DOM 节点。
  3. 切换前后只通过属性选择器 `:root[data-qitu-eyecare="true"]` 进行 CSS 样式重着色，保证几何尺寸、边距与网格排版分毫不动。
  4. **按钮位置标准**：
     - 学生端：置于顶部账号胶囊（`.qitu-student-account`）内，位于学生姓名与偏好设置之间。
     - 家长端：置于顶栏身份操作区（`.parent-identity`）内，位于“联系班主任”与偏好设置之间。
     - 教师端：置于顶栏右侧（`.qtx-topbar`）操作区内，位于偏好设置与退出登录按键旁。
     - 管理员端：置于顶栏身份操作区（`.admin-console-identity`）内，位于管理员姓名与偏好设置之间。

---

### 守则 2：刺眼白底全深度消除守则 (Glaring White Elimination)

> [!WARNING]
> **在夜间暗色模式下，任何未被覆盖的纯白背景（`#FFF` / `#FFFFFF` / `rgb(255,255,255)`）都会造成刺眼光斑，彻底摧毁护眼体验。全局变量覆盖不足以解决局部硬编码白底问题。**

开发与维护时必须依序巡检并覆盖以下 8 大类区域：

1. **输入区域 (Composer & Forms)**：
   - 学生端 AI 对话录入框、外围边框、阴影重置。
   - 底部工具栏的“语音输入”、“图片”、“文件”上传按钮（必须覆盖其独立类名，不可漏掉 hover 与 focus 状态）。
   - 家长端“给孩子一句鼓励”文本域、教师端搜索框（`.qtx-input`）、工单反馈与跟进输入框。
2. **多模态会话与富文本卡片**：
   - AI 对话消息气泡与历史卡片。
   - 白板容器（`.qitu-whiteboard` / `.qitu-tutor-whiteboard`）及白板内部所有画布块。
   - Mermaid 图表容器（SVG 元素背景强制透明或 `#1E2228`，消除纯白图表底框）。
   - KaTeX 数学公式渲染（公式行底色、公式强调色、分数横线 `.frac-line` 的边框颜色适配）。
3. **交互式探究仿真组件 (Simulations)**：
   - 电路仿真组件（`CircuitSimulationCard`）。
   - 动能与势能探究组件（`KineticEnergyInteractiveCard`）。
   - 光学反射、衍射与散射组件（`OpticsDiffractionScatteringCard`）。
   - 所有仿真 Canvas 容器与控制面板。
4. **历史会话与项目推进面板**：
   - 历史探索记录标签（如 `interest_confirmed`、`theory_mastered` 等状态徽标底色必须转为 `#112F24` 翡翠深绿）。
   - 项目进度侧栏：“当前项目”、“当前任务”文字底层背景。
   - 团队智能体面板（`TeamAgentHud`）标题背景、任务流卡片、智能体头像底色。
   - “思考灵感”右侧卡片矩阵。
5. **头部与身份标识徽标**：
   - 导师团队 Badge（例如：“探究光的路径：从反射定律到透镜成像 导师团队 v1” 的 `.qitu-tutor-identity-badge.is-team` 与 `.is-assistant`）。
   - 当前学生账号胶囊（“演示学生” `.qitu-student-account`）。
   - 教师工作台欢迎横幅（`.qtx-banner`）、教师身份区（`.qtx-user`）。
   - 家长陪伴中心头部（`.home-welcome`）与当前孩子选择器（`ChildPicker`）。
6. **侧边栏与收起/展开控制器**：
   - 历史会话顶部收起键（`.qitu-live-session-sidebar .qitu-button-ghost`）。
   - 主侧边栏底部收起控制器（`.qitu-sidebar-toggle`、`.qtx-sidebar-bottom`）。
   - 页面内所有 `button[aria-label*="收起"]` 通用按键。
7. **学生端各业务页子卡片与组件深度消白 (Sub-cards & Shared Kits)**：
   - **基础统计卡与三元组 (StatTriple)**：`@qitu/ui` 基础样式中写死了 `.qitu-stat-triple-item { background: white; border: 1px solid var(--qitu-border); }`。在“成长轨迹”（`/student/growth`）页的“从今天开始记录”（`GrowthSummaryCard`）等卡片中，内部统计小卡片（如“连续学习天数”、“完成项目”、“掌握目标”、“发布作品”）必须全量覆盖为 `#1E2228` 底色与 `#2E3540` 边框，消除大面积刺眼白底。
   - **内联单字封面占位符 (Avatar Fallbacks)**：`DirectionCard`（“从一个想法开始”方向卡）与 `ContinueProjectCard`（“当前项目”卡）在无封面图时会渲染项目/方向首字的单字占位方块（如“光”）。由于其 JSX 内联硬编码了 `background: colors.page`（`#f2f3ff` 浅白底）与 `color: colors.primary`（`#1e4fd9` 深蓝字），在夜间模式下必须使用精准选择器（如 `.qitu-direction-card span[aria-hidden="true"]`、`.qitu-direction-avatar`、`.qitu-project-avatar`）与 `!important` 强制将其重设为 `#15181D` 极深底色、`#2E3540` 边框以及 `#34D399` 薄荷绿字符。
8. **家长端与教师端业务卡片深度消白**：
   - **家长端 KPI 卡与孩子选择芯片**：`.kpi-card`、`.child-chip`、`.question-box`、`.summary-box`、`.artifact-tile`、`.work-card` 统一使用 `#1E2228` 底色与 `#2E3540` 边框。
   - **教师端数据统计与重点关注学生**：`.qtx-metric`、`.qtx-panel`、`.qtx-attention-student`、`.qtx-table` 彻底消除白色与浅蓝底色。
9. **家长端与教师端业务子卡片、插画与弹窗面板彻底消白 (Accurate Selector & Visual Base Elimination)**：
   - **以真实 JSX DOM 节点类名为唯一事实源，严禁凭空猜测类名**：
     - 家长端消息页（`/parent/messages`）：顶部 4 张消息状态卡片的真实类名是 `.summary-card`（而非 `.message-card`）；左侧消息容器是 `.message-list`，消息单项是 `.message-row`（而非 `.message-item`）；
     - 统一反馈组件：右下角弹窗浮层的真实类名是 `.parent-feedback-panel`（而非 `.parent-feedback-dialog`），其表头是 `.parent-feedback-head`，表单控件是 `.parent-feedback-form select, textarea, input`；若选择器类名与真实 DOM 不匹配，会导致暗色模式下仍渲染纯白底色（`background: #ffffff`）。
   - **插画视觉容器消白 (Project Visual & Mascot Container)**：
     - 家长端当前学习项目插画与吉祥物展示区（`<ProjectVisual />`）在 `globals.css` 中硬编码了 `.project-visual { background: #edf5ff; border: 1px solid #d7e5fa; }`、`.project-visual-desk { background: #bfd3ed; }` 与 `.floating-stage-tag { background: rgba(255, 255, 255, 0.92); }`。护眼模式必须显式重设为极深暗色 `#15181D`、暗线边框 `#2E3540` 与翡翠状态徽章 `#112F24` / `#34D399`，杜绝机器人在暗色卡片上留下刺眼浅蓝/白色方框。
   - **当前项目内三项任务指标卡片 (Fact Items)**：
     - “当前学习项目”中展示的“今日任务”、“最近完成”、“下一步计划”为 `.project-facts-grid .fact-item`。必须显式赋予卡片底色 `#181B20` 或 `#1E2228`、边框 `1px solid #2E3540`，标签 `small` 设为 `#94A3B8`，数值 `span` 设为 `#FFFFFF`，杜绝继承 muddy 颜色或缺失边框。
   - **教师端隐蔽白底全面消除**：
     - 欢迎横幅头像小方框：`.qtx-banner-avatar > div` 硬编码了 `background: #fff; color: #2563eb;`，必须覆盖为 `background: #112F24 !important; color: #34D399 !important; border: 1px solid #195A3B !important;`。
     - 重点关注学生条目：`.qtx-attention-student` 在 `globals.css` 硬编码了渐变白底 `background: linear-gradient(100deg, #fffcf5, #fff 30%);`，头像硬编码了 `background: #e8effc; color: #1d4ed8;`。必须全量覆盖为 `#181B20` 暗色卡片与 `#112F24` 翡翠深绿头像底色。
     - 介入详情子卡片：`.qtx-card-soft` 硬编码了半透明白底 `rgba(255, 255, 255, 0.88);`，`.qtx-note` 硬编码了 `#f8fafc`。必须覆盖为 `#15181D`。
     - 输入框与下拉选择框聚焦态：`.qtx-input:focus`、`.qtx-select:focus` 在聚焦时曾出现 `background: #fff;`，必须保持为护眼暗色 `#15181D`。
10. **教师端工作台快捷操作、学生名册选中条目与 Agent 协作面板专项治理 (Teacher Workspace & Agent Run Primitives)**：
   - **场景 A：工作台“快捷操作”卡片与提示框 (Quick Actions & Inline Styles)**：
     - **根本原因**：工作台首页中的快捷操作卡片采用 `<Link style={{ background: '#fff' }}>` 与 `<div style={{ background: '#f0f9ff' }}>` 内联硬编码。依赖 CSS 属性选择器 `[style*="background: #fff"]` 在浏览器 CSSOM 解析时极易失效（浏览器将内联属性规范化为 `rgb(255, 255, 255)` 或对简写属性重构分解），导致子串匹配规则无法捕获内联白底；且 `#f0f9ff` 浅蓝底提示条缺乏专用类名。
     - **治理策略**：严禁单靠 CSS 属性选择器模糊匹配内联样式。必须在 JSX 中赋予结构化语义类名（`.qtx-quick-action-link`、`.qtx-quick-action-tip`），并在护眼样式中显式配置暗色底 `#181B20`、边框 `#2E3540`、hover 态 `#1E252F`、标题高对比纯白 `#FFFFFF`，提示框配置为翡翠深绿 `#112F24` / `#34D399`。
   - **场景 B：学生管理“演示学生”整条浅色背景与详情抽屉 (Selected Student & Detail Drawer Header)**：
     - **根本原因**：学生管理页（`/teacher/students`）默认选中的“演示学生”在右侧详情面板头部采用了复合浅色渐变 `background: linear-gradient(135deg,#eff6ff,#eef2ff)`。它既非纯白又无类名，单色属性选择器无法捕获，在暗色背景上形成极其扎眼的浅蓝白宽横幅；同时左侧表格选中行（`tr.selected`）若仅设置 `tr` 背景，某些浏览器下的单元格 `td` 背景可能发生层叠遮挡。
     - **治理策略**：
       1. 为详情抽屉头部赋予类名 `.qtx-student-detail-header`，在护眼模式下覆写为深翡翠微渐变 `background: linear-gradient(135deg, #142820, #1A3328) !important; border-bottom: 1px solid #195A3B !important;`，标题设为纯白 `#FFFFFF`；
       2. 表格选中行必须联合覆盖 `.qtx-table tbody tr.selected, .qtx-table tbody tr.selected td { background: #142820 !important; }`，且第一列添加发光指示边框 `border-left: 3px solid #10B981 !important;`；
       3. 详情抽屉内部的项目列表、介入记录、近期成长等子卡片均赋予专用语义类名（如 `.qtx-student-project-card`、`.qtx-student-intervention-card`、`.qtx-student-growth-card`）并配置暗色底与彩色边框，杜绝任何 `#f8fafc`、`#fef2f2`、`#f0fdf4` 浅底漏光。
   - **场景 C：Agent 协作记录刷新按钮与运行卡片 (Agent Run Panel & Ghost Button)**：
     - **根本原因**：Agent 协作记录标题旁的“刷新”按钮采用了 `@qitu/ui` 的 `<Button variant="ghost">`。在 `@qitu/ui` 中，幽灵按钮硬编码了 `background: white`；且下方的协作执行图（`.qitu-team-run-graph`）与协作活动流（`.qitu-team-activity`）及其子节点（`.qitu-team-node`）均依赖组件库默认的浅色背景变量或 `background: white`。由于子应用中仅对 `.qtx-agent-run-panel` 容器外壳写了暗色，未覆盖内部跨包组件，导致刷新按钮和子卡片全为白底。
     - **治理策略**：子应用护眼样式必须对跨包基础组件建立完备的暗色兜底基线：
       1. 为刷新按钮与幽灵按钮覆写 `.qtx-agent-refresh-btn, .qitu-button-ghost { background: #1E252F !important; border: 1px solid #2E3540 !important; color: #CBD5E1 !important; }`，hover 态转为翡翠深绿高亮；
       2. 对 `.qitu-team-run-graph`、`.qitu-team-activity` 设为 `#15181D !important`，节点 `.qitu-team-node` 设为 `#1E2228 !important`，标记点 `.qitu-team-run-marker` 设为翡翠亮线，代码标签与状态徽标全部暗化；
       3. 同步覆盖骨架屏微光 `.qitu-skeleton-line` 与空状态/错误态容器 `.qitu-state`，确保所有加载和交互阶段视觉一致。
11. **管理员端学生数据统计光标、关系绑定卡片操作按键、启途管家对齐与模型设置排查消白专项治理 (Admin Console Governance Primitives)**：
   - **场景 A：学生数据统计指示光标与周期选择器 (Statistics Indicator & Range Selector)**：
     - **问题现象**：学生数据统计页中，部分光标指示条呈亮白色或不可读，统计周期选择器按键激活时继承浅色高亮。
     - **治理策略**：
       1. 侧栏与页面指示光标统一为翡翠绿 `#10B981`（发光阴影 `rgba(16, 185, 129, 0.8)`），hover 态展示浅薄荷绿 `#34D399`；
       2. 标题前置竖线指示光标（`.admin-data-section h3::before`、`h4::before`、`.admin-chart-section h3::before`）统一重写为 `#10B981`；
       3. 周期选择栏容器（`.admin-range-selector`）设为 `#15181D` 与 `#2E3540` 边框，周期按键（`.admin-range-btn.active`）激活态配置为翡翠深绿 `#112F24`、微绿边框 `#195A3B` 与薄荷绿文字 `#34D399`；
       4. 全局表单与插入光标（`caret-color`）强制设为 `#10B981 !important;`。
   - **场景 B：关系绑定面板、统计卡片、操作按钮与二次确认弹窗消白 (Relationship Binding Panels & Action Buttons)**：
     - **问题现象**：关系绑定主面板（`.admin-relationship-panel`）与面板头部（`.admin-panel-header`）硬编码 `background: rgb(255 255 255 / 80%)` 与 `white`；统计指标小卡（`.admin-stat-item`）硬编码浅色渐变 `linear-gradient(135deg, #f5f9ff, #ffffff)`；表单卡（`.admin-form-card`）内部下拉框 `select` 为白底；表格内的“换班主任”、“结束关系”、“结束分配”按键（`.admin-action-btn`）在 `globals.css` 中硬编码了 `background: white`；二次确认弹窗（`.admin-dialog`）同样写死 `background: white`。
     - **治理策略**：
       1. 关系主面板与面板头全量覆盖为表面底色 `#181B20`，边框 `#2E3540`，取消白色模糊滤镜；
       2. 统计指标卡覆盖为 `#1E2228` 暗色底，指标数值重置为薄荷绿 `#34D399`；
       3. 选项卡卡片（`.admin-tabs-card`, `.admin-tabs`）覆写为 `#15181D`，激活选项卡（`.admin-tab.active`）覆写为 `#112F24` 翡翠深绿底色；表单下拉框 `select` 覆写为 `#15181D`；
       4. 表格行内操作按钮 `.admin-action-btn` 统一重置为 `#1E2228` 暗色底色与 `#2E3540` 边框，hover 态切换为翡翠深绿 `#112F24` 与薄荷绿文字 `#34D399`，危险按钮 `.admin-action-btn-danger` hover 态转为暗红 `#3B1B1B` 与 `#FCA5A5`；
       5. 二次确认弹窗遮罩 `.admin-dialog-backdrop` 设为 `rgba(0, 0, 0, 0.75)`，弹窗本体 `.admin-dialog` 设为 `#1E2228`，标题设为高对比纯白 `#FFFFFF`。
   - **场景 C：启途智学管家对齐学生端 AI 搭档护眼规范 (Admin Copilot Tutor Parity)**：
     - **问题现象**：启途智学管家（`/admin/copilot`）此前包含大量写死在内联 style 的浅色渐变背景、浅白底工具栏、白色气泡与白色输入框，未能复用学生端 AI 搭档已验证成熟的护眼样式。
     - **治理策略**：
       1. 在 JSX 中赋予结构化语义类名（`.copilot-page`、`.copilot-sidebar`、`.copilot-session-item`、`.copilot-toolbar`、`.copilot-messages-container`、`.copilot-bubble-assistant`、`.copilot-bubble-user`、`.copilot-tool-steps-container`、`.copilot-artifact-card`、`.copilot-thinking-bubble`、`.copilot-composer-container`、`.copilot-textarea`、`.copilot-voice-btn`、`.copilot-send-btn`）；
       2. 样式深度对齐学生端规范：页面画布底色 `#121417`，会话管理侧栏 `#181B20`（激活项 `#112F24` / `#34D399`），控制顶栏 `#181B20`（内部下拉配置为 `#15181D` 暗色胶囊），助手消息气泡 `#1E2228`，用户消息气泡 `#142820` 带翡翠微绿边框 `#195A3B`，工具步骤与产物卡片 `#15181D` / `#1E2228`；
       3. 底部输入区 `#181B20`，输入框 `#15181D` 搭配绿色光标 `caret-color: #10B981`，语音按键与发送按键（`#10B981` 翡翠主绿）全面暗色护眼化。
   - **场景 D：模型与设置 AION 变量覆盖与白底框深度消白 (Settings & Model Providers)**：
     - **问题现象**：`apps/admin-console` 的 `(console)/settings` 采用 AION 框架，引入了 `settings-aion.css`、`teams.css`、`modals.css` 等，定义了大量的 `--aion-bg-card: #ffffff;` 以及写死的 `.settings-sider`、`.settings-collapsible-card`、`.settings-overview-card`、`.multica-profile-card`、`.team-card`、`.admin-skill-*`、`.admin-modal-card` 等白底类名。
     - **治理策略**：
       1. 在 `:root[data-qitu-eyecare="true"]` 中全面重定义 AION CSS 变量：`--aion-bg-card: #1E2228`、`--aion-fill-1: #181B20`、`--aion-fill-2: #15181D`、`--aion-border: #2E3540`、`--aion-t-primary: #FFFFFF`、`--aion-t-secondary: #E2E8F0` 等；
       2. 设置侧栏 `.settings-sider` 覆写为 `#181B20`，激活项 `.settings-sider-item.is-active` 为 `#112F24` 翡翠深绿；
       3. 设置概览卡片 `.settings-overview-card`、折叠卡片 `.settings-collapsible-card`、团队卡片 `.team-card`、团队详情 `.team-detail-view`、技能卡片 `.admin-skill-card-section`、弹窗 `.admin-modal-card` 与 `.modal-content` 全面消白，重置为 `#1E2228` 卡片底色与 `#2E3540` 边框；
       4. 输入框 `.settings-input`、文本域 `.settings-textarea`、选择框 `.settings-select`、代码预览 `.instruction-editor` 与 `.instruction-preview` 统一覆写为 `#15181D`，光标为 `#10B981`。
   - **场景 E：管理员端 Copilot 药丸控制器、设置总览全栈协同、AI 助手卡片与工作区全页面底框黑底白字排查 (Admin Copilot Controls, AI Assistants & Workspace Strict Eyecare)**：
     - **问题现象**：
       1. 启途智学管家（Copilot）顶栏控制药丸（“交互助手”、“团队”、“思考强度”、“模型”、“权限”）及侧栏底部的“快速转至设置库”包含硬编码的浅色背景（`#eff6ff`、`#f0fdf4`、`#f8fafc`、`#fafafa`、`#fff`），在护眼模式下呈现白色底框；
       2. “模型与设置”各子页面中大量文字继承深色字体（`#102a5c`、`#1e293b`、`#1d2129`、`#334155` 等），在暗色背景下对比度不足；
       3. “AI助手”中的卡片（`.admin-assistant-card`）及编辑器卡片此前背景仍为白色，文字对比度低；
       4. “设置总览”横幅“全栈协同”（`.settings-overview-intro`）底色为浅蓝渐变，且卡片上的 Emoji 图标容器存在多种浅色背景；
       5. “工作区”下各页面（设置总览、账号设置、团队工作区、技能工作区等）存在部分文字容器底框漏白。
     - **治理策略**：
       1. **Copilot 工具栏与快捷跳转黑化**：在 `copilot/page.tsx` 中注入结构化类名（`.copilot-control-pill`、`.copilot-control-label`、`.copilot-control-select`、`.copilot-settings-jump-box`、`.copilot-settings-jump-title`、`.copilot-settings-jump-link`），并在 `eyecare-night.css` 中将胶囊框与跳转区底色强制重设为纯黑 `#000000 !important`，标签与链接设为薄荷绿 `#34D399 !important`，消除一切浅色底；
       2. **模型与设置深色字体转纯白**：在 `.settings-shell` 与 `.settings-main` 作用域内，将全部标题、标签、加粗字、说明文字、正文以及硬编码深色子串（`#102a5c`、`#1e293b`、`#1d2129` 等）强制重写为高对比度纯白 `#FFFFFF !important`；
       3. **AI 助手卡片深底白字**：卡片 `.admin-assistant-card` 与编辑器卡片 `.admin-editor-card` 统一重写为纯黑背景 `#000000 !important`，卡片标题与正文纯白 `#FFFFFF !important`，角色胶囊与操作按钮为深森林绿 `#112F24` 搭配薄荷绿文字 `#34D399`，头像框为黑底配翡翠绿边框；
       4. **设置总览“全栈协同”与 Emoji 规范**：`.settings-overview-intro` 横幅统一为纯黑 `#000000 !important` 配翠绿边框 `#10B981`，“全栈协同”徽标设为黑底绿字；全部卡片 Emoji 图标容器（`.settings-overview-icon`、`.admin-card-icon-box`、`.settings-row-avatar`、`.team-card-icon` 等）统一重写为纯黑底色配翠绿发光边框（`background: #000000 !important; border: 1px solid #10B981 !important; color: #FFFFFF !important; box-shadow: 0 0 10px rgba(16, 185, 129, 0.4) !important;`）；
       5. **工作区全页面文字底框排查拦截**：全面排查“工作区”下所有页面（设置总览、账号设置、团队卡片、详情视图、技能面板、模态弹窗、飞书配置卡片等），所有存在文字的卡片、输入框、表格、单元格全部强制为纯黑底色 `#000000 !important`，文字为纯白 `#FFFFFF !important`；并在 `.settings-shell` 与 `.settings-main` 作用域内对一切浅白底内联属性（`[style*="background: #fff"]`、`#fafafa`、`#f8fafc`、`#f1f5f9`、`#eff6ff`、`#f0fdf4` 等）施加黑底白字强制拦截。
   - **场景 F：模型接入、AI助手/技能中心Emoji、操作长按钮、工具与MCP、生态插件与内容数据四子页面治理 (Model Providers, Emoji Fidelity, Action Buttons, Tools/MCP, Plugins & Content Data 4 Sub-pages)**：
     - **问题现象**：
       1. AI 助手卡片与技能中心中因 `AssistantGlyph` 内部尝试加载并渲染共享图像组件，若图片未正常载入或在微型容器（26px）中渲染时，会退化展示图片 alt 属性文本（如“启途 AI 智学搭档”），导致 emoji 变成了一串文字；
       2. “模型接入”页面通道名称前的卡片 `.provider-logo`（原写死 `#e9efff` 浅蓝白底）、“协议”徽章 `.protocol-chip`（原写死 `#eef2f7` 浅灰底）与“状态”徽标 `.runtime-status`（`.is-ready`、`.is-warning`、`.is-off` 原浅色底）均存在刺眼浅色底色；
       3. “模型接入”表格中的“操作”列按钮文案（如“▼ 二级展开 (模型管理)”）因列宽不足发生文字换行折行；表格内代码、模型数、网关地址与最近同步文字颜色未全量转为纯白；
       4. “工具与MCP”页面顶部模式切换器、智能体授权矩阵卡片、单元格及运行时上报的内置工具卡片包含大量硬编码白色与浅灰底色（`#ffffff`、`#f8fafc`、`#f1f5f9`）；
       5. “生态插件”页面扩展卡片仍为白色，且“标准化接入协议”横幅未适配黑底白字绿边；
       6. “内容与数据”四大子页面（知识中心 `/settings/knowledge`、项目模板库 `/settings/templates`、学情画像与轨迹 `/settings/profile-growth`、数据库 `/settings/database`）内部大量卡片、侧栏、预览面板与列表项存在刺眼白底。
     - **治理策略**：
       1. **Emoji 真实呈现**：在 AI 助手卡片、技能中心“被谁使用”、团队成员等所有管理端场景中，直接渲染原生字符 `{avatar || '🤖'}`，杜绝图像组件失效或 alt 字符溢出；技能中心圆形头像容器 `.admin-skill-avatar-circle` 赋予纯黑底色与翡翠绿边框（`#000000` / `#10B981`）；
       2. **模型接入通道与状态消白**：`.provider-logo` 强制转为黑底绿边白字（`#000000` / `#10B981` / `#FFFFFF`），`.protocol-chip` 与 `.runtime-status.is-ready` 转为深森林绿（`#112F24` / `#34D399`），`.runtime-status.is-warning` 转为深琥珀暗色（`#2D2311` / `#FBBF24`），`.runtime-status.is-off` 转为暗黑灰色（`#181B20` / `#9CA3AF`）；
       3. **操作按钮防折行与全字体纯白**：`.runtime-actions` 设为 `flex-wrap: nowrap`，按钮 `.settings-pill-btn` 强制 `white-space: nowrap !important; min-width: max-content !important; padding: 6px 14px !important;`，操作列 `th`/`td` 设置 `min-width: 440px !important;`；表格内全部文本、代码与数值统一重设为高对比度纯白 `#FFFFFF !important;`；
       4. **工具与 MCP 全量消白**：将 `.admin-tools-page-view` 内所有模式切换器、授权矩阵卡片 `.admin-tools-card`、内置工具卡片 `.admin-builtin-tool-card` 统一重设为纯黑底色、翠绿边框与纯白文字；
       5. **生态插件去白与标准化接入协议**：卡片 `.admin-knowledge-item-card` 与文档卡片 `.admin-hook-doc-card` 设为黑底绿边白字，挂载钩子徽标 `.admin-hook-badge` 设为 `#112F24`，顶部“标准化接入协议”横幅 `.admin-editor-tag.is-green` 设为纯黑底色、纯白文字、翠绿发光边框（`#000000` / `#FFFFFF` / `border: 1px solid #10B981`）；
       6. **内容与数据四大页面卡片全量黑化**：
          - 知识中心：覆盖 `.libraryCard`、工作区 `.fileWorkspace`、侧栏 `.fileSidebar`、预览区 `.preview` 为纯黑底色 `#000000` 与纯白文字，激活文件项为 `#112F24`；
          - 项目模板库：覆盖模板卡片 `.admin-template-item-card`、阶段设计卡片与工作流容器为黑底绿边；
          - 学情画像与轨迹：为 4 大业务分区 `.admin-profile-growth-section` 及维度卡片 `.admin-dimension-card` 覆盖纯黑背景与纯白文字；
          - 数据库与初始化：覆盖运行时卡片 `.admin-runtime-cards .qitu-section-card` 及检查项 `.admin-runtime-row` 为黑底绿边白字。
   - **场景 G：管理员端设置中心二级展开、技能中心视图/搜索/详情、工具徽标、知识中心搜索框、模板状态与学情画像深度消白与高对比增强 (Admin Model Secondary Expand, Skills Search/Cards, Tools Badges, Knowledge Search, Template Status & Profile Growth High-Contrast)**：
     - **问题现象**：
       1. “模型接入”中的“操作-二级展开”展开面板（原写死 `#f8fafc` 浅灰底）及内部模型卡片（原写死 `#ffffff` 白底）与挂载模型徽标在暗色模式下大面积刺眼泛白；
       2. “技能中心”中的“技能列表 / 助手×技能绑定矩阵”视图切换药丸原写死 `#f1f5f9` 白底，搜索框 `.admin-skills-search-input-wrap` 原写死 `#ffffff` 白底；
       3. 技能详情页中“此技能来自 AI 运行时目录...”提示框写死 `#fffbeb` 浅黄白底；元数据徽标（`admin-skill-meta-pill`）、标签（`admin-skill-tag-chip`）存在白底；“被 0 个智能体使用”卡片与文件工作台写死 `#ffffff`；
       4. “工具与 MCP”汇总徽标写死 `#eff6ff`、导师角色写死 `#e2e8f0` 浅灰白底；内置工具卡片下的低/中/高风险徽标、门禁与角色注册徽标存在 `#f1f5f9` 浅色底；
       5. 知识中心搜索框（`.search`、`.fileSearch`）及其下拉框（`select`）在模块化样式中写死 `white` 与 `#fcfdff`，产生白色裸露；
       6. 项目模板库“已发布”状态徽标 `.admin-template-status-pill` 原写死 `#e8ffea` 极浅绿色背景配绿字，在暗色模式全局文本转白后导致“浅绿底浮白字”，对比度极低完全无法阅读；
       7. 学情画像与成长轨迹中的“不可篡改审计流”与“提示框”同样为 `#dcfce7`、`#f0fdf4` 浅绿白底导致白字不可读；“PBL 关键事件流捕获与档案自动沉淀”卡片与“能力画像多维评价模型”维度卡片、评定来源框、启用按钮存在白底与白字低对比；
       8. “飞书机器人”页面“飞书汇报助手”的连接状态药丸（`.feishu-status-pill.is-connected`）在暗色横幅中呈现刺眼浅绿浅白底；
       9. “模型接入”支持的供应商目录右侧“5 个模板已就绪”药丸（写死 `#eff6ff` 浅蓝底）与下方当前激活模板卡片（如“通义千问（DashScope 兼容模式）”写死 `#f8fafc` 浅灰底）存在白色与浅色裸露。
     - **治理策略**：
       1. **模型展开面板与模型卡片消白**：为二级面板 `.provider-expanded-panel` 赋予纯黑底色 `#000000` 与翠绿顶底边框 `#10B981`；模型卡片 `.provider-model-card` 设为纯黑底色、翠绿微光边框与纯白文字；模型分组标签设为深森林绿 `#112F24` 配翡翠绿文字 `#34D399`；快速单条添加模型输入框设为暗色黑底；
       2. **技能中心切换器与搜索框纯黑化**：`.admin-skills-view-switcher` 统一为纯黑底色与翠绿边框，激活态切换按钮 `.is-active` 为深森林绿 `#112F24` 配薄荷绿文字 `#34D399`；搜索输入容器 `.admin-skills-search-input-wrap` 及其输入框全量转为纯黑背景、翠绿边框、纯白文字与翡翠绿光标；
       3. **技能详情提示条、标签与卡片黑化**：只读提示条 `.admin-skill-readonly-alert` 覆盖为深森林绿 `#112F24` 配翠绿边框；标签与元数据徽标设为深森林绿；卡片分区 `.admin-skill-card-section`、成员行 `.admin-skill-agent-row` 与文件树工作台 `.admin-skill-files-workbench` 全面转为纯黑背景与翠绿边框；
       4. **工具与 MCP 徽标多态深色体系**：汇总徽章 `.admin-tools-summary-badge` 与导师药丸 `.admin-tools-role-pill` 设为深森林绿；低/中风险及角色注册徽标转为深森林绿，高风险转为深暗红（`#2D1414` / `#EF4444` / `#F87171`），门禁徽章转为深暗金（`#2D2311` / `#F59E0B` / `#FBBF24`）；
       5. **知识中心搜索框深度适配**：对 CSS Modules 编译后的 `[class*="search"]`、`[class*="fileSearch"]` 及其内联 input 强制覆盖为纯黑底色 `#000000`、翡翠绿边框 `#10B981` 与纯白输入文字，下拉选择框 `select` 同样纯黑化；
       6. **浅绿底白字顽疾根治（高对比度墨绿+薄荷绿）**：废除一切浅绿底色（`#dcfce7`、`#e8ffea`、`#f0fdf4`），统一替换为深森林绿 `#112F24 !important`，边框采用 `#195A3B !important`，文字与图标采用高对比度薄荷绿 `#34D399 !important`。涵盖模板库“已发布”徽章、审计流徽章、维度评定来源框及提示框；
       7. **学情画像维度与事件流卡片黑化**：事件卡片 `.admin-growth-event-card`、子卡片 `.admin-growth-sub-card`、助手卡片 `.admin-growth-assistant-box` 与维度卡片 `.admin-dimension-card` 全量转为纯黑底色、翠绿微光边框与纯白文字；总权重分布条轨道纯黑化，权重输入框与恢复默认按钮暗色黑化；
       8. **飞书连接状态深绿标准化**：`.feishu-status-pill.is-connected` 统一定制为深森林绿 `#112F24`、墨绿边框 `#195A3B` 与薄荷绿文字/指示点 `#34D399`，消灭浅绿白底；
       9. **预置供应商就绪徽章与激活模板卡片纯黑化**：`.provider-presets-ready-badge` 设为纯黑底色 `#000000`、翠绿发光边框 `#10B981` 与纯白文字；激活模板卡片 `.provider-preset-active-card`（如通义千问卡片）设为纯黑底色、翠绿发光边框，内部协议标签与模型列表设为深森林绿与薄荷绿文字，模板选择器 `select` 全量黑化。
   - **场景 H：学生端个人画像设备管理、模板库 16 课时编排与画像专任助手审核状态消白与按钮重构 (Student Profile Devices, Template 16-Session Tag, Admin Growth Assistant Audit & Reload Button)**：
     - **问题现象**：
       1. 学生端“个人画像”中的“登录设备”卡片（`.qitu-profile-devices-section`）底部直接硬编码 `#fff` 白底、`#102a5c` 深蓝标题与 `#fff7f7` / `#efb4b4` 浅粉浅红退出按钮，暗色模式下大面积刺眼泛白；
       2. 管理端“模型与设置”-“项目模板库”卡片中“📅 16 课时项目教学编排”（`.admin-template-16session-tag`）硬编码 `#eff6ff` 浅蓝白底与 `#1d4ed8` 蓝字，在暗色卡片上成为亮眼白块；
       3. “学情画像与轨迹”控制页顶部标题右侧“专任助手与证据审核”标签（`.admin-profile-growth-tag`）硬编码 `#dbeafe` 浅蓝白底；
       4. “学情画像与轨迹”状态提示横幅（`.admin-growth-status-banner`）硬编码 `#eff6ff` / `#fff7ed` 浅色底，提示文字（“暂无同时启用的专任助手。请先在助手设置及运行时中配置对应助手。”）在暗色下出现对比度不足；
       5. “重新读取配置”按键为原生无修饰浏览器按钮，样式粗糙且未适配护眼操作规范。
     - **治理策略**：
       1. **学生端登录设备全卡片暗色化**：提取语义类名 `.qitu-profile-devices-section`，在夜间暗色模式下统一设定为柔和深色 `#181B20 !important`、边框 `#2E3540 !important`；标题 `.qitu-profile-devices-title` 为纯白 `#FFFFFF !important`；刷新按键 `.qitu-profile-devices-refresh` 设为深森林绿 `#112F24` 配薄荷绿 `#34D399`；退出设备按钮 `.qitu-profile-device-revoke` 转为深暗红底 `#3B1212` 配浅粉红字 `#FCA5A5`；
       2. **模板库 16 课时项目教学编排黑底化**：`.admin-template-16session-tag` 设为纯黑深色底色 `#000000 !important`、翠绿发光边框 `#10B981 !important` 与高对比纯白文字 `#FFFFFF !important`，彻底杜绝白块突兀；
       3. **学情画像审核标签纯黑翠绿边框化**：`.admin-profile-growth-tag` 设为纯黑底色 `#000000 !important`、翠绿微光边框 `#10B981 !important` 与纯白文字 `#FFFFFF !important`；
       4. **学情画像状态横幅黑底化与对比度增强**：`.admin-growth-status-banner` 设为纯黑底色 `#000000 !important`、翠绿发光边框 `#10B981 !important`；文字 `.admin-growth-status-text` 强化为纯白文字 `#FFFFFF !important`；
       5. **“重新读取配置”按键重新设计**：`.admin-growth-reload-btn` 重新设计为带刷新图标 `🔄` 的精致操作按钮，暗色模式下为深森林绿底色 `#112F24 !important`、翠绿边框 `#10B981 !important` 与薄荷绿文字 `#34D399 !important`，悬停态平滑过渡至 `#164332`，禁用态淡化防误触。



---

### 守则 3：暗色底深蓝文字对比度防御守则 (Dark Blue on Dark Defense)

> [!IMPORTANT]
> **深蓝色字体（如 `#102a5c`、`#132646`、`rgb(16, 42, 92)`、`#1e293b`、`#1d4ed8`）在亮色模式下对比度极高，但在暗色模式下对比度低于 1.3:1，属于严重不可见缺陷。**

- **典型案例**：左上角品牌标题“启途智学”（`.qitu-sidebar-name` / `.qtx-brand h1`），因默认继承 `--qitu-heading` 或深蓝色系，在暗色侧边栏背景上几近隐形。
- **守则规范**：
  1. **品牌标题强制纯白**：
     ```css
     :root[data-qitu-eyecare="true"] .qitu-sidebar-name,
     :root[data-qitu-eyecare="true"] .qitu-sidebar-brand strong,
     :root[data-qitu-eyecare="true"] .qtx-brand h1 {
       color: #FFFFFF !important;
     }
     ```
  2. **正文与次级信息灰阶分层**：
     - 主要标题与强调：`#F1F5F9`
     - 正文文字：`#E2E8F0`
     - 弱化辅助字：`#94A3B8`
  3. **属性选择器全局拦截防御**：
     - 对于任何内联注入或第三方遗留的深蓝文字，在各端 `eyecare-night.css` 中采用子串选择器进行统一提升：
     ```css
     :root[data-qitu-eyecare="true"] [style*="color: #102a5c"],
     :root[data-qitu-eyecare="true"] [style*="color: rgb(16, 42, 92)"],
     :root[data-qitu-eyecare="true"] [style*="color: #132646"],
     :root[data-qitu-eyecare="true"] [style*="color: #1e293b"],
     :root[data-qitu-eyecare="true"] [style*="color: #1d4ed8"] {
       color: #E2E8F0 !important;
     }
     ```
  4. **卡片标题操作区链接高对比度保证 (SectionCard Action Links)**：
     - `SectionCard` 顶部的动作区域（`.qitu-section-card-action a`，例如“从一个想法开始”中的“进入灵感空间”、“当前项目”中的“查看详情”与“成长轨迹”）在默认无独立样式时会继承全局深色链接，导致在暗色卡片上字色发暗不可读。
     - 必须显式为 `.qitu-section-card-action a` 与 `.qitu-section-card-header a` 设定翡翠浅绿 `#34D399`，并在 hover 时切换至 `#10B981` 带下划线，确保操作指引高对比可见。
  5. **幽灵按钮与次级按钮防白化规范 (Ghost & Secondary Button Standards)**：
     - **底层样式白色泄露教训**：底层基础库 `@qitu/ui` 的 `.qitu-button-ghost` 在 `styles.css` 中写死了 `background: white; border-color: var(--qitu-border); color: var(--qitu-muted);`。因此页面中的幽灵按钮（如家长端首页的“我有疑问”、顶栏的“联系班主任”、各类“就此问题反馈”及“暂不提醒”按键）在暗色模式下若未被显式重写，就会变成极其刺眼的白底按钮！
     - **按键护眼模式标准配置**：
       - **幽灵按钮 (`.qitu-button-ghost`)**：`background: #1E2228 !important; border: 1px solid #2E3540 !important; color: #E2E8F0 !important;`；hover 态为 `background: #28303C !important; color: #FFFFFF !important;`。
       - **次级按钮 (`.qitu-button-secondary`，如“查看详情”)**：`background: #112F24 !important; border: 1px solid #195A3B !important; color: #34D399 !important;`；hover 态为 `background: #164332 !important; border-color: #10B981 !important; color: #6EE7B7 !important;`。
       - **教师端幽灵按钮 (`.qtx-btn-ghost-blue` / `.qtx-btn`)**：分别配置为翡翠深绿 `#112F24` 与暗色 `#1E2228`，消除浅蓝与白底。
  6. **标题与深色背景上重要文字转纯白规范**：
     - 底层系统变量 `--qitu-heading` 默认值为 `#132646`（深藏青蓝）。在暗色卡片上，所有标题、阶段名、指标数值（如 `.project-title-row h2`、`.fact-item span`、`.summary-card strong`、`.timeline-section-title`、`.ticket-table strong`、`h1`~`h3` 等）必须强制重置为高对比度纯白 `#FFFFFF !important;`，严禁深蓝文字悬浮在暗色之上。

---

### 守则 4：导航光标与类名契约守则 (Navigation Indicator & Class Contract)

- **守则规范**：
  1. **以实际 JSX/DOM 结构为唯一事实源**：修改样式前务必核对组件真实输出，严禁臆造选择器。
  2. **激活指示光标条（Indicator Bar / `::before`）**：
     - 学生端、家长端与管理端（使用 `@qitu/ui` 的 `NavSidebar`）：
       ```css
       :root[data-qitu-eyecare="true"] .qitu-sidebar-nav a.qitu-nav-item.is-active::before,
       :root[data-qitu-eyecare="true"] .admin-console-shell .qitu-nav-item.is-active::before {
         display: block !important;
         background: #10B981 !important;
         box-shadow: 0 0 10px rgba(16, 185, 129, 0.8) !important;
         width: 3.5px !important;
         height: 20px !important;
         border-radius: 4px !important;
       }
       ```
     - 教师端（使用独立工作台侧边栏 `.qtx-sidebar`）：
       ```css
       :root[data-qitu-eyecare="true"] .qtx-sidebar .qtx-nav-item.active::before {
         content: "" !important;
         display: block !important;
         position: absolute !important;
         left: 0 !important;
         top: 50% !important;
         transform: translateY(-50%) !important;
         width: 3.5px !important;
         height: 20px !important;
         background: #10B981 !important;
         box-shadow: 0 0 10px rgba(16, 185, 129, 0.8) !important;
         border-radius: 4px !important;
       }
       ```
  3. **激活项背景与文字**：
     - 底色设为 deep emerald（`#112F24 !important`），边框设为 `#195A3B !important`，文字与图标设为 `#34D399 !important`。
  4. **折叠态适配**：
     - 侧边栏折叠时必须将光标条定位修正为 `left: 2px !important;`，防止光标条被外边缘裁切。

---

### 守则 5：全站状态持久化与外壳生命周期守则 (Theme Persistence & Shell Lifecycle)

- **规范要求**：
  1. **状态事实源存储**：护眼状态统一持久化至 `localStorage`，同时支持全局聚合键 `qitu.eyecare` 及各端独立命名空间（`qitu.student.eyecare`、`qitu.parent.eyecare`、`qitu.teacher.eyecare`），取值为 `'1'` 或 `'0'`。
  2. **外壳挂载即生效**：在各端外壳宿主组件（`StudentShellHost`、`ParentShell`、`TeacherShell`、`ConsoleLayout`）的 `useEffect` 中，挂载阶段立即检查存储并向 `document.documentElement` 设置 `data-qitu-eyecare="true"`。
  3. **跨端与多页面无缝同步**：各端均派发并监听自定义事件 `qitu-eyecare-change` 与原生 `storage` 事件，实现同浏览器下多标签页与多端一致同步响应。
  4. **防止路由切换与刷新闪烁**：无论用户在哪个页面刷新浏览器，整个外壳（侧边栏、顶栏、底栏）必须首屏即保持护眼暗色，杜绝浅色闪烁。

---

## 三、修改与发布验收清单 (Checklist)

每次对护眼模式进行增量开发或修复后，提交代码前必须逐项核对本清单：

- [ ] **1. 零布局抖动校验**：
  - [ ] 点击右上角护眼开关来回切换，三栏布局高度、外边距、内边距无任何跳动。
  - [ ] 切换按钮本身文案与呼吸点正常过渡，无多余顶部横幅出现。
- [ ] **2. 刺眼白底巡检**：
  - [ ] 学生端：输入框及“语音/图片/文件”三键无白底，白板/公式/图表无白底，仿真卡片无白底。
  - [ ] 学生端：“从一个想法开始”与“当前项目”中的单字封面占位符（如“光”）底色为暗色 `#15181D`、文字为翡翠绿 `#34D399`，无白底。
  - [ ] 学生端：“成长轨迹”中“从今天开始记录”内的所有三元统计小卡片（`StatTriple`）无白底。
  - [ ] 家长端：首页欢迎横幅、孩子芯片、KPI 指标卡、当前项目、关注卡片、成长摘要、作品成果无白底。
  - [ ] 教师端：工作台横幅、4项指标卡、关注学生条目、工作台快捷操作（`.qtx-quick-action-link`、`.qtx-quick-action-tip`）无白底。
  - [ ] 教师端：学生名册表格选中行（`tr.selected`）、演示学生详情头部（`.qtx-student-detail-header`）、子项目/介入/成长卡片无白底。
  - [ ] 教师端：Agent 协作记录标题旁“刷新”按钮（`.qtx-agent-refresh-btn` / `.qitu-button-ghost`）及协作图/活动流卡片（`.qitu-team-run-graph`、`.qitu-team-activity`、`.qitu-team-node`）无白底。
  - [ ] 管理员端：顶栏、横幅 `.admin-hero-banner`、6项指标卡 `.admin-stat-card`、治理列表 `.admin-data-table`、模型与设置面板无白底。
  - [ ] 管理员端：“学生数据统计”导航激活条与页面标题光标指示条为翡翠绿（`#10B981`），周期切换按钮激活态为深绿底薄荷绿字，全局输入光标为翡翠绿。
  - [ ] 管理员端：“关系绑定”主面板、统计小卡、选项卡、表单以及行内操作按键（“换班主任”、“结束关系”、“结束分配”）与二次确认弹窗无白底漏光。
  - [ ] 管理员端：“启途智学管家”窗口全量对齐学生端 AI 搭档护眼规范，画布底色、侧栏、顶栏、消息气泡、工具步骤、产物卡片与输入区无白底。
  - [ ] 管理员端：“模型与设置”各子页面卡片、折叠密集表单、Multica 团队工作台与模态弹窗全部消除白底框。
  - [ ] 管理员端：“启途智学管家”对话框上方控制药丸（“交互助手”、“团队”、“思考强度”、“模型”、“权限”）及快捷跳转“快速转至设置库”消除浅白底，采用纯黑底色与翠绿标签。
  - [ ] 管理员端：“模型与设置”所有页面中的深色字体（`#102a5c`、`#1e293b`、`#1d2129` 等）全部转为高对比度纯白（`#FFFFFF`）。
  - [ ] 管理员端：“AI 助手”卡片全部转为纯黑深色底色 + 纯白高对比文字，角色药丸与编辑按键为深森林绿，头像框为黑底翠绿边框。
  - [ ] 管理员端：“设置总览”中的“全栈协同”横幅底色转为纯黑（`#000000`）；所有卡片 Emoji 图标容器统一为纯黑底色配翠绿发光边框（`#10B981`）。
  - [ ] 管理员端：“工作区”下各页面（设置总览、账号设置、团队工作区、知识库、技能中心等）任何存在文字的卡片、输入框、表格与面板底框全面消除白底，统一为黑色背景 + 纯白文字。
  - [ ] 管理员端：AI 助手卡片与技能中心“被谁使用”纯净渲染原生 Emoji，杜绝退化为 alt 字符串；头像框为黑底翠绿边框。
  - [ ] 管理员端：“模型接入”通道名称前 Logo 卡片为黑底绿边纯白文字；“协议”与“状态”全面消除浅白底，分别转为深森林绿与暗色调；操作列按键防折行；全量字体纯白。
  - [ ] 管理员端：“工具与 MCP”全页面容器、授权矩阵卡片与内置工具卡片彻底消白，为纯黑底色与纯白文字。
  - [ ] 管理员端：“生态插件”卡片消除白色背景，“标准化接入协议”横幅为黑色底色纯白文字绿色发光边框。
  - [ ] 管理员端：“内容与数据”四大子页面（知识中心、项目模板库、学情画像与轨迹、数据库与初始化）所有白色卡片、列表项与面板全面转为黑色背景与高对比纯白文字。
  - [ ] 管理员端：“模型接入”操作二级展开面板、模型卡片、分组徽标消白；“技能中心”视图切换按键、搜索框黑底化、只读提示条、标签与被谁使用卡片消白；“工具与MCP”汇总与导师徽标、风险/门禁/注册徽标消白；知识中心搜索框消白；项目模板库“已发布”高对比度显示；“学情画像与轨迹”关键事件流卡片、浅绿审计流/提示条与“能力画像多维评价模型”维度卡片及评定来源框彻底消白并保证高对比可读。
  - [ ] 管理员端：“飞书机器人”汇报助手连接状态（connected）为深森林绿（`#112F24` / `#34D399`）；“模型接入”服务端预置模板“5 个模板已就绪”徽章为纯黑底色翠绿边框纯白文字；下方当前激活模板卡片（如“通义千问（DashScope 兼容模式）”）全量转为黑色背景与翠绿发光边框。
  - [ ] 学生端：“个人画像”登录设备卡片（`.qitu-profile-devices-section`）及设备列表项全面消除浅白底与浅红底，转为柔和夜间深色（`#181B20`），标题为高对比纯白，退出按键为深暗红底。
  - [ ] 管理员端：“模型与设置”-“项目模板库”卡片中“16 课时项目教学编排”（`.admin-template-16session-tag`）全面消白，转为纯黑深色底色配翠绿发光边框（`#10B981`）与纯白文字。
  - [ ] 管理员端：“学情画像与轨迹”中“专任助手与证据审核”标签（`.admin-profile-growth-tag`）与“暂无同时启用的专任助手...”状态横幅（`.admin-growth-status-banner`）全面消除浅蓝白底，统一为黑色背景 + 翠绿边框 + 纯白文字；“重新读取配置”按钮（`.admin-growth-reload-btn`）重新设计为深森林绿边框配刷新图标的精致操作按键。
- [ ] **3. 对比度与可读性巡检**：
  - [ ] 学生端、家长端、教师端、管理员端左上角“启途智学”均为高对比度纯白（`#FFFFFF`）。
  - [ ] 无任何深蓝色字体（`#102a5c`、`#1e293b` 等）叠在暗色背景上导致不可见的情况。
  - [ ] 各端操作链接（如“进入灵感空间”、“查看详情”、“成长轨迹”、“查看全部作品”）高对比可见（浅薄荷绿 `#34D399`）。
- [ ] **4. 导航光标与状态巡检**：
  - [ ] 学生端与家长端：左侧导航栏当前激活项左侧展示翡翠绿发光指示光标（`#10B981`）。
  - [ ] 教师端：左侧导航栏激活项左侧展示翡翠绿发光指示光标（`#10B981`）。
  - [ ] 激活项底色为深森林绿（`#112F24`），文字与图标为薄荷绿（`#34D399`）。
  - [ ] 鼠标悬停及折叠收起状态下光标位置正常、不被边缘裁切。
- [ ] **5. 持久化与回归测试**：
  - [ ] 在 `/student`、`/parent`、`/teacher` 任意一端开启护眼模式后刷新页面，暗色状态保持。
  - [ ] 运行自动化测试：`pnpm --filter @qitu/student-center test`（28 项全部 PASS）。
  - [ ] 运行教师端链接守护测试：`pnpm --filter @qitu/teacher-workspace test`（4 项全部 PASS）。
  - [ ] 运行 UI 包动效与品牌规范测试：`pnpm --filter @qitu/ui test`（全部 PASS）。
  - [ ] 运行全量构建：`pnpm --filter @qitu/parent-companion build`、`pnpm --filter @qitu/teacher-workspace build`、`pnpm --filter @qitu/admin-console build`（Code 0）。
  - [ ] 运行文档校验：`python3 tooling/validate-docs.py`（PASS）。
