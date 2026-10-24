# 两项目录屏验收：视觉与交互独立审计

状态：两个项目均已完成 8/8，已复核最终 build `qHOvk6OE_mu5uH9HMW_rF`、全服务重启后的历史和主要显示修复；T20/T21/T22 的作品源码与复制链路已完成线上复验。本文由视觉审计 agent 独立维护，所有业务源代码修改由主 agent 统一发布；审计没有登录公共学生账号。下文保留修复前证据，最终处置以[去重登记表](20261024-recorded-journey-issue-registry.md)及其 JSON 为准。

## 范围与证据分层

- 本轮目标：逐课检查首屏可发现性、课件和问答衔接、按钮状态、错误恢复、动态演示、移动端、全屏和历史回看。
- **本轮录屏**：仅在已亲眼查看对应截图/视频帧后标记“本轮视觉确认”；具体动作和服务端状态另引用 journey agent 的动作日志。
- **既有截图**：只能说明截图当时的表现，不替代本轮上线版本验收。
- **源码风险**：仅说明可能发生的行为，不写成生产复现。
- 严重程度：P1 阻断学习/无法恢复或误导完成；P2 明显妨碍操作、理解或回看；P3 一致性与可读性问题。
- 用户要求录屏。截图本身不能证明动画运行、交互成功或完整完成全部课时；连续录像和带时间戳的动作日志应共同保留。

## 审计矩阵

| 范围 | 光学应检查 | 雷霆战机应检查 | 当前证据状态 |
| --- | --- | --- | --- |
| 首屏/下一步 | 第一课开场、学习区和当前目标可见 | 第一课开场、代码与游戏目标易理解 | 本轮 V10/V12；自动滚动已修复 |
| 课件呈现 | 每概念图示、空白、重复、历史可见 | 板书是否足够支撑实际编码和运行 | 本轮 V13/V18、T12；两项目8课已完成 |
| 问答与推进 | 课程最后一步进入问题、错答/求助 | mastery 和普通表达的答题入口 | 本轮 V11/V17、T13 |
| 禁用/失败恢复 | 预测、门禁、来源失败有明确下一步 | 提交/评价失败可恢复，不重复抄答案 | 本轮 V14/V17 |
| 动态效果 | 播放、暂停、滑块和观察对应、清晰度 | 站内是否能操作/运行游戏，外部步骤是否清楚 | 光学第3课正式动态实验成功；战机外部运行 |
| 移动端/全屏 | 390px 的图、按钮、轴标和记录面板 | 390px 代码/提交表单与按钮 | 本轮 V01/V02/V05/V19 |
| 历史回看 | 原课件、预测/观察、原题和反馈 | 原题、代码版本、评价、完成回执 | 光学第3课 V20 仍缺观察原文；八课历史重启后保留 |

## 已有证据的独立视觉复核

### V01 / P2：手机端传播示意缩得过小，图内文字无法正常阅读

证据层：**亲眼查看既有截图，后续已在本轮第3课重现**。历史位置：[optics-mobile.png](assets/20261024-dynamic-experiment-visible/optics-mobile.png)，390px 视口，图中“单色光源/双缝/光屏”明显小于同卡片正文；图占用约 185px 宽，而外层仍有多重卡片留白。

源码对应：`WaveOpticsScene.tsx:41` 使用 680 宽的 SVG viewBox，`WaveOpticsScene.module.css:7` 按父宽完整缩放，图内字为 17 个 SVG 单位。若显示宽约 185px，文字随之缩至约 4.6 CSS px；这是由布局计算的说明，需本轮读取实际 DOM 尺寸后量化。单纯“没有横向溢出”不足以判定手机可用。

建议：手机改用更少嵌套留白、图外可读标签或分段示意；提供显式放大。保持科学语义和比例说明，不以位图放大替代真正可读布局。

### V02 / P2：多个滚动容器割裂学习内容和提交区

证据层：**亲眼查看既有截图**。同一手机截图同时出现页面滚动条、聊天内容滚动条和输入框内滚动条；输入区占据下半屏，传播图、屏幕条纹、说明无法同屏查看。[第 3 课战机记录截图](assets/20261024-autonomous-fullflow-live/thunder-lesson-3-records.png)还显示记录内容嵌入窄滚动区，顶部项目/课时汇总占用大量高度。

当前不能从单张图断言滚动陷阱或遮挡点击；本轮需观察手指/鼠标滚动目标、键盘弹出及滚动到报错/下一步的行为。

### V03 / P2：历史中旧“需要修改”反馈与最终完成并置，缺少明显的版本关系

证据层：**亲眼查看既有截图**。[光学第 2 课记录](assets/20261024-autonomous-fullflow-live/zero8-lesson-2-records.png)、[战机第 3 课记录](assets/20261024-autonomous-fullflow-live/thunder-lesson-3-records.png)顶部均显示完成 8/8，下方可见旧“需要修改”及否定反馈。保留失败记录是必要的，但该视图未在可见范围说明“这次提交已由哪次修订替代”。这会让学生难分当前阻塞和历史失败。

建议：在历史条目旁明确“历史版本/后续已修正”的关联；当前活动只突出仍然有效的阻塞，历史评价仍原样保留。

### V04 / P2：板书是流程图，并不等于可操作演示

证据层：**亲眼查看既有截图 + 源码**。[光学板书](assets/20261024-autonomous-fullflow-live/zero8-board.png)呈现光源→单缝/双缝→光屏的分类关系，未呈现真实缝位置和条纹对比；[战机板书](assets/20261024-autonomous-fullflow-live/thunder-board.png)呈现循环步骤，没有可操作飞机/子弹。两张截图文字清楚、流程关系可辨，不能将“缺交互”描述成渲染失败。

源码中普通 BoardBlock/课件协议为分步图示和公式；动态实验由独立注册组件提供。需在每个关键概念明确“这一步是图示还是操作”，并让下一题引用刚观察的变量。

### V05 / P3：手机顶部项目名截断且重复出现夜间模式入口

证据层：**亲眼查看既有截图**。[optics-mobile.png](assets/20261024-dynamic-experiment-visible/optics-mobile.png)顶部昵称和项目标签截断，页面头部与“教学会话已连接”同行均有夜间模式按钮。问题是空间占用和定位信息不足，不能仅因截断断言功能不可用。

建议：在窄屏保留当前项目/课时定位，合并重复入口；若调整冻结导航，应先走产品文档要求。

## 源码风险，等待录屏验证

| 编号 | 优先级 | 风险与源码 | 必须观察的行为 |
| --- | --- | --- | --- |
| V06 | P1 | `LessonNextStep.tsx:25` 明示聊天回答不成为活动记录；`LessonWorkPanel.tsx:144` 仍另有回答表单 | 学生回答后是否仍被要求复制到侧栏；是否知道还欠什么 |
| V07 | P2 | `LessonWorkPanel.tsx:177` / `:181` 合并多种禁用条件，没有按钮附近逐项原因；仅上方 blockers | 禁用“保存/完成”时，用户是否无需翻找就能知道缺项 |
| V08 | P2 | `LessonCoursewareCard.tsx:125` / `:126` 补讲使用泛化“当前概念”，不带当前选中实例 | 选历史课件后求助是否讲错对象；已读概念能否补讲 |
| V09 | P2 | `WaveOpticsScene.tsx:39` 减少动态效果设置会禁用播放按钮 | 已启用减少动态时文案是否足够解释，不误以为动画坏了 |

## 本轮录屏问题

新项目：光学 `proj-6de90ad2-3fc8-42a9-85f6-536864069958`；战机 `proj-3a7de977-7991-4442-84ce-6db301e10495`。两者通过学生真实界面确认创建，独立录屏。截图清单见 [reviewed-evidence.json](assets/20261024-recorded-journey-visual-audit/reviewed-evidence.json)。下述时间来自各 journey 日志相对开始时间，最终视频封装后还需校准播放器时间。

### R00 / 测试边界：新项目不等于无既存掌握证据的新学生

证据层：**主 agent 账户入口调查结论**。线上没有可用的正常开户入口，本轮两个项目分别占用演示学生的两个设备会话；视觉审计不另行登录。演示学生此前已有学习证据，不能把本轮新项目说成“全新学生零掌握度”。具体是否继承 mastery 由 journey 的只读开场状态记录核对；不清空生产掌握记录或注入假门禁来制造新生条件。

后续需要可丢弃隔离新生环境或正常受治理的合成账号入口，才能完整验证首次从零获得理论门禁的过程。本轮仍能真实检验逐课教学、提交、评价、布局和错误恢复。

### V10 / P2：两个项目首次进入都落在内容尾部，开场问题未呈现在视口内

证据层：**本轮视觉确认**。光学约 **00:55** 的[开场截图](assets/20261024-recorded-journey-visual-audit/optics-02-lesson1-opening.png)，战机约 **01:02** 的[开场截图](assets/20261024-recorded-journey-visual-audit/thunder-002-start-thunder.png)，均为 1440×1000。

开场卡的上半部分已在聊天视口上方，只剩底部“我有疑问”等按钮。视口主体是“已保存的学习记录”及课件/提交提示；刚开始第 1 课就突出历史汇总，学生需要主动向上滚动寻找这一轮具体在问什么。截图可证实当时落点，不单凭截图断言每条消息都这样。

建议：首轮或新的教学消息完成时锚定该消息开头/当前任务，而不是无条件滚到历史汇总之后。需要保留学生主动回看时的位置；不要所有刷新都强制滚动。

### V11 / P1：战机开场把课堂回答导向独立记录表单

证据层：**本轮视觉确认（入口和文案）**。战机 **01:02** [截图](assets/20261024-recorded-journey-visual-audit/thunder-002-start-thunder.png)显示“保存本活动的回答与依据”，并明确“对话中的回答不会自动保存为本活动的学习记录”，主按钮为“打开本课记录与评价”。因此该时点不能在原问题下直接完成有回执的作答。

后续战机 T1 **02:12** [聊天回答截图](assets/20261024-recorded-journey-visual-audit/thunder-003-lesson1-answer-in-chat.png)确认回答后仍显示独立保存入口；T1 **06:09** 的记录表单截图已出现另一份待提交回答。执行 agent 确认采用了额外表单保存路径。不能把聊天已发出理解为活动证据已保存。

### V12 / P2：光学首次开场仍需学生主动准备课件

证据层：**本轮视觉确认（课件空状态）**。光学 **00:55** [截图](assets/20261024-recorded-journey-visual-audit/optics-02-lesson1-opening.png)显示“本活动还没有课件，请让 AI搭档读取资料并准备讲解”，同时有“准备本活动课件”按钮。因此是“自动开场未提供课件”，不是“课件渲染失败”或“没有恢复入口”。

光学 agent 报告开场要求比较单缝/双缝，但尚无图可看；该完整问句不在当前截图视口内，需结合后续向上滚动截图确认。对于零基础教学，观察任务所需的图示应随任务出现。

### V13 / P2：要求观察条纹，却只显示公式或文字关系

证据层：**本轮视觉确认**。光学第一段视频约 **02:23–02:24**，第 1 课板书第 2 步说“明暗相间、宽度几乎相等的细直条纹”，[展示区却只有条纹间距公式](assets/20261024-recorded-journey-visual-audit/optics-05-lesson1-board-step2.png)；[第 3 步](assets/20261024-recorded-journey-visual-audit/optics-05-lesson1-board-step3.png)描述中央亮带及两侧条纹，但展示区只有“a 越小 → 衍射越明显”；[第 4 步](assets/20261024-recorded-journey-visual-audit/optics-05-lesson1-board-step4.png)要求比较中央/两侧，却只保留上述文字。

公式没有加载失败，视觉内容与观察任务不匹配。第 1 步[装置关系图](assets/20261024-recorded-journey-visual-audit/optics-04-lesson1-board.png)可读，但不能代替实际单缝/双缝条纹对照。应提供经过审核的理论示意或只读预览，正式实验的门禁仍保留。

### V14 / P1：登录失效后缺乏就地恢复，顶部仍显示会话已连接

证据层：**本轮视觉确认 + journey 请求状态**。光学第一段约 **03:53** [截图](assets/20261024-recorded-journey-visual-audit/optics-11-lesson1-theory-courseware.png)出现“登录已失效（UNAUTHENTICATED）”，可见操作是“关闭提示”；战机第一段 **06:09** [截图](assets/20261024-recorded-journey-visual-audit/thunder-011-theory-save.png)右侧显示“登录已失效”，刚写的回答仍在表单，保存按钮仍为主要蓝色按钮，顶栏依旧显示“教学会话已连接”。没有可见的“重新登录并恢复草稿”路径。

失效原因由主 agent 按发生时段独立核查，不把未经确认的设备挤出或部署行为当作事实，也不归因于课程门禁。本项确认的是失效状态的界面恢复缺口，不能用普通重试无限重复同一个 401。应保留本地待提交内容并引导恢复认证，再由原幂等提交重试。

另一次 **23:28** 中断，主 agent 的 systemd 核对显示 `Stopping → Deactivated successfully → Started`，没有崩溃自动重启记录；timer/cron 未找到相关重启，auditd 未启用，无法追溯调用者。用户确认没有其他部署，因此只能写为**未确认来源的服务管理停止/启动**。认证 session 存在内存、随该次重启失效已确认；不得写成另一个会话或外部部署已证实。

### V15 / P2：学生界面直接显示面向生成器的内部教学指令

证据层：**本轮视觉确认**。战机 **06:09** [截图](assets/20261024-recorded-journey-visual-audit/thunder-011-theory-save.png)中心“保存本活动的回答与依据”下直接显示“用注册 BoardBlock、流程图或坐标示意演示”“没有编程知识库来源时明确是教学示例，不伪称检索过教材”。这是给生成器的执行规则，对零基础学生不构成明确任务。

建议服务端按学生视角投影当前任务与缺少项，把内部教学约束留在模型上下文。真实资料不可用仍应明确告知，但无需向学生解释内部块类型。

### V16 / P2：普通回答显示了两套容易误解的评价状态

证据层：**本轮视觉确认**。光学第 1 课 O2 **04:18** [截图](assets/20261024-recorded-journey-visual-audit/optics-20-lesson1-check-evaluation.png)右侧证据列表为“本版本质量已达标”，同一条回应详情又显示“作品状态：未提交 / 自动评价：尚未申请”。前者是课时表达质量，后者是底层作品审核状态，但界面未解释这层差异。

这不证明服务端评价事实互相矛盾。当前 `LessonWorkPanel` 对普通回答也使用通用 artifact 详情投影，造成学生认为提交没有成功。普通回答应突出其对应活动的保存与质量回执；只有正式作品才展示作品审核/发布状态。

### V17 / P1：评价未完成时，中心下一步仍引导继续教学

证据层：**本轮视觉确认 + journey 操作日志**。战机第 2 课 T2 **06:10** [截图](assets/20261024-recorded-journey-visual-audit/thunder-segment2-028-lesson2-complete-error.png)，右侧说明“记录已保存，自动评价暂未完成，请重试评价”，完成按钮处于禁用。中心仍是“保存本活动的表达与反思”和“继续当前活动”。T2 **06:40** [截图](assets/20261024-recorded-journey-visual-audit/thunder-segment2-029-lesson3-teaching.png)仍在第 2 课，并未进入截图文件名中的“lesson3”。

执行 agent 点击继续后只得到更多板书，需在较深的侧栏找到“重试自动评价”。本轮服务失败的根因由主 agent/请求日志独立核对；视觉缺口是“当前阻塞与首要恢复按钮不在同一处”。应在中心下一步显示当前待评价记录和原地重试，不要求重复回答或重新听课。

### V13 的第 2 课复现

光学 O2 **06:29 / 06:32** 的[亮条纹条件](assets/20261024-recorded-journey-visual-audit/optics-L2-review-0-step2.png)、[暗条纹条件](assets/20261024-recorded-journey-visual-audit/optics-L2-review-0-step3.png)仍只显示公式，没有波形或叠加动画。公式本身可读且显示正常；这再次说明“已生成课件”不等于“零基础所需的动态观察材料已具备”。与 V13 合并计数。

### V18 / P2：把普通中文解释放进公式块，打开侧栏后出现横向滚动

证据层：**本轮视觉确认**。战机第 3 课 [板书截图](assets/20261024-recorded-journey-visual-audit/thunder-segment2-038-lesson3-board.png)将“按住 → 每帧都改位置　按一下 → 只触发一次”作为整行公式展示；1440px 桌面开启右侧记录栏后，中间课件宽约 480px，图示底部已经出现横向滚动条。普通短句仍被迫左右阅读。

建议中文解释使用可换行正文/对照卡，只对数学表达使用公式排版；检查窄屏与侧栏展开后的实际可用宽度，而不只检查页面整体是否溢出。

T2 **12:34** 的[碰撞四条件](assets/20261024-recorded-journey-visual-audit/thunder-segment2-047-collision-step5.png)将4个不等式及“且”排成一整行，右半条件超出展示区，必须横向滚动；这一次是真实长数学表达，也应拆成对齐的多行或逐条件图示。第2步[矩形坐标表示](assets/20261024-recorded-journey-visual-audit/thunder-segment2-044-collision-step2.png)同样出现横滚，但不能据此宣称内容已丢失。

### V01/V02/V05 的手机端本轮复现

光学第 3 课已取得[390px 嵌入模式截图](assets/20261024-recorded-journey-visual-audit/optics-L3-inline-mobile-390.png)：传播图被多层留白压缩到约 190px，图内标签肉眼很难阅读；聊天、页面和输入框各自滚动，输入区占用近半个内容区域；顶栏重复夜间模式入口。上述三项从历史观察升级为本轮确认。

修复后 O3 **01:51** [重复测量截图](assets/20261024-recorded-journey-visual-audit/optics-part3-L3-inline-mobile-390-measured.png)及[实际 DOM 尺寸记录](assets/20261024-recorded-journey-visual-audit/mobile-diagram-measurements.json)：SVG 宽 **192.6667 CSS px**，viewBox 宽 680；图内 17 单位标签最终约 **4.82 CSS px**，13 单位说明约 **3.68 CSS px**。这是本轮实测尺寸的缩放计算，不是从视频压缩清晰度推测。

[390px 全屏截图](assets/20261024-recorded-journey-visual-audit/optics-L3-lab-mobile-390.png)给图留出更多空间，滑块标签与数值可读且没有页面横向溢出，但图内文字仍随 SVG 缩小。[战机第 4 课手机图](assets/20261024-recorded-journey-visual-audit/thunder-segment2-061-lesson4-mobile.png)也显示正文可见区很短，记录侧栏改到下方后还要向下滚动寻找，不能把“无页面横向溢出”视作移动端体验已通过。

### V19 / P3：全屏开关的文案不随实际状态变化

证据层：**本轮视觉确认 + journey 操作**。光学第 3 课[已经全屏](assets/20261024-recorded-journey-visual-audit/optics-L3-lab-fullscreen.png)，右上按钮仍叫“全屏探究”。执行 agent 验证点击同按钮可以退出；因此是标签未提示退出，不是缺少退出能力。应按状态显示“退出全屏”，并保留可访问名称一致。

### 第 3 课动态实验已观察到的正常表现

本轮[首次运行截图](assets/20261024-recorded-journey-visual-audit/optics-L3-lab-first-run.png)中波传播、单色光源和条纹清楚出现；[保存观察后](assets/20261024-recorded-journey-visual-audit/optics-L3-observation-saved.png)有实际两组参数曲线、包络宽度、细纹间距及保存回执。执行 agent 记录正常预测/运行/暂停恢复/全屏操作，d 从 150μm 改成 300μm，间距从 7.33mm 改成 3.67mm，包络宽度不变。这与理论板书缺观察图的 V13 是两条不同能力路径。

本轮一次暂停恢复失败源于测试脚本用了“继续波动演示”，实际按钮是“播放波动演示”，不得计为产品故障。动态组件没有在这些截图中消失或普遍模糊。

### V20 / P1：历史投影显示观察评价与回执，没有原始观察/预测正文

证据层：**本轮实际 DOM 文本 + 源码对应**。O3 **01:50–01:51**，执行 agent 展开第3课历史，`result-35.json` 完整 `text` 中两条“学习回应”均有学生原文；[观察项实际DOM文本](assets/20261024-recorded-journey-visual-audit/optics-L3-history-dom-excerpt.json)只有“本版本质量已达标”、评价说明和“查看保存回执”，没有原始观察或预测正文。[当时截图](assets/20261024-recorded-journey-visual-audit/optics-part3-L3-history-observation-receipt.png)的可见范围仅覆盖学习回应，不能单凭此图证明下方观察项；完整展开观察的截图仍待补。

源码对应为观察回执仅提供 id/digest/rubric 等元数据，历史 `RecordContent` 在没有 artifact 时不输出正文。本项是学生回看投影缺失，不代表服务端原记录丢失。应由现有 owner 提供有对象权限的原观察/预测投影；不能用模型评价摘要替代学生原始证据。

### T12 / 验收边界：外部游戏代码由测试人员补写

战机第4课无站内 Python 执行环境。执行 agent 为继续检查后续提交、评价和作品流程，根据课堂概念补写最小 Pygame 程序，在真实可见窗口运行并录制 `native-lesson4/lesson4-native-window.mp4`（12.5秒、480×640）。已亲眼查看边界截图，可见飞机、坐标和操作说明。

这证明该测试作品可运行，**不能证明平台当前教学足以让零基础学生独立写出该作品**。完整教学验收仍需从安装、窗口、主循环到输入/边界逐段给出可运行增量，学生每一步运行后产生真实证据。不得把测试人员自行补齐的编码能力计为平台教学通过。

### T13 / P1：理论概念回答被要求交可运行代码，与导师解释冲突

证据层：**本轮视觉确认**。战机 T4 **00:48** [保存后截图](assets/20261024-recorded-journey-visual-audit/thunder-segment4-003-lesson4-theory-save.png)右侧拒绝原因是“当前只是概念解释与预测，尚未提供可运行的代码和实际测试输入/结果”；T4 **01:53** [导师回复](assets/20261024-recorded-journey-visual-audit/thunder-segment4-004-theory-needs-code-question.png)明确当前 theory 活动只需解释窗口、循环、边界，可运行代码属于后面的动手制作，当前不用急着交代码。

因此学生同时收到互不一致的下一步指引。界面证据指向“整课作品要求被用于当前普通表达”的评价范围问题；服务端具体根因及修复由主 agent 核查，当前不能标为已解除。本轮同时确认新回复开头已位于视口内，符合 V10 自动滚动修复预期。

后续复测：主 agent 首轮修复评价范围后，T5 **00:58** [同一理论回答重交](assets/20261024-recorded-journey-visual-audit/thunder-segment5-003-theory-resubmit-scope-fix.png)显示新回应“本版本质量已达标”并被选中；执行 agent 确认进入下一活动。**第4课对应分支恢复，但T13尚未彻底解决**：第6课review再次出现尚未实践却要求未来实测的问题，执行agent通过补预测数值例子恢复，不能把补写后的成功当原问题消失。主agent新增按review/theory/check投影流程、示例输入、预测结果一致性标准；冻结原文/ID保持，practice继续原标准，末次修复待部署复测。旧失败记录保留。

### 第 4 课补救教学的可见表现

光学 O3 **06:18 / 06:25** [公式步骤](assets/20261024-recorded-journey-visual-audit/optics-part3-L4-theory-1-step3.png)和[总结步骤](assets/20261024-recorded-journey-visual-audit/optics-part3-L4-theory-1-step5.png)正常渲染，公式、解释和“从头再看”清楚可见。O3 **08:55** [同目标补讲](assets/20261024-recorded-journey-visual-audit/optics-part3-L4-wrong-answer-remediation.png)针对 d 增大时分母变大解释条纹变窄；O3 **09:49** [再次澄清](assets/20261024-recorded-journey-visual-audit/optics-part3-L4-corrected-chat-answer.png)给出装置关系步骤。

执行 agent 报告此前错误回答收到 needs_revision 并主动求助，上述截图能确认补讲内容出现，但没有同时显示错误提交与完整评价，因此成功补救/保存修订以旅程 owner 日志为准。这一组截图没有显示课件空白或无法重看。

### V21 / P2：长板书排在追问之前，首屏仍难发现该回答什么

证据层：**本轮视觉确认 + 执行操作确认**。O3 **09:49** [新回复截图](assets/20261024-recorded-journey-visual-audit/optics-part3-L4-corrected-chat-answer.png)自动定位在回复开头，但可见内容为完整5步板书，启发问题在其后，首屏没有显示。执行 agent 确认本次只发送聊天、等待结束、截图，没有主动滚到板书。

这是回复块排序与内容占高造成的可发现性问题，**不是 V10 再次滚到历史底部**；V10 修复仍有效。下一步可在课件前给出当前学习目标/待回答问题的简短提示，并在末页提供相同问题的有回执作答入口。保留原课件与完整对话，不再通过重复生成另一套板书提醒学生回答。

### O17 / V22 / P1：要求两条观察，界面只说至少一组

证据层：**本轮视觉确认 + 执行 agent 冻结合同核查**。O3 **20:02** [界面截图](assets/20261024-recorded-journey-visual-audit/optics-part3-L4-observation-quality.png)右侧只说明“至少一组受控双缝模拟观察与比较解释”，并继续要求在对话实验保存本课观察。执行 agent 已正常保存并取得一条 accepted 观察，核对冻结合同后才发现当前活动需 **2条**。截图当前视口未展示该 accepted 回执，因此已接受数量以 owner 读取记录为依据。

两条记录要求是既有课程规则，不能为了绕过卡点降低或直接推进。问题是当前已接受数与尚缺数没有显示。本项与 V17 的“评价 pending 不知如何重试”不同：此次一条观察已评价通过，但总数量不足。

修复后同类场景：O4 **14:42** [第6课0/2](assets/20261024-recorded-journey-visual-audit/optics-part4-L6-count-0.png)、**16:05** [第6课1/2](assets/20261024-recorded-journey-visual-audit/optics-part4-L6-count-1.png)明确展示冻结要求与已接受数，并说明同一记录描述多次运行仍只计一条。执行agent记录 **16:40** 第二条真实accepted后活动直接从practice转reflect，因此无需也没有伪造停在2/2的截图。计数显示已上线复测通过，数量与质量要求保持。

### 第 5 课重复素材与物理表达核验线索

证据层：**本轮视觉确认 + 逐页DOM记录**。光学 O4 **04:51** [review第2步](assets/20261024-recorded-journey-visual-audit/optics-part4-L5-review-0-step2.png)和 **05:41** [theory第2步](assets/20261024-recorded-journey-visual-audit/optics-part4-L5-theory-1-step2.png)同标题、不同课件实例，均5页，均由三个子波节点汇入屏上P点，只改写节点称呼。`result-p4-62.json`保存了两份完整逐页文本与不同courseware证据ID。此处确认高度重复，不能仅凭相同标题断言是同一实例重复渲染；并入O08的复用/增量教学改进项，与O03的两处阅读确认不同。

O4 **05:48** [theory第4步](assets/20261024-recorded-journey-visual-audit/optics-part4-L5-theory-1-step4.png)写 `Δr=λ/2, 3λ/2… → 减弱（暗）`，相邻第5步又给单缝 `a sinθ=kλ`。前者没有定义Δr对应哪两个子波/哪段孔径，学生难以区分两波相消与全孔径叠加的条件。这里只登记O04的模型/变量限定不足，待领域核验，**不凭截图把公式宣布为无条件错误**。

### V23 / P2：桌面收窄时长流程图也被整体缩到小字

证据层：**本轮视觉确认**。战机 T5 **10:55** [第5课板书](assets/20261024-recorded-journey-visual-audit/thunder-segment5-027-lesson5-theory.png)在1440px桌面打开右侧记录后，横向多节点循环图缩进约350px展示区，节点文字明显小于上方正文。并非只有手机光学SVG需要检查；Mermaid的长横向布局也需分行/纵向、图外标签或显式放大，避免把“完整塞进卡片”当作清晰可读。没有DOM字号测量，不给出未经实测的精确字高。

### V24 / P2：动态光屏逐次自动缩放，改变缝宽后图面宽度可能看似不变

证据层：**本轮执行记录 + 当前动态图截图 + 源码**。第5课单缝模拟a从20改为40µm，中央宽度读数由110.04变55.01mm；执行agent记录横轴由±88变±44mm。[a40实际动态光屏](assets/20261024-recorded-journey-visual-audit/optics-part4-L5-single-figure.png)清楚显示±44mm和归一化说明，桌面图本身清楚，但没有突出提示本次横轴自动缩放。

`WaveOpticsScene.tsx`按当前run的samples计算extent，并按样本序号铺满680宽光屏；`WaveOpticsExperimentCard.tsx`比较曲线则从全部runs取共同extent。这意味着同屏动态条纹与对照曲线可采用不同横轴范围。**不是数值计算错误**，风险是学生仅看动态条纹时误以为中央带宽没有变化。对照模式宜使用一致毫米范围，或明确显示“横轴自动缩放，请按刻度/下方同尺度曲线比较”。保留服务端模型结果和归一化约束。

### O19 / P1：把近轴中央宽度公式配上相反的适用条件

证据层：**本轮截图 + 原始DOM + 官方教材审核**。光学 O4 **12:27** [第6课theory第5步](assets/20261024-recorded-journey-visual-audit/optics-part4-L6-theory-1-step5.png)同屏展示 `W≈2λD/a`，却将“a与λ可比或更小，且D远大于a”写成适用条件；`result-p4-73.json`的公开回复还把“屏距远”直接作为 `sinθ≈θ` 的理由。

OpenStax 给出单缝暗纹条件 `a sinθ=mλ`，并明确中央角宽 `Δθ≈2λ/a` 使用小角近似；`a≈λ` 时中央峰会很宽。[官方教材4.2节](https://openstax.org/books/university-physics-volume-3/pages/4-2-intensity-in-single-slit-diffraction)。**由该式推论**：若 `a<λ`，第一暗纹要求 `sinθ=λ/a>1`，没有实角解，不能继续把近轴 `2λD/a` 当作由第一暗纹界定的中央宽度。增大屏距本身也不能保证该角度变小。

因此本项已经是有依据的适用条件错配，不仅是未定义变量的O04线索。这里只短述审核依据并链接官方页面，没有复制教材图文作为产品资产。注册实验对参数域的限制仍是正确保护；修复应针对生成内容的模型条件，不放宽工具范围来配合错误课件。

## 本轮逐课视觉覆盖结果

执行 agent 的正式课时结果已是光学 8/8、战机 8/8，完成事实与输入/回执见两份旅程明细。本专题独立审阅关键截图、选定视频帧和相关只读记录，不把抽帧审阅写成逐秒观看全部录像；手机仅覆盖记录中的指定场景，不声称 16 课全部进行了手机独立重跑。

| 项目/课时 | 独立审阅的关键内容 | 结果与剩余问题 |
| --- | --- | --- |
| 光学 1 | 开场、逐步板书、底部课件、401、评价详情 | V10 自动滚动与 V16 状态显示已修；V11/V12/V13 学习衔接缺口保留 |
| 光学 2 | 波叠加亮/暗条件图示 | 完成记录保留；公式代替波形观察仍是 V13 |
| 光学 3 | 双缝动态首次运行、参数比较、手机/全屏、历史观察 | 实验实际运行；V01 小字、V20 原观察正文缺失；V19 全屏文案末次复验通过 |
| 光学 4 | 错答、补讲、修正回答、观察 accepted 后未推进 | 补救可继续；两条观察要求的 O17 计数已在同类第6课复验 |
| 光学 5 | review/theory 重复课件、单缝动态图、历史再运行 | O08 重复与 V24 横轴自动变尺度仍存在；复习播放/重置成功且无 action 写入 |
| 光学 6 | 公式适用条件、观察 0/2→1/2 | O17 已修；O19 科学条件错配仍开放 |
| 光学 7 | 普通回应详情、正式作品已发布详情 | V16 两类质量状态正确区分；作品确实发布 |
| 光学 8 | 末课完成、刷新后八课历史、全服务重启后8/8 | 完成和历史保留；模型归档后回顾可用，不代表所有生成内容正确 |
| 战机 1 | 开场、聊天回答、流程板书、单独记录表单、401 | V10 已修；V11、V14、V15 仍开放 |
| 战机 2 | 评价 pending、误点继续生成板书、重试后恢复 | 正式完成；V17 恢复主动作不突出仍存在 |
| 战机 3 | 碰撞板书与四条长公式 | 正式完成；V18 长公式横向滚动仍存在 |
| 战机 4 | 移动视口、理论评价冲突、勾选保留、外部最小作品 | T10 已修；T13 本课原回答通过后曾在第6课复现，后续补丁另验 |
| 战机 5 | 列表板书、两子弹外部运行、短反思 accepted | T14 同课实践正文引用复验通过；外部作品仍有测试员辅助边界 |
| 战机 6 | 评价复现、错误碰撞题、实测作品、原 Markdown 表格 | T17 内容错误开放；V25 同一历史消息桌面和390px末次复验通过 |
| 战机 7 | 跨课实测遗漏、计划评价通过、发布作品、独立窗口测试 | T13 同类活动修复通过；T19 开场遗漏仍开放；T20/T21/T22 最终线上复验通过 |
| 战机 8 | 认证中断、恢复完成、重启后8/8 | 正式完成和全部历史保留；401归为认证中断，不误写门禁拒绝 |

## 录像质量抽检

- O1 文件 `8006d28648de7421aa9e498753f91af6.webm`：VP8、1440×1000、25fps、347.80 秒，可正常解码。已提取并亲眼核对 [02:23 帧](assets/20261024-recorded-journey-visual-audit/optics-o1-02m23.png)，可见第 4 步文字代替条纹示意。
- T1 文件 `443463992b64261d8fdf900d6c94ddbc.webm`：VP8、1440×1000、25fps、437.12 秒，可正常解码。[06:09 帧](assets/20261024-recorded-journey-visual-audit/thunder-t1-06m09.png)确认登录失效与保留的待提交表单。
- 动作日志和相邻快速翻页存在约 1–2 秒差异，定位时保留前后 2 秒。视频压缩比原 PNG 略软，字体清晰度以原 PNG 和实际 DOM 尺寸为依据，不把转码损失写成产品渲染模糊。
- O3 因测试 harness 未捕获 `waitForResponse` 超时而异常退出，旧进程停止后确认原件不再写入；不是业务服务崩溃。原始 WebM 保留（85,458,944 bytes，SHA256 `1d4e6917d36e266c60668d7189e1b52f0757cb39ca8e04460c602a0ff17b9955`），另用 `ffmpeg -c copy` 恢复容器索引，**没有重新编码**。恢复版时长1285.16秒、1440×1000/25fps，[20:02抽帧](assets/20261024-recorded-journey-visual-audit/optics-o3-20m02.png)已亲眼核对正常。`O3-remux-provenance.json` 记录命令、源/目标哈希及尾部提前结束警告，不能把恢复版称为完整无中断录屏。

## 已完成的最小修复：V10 自动滚动

源码：`ChatThread.tsx`、`lib/threadScroll.ts`、`lib/threadScroll.test.ts`。保留工作树原有课件历史、实验索引及探索入口修改，只替换滚动策略并增加稳定 turn 锚点。

- 正式项目首轮和新回复定位消息起点，不再定位位于消息之后的历史汇总/学习区底部。
- 同一 turn 的流式增长、课件翻页或进度刷新不重新抢滚。
- 学生正在读旧消息时不追随新回复；主动提交新消息后恢复跟随。
- 切换会话在新会话数据就绪后定位，探索开场保持原来的顶部行为。

验证：5 个滚动决策测试通过；6 个 headed Chromium + 实际 ChatThread React DOM 隔离回归通过。渲染夹具对非滚动子组件使用替身，验证首屏、新回复、流式增长、旧消息阅读、主动提交恢复、切会话。[隔离验证结果](assets/20261024-recorded-journey-visual-audit/isolated-scroll-verification.json)。这不代表完整线上组件、真实课件加载或部署验收已通过；等待主 agent 发布及 journey 原会话复测。

发布后 T4 **01:53** 实际回复截图显示新消息从开头呈现，没有再次被带到尾部历史。原位置保留、流式增量等边界仍以上述隔离行为测试为证据，不能单张截图覆盖全部滚动路径。

## 本地录像审阅包

`.codex-tasks/20261024-recorded-journeys/review/index.html` 可直接打开，`manifest.json`/`manifest.js` 提供问题与课时索引；点击问题跳到对应视频时间并查看原始 PNG。首批保留 O1/O2/T1/T2 原始 WebM（1440×1000、VP8，共216,463,635 bytes），后续已封装视频继续加入。正在录制的片段明确标为未封装。

此目录由 Git 忽略，只用于本地审阅，不发布公共网站，不包含浏览器认证/状态文件。6 项 headed Chromium 检查通过：原尺寸、跳时间、项目/课时筛选、原PNG、未封装片段提示、390px页面无横溢；结果为同目录 `verification.json`。这些是审阅工具检查，不是产品课时验收结果。

## 对主 agent 修复的独立回归

主 agent 修改 `CurrentLessonCard` / `LessonWorkPanel`，使同课最后一个活动结束时保留合法的已选证据，并按记录类型显示课时质量或作品审核状态。视觉 agent 使用实际这两个 React 组件及只读 owner 替身执行 headed Chromium 回归，没有修改生产数据。

前 6 项通过后，追加“作品活动 → 普通表达活动”发现新回归：因为组件不再随活动重挂载，记录类型遗留为 artifacts，保存按钮可能被 evidence 类型检查禁用。已将失败返回主 agent；其修复类型选择后重新运行 **7/7 通过**，包含末活动保留选中/清草稿、普通 accepted 回执、换课重置、planRevision 重置、真实作品审核状态、移除证据过滤、活动切换类型重置。[验证结果](assets/20261024-recorded-journey-visual-audit/isolated-lesson-work-verification.json)。

这些结果只证明隔离 DOM 行为；部署与线上原路径复测独立记录。

T10线上复测：T5 **08:41** [末活动评价通过后](assets/20261024-recorded-journey-visual-audit/thunder-segment5-020-reflection-retry-after-readback.png)合法证据仍被勾选，完成按钮可用；T5 **09:20** [第4课完成](assets/20261024-recorded-journey-visual-audit/thunder-segment5-022-complete-lesson4.png)已进入第5课。当前活动结束导致勾选清空的问题已在真实路径解除。该画面同时保留旧拒绝与新accepted反馈，仍应明确历史/当前关系（V03），不能删除旧反馈。

T14后续同类场景复测：T6 **07:22** [第5课短反思保存后](assets/20261024-recorded-journey-visual-audit/thunder-segment6-016-lesson5-reflection-save.png)显示accepted与有效勾选、完成按钮可用；T6 **08:15** [进入第6课](assets/20261024-recorded-journey-visual-audit/thunder-segment6-019-complete-lesson5.png)。执行agent确认这次只写反思并引用同课已保存的实践，不再贴完整代码。它证明修复在第5课同类场景有效，**不是第4课原失败输入的逐字重放**。

## 去重映射与当前处置分类

同一根因在多课多次出现保留多个定位点，但不重复计为独立缺陷。下表状态与主 agent、journey 复测同步；未复核的源码风险不升级为线上故障。

| 映射 | 独立问题/边界 | 当前分类与证据 |
| --- | --- | --- |
| V10 | 自动滚到历史尾部 | **已修复并有线上复测**：T4 01:53新回复起点可见，隔离5+6通过 |
| T10 | 末活动完成重挂载导致勾选清空 | **已修复并有线上复测**：T5 08:41选中保留、09:20课时完成，隔离7通过 |
| T13 | 理论/回顾被未来代码与实测标准拒绝 | **新活动范围投影已发布，同类第7课 review/theory 通过**；不是第6课原拒绝文本逐字重放，不外推所有评价永久稳定 |
| V16 | 普通回应误显示artifact审核状态 | **已发布，隔离复测通过**；同类线上详情独立截图仍待补 |
| O06 | AI追问未纳入公开对话上下文 | **已发布，本轮补救衔接恢复可见**；不等于所有自然问答分支已覆盖 |
| T11 | 已有实践权限仍被AI口头称门禁未通过 | **已发布，回复已明确纠正**；没有对应门禁拒绝API，不能报告绕过门禁 |
| I03；V08独立风险 | 已读概念补救去重；历史实例求助指向 | **I03 隔离回归通过、专项线上未完成**；V08 的历史选择指向仍独立列未确认风险，不能合并宣称全部修好 |
| I04 | 旧失效来源阻断有效当前课件 | **隔离修复通过**；未在生产伪造过期来源，不冒称本轮失败复现 |
| O17 / V22 | 两条观察要求缺当前计数 | **已上线并在第6课复测通过**：0/2→1/2，第二条accepted进入reflect；数量要求本身是正确保护 |
| T14 | 反思评价看不到本课已accepted的practice正文 | **已发布，同类第5课短反思通过**：评价上下文此前遗漏session_response；T6 07:22证据，明确不是第4课原输入重放，不与T13混并 |
| T09 / V17 | 评价失败后的恢复动作不突出 | **本次通过重试恢复，UI缺口仍存在**；模型引用失败与中央下一步错误分开记录 |
| T15 | responses请求502 | **单次重试已恢复，根因未证实**；主agent确认API未重启，不归为401 |
| V14 | 认证失效的恢复/连接文案 | **旅程会话已恢复，产品恢复入口仍缺**；与T15的502不同 |
| V06 / V11 / I01–I02 | 聊天回答和正式证据表单分离 | **仍存在**，同一提交衔接问题合并计数 |
| V12 / O01 | 开场观察任务尚无配套课件 | **仍存在**；准备按钮可恢复，不是渲染失败 |
| V04 / V13 / O02 | 公式/框图代替要求观察的现象 | **仍存在**；理论展示缺口与正式实验成功并存 |
| O03 | 聊天板书与本课课件阅读进度分离 | **仍待完善**；完整历史保留不代表阅读确认已统一 |
| O08 / O10 | review/theory/check反复生成高度近似课件 | **仍存在**；与同实例两处阅读进度不同，不混并O03 |
| O04 | 生成解释的物理模型限定不足 | **待领域逐条核验**；不把存在引用当作科学正确证明 |
| O19 | 近轴单缝宽度公式的适用条件错配 | **官方教材与本轮截图核验确认**；独立于O04未定义路径差对象，注册参数保护正确 |
| V01 / V02 / V05 | 手机标签缩小、正文高度和重复入口 | **本轮已复现，仍存在**；三种不同布局现象，不拿“无横溢”代替可用 |
| V15 / V18 / V21 / V23 | 内部术语、长公式、问题在长板书后、流程图缩小 | **本轮已复现，仍存在**；分别保留证据定位 |
| V19 / O12 | 全屏按钮文案不随状态变化 | **最终版本实测通过**；O5 00:43/00:44 两态文案与 aria-pressed 相符 |
| V25 | 历史 Markdown 表格裸露管道符 | **最终版本实测通过**；T13 02:15/02:16 原历史消息桌面与390px横滚均已独立看图 |
| T20 | 已发布作品代码吞入后续说明 | **已修复并完成线上复验**；最终展示源码 125 行、`ast.parse` 通过，且与真实运行版本一致 |
| V24 | 单次动态横轴自动缩放与比较曲线尺度不同 | **执行记录/源码确认，仍存在**；不是计算错误，需清晰表达比较尺度 |
| V20 | 观察历史缺原始正文投影 | **本轮DOM确认，仍存在**；不等于服务器原记录丢失 |
| V03 | 历史失败与当前成功关系弱 | **历史及本轮可见**；保留真实失败，补版本关联，不能删记录 |
| V07 / V09 | 泛化禁用/减少动态提示 | **源码风险**，没有足够本轮证据宣称独立线上缺陷 |
| R00 / T12 | 既存mastery/测试人员补写程序 | **验收限制**。最小可运行代码后续已在线出现（journey记录），仍不能倒推早期学生已独立学会 |

**正确保护，不计为故障**：保留TheoryMastered真实门禁；实验前先提交预测；错误回答接受质量反馈并同目标补救；冻结活动要求两条观察时一条不能完成；代码运行声称需有真实运行与输入/结果依据。仅对错用标准、遗漏已有证据、缺少清晰计数或恢复入口进行修复。

**测试脚本异常，不计为产品故障**：把“播放波动演示”写成“继续波动演示”造成定位超时；O3预建`waitForResponse`没有匹配请求、超时未捕获导致录屏中断；独立审阅页面首次测试发现其自身hidden样式被覆盖已修正。此类事件保留在录制/测试日志，不用作产品卡点数量。

## 第6–7课新增证据与修复复核

补充到 2026-10-25 00:24，旅程仍在继续：

- **V16 / O07 已有独立线上近景复核**：O4 约 34:41 的[普通学习回应详情](assets/20261024-recorded-journey-visual-audit/optics-part4-L7-normal-response-detail-fixed.png)清楚显示“学习记录已保存。本版本质量已达标”，保留学生正文；同批[正式作品详情](assets/20261024-recorded-journey-visual-audit/optics-part4-L7-artifact-published-detail.png)仍正确显示已发布、已通过。这补齐了此前第3课截图只拍到列表的证据缺口。
- **T13 未宣称彻底解决**：[第6课回顾](assets/20261024-recorded-journey-visual-audit/thunder-segment7-003-lesson6-review-save.png)再次出现“这是回顾与计划”但仍要求实际代码和实测的矛盾评价。活动标准投影补丁于 00:18:17 启用，需继续验证相同阶段，不用第4课单次恢复覆盖此复现。
- **T17 内容错误已独立确认**：[导师纠正截图](assets/20261024-recorded-journey-visual-audit/thunder-segment7-008-lesson6-question-ambiguity.png)明确承认原题错误：唯一子弹已经删除，就不能直接凭子弹速度与敌机高度推导后续帧重复加分。学生质疑后改题能继续，但不代表生成前检查已经解决。
- **V25 / P2 新增**：T8 **02:03** [四列测试规则原图](assets/20261024-recorded-journey-visual-audit/thunder-segment8-003-lesson6-practice-guidance-restored.png)把 Markdown 管道和分隔行直接显示，规则/触发/观察/记录无法按列对齐。已亲眼看到；源码 `MarkdownMathView.tsx` 的 `MarkdownParagraph` 逐行仅处理列表和段落，没有表格解析，可确认渲染支持缺口。主 agent 正补安全表格与窄屏处理，尚未用修复后的界面替代前证据。
- T16 的安全错误与来源权限结构补丁已经发布，但旧运行时吞掉了当时 owner 异常，**该次原始失败的具体原因仍未知**。不能把结构性修复写成原故障已经完全根治。

00:24 的历史快照：当时已封装 **10 段站内 WebM + 3 段站外测试作品 MP4**，含 T7 561.32 秒和 N6 13.8 秒，O4/T8 当时尚未封装。42 个证据定位点包含复测与正面路径，**不是 42 个产品缺陷**；当时去重快照为 36 个确认缺陷（34 个本轮线上、2 个仅隔离确认）。后续录像与问题已追加，最终数量和状态以[去重表](20261024-recorded-journey-issue-registry.md)为准。

## 修复与验收原则

2026-10-25 后续进展：光学 **8/8** 已完成，O4 完整录像 2845.80 秒。O4 **45:05** 末课完成，**45:58** 刷新后八条历史仍已完成；该刷新截图同时处在新回复加载状态，不能仅凭一帧就说全部对话渲染完成。后续实际读回保留五张实验的真实 runs。

O14 / V20 已补到可见近景：O4 **47:01** [观察回执详情](assets/20261024-recorded-journey-visual-audit/optics-part4-L3-observation-receipt-expanded.png)有 AI 质量理由和观察 ID / 参数 hash，仍没有学生原始预测与观察正文。AI 理由概括了部分数值，不能当作原始学生表达。O4 **47:05** [旧单缝实验回放](assets/20261024-recorded-journey-visual-audit/optics-part4-L5-repeat-paused-after-completion.png)可再次演示；执行 agent 实际将 a 调到 25µm 得 88.02mm，暂停/播放/重置成功，0 次 action 写入。已保存实验刷新后空白的疑点未复现，不加入缺陷统计。

**T19 / P1** 与 O06 分开计数：第7课开场把上一课已通过的实测当作缺失。最初说法出现在 T9 00:42 对应 DOM 文本，001 截图本身只显示开场卡，没有拍到该板书；T9 **02:47** [导师纠正](assets/20261024-recorded-journey-visual-audit/thunder-segment9-004-lesson7-theory-guidance.png)明确承认已有 13.8 秒 11 项实测。O06 解决的是丢失自己的公开问题，不能据此宣称跨课证据上下文已打通。新问题的生成链根因仍未完全确认。

T13 新补丁后的第7课 review/theory 同类分支已通过，T9 **04:07** [两条达标回应](assets/20261024-recorded-journey-visual-audit/thunder-segment9-006-lesson7-theory-save.png)已独立查看。精确输入和 owner 回执见 journey；这是新分支验证，不是第6课原拒绝输入逐字重放，也不保证所有评价永久稳定。

雷霆战机第7课源码还接受了视觉 agent 的独立集成验收：SHA-256 `61c87df3c9d1742f171b94cad81ee54e99f1579a42f6787f4e5a9560d05fe1b3` 不变，真实 Pygame 窗口、正常输入事件队列，启动、移动、发射、HUD 边界、漏机结束、R 重开、重开后的移动发射、关闭共 **8/8** 通过，录像 **N7I 11.433 秒**。这是另一 AI agent 的自动化测试，**不是真人试玩、不是 OS 键盘控制，也不是平台内嵌运行环境**。源码与较完整作品依然包含测试人员辅助，保留 R01 边界。

先按课时/活动记录学生看到什么、做了什么、系统如何回应，再查代码归因。保留失败时间点和实际错误，不用直接推进 API、注入 mastery 或回填完成事实掩盖阻塞。视觉问题与服务端拒绝分别登记；每项修复后在相同输入、相同活动重新录制。

## 全服务重启后的最终视觉复核

2026-10-25 00:58 的全服务重启后，版本 `s5Q4jZLyDa5-d0TBO3lMz` 保留两个项目各 8/8 完成状态及各课记录。最终 build `qHOvk6OE_mu5uH9HMW_rF` 于 01:29 再次重启全部 15 个应用服务；O7（50.920 秒）在重启后只读确认光学项目仍为 completed、8/8，未新增聊天或学习写入。O5 **00:43** [全屏状态](assets/20261024-recorded-journey-visual-audit/optics-part5-all-services-restarted-fullscreen-label.png)明确显示“退出全屏”，**00:44** [嵌入状态](assets/20261024-recorded-journey-visual-audit/optics-part5-all-services-restarted-local-replay.png)恢复“全屏探究”；执行日志对应 aria-pressed true→false。V19 因此转为已修复且复测通过。

V25 同一条原第6课消息在 T13 **02:15** [桌面表格](assets/20261024-recorded-journey-visual-audit/thunder-postrestart-018-original-l6-table-desktop.png)正确显示4列表头、4行规则；[390px左侧](assets/20261024-recorded-journey-visual-audit/thunder-postrestart-020-original-l6-table-mobile.png)和 **02:16** [右侧](assets/20261024-recorded-journey-visual-audit/thunder-postrestart-021-original-l6-table-mobile-scroll.png)证明横向滚动可看最后一列。滚动实际发生在 table 元素，外层 div 的 scrollLeft=0 不能当作失败。以上原图均由本审计 agent 独立查看，V25 转为已修复且复测通过。

T19 的原错误板书也补到 **T13 02:14** [可见近景](assets/20261024-recorded-journey-visual-audit/thunder-postrestart-017-original-l7-missing-evidence-board.png)。它是历史原消息回看，不代表新版本再次生成同一错误；原生成缺陷仍开放。

**T20 / P1 原始失败与最终修复**：T13 **04:49** [已发布作品代码预览](assets/20261024-recorded-journey-visual-audit/thunder-postrestart-027-work-code-includes-prose.png)第128行混入“独立复核补充”中文说明。修复后 `copy-final/002` 的展示源码为 125 行，不含正文说明，`ast.parse` 通过，并与实际运行版本按换行/行尾空白规范化后相同；说明仍保留在作品正文。

**T21 / P1 新确认**：[真实点击后的页面](assets/20261024-recorded-journey-visual-audit/thunder-copy-before-002-copy-before.png)仍显示“复制代码”，没有成功或错误反馈；[能力记录](assets/20261024-recorded-journey-visual-audit/work-code-before-browser-capabilities.json)显示 HTTP 页面不是安全上下文、`navigator.clipboard.writeText` 不存在。旧实现调用异常后静默忽略，和 T20 解析边界是两个独立原因。

本审计 agent 已用实际 `WorkTextRenderer` 做 [4 项隔离 React DOM 验证](assets/20261024-recorded-journey-visual-audit/isolated-work-copy-verification.json)：无 Clipboard API 且 fallback 失败显示[明确提示](assets/20261024-recorded-journey-visual-audit/isolated-copy-failure-alert.png)；fallback 成功报告已复制且只传源码；API 拒绝后走 fallback；API 成功时不重复 fallback。剪贴板入口全部注入测试实现，没有接触 OS 剪贴板或生产接口；实际线上同作品复验另记。

**T22 / P1 原始失败与最终修复**：T15 **00:35** [长代码块压缩图](assets/20261024-recorded-journey-visual-audit/thunder-copy-after-002-copy-success-error.png)只剩一条边线，普通 UI 点击复制被 `article/codeblock` 父层拦截。最终 build `qHOvk6OE_mu5uH9HMW_rF` 加入 `flex-shrink: 0` 后，`copy-final/002` 普通点击成功，源码块可见且内部滚动正常；线上验证未使用 force 或改 DOM。

当前去重登记为 **40 个确定产品缺陷**（38 个本轮真实路径、2 个仅隔离确认）；14 项已修复并有真实或同类场景复测、22 项开放、2 项隔离确认、1 项部分改善、1 项结构性补丁待同条件复测（T16）。T20/T21/T22 已从待复验状态移出。另列 8 个未确认风险/事件和 12 个正确保护、验收边界、脚本或运维事件。完整证据与最终状态以[登记表](20261024-recorded-journey-issue-registry.md)为准；正确门禁、历史 mastery 限制、测试辅助程序不能计入缺陷数量或冒称从零教学成功。
