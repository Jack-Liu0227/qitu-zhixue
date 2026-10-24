# 两模板逐课工具、课件和问答重测（2026-10-24）

状态：代码已同步 study-remote；本轮新建两项目各 8 课完成并归档。全部课件逐步渲染和重播通过，15 个已启用应用服务重启后，16 课记录、两模板目录与健康检查再次通过。此文保留本轮失败、修复和验证边界。

## 范围与完成标准

- 雷霆战机与零基础干涉衍射各 8 课，逐个执行当前活动要求，包括教学、考核、实践、学习记录、教师评价、作品与反思。
- 留存每轮工具调用结果；参数错误必须定位具体字段、补回归、修复后重新运行。记录恢复过程，不把“最后有文本”当作工具成功。
- 课件验证生成、展示、翻页、参数联动、再次运行、刷新恢复和适用范围；检查桌面及窄屏显示。
- 问答验证出题、求助不判错、答错反馈、正确作答、重试幂等、刷新保留待答题和实践权限同步。
- 同步 study-remote，重启应用服务，复查服务健康与学生可见记录。禁止生产 mastery/阶段注入。

## 已定位问题

| 编号 | 问题与证据 | 处理状态 |
| --- | --- | --- |
| T1 | 工具校验直接取 `oneOf` 全部分支前 6 个错误。给板书多传 `use` 时，修正提示却指向标题、步骤、目标与来源，来自 `find_courseware` 分支 | 已复现；诊断改为按实际 kind 选择分支，执行仍检查完整合同；已发布，runtime/schema 回归通过 |
| T2 | 模型面对的旧工具 schema 允许混用所有活动字段，且省略节点 ID、图示要求等 owner 限制 | 为当前活动提供收窄的模型参数投影，保留已冻结工具版本和 hash；已发布，回归通过 |
| T3 | 板书把任意 `<`、`>` 都当作危险内容，误拒飞船边界或光学关系等合法比较表达式 | 改为禁止真正的标签、外链与危险 TeX，图节点转义；补比较式和恶意内容测试 |
| T4 | 日志只有 TOOL_ARGUMENT_INVALID，无法定位字段；模型反复修正仍无证据区分是否修复 | 仅记录 schema 字段路径与规则，不记录参数值、学生答案或秘密 |
| T5 | 本轮线上第 2 课理论活动，第三步是预测提问，仅有 caption；逐步必须有图/公式的校验拒绝了它。精确日志 `/steps/2/tex,nodes,edges`，模型随后一次修正成功 | 调整为整份课件至少一处图/公式，其余步骤可提出问题；纯文本课件仍拒绝。补 owner 与真实 runtime schema 回归 |
| T6 | 待答题求助时仍向模型暴露活动生成工具，但 owner 会拒绝所有新活动，容易造成无效调用 | 待答状态仅保留授权读取工具；答题卡增加“给我一点提示”，不提交答案、不替换题目。补网关回归 |
| T7 | 390px 窄屏下，Grid 自动列最小尺寸把对话气泡撑到 530px、实验卡片撑到约 497px，右侧被裁切 | 将对话/气泡/正文轨道设置为 minmax(0,1fr)，实验卡使用 border-box；最终重测卡片宽约 243px，无内部水平溢出 |
| T8 | 第 4、5、6 课原生 ima_search_knowledge 失败；第 6 课的安全日志确认上游 HTTP 403（call_00_ET_w14dNBkQhmTzTwQhJ9Gc1317）。模型同时拿到受治理搜索与桥接服务独立凭证搜索，重复尝试消耗工具预算 | 搜索收口到 Admin 管理的连接；保留另行授权的目录/原文工具。401/403 明确显示访问被拒绝，不重试、不伪装成功；桥接层只对 429/502/503/504 在原总超时内重试一次。原生搜索的上游 403 尚未恢复，不能宣称凭证权限已修复 |
| T9 | 受治理检索把引擎失败 `ok:false` 转为空数组，最终显示“没有相关资料”，掩盖真实连接故障 | 区分空结果与检索失败，返回脱敏的拒绝/不可用原因；失败不产生引用，不自动扩大权限。补空结果、权限拒绝、超时和敏感错误脱敏回归 |
| T10 | 最终展示重测发现雷霆 8 份板书在 API 历史中存在，但页面全部显示格式回退。前端 `isBoardStep` 强制每步恰有一种图示，误拒了服务端允许的图示＋公式和仅提问步骤；SSE 也使用同一个 guard，会静默丢弃板书 | 对齐 owner：整份板书至少一处可视内容，步骤允许提问或组合图示；非字符串、空图示及整份纯文本仍拒绝。补真实 SSE 传输回归，并将逐课脚本升级为检查板书实际进入 DOM；展示脚本逐份比对服务器板书与页面数量、翻页并重播 |
| T11 | 重建学生端后，灵感空间出现 8 张卡片：API 返回两模板，但客户端额外拼入了 6 个本地演示模板 | 移除 live 数据源的 fixture 拼接，以 Admin 已发布目录为准；补恰好两项和空目录回归。保留独立 mock 数据源用于隔离测试 |
| T12 | 截图人工复核发现雷霆板书虽然有卡片，但流程图退回源码：模型节点 ID `end` 与 Mermaid 关键字冲突。旧展示断言只检查卡片、文字与翻页，未检查实际图形 | 新生成图统一前缀节点 ID；历史 owner 简单图在严格限定语法内重映射 ID，不修改标签、边或保存内容，其他 Mermaid 语法保持原样。浏览器改为逐份逐步检查 SVG/公式渲染，不能以源码回退判成功 |

T12 语法依据：[Mermaid 官方 Flowcharts 文档](https://mermaid.js.org/syntax/flowchart.html)明确说明小写 `end` 会破坏流程图；本次兼容不改动合法 subgraph 的结束语句。

本轮首次线上执行于 05:49 开始，已完成第 1 课，并在第 2 课发现 T5 后停下排查。保留这次失败和自动恢复记录，修复后从持久化课时继续；不删除失败日志来制造“零错误”。

## 已执行验证

- 隔离 owner 回归 68/68：包括新增雷霆 8 课首次学习、答错恢复、pending 恢复、幂等答案、两节理论都满足后自动进入实践，以及光学 8 课首次考核与全流程。隔离存储不连接生产数据库；其中作品审核是合成 fixture，实机游戏另在线上流程验证。
- 浏览器响应 fixture：提示按钮不提交答案/不更换待答题、保留选择、刷新恢复题目、503 后重试 key 相同、答错和达标反馈均通过。全部写请求在浏览器拦截，不向生产制造掌握事实。
- 已发布页面展示：减少动态效果偏好、动画暂停/播放、波长改变条纹、重复演示、全屏、390px 布局、两模板板书步骤切换与从头再看通过；复习过程没有任何证据写请求或页面异常。
- 线上两模板本轮均已完成 8/8，项目正常归档；光学第 2 课、雷霆第 3 课完成后自动进入 practice_building。光学 4 次失败已保留并完成后续恢复；雷霆全程无工具失败。16 课记录可展开，断网重试、刷新恢复、匿名拒绝和仅保留两个模板均通过。

## 展示设计

保留 AI 搭档对话、右侧项目进度和现有学习活动位置。光学以仪器图、屏上条纹和强度曲线联动为主要展示；雷霆课程以逐步流程节点和坐标/状态关系为主要展示。采用产品既有蓝色文字、浅色教学画布、青色当前步骤、琥珀比较标记；数学与数值保持高对比和可缩放。动效服务于“当前在观察什么”，可暂停并尊重减少动态效果设置。所有内容使用受控模型/结构化图，不开放任意 HTML/JS。

## 验证边界

线上使用明确标注的合成验收账号与项目，经既有 owner API 写入学习证据；教师评价也经过正式审核接口。本次演示账号已有目标掌握事实，线上正式考核走复习路径；从零首次考核、答错补救与门禁由 68 项隔离 owner 测试覆盖。没有清空或伪造生产掌握度，浏览器响应 fixture 不属于生产判分证据。雷霆当前没有授权编程知识库，其板书明确标记为教学示例；不能宣称已完成教材检索。

开始前保存了目标文件基线及工作区状态；Admin、家长、教师、资产等既有非本轮改动不覆盖。本轮结果只覆盖报告列出的路径，不声称验证所有其他工作区改动。

## 复核入口

- `tooling/verify-live-project-lessons.cjs`：逐课浏览器流程，设置 `QITU_LIVE_ACCEPTANCE=1`、`QITU_E2E_TEMPLATE=zero8|thunder`、`QITU_E2E_STRICT_TOOLS=1`、`QITU_E2E_VERIFY_REFRESH=1`。用 `QITU_E2E_DIR` 保存独立项目 URL 与结果，可从服务器已保存的活动继续。
- 雷霆流程同时设置 `QITU_GAME_SOURCE` 为 `tooling/fixtures/thunder-fighter-synthetic` 的绝对路径、`QITU_GAME_PYTHON` 为安装 Pygame 的 Python。实际窗口逐级验证输入、移动、边界、发射、碰撞、计分、失败与重开，保存源码 SHA256。
- `tooling/verify-live-project-records.cjs`：设置 `QITU_RECORD_SOURCE_PREFIX=qitu-tool-retest-`，检查两项目 16 课可见记录、审核回执、断网恢复、刷新和匿名拒绝；重启前后分别保存结果。
- `tooling/verify-live-courseware.cjs`：对同一轮两个已完成项目检查重复演示、参数响应、动画、全屏、窄屏和板书翻页；记录所有写请求并断言为空。
- `tooling/verify-assessment-interaction.cjs`：复用展示验证的浏览器状态，拦截全部写请求，以响应 fixture 检查提示、待答题恢复、503 重试和答题反馈；不能将此结果当作生产判分证据。
- Playwright 文件通过已安装的 Playwright runner 执行；浏览器状态只保留在本机临时目录，不进入文档资产或源码同步包。

## 最终验收证据

完整机器记录：[verification.json](assets/20261024-tools-courseware-full-retest/verification.json)。其中保留真实工具失败、恢复、课时活动执行、门禁转换、Pygame 实机回执、重启前后浏览器结果和服务健康结果。

| 项目 | 新建项目记录入口 | 课时 | 自动实践权限同步 |
| --- | --- | --- | --- |
| 干涉与衍射 · 从基础开始 | [学生端记录](http://122.51.130.204/student/tutor/proj-7ddf7fcc-fd9d-4d6f-9617-f76d52653756) | 8/8，completed | 第 2 课完成后 practice_building |
| 雷霆战机 | [学生端记录](http://122.51.130.204/student/tutor/proj-91368fda-a4cb-4af9-b09a-c0127c2be9e2) | 8/8，completed | 第 3 课完成后 practice_building |

用演示学生账号进入对应项目，在右侧课时列表选择第 1–8 课，再展开“本课记录与评价”。记录默认折叠，课件集中在中间学习区。历史失败调用保留供复核。

| 项目 | 课时 | 已完成内容 | 记录截图 |
| --- | --- | --- | --- |
| 光学 | 1 · 条纹从哪里来？ | review、theory、check、reflect | [查看](assets/20261024-tools-courseware-full-retest/zero8-lesson-1-records.png) |
| 光学 | 2 · 两列波相遇会怎样？ | review、theory、check、reflect | [查看](assets/20261024-tools-courseware-full-retest/zero8-lesson-2-records.png) |
| 光学 | 3 · 双缝为什么出现明暗？ | review、theory、check、practice、reflect | [查看](assets/20261024-tools-courseware-full-retest/zero8-lesson-3-records.png) |
| 光学 | 4 · 怎样改变干涉条纹间距？ | review、theory、check、practice、reflect | [查看](assets/20261024-tools-courseware-full-retest/zero8-lesson-4-records.png) |
| 光学 | 5 · 一条缝为什么仍有条纹？ | review、theory、check、practice、reflect | [查看](assets/20261024-tools-courseware-full-retest/zero8-lesson-5-records.png) |
| 光学 | 6 · 缝变窄，图样怎样变化？ | review、theory、check、practice、reflect | [查看](assets/20261024-tools-courseware-full-retest/zero8-lesson-6-records.png) |
| 光学 | 7 · 干涉与衍射怎样联系？ | review、theory、check、practice、reflect | [查看](assets/20261024-tools-courseware-full-retest/zero8-lesson-7-records.png) |
| 光学 | 8 · 别人能复核我的探究吗？ | review、theory、check、reflect | [查看](assets/20261024-tools-courseware-full-retest/zero8-lesson-8-records.png) |
| 雷霆 | 1 · 我的战机游戏怎么玩？ | review、theory、check、reflect | [查看](assets/20261024-tools-courseware-full-retest/thunder-lesson-1-records.png) |
| 雷霆 | 2 · 画面为什么会动？循环与坐标 | review、theory、check、reflect | [查看](assets/20261024-tools-courseware-full-retest/thunder-lesson-2-records.png) |
| 雷霆 | 3 · 按键与碰撞怎样变成规则？ | review、theory、check、reflect | [查看](assets/20261024-tools-courseware-full-retest/thunder-lesson-3-records.png) |
| 雷霆 | 4 · 让第一架战机动起来 | review、theory、check、practice、reflect | [查看](assets/20261024-tools-courseware-full-retest/thunder-lesson-4-records.png) |
| 雷霆 | 5 · 加入子弹与敌机 | review、theory、check、practice、reflect | [查看](assets/20261024-tools-courseware-full-retest/thunder-lesson-5-records.png) |
| 雷霆 | 6 · 完成得分、生命和重新开始 | review、theory、check、practice、reflect | [查看](assets/20261024-tools-courseware-full-retest/thunder-lesson-6-records.png) |
| 雷霆 | 7 · 测试并交付可玩的游戏 | review、theory、check、practice、reflect | [查看](assets/20261024-tools-courseware-full-retest/thunder-lesson-7-records.png) |
| 雷霆 | 8 · 展示作品，解释我的设计 | review、theory、check、reflect | [查看](assets/20261024-tools-courseware-full-retest/thunder-lesson-8-records.png) |

课件：共 29 份历史板书，服务器数量与页面数量逐份一致；每一步 Mermaid SVG、KaTeX 或受控 SVG 实际渲染成功，翻页、重播无错误回退。光学波动真实动画、暂停/恢复、改变波长后条纹变化、重复演示、全屏与 390px 布局通过，回看过程中证据写请求为 0。

截图：[光学动态演示](assets/20261024-tools-courseware-full-retest/optics-desktop.png)、[手机显示](assets/20261024-tools-courseware-full-retest/optics-mobile.png)、[雷霆板书](assets/20261024-tools-courseware-full-retest/thunder-board.png)、[问答反馈](assets/20261024-tools-courseware-full-retest/assessment-feedback.png)。

雷霆实机：Windows Pygame 2.6.1，实际窗口和事件队列，覆盖移动/松键、边界、帧率与小数坐标、发射、定时生成敌机、碰撞只计分一次、生命归零、R 键重开和退出。第 7 课提交源码与实际运行源码 SHA256 一致：`00c72821d34fb50570301173dd45cb598424e6596388a768a18cc4ff7188111e`。

| 回归组 | 通过 / 总数 |
| --- | --- |
| api-checks.txt | 23/23 + 33/33 |
| novice-checks.txt | 68/68 |
| ima-checks.txt | 38/38 |
| bridge-checks.txt | 17/17 |
| student-tests.txt | 9/9 |

测试组存在重叠，不将这些数字相加为唯一测试总量。跨包依赖构建、API 类型编译、学生端测试编译与 Next 生产构建均通过。

重启验收时间：2026-10-24T18:24:39.157426+08:00；学生端 BUILD_ID：`N0sO24qAhmFbLtbdzHHw4`。15 个已启用 qitu 应用服务全部重新启动并处于 active；未启用的 family-preview 保持禁用。数据库和 Redis 通过 API ready 检查，不重启操作系统或数据服务。

| 应用服务 | 重启后状态 |
| --- | --- |
| qitu-admin.service | active |
| qitu-api.service | active |
| qitu-auth.service | active |
| qitu-fix-admin.service | active |
| qitu-fix-auth.service | active |
| qitu-fix-parent.service | active |
| qitu-fix-student.service | active |
| qitu-fix-teacher.service | active |
| qitu-ima-mcp.service | active |
| qitu-local-embedding.service | active |
| qitu-parent.service | active |
| qitu-profile-growth.service | active |
| qitu-student.service | active |
| qitu-teacher.service | active |
| qitu-workers.service | active |

API ready、学生 Tutor、登录、教师、家长和 Admin 共 6 个 HTTP 检查均通过。重启后重新登录，两个项目各 8 条记录、离线恢复、刷新持久化、匿名访问 401、作品源码一致性和仅两个模板均再次通过。

验收脚本自身的两次失败也已区分：复用失效登录状态造成问答界面等待超时，重取会话后通过；部署启动尚未就绪时浏览器遇到一次 502，激活脚本增加 HTTP 200 就绪等待后通过。两者未计作成功，也未改动学习事实。

T12 修复前截图：[图形回退源码](assets/20261024-tools-courseware-full-retest/thunder-board-fallback-before.png)；修复后的雷霆截图见上。

工作区既有并行修改仍保留，包括 `packages/auth/src/index.tsx`、`TutorPage.tsx`、`LessonNextStep.tsx/test`、`docs/issues/20261024-tutor-lesson-progression.md` 和 `packages/model-runtime/src/empty-narration.test.ts`；共享文件中的课时下一步引导与空回复处理也未回滚。它们随当前源码参加必要编译，但本报告不声称完成其独立需求验收。

剩余外部边界：原生 IMA 桥独立搜索凭证仍收到上游 403；当前课程搜索已统一到 Admin 管理且实际成功的连接，失败会明确报告。此结果不等于修复那份上游凭证，也没有扩大旧项目授权。
