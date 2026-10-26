# AI 搭档教学内容跟随对话

状态：2026-10-25 已部署至 `study-remote` 的 `/root/qitu-zhixue`。学生端构建为 `9uHMUBhNl4Cs4SGr3QXQV`，全部 15 个已启用启途应用服务已重启，线上展示与服务检查通过。

用户反馈：消息发送后，课件与学习记录仍常驻对话底部，没有紧跟回复。

原因：`ChatThread` 在所有消息后追加 `ProjectLearningHistory`，并在消息滚动区外渲染 `learningActivity`。独立面板 CSS 预留约半屏高度且自行滚动。同时，零基础板书默认折叠，使教学内容与回复分离。

修复：学习操作在消息滚动区内紧跟最近的完整 AI 回复。流式输出期间保留在上一条完整回复旁；使用同级稳定 key，在位置变化时保留课件阅读状态和未提交答案。板书在原消息中默认展开；历史记录与实验索引移至现有项目进展侧栏。已完成项目不渲染当前教学工作区。

影响范围为学生端展示与组件位置，不改变服务端课件、考核、证据、实验回放、对象权限或教学门禁合同。保留已有全屏样式及状态按钮修改，不处理工作区内其他文档删除与录制素材。

验证使用隔离 fixture，不制造生产项目或学习事实。

- 按顺序构建 `@qitu/contracts`、`@qitu/database`、`@qitu/ai-client` 成功。确认 UNC `node_modules/@qitu` 是旧目录快照后，同步本地 contracts 的 src/dist、ai-client 的 dist、ui 的 src/assets。学生端 `typecheck` 通过。
- 新增 2 项消息关联回归，覆盖学生发言、空回复、流式输出和回复完成。常规 `pnpm --filter @qitu/student-center test` 在共享 UI 的 PNG 加载处失败；用临时 PNG 模块加载器及 React JSX 运行时适配后，70 项测试全部通过。另行运行 `node --test tooling/test-tutor-live-boundary.mjs`，7 项通过。适配仅在临时测试进程中生效，没有修改产品加载器或测试脚本。
- 使用真实 `ChatThread`、课件、考核、历史和实验组件，在 1440×1080 与 390×844 浏览器中完成 23 项断言。确认教学区属于消息滚动区、历史记录位于侧栏、流式期间保留位置、完成回复后保留待答文本与课件页码、全屏正常、断网禁用写入、403 清除失权内容且可重试，以及历史实验可重播且不提交证据。完成课时后保留原板书，移除当前教学操作。浏览器无运行时错误。

浏览器证据：[断言与请求记录](assets/20261025-tutor-inline-learning/result.json)、[桌面截图](assets/20261025-tutor-inline-learning/desktop.png)、[手机截图](assets/20261025-tutor-inline-learning/mobile.png)。截图顶部按钮属于隔离测试控制器，不是产品界面。

本地 Windows 快照缺少 Next 命令入口和 Mermaid，UNC 路径另有 Webpack loader 解析问题；因此本地生产构建未通过。临时映射盘已清理。后续 Linux 服务器的生产构建成功，不能把此前本地失败视为线上仍未构建。

已有 `LessonCoursewareCard.tsx`、`CoursewarePresentation.module.css` 的全屏修改及 `WaveOpticsExperimentCard.module.css` 的布局修改保留；浏览器验证了课件全屏和实验重播。已有 `ChatThread.tsx` 的独立底部面板与 `TutorReplyBlockView.tsx` 的默认收起行为属于此次反馈的原因，已按本次要求调整。`docs/plan/codex` 中原有删除项和工作区录制素材未改动。

发布核验：

- 仅同步 6 个本次修复文件，覆盖前核对远端基线 SHA256，构建后再次回读。远端已有课件全屏改动与本地内容一致，保留原文件。Git 基线仍为 `3bd71540de672f338227a8c4f5a56d146d45aed4`，通过发布清单记录工作树增量，未声称已推送新提交。
- Linux 按顺序构建 contracts、database、ai-client，通过学生端 typecheck、测试编译、13 项展示与滚动行为测试、7 项 Tutor 边界测试及 Next 生产构建。冻结安装被既有 Admin 依赖声明与锁文件不一致阻止；核对学生端全部 17 个直接依赖的已安装版本均满足声明后复用原依赖，锁文件未改动。
- 23:00:26–23:00:33（Asia/Shanghai）逐项重启 15 个已启用启途服务，回读 PID 均变化、状态均为 active/running、`NRestarts=0`。停用的 family-preview 保持停用；Nginx/PostgreSQL/Redis 未重启，分别检查配置与就绪状态。
- API readiness 为 live，数据库、Redis 均 ok；IMA `/healthz` 返回 200，匿名受保护 API 返回 401。本机及公网各 7 条页面路由和全部引用的 CSS/JS 通过检查。首次探测早于 Next 启动就绪，短暂返回 502，待就绪后全部复验通过；教师根路径正常跳转至 `/teacher/dashboard`，以实际目标路由检查资源。
- 使用普通登录流程只读复核两个既有演示项目，桌面和手机端共 26 项断言通过。光学项目保留 64 条消息、21 份板书及 5 个实验实例；战机项目保留 24 条消息和 8 份板书。两个项目各 8 课记录均在侧栏可读，刷新后保留；回看和重播未新增学习写入。浏览器未出现运行时错误或静态资源失败。本机浏览器首次受代理影响返回 502，改为该次浏览器进程直连后通过；没有改动系统代理。

发布证据：[部署与健康回读](assets/20261025-tutor-inline-learning/deployment.json)、[线上浏览器断言](assets/20261025-tutor-inline-learning/live-result.json)。源码和上一份学生端构建备份在 `/root/qitu-backups/tutor-inline-20261025145522-retry1/`，初次冻结安装失败记录在同名不含 `-retry1` 的备份目录。本次验证展示、历史回看和服务恢复，不替代新建项目与逐课教学全流程验收。
