# 自由探索在首次发送时创建

2026-10-24 用户明确要求：进入、刷新 AI搭档或点击新建对话，只展示顶层欢迎状态；发送第一句话才生成自由探索记录。

默认入口不自动选择当前项目，不创建探索、不加载 Tutor 会话、不连接教学流。输入草稿和灵感预填不触发创建；显式历史探索链接及项目链接继续恢复原会话。新建只重置展示和输入区。

首次非空文本发送复用幂等创建键，等会话与流连接就绪后发送原消息。失败保留草稿，重试沿用会话/创建键；切换入口或卸载后旧响应不能回写当前对话。首次发送后更新已有 URL 的 explorationId，不引起新的会话初始化。保持既有导航和对象权限，不清理历史数据。

验证：学生端全量类型检查通过（使用当前工作区解析配置）；可见 Chromium 中 10 项交互检查通过，使用实际 TutorPage、ChatThread、Composer、useComposer、useTutorSession 和 TutorRealtimeClient，测试数据源与外围布局组件为隔离替身。检查开启 React StrictMode，覆盖默认进入/输入/刷新/重复新建、首次发送与 URL 恢复、创建响应失败幂等重试、预填与清理后入口、显式历史/项目恢复、异步切换旧请求、断网、快速重复发送、首次发送失败复用会话。URL 更新未重新打开消息流；未发送内容不会产生探索记录。

测试脚本位于本机临时目录 `playwright-test-lazy-exploration.js`，结果为 `qitu-lazy-exploration/browser-verification.json`。这是最初一轮的本地真实组件验证，当时尚未同步、构建或重启 study-remote。后续用户再次反馈线上仍自动创建，并明确要求推送远程，实际发布与线上验收见下文。

影响范围为 TutorPage、ChatThread、useTutorSession 与本条产品文档。共享工作区已有自主学习评价、课件展示、灵感模板扩展等并发改动，均保留；ChatThread 原有自主学习提示与 tutor.md 其他产品记录未覆盖。上述验证不替其他并发改动背书；修复提交排除了其他并发改动。远端发布保留该工作区原有内容，只覆盖下文列出的两个缺失文件。


## 2026-10-24 线上修复与验收

根因是远端只同步了欢迎展示等部分改动，`TutorPage.tsx` 与 `hooks/useTutorSession.ts` 仍为旧版，运行构建也未包含延迟创建逻辑。只更新文案无法阻止入口初始化创建记录。

修复提交 `ebaa277db91e849d7c69839d0246747b0d264a8c` 已推送至 `study-remote` 的 `fix/tutor-lazy-exploration-20261024` 分支。远端 main 有其他任务的未提交修改，因此未切换、重置或合并远端 main；通过文件原值 SHA-256 比较后，仅同步上述两个缺失文件，保留远端其他改动。ChatThread 的相应改动在发布前已存在。

远端按依赖顺序构建学生端所需包，学生端类型检查和生产构建通过。仅停止、构建并启动 `qitu-student.service`；本次发布构建为 `nUBZs44Br4dzIs3jwa9RT`，于 21:47 CST 启动。源码和旧构建备份在 `/root/qitu-backups/lazy-exploration-20261024-214605`，该目录含 `build.log` 与 `release.json`。

验收期间共享远端另一次发布将构建更新为 `EwXUbpm5GUmzH147ivsSk`（服务 21:49:52 CST 启动）。收尾核对该服务仍 active、公网 `/student/tutor` 与 API ready 均为 200，两个修复文件的 SHA-256 仍与本次发布一致。线上浏览器实际下载的 JavaScript 含新的首次文本校验逻辑；不能将本次提交称为整个运行版本的全部来源。

使用公开演示学生账号、可见 Chromium 访问 `http://122.51.130.204/student/tutor`，实际接口与页面无 mock，11 项检查通过：

- 默认进入、连续刷新 3 次、离开后重新进入 2 次：创建请求为 0，未加载 Tutor 会话，历史 ID 集合保持不变。
- 重复点击新建 2 次、只输入草稿不发送：没有创建探索记录。
- 浏览器下载的新页面脚本包含 `FIRST_MESSAGE_REQUIRED` 校验。
- 首次发送一条合成文本：创建请求恰好 1 次，教学流请求恰好 1 次且 HTTP 200，URL 自动带上 explorationId。
- 服务端回读该学生消息恰好 1 条，历史只新增 1 条记录。
- 刷新明确的 explorationId 链接恢复原会话；再点击新建并返回默认入口，没有额外创建。

最终检查无浏览器运行错误。只通过正常对象权限 API 删除本次合成验收产生的探索记录，历史 ID 集合恢复到验收前；没有删除用户原有记录。验证脚本早期对回执正文层级的断言已按 `TutorTurn.blocks[].kind/text` 合同修正，最终 11 项均通过；失败试跑的合成记录也已清理。

脱敏结果：[live-verification.json](assets/20261024-tutor-lazy-exploration/live-verification.json)。脚本留在本机临时目录 `playwright-test-lazy-exploration-live.js`，认证状态仅在临时目录中，不进入提交。此次线上验收覆盖探索创建和恢复，不等同于所有项目课时、模型质量或其他并发改动的完整验收。

## 默认入口开场恢复（同日追加）

用户反馈延迟创建后开场卡片消失。原因是完整开场原先仅在已有服务端探索会话时展示。默认入口现在复用同一开场卡片的展示模式：自动显示助手问候、探究问题和四个探索方向；前三个选项只填写草稿，自己的想法选项聚焦输入框并保留草稿。学生明确发送后才创建一次会话。展示模式不伪造 TutorTurn、项目上下文或助手授权。正式历史/模板探索仍使用服务端开场选项和真实导师身份。

卡片首屏保持顶部，避免较矮窗口把开场滚到下方。沿用原三列布局、卡片样式与导航。学生端全量类型检查通过，可见 Chromium 中 11 项实际组件检查通过，包含开场展示、选项只预填、自由探索延迟创建及既有错误/恢复场景；线上发布与验收如下。

开场恢复提交 `60caf7cad3e48dfcac669e8401f22474a68c4eec` 已推送到相同修复分支，并于 22:02 CST 发布至 study-remote。仅同步 ChatThread、ExplorationWelcome、TutorPage 的本次改动，保留共享工作区其他内容；依赖构建、类型检查与生产构建通过。构建 ID 为 `W4S5RCtDnNVEtEMD8iUXv`，备份 `/root/qitu-backups/opening-preview-20261024-220104`。

公网可见浏览器 15 项检查通过：开场问候可见且初始位于顶部，较矮窗口仍可阅读开场；四个选项只预填或聚焦且不创建会话；重复刷新、重新进入和新建没有新增；首次发送恰好创建一次且消息保存一次；刷新恢复原会话。无浏览器运行错误，合成验收记录已删除并确认原历史集合恢复。见[开场线上验证](assets/20261024-tutor-lazy-exploration/opening-verification.json)与[实际开场截图](assets/20261024-tutor-lazy-exploration/opening-desktop.png)。
