# 启途智学夜间暗色护眼模式改造守则

> 文档定位：记录学生端 AI 搭档及全站主外壳在实现“夜间暗色护眼模式”过程中的核心设计标准、技术踩坑经验与不可破坏的修改守则。
> 适用范围：`apps/student-center`（学生端）全页面、`packages/ui`（外壳与基础组件）、以及后续各端暗色/护眼模式的适配开发。

---

## 一、背景与设计基线

夜间暗色护眼模式旨在为长时段进行项目式探究学习（PBL）的学生提供温润、低眩光、沉浸式的视觉环境。设计基线参考标准色谱（色温区间 2700K~3200K，有效滤除高能蓝光刺激，降低视觉疲劳度）。

### 1.1 标准色阶规范

| 色彩角色 | 色值 | 用途与约束 |
| :--- | :--- | :--- |
| **画布底色 (Canvas)** | `#121417` | 页面最底层底色，消除一切白底漏光 |
| **表面底色 (Surface)** | `#181B20` | 主侧边栏、对话历史侧边栏、主外壳顶栏 |
| **卡片底色 (Card)** | `#1E2228` | 消息气泡、对话卡片、仿真框、白板底色 |
| **激活深绿 (Primary Soft)** | `#112F24` | 导航激活项底色、状态徽标底色、开关按钮开启态 |
| **边框暗线 (Border Subtle)**| `#252A33` / `#2E3540` | 分割线、卡片边框、浅灰色弱对比边缘 |
| **边框微绿 (Border Accent)**| `#195A3B` | 激活项边框、护眼开启态边框 |
| **翡翠主绿 (Accent Emerald)**| `#10B981` | 激活光标条（Indicator Bar）、悬停强调、呼吸光点 |
| **浅薄荷绿 (Mint Light)** | `#34D399` | 激活文字、状态字样、绿色高亮强调文本 |
| **高对比纯白 (Heading White)**| `#FFFFFF` | 左上角“启途智学”平台品牌名称、核心层级标题 |
| **次级浅灰 (Text Main)** | `#E2E8F0` / `#F1F5F9` | 消息正文、卡片正文、输入框录入文字 |
| **弱化灰阶 (Text Muted)** | `#94A3B8` / `#CBD5E1` | 次要描述、占位符、未激活图标、标签说明 |

---

## 二、五大核心修改守则

### 守则 1：零布局抖动原则 (Zero Layout Shift)

> [!CAUTION]
> **绝对禁止因开关护眼模式而产生任何页面高度、外边距、内边距或元素布局的跳动（Cumulative Layout Shift, CLS）。**

- **历史教训**：在早期实现中，开启护眼模式后在页面顶部插入了“夜间暗色护眼模式已开启 · 柔光低眩光暗色显示…”的大型信息横幅，导致整个三栏工作台下沉数十像素，用户来回切换时发生剧烈抖动。
- **治理守则**：
  1. 状态提示必须**内聚于右上角切换按钮**本身（例如：按钮文案变为 `护眼模式 (已开启)`、带绿色微光呼吸点 `qitu-eyecare-pulse-dot`）。
  2. 严禁在工作区视口内新增或移除占位 DOM 节点。
  3. 切换前后只通过属性选择器 `:root[data-qitu-eyecare="true"]` 进行 CSS 样式重着色，保证几何尺寸、边距与网格排版分毫不动。

---

### 守则 2：刺眼白底全深度消除守则 (Glaring White Elimination)

> [!WARNING]
> **在夜间暗色模式下，任何未被覆盖的纯白背景（`#FFF` / `#FFFFFF` / `rgb(255,255,255)`）都会造成刺眼光斑，彻底摧毁护眼体验。全局变量覆盖不足以解决局部硬编码白底问题。**

开发与维护时必须依序巡检并覆盖以下 6 大类区域：

1. **输入区域 (Composer)**：
   - 文本录入框、外围边框、阴影重置。
   - 底部工具栏的“语音输入”、“图片”、“文件”上传按钮（必须覆盖其独立类名，不可漏掉 hover 与 focus 状态）。
   - 快捷 Prompt 引导芯片。
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
6. **侧边栏与收起/展开控制器**：
   - 历史会话顶部收起键（`.qitu-live-session-sidebar .qitu-button-ghost`）。
   - 主侧边栏底部收起控制器（`.qitu-sidebar-toggle`）。
   - 页面内所有 `button[aria-label*="收起"]` 通用按键。

---

### 守则 3：暗色底深蓝文字对比度防御守则 (Dark Blue on Dark Defense)

> [!IMPORTANT]
> **深蓝色字体（如 `#102a5c`、`#132646`、`rgb(16, 42, 92)`）在亮色模式下对比度极高，但在暗色模式下对比度低于 1.3:1，属于严重不可见缺陷。**

- **典型案例**：左上角品牌标题“启途智学”（`.qitu-sidebar-name`），因默认继承 `--qitu-heading` 深蓝，在暗色侧边栏背景上几近隐形。
- **守则规范**：
  1. **品牌标题强制纯白**：
     ```css
     :root[data-qitu-eyecare="true"] .qitu-sidebar-name,
     :root[data-qitu-eyecare="true"] .qitu-sidebar-brand strong {
       color: #FFFFFF !important;
     }
     ```
  2. **正文与次级信息灰阶分层**：
     - 主要标题与强调：`#F1F5F9`
     - 正文文字：`#E2E8F0`
     - 弱化辅助字：`#94A3B8`
  3. **属性选择器全局拦截防御**：
     - 对于任何内联注入或第三方遗留的深蓝文字，在 `eyecare-night.css` 中采用子串选择器进行统一提升：
     ```css
     :root[data-qitu-eyecare="true"] [style*="color: #102a5c"],
     :root[data-qitu-eyecare="true"] [style*="color: rgb(16, 42, 92)"],
     :root[data-qitu-eyecare="true"] [style*="color: #132646"] {
       color: #E2E8F0 !important;
     }
     ```

---

### 守则 4：导航光标与类名契约守则 (Navigation Indicator & Class Contract)

- **历史教训**：
  1. 样式文件中曾使用猜测的类名 `.qitu-student-nav a`，而 `@qitu/ui` 实际渲染结构为 `<aside className="qitu-sidebar">`、`<nav className="qitu-sidebar-nav">`、`<a className="qitu-nav-item is-active">`，导致样式从未生效。
  2. 基础品牌库 `brand.css` 中设置了 `.qitu-nav-item.is-active::before { display: none; }`，导致垂直指示光标条被隐藏。
- **守则规范**：
  1. **必须以实际 JSX/DOM 结构为唯一事实源**：修改样式前务必核对组件真实输出（如 `@qitu/ui` 中的 `shell.tsx`），严禁臆造选择器。
  2. **激活指示光标条（Indicator Bar / `::before`）**：
     - 恢复显示：`display: block !important;`
     - 翡翠发光绿：`background: #10B981 !important; box-shadow: 0 0 10px rgba(16, 185, 129, 0.8) !important;`
     - 尺寸与倒角：宽 3.5px、高 20px、圆角 4px。
  3. **激活项背景与文字**：
     - 底色设为 deep emerald（`#112F24 !important`），边框设为 `#195A3B !important`，文字与图标设为 `#34D399 !important`。
  4. **折叠态（`is-collapsed`）适配**：
     - 由于侧边栏设有 `overflow-x: clip`，折叠时必须将光标条定位修正为 `left: 2px !important;`，防止光标条被外边缘裁切。

---

### 守则 5：全站状态持久化与外壳生命周期守则 (Theme Persistence & Shell Lifecycle)

- **规范要求**：
  1. **状态事实源存储**：护眼状态必须统一持久化至 `localStorage.getItem('qitu.student.eyecare')`，取值为 `'1'` 或 `'0'`。
  2. **外壳挂载即生效**：在 `apps/student-center/app/student-shell.tsx` 的 `StudentShellHost` 中，挂载阶段（`useEffect`）立即检查存储并向 `document.documentElement` 设置 `data-qitu-eyecare="true"`。
  3. **防止路由切换与刷新闪烁**：无论用户在“今天”、“我的项目”还是“AI搭档”页面刷新浏览器，整个外壳（侧边栏、顶栏、底栏）必须首屏即保持护眼暗色，杜绝浅色闪烁。

---

## 三、修改与发布验收清单 (Checklist)

每次对护眼模式进行增量开发或修复后，提交代码前必须逐项核对本清单：

- [ ] **1. 零布局抖动校验**：
  - [ ] 点击右上角护眼开关来回切换，三栏布局高度、外边距、内边距无任何跳动。
  - [ ] 切换按钮本身文案与呼吸点正常过渡，无多余顶部横幅出现。
- [ ] **2. 刺眼白底巡检**：
  - [ ] 对话输入框及“语音/图片/文件”三键无白底。
  - [ ] 对话中生成的白板、数学公式 KaTeX、Mermaid 流程图无白底。
  - [ ] 交互仿真卡片（电路/动能/光学）无白底。
  - [ ] 导师团队徽标、学生账号胶囊、所有“收起”按键无白底。
- [ ] **3. 对比度与可读性巡检**：
  - [ ] 左上角“启途智学”为高对比度纯白（`#FFFFFF`）。
  - [ ] 无任何深蓝色字体（`#102a5c` 等）叠在暗色背景上导致不可见的情况。
- [ ] **4. 导航光标与状态巡检**：
  - [ ] 左侧导航栏当前激活项左侧展示翡翠绿发光指示光标（`#10B981`）。
  - [ ] 激活项底色为深森林绿（`#112F24`），文字与图标为薄荷绿（`#34D399`）。
  - [ ] 鼠标悬停及折叠收起状态下光标位置正常、不被边缘裁切。
- [ ] **5. 持久化与回归测试**：
  - [ ] 在 `/student/tutor` 开启护眼模式后刷新页面，暗色状态保持。
  - [ ] 跳转至 `/student/today` 或 `/student/projects` 并刷新，暗色外壳依然保持。
  - [ ] 运行自动化测试：`pnpm --filter @qitu/student-center test`（28 项全部 PASS）。
  - [ ] 运行全量构建：`pnpm --filter @qitu/student-center build`（Build Code 0）。
