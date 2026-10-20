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
