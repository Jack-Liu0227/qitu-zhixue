# Admin 与学生端页面滚动和布局检查

用户要求检查 `http://122.51.130.204` 的 Admin、学生端一至四级界面，修复滚动和布局问题。

## 已复现

- 设置页外层 `.admin-console-content` 固定在视口剩余高度并隐藏溢出，内层 `.settings-shell` 只有最小高度。可调整分栏随长内容撑高，`.settings-main` 没有可用的有限高度，滚轮无法到达列表底部。桌面助手页内容约 3370px，外层可视高度约 831px，滚轮后两者的 `scrollTop` 均为 0。
- 设置目录同样随内容撑高，底部入口不可见。
- 助手卡片标题与角色标签并排争抢宽度，模型标签断成两行。

## 修复结果

已发布到公网 Admin 和学生端。保留导航、页面层级、接口及权限。本次仅修改以下 5 个产品文件：

| 文件 | 改动 |
| --- | --- |
| `apps/admin-console/app/globals.css` | 使用动态视口高度，允许主内容收缩到剩余空间 |
| `apps/admin-console/app/(console)/settings/layout.tsx` | 设置内容改为有名称、可键盘聚焦的 section，避免嵌套 main |
| `apps/admin-console/app/(console)/settings/settings-compact.css` | 约束分栏高度，目录与内容分别滚动；处理拖宽外侧栏后的堆叠状态；助手卡片标题、角色和模型信息分开排版；技能表格保持可读列宽；手机模型配置弹窗改为单列滚动 |
| `apps/admin-console/app/detail-polish.css` | 管家堆叠布局由有限高度容器滚动，手机端能到达输入区 |
| `apps/student-center/styles/projects.css` | 项目卡片按可用宽度排布，取消正文固定最大高度；手机封面与文字上下布局，长标题、标签及操作条换行 |

浏览器使用站点提供的测试账号，登录后拦截业务写请求，不修改模型、教学绑定、学生证据或项目状态。截图保存在本机临时目录，报告只保留界面类型和几何数据。

## 工作区已有改动

本次开始前已存在 AI 搭档页面、对话列表、课件、项目学习历史、波动实验、timelinePresentation 及其测试、tutor.css 和 tutor 文档的修改；另有计划文档、调试脚本和两个 Word 文档的删除。保留这些状态，不将它们算作本次修复。

上述 Tutor 修改已由 [前次发布记录](20261025-tutor-inline-learning.md) 确认在 2026-10-25 上线，本次构建保留它们；本次复验既有完成项目的 8 课学习记录与 21 份已保存课件均可读。执行期间还出现资源名称唯一性的合同、数据库迁移、API、技能页及相关文档修改，以及 `design-assets/README.md`；这些不在本次 5 文件发布清单内，没有覆盖或发布，也不声称本次已验证其业务行为。

## 验证

机器记录：[verification.json](assets/20261026-page-scroll-layout/verification.json)。

1. **线上基线**：38 个路由入口 × 3 个尺寸，共 114 组；其中 52 组检测到裁切，涉及 22 个路由入口（含兼容重定向）。
2. **CSS 候选预览**：同样 114 组未再检测到裁切，随后进入详情、编辑器和弹窗检查，补修模型弹窗窄屏两栏拥挤。
3. **发布后公网验收**：286 组页面/状态/尺寸检查，裁切、无容器承接的水平溢出、标题竖向挤压、图片加载失败均为 0。包含 114 组一级/二级路由、156 组深层界面和 16 组加载、空数据、错误、离线、偏好及记录展开状态。
4. **13 项行为断言最终通过**：滚轮到底、Ctrl+Home/End、320/390/768/880/1024/1440px 目录末项可达、授权矩阵横向到底、弹窗单列与底部可达、管家输入区可达、8 课目录切换与历史展开、403、503、320px 项目卡片不裁切、8 课完成记录和 21 份课件回读、断网、偏好菜单、加载与空数据。初次补充测试的异步等待、动态 summary 选择器和错误注入路径已校正并复测；没有将测试脚本失败计为通过。

一级/二级入口覆盖治理概览、学生统计、学生与教师目录及教师详情、关系绑定、管家、设置总览和全部现存设置路由；学生端覆盖今天、灵感、AI 搭档、我的项目、作品、成长、个人资料，以及推荐详情、项目详情和 Tutor 项目入口。深层覆盖助手编辑/预览/展开、团队成员/运行指引/成员全部能力和设置分类、添加成员弹窗、10 门上架课程编辑与展开、课时目录与高级历史、技能详情/文件/预览/矩阵、通道模型/配置弹窗、工具 JSON 编辑/预览/添加、知识库文件/PDF/设置/选择器/创建、知识引擎、课件资产、10 个推荐详情、项目理论/实践/反思/工作台入口、Tutor 侧栏和记录、个人资料 6 个页签。

这里的覆盖按**界面类型和现有测试身份可达状态**统计，不等于遍历所有数据库记录、所有课程活动或所有新建/保存/删除流程。受门禁控制的入口保留服务端实际返回结果；不注入掌握度、不创建项目、不发送 AI 请求、不提交配置或学习证据。403/503/加载/空数据使用浏览器请求拦截，断网使用浏览器网络状态，均不是修改线上 API。

## 构建与发布

- 本地按实际依赖图构建 6 个前置包通过；学生端 typecheck、basePath 检查通过。Admin 本地依赖快照缺 `pdfjs-dist`，`@qitu/auth` 快照缺 `UnifiedLoginRedirect`，因此本地 Admin typecheck 未通过。
- 已有 `tooling/visual-layout.test.mjs` 为 11/12 通过；未修改的 Copilot 静态快捷操作 `item.icon` 被“禁止直接展示存储头像”的测试匹配。未为通过测试而改动该业务文件。
- Linux 正式依赖下，两个应用的前置包构建、typecheck 和 Next 生产构建均通过；先停止对应服务再构建，逐端启动。仅重启 `qitu-admin`、`qitu-student`，不涉及数据库迁移或 API 重启。
- Admin BUILD_ID：`DlwDi8kXFtN8h82DQEkWG`；Student BUILD_ID：`XtXcaGmq9upFSBU1vbOJL`。两端 `active/running`，WorkingDirectory 为 `/root/qitu-zhixue`；readiness 为 `live`，database/Redis 均 `ok`。
- 5 个发布文件逐一回读 SHA256，与本地按 LF 归一化后的内容一致，详见机器记录。没有提交、推送或打包其他工作区改动。
- 构建过程中原备份目录 `/root/qitu-backups/page-scroll-20261026` 曾成功写入，随后回读不可见；本次未执行备份清理。已在 `/var/backups/qitu-page-scroll-20261026` 补存当前已验收构建、发布补丁及发布前 5 个文件原件。回退旧代码需恢复原件并重建，不能声称旧 `.next` 仍能直接恢复。

## 界面对照

手机项目卡片：[修复前](assets/20261026-page-scroll-layout/student-projects-before.png) / [修复后](assets/20261026-page-scroll-layout/student-projects-after.png)。

手机管家滚动至底部：[修复前](assets/20261026-page-scroll-layout/admin-copilot-before.png) / [修复后](assets/20261026-page-scroll-layout/admin-copilot-after.png)。

截图使用站点既有演示账号，仅保留不含原始学生对话的项目卡片和管家空会话。完整浏览器截图与脚本留在本机 `C:/tmp/qitu-scroll-*` 和 `C:/tmp/playwright-test-qitu-*.js`，未提交认证信息或响应正文。
