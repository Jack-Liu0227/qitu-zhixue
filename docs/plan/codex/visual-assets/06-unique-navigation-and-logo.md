# 导航独立图标与品牌 Logo

> 状态：deployed · 2026-10-21 · 36 个导航入口、品牌 Logo、五应用构建与真实页面验收通过；运行代码为 `c39117c`。

用户要求每个侧边栏入口的标识不同，同时在品牌名旁保留启途智学原有 Logo。此前去掉平台前缀的路由匹配会让不同平台共用图片，未覆盖的设置入口也会退回同一工具图标。本次保留平台语义，并为所有实际导航入口登记图片。

## 导航图片

覆盖学生端 7 项、家长端 3 项、教师端 4 项、Admin 主导航 5 项、Admin 设置导航 17 项，共 36 项。主导航“设置”与设置内的“概览”也分别使用不同图片。导航顺序、路径、名称、业务权限和现有 55 项可选素材目录保持原有合同。

新增 18 张固定功能图标：治理概览、教师工作台、学生管理、学生统计、关系绑定、设置、家庭首页、消息、模型网关、插件、数据库、运维、系统、飞书连接、关于、个人档案、助手管理、教师统计。另有 17 张现有内容素材和 1 张现有账户头像用于其余入口。固定图片直接接入导航，无需用户为每个入口选择。

- [路由对应表](../../../../packages/ui/src/navigation-artwork.catalog.ts)保留平台身份，兼容实际传入的相对路径、查询参数和部署 basePath。
- [固定图片导入](../../../../packages/ui/src/navigation-artwork-files.ts)采用静态导入，复用现有图片加载失败状态。
- 新图原始输出、完整提示词、工具信息和 SHA-256 存于 [fixed-navigation/v1](../../../../design-assets/fixed-navigation/v1/receipt.json)。生成工具为内置 `image_gen`，工具未暴露底层模型 ID，记录为 `not_exposed`。
- 运行图片存于 `packages/ui/assets/navigation/`，每项提供透明 PNG 的 64 和 128 像素版本。通过 [prepare-navigation-assets.mjs](../../../../tooling/prepare-navigation-assets.mjs)可从保留原图重新导出。

视觉以白色、钴蓝、青色为主；用房屋、气泡、链环、滑杆、柱状图、饼图、拼图、数据库等不同轮廓表达功能。没有将用户 Logo 用作功能图标。

## 品牌文件

专用目录为 [packages/ui/assets/logo](../../../../packages/ui/assets/logo/README.md)，页面不依赖 docs 图片路径。

| 文件 | 用途 |
| --- | --- |
| `source.png` | 用户提供的原图，逐字节保留，与 `docs/logo.png` 的 SHA-256 相同 |
| `full.png` | 通过图片工具收紧外部留白、再缩小为运行图片的完整 Logo；用于登录等完整品牌位置 |
| `mark.png` | 同一品牌已有的透明纯图形版本；用于侧边栏品牌名旁 |
| `receipt.json` | 原始来源、裁剪提示词和输出摘要 |

共享 `BrandMark`、`BrandLogo` 统一引用此目录。原图中的 Q 形路径、灯泡、中文名与英文名继续作为品牌身份；机器人形象仍可用于助手内容，不代替品牌标志。官网页脚原有的横向容器会将完整 Logo 压小，本次改为按原图比例展示。

## 验证与影响

`node --test tooling/visual-layout.test.mjs` 的 9 项检查通过，包含直接读取四端及服务端设置导航声明、36 个入口完整覆盖、渲染后的图片路径与文件摘要均不重复、部署路径兼容、品牌原图完整保留，以及导航不引用品牌 Logo。不是仅验证手写清单。`node tooling/check-basepath.mjs` 通过，覆盖四应用的 368 个文件；Linux 的 `@qitu/ui` typecheck 与 lint 通过。

发布代码为 `9756503` 与 `c39117c`，均已推送远程 main，并核对相同提交后同步服务器。官网及四端生产构建、各应用自身的类型检查通过，五个前端已重新启动；API 保持运行，六项服务最终均为 active。Nginx 配置检查和六条入口的 74 个 CSS/JS 引用校验通过。

真实浏览器使用公开登录页提供的测试账号快捷填充，不记录账号密码。以 1440 像素桌面宽度和 390 像素手机宽度验收：

- 四端共 36 个导航图片都已加载，实际静态文件名均不同，HTTP 200 且为 PNG；图片按既有 20–24 像素导航槽位适配。
- 四端品牌名旁均加载 `mark`；官网完整 Logo 加载 `full`，显示为 164×164，保留原图比例。
- 学生、家长、Admin 的折叠导航保留图片；四端手机导航及 Admin 设置目录可展开。未出现页面横向溢出或浏览器运行异常。
- [浏览器报告](./navigation-logo-20261021/report.json)、[Admin 设置导航](./navigation-logo-20261021/admin-settings-desktop.png)、[学生手机导航](./navigation-logo-20261021/student-sidebar-mobile.png)、[官网 Logo](./navigation-logo-20261021/brand-full-logo.png)均已保存。截图只保留导航或品牌区域，不包含学生对话及身份内容。

构建时服务器出现内存压力，学生及 Admin 冷构建期间临时暂停了其他前端。内核于 15:28:12 记录 OOM，终止了既有用户会话中的 `next-server`（PID 1047985，约 1.8 GB RSS）。暂停期资源检查出现的 502 不作为验收成功；恢复所有前端后重新完成上述检查，复查时可用内存约 3.8 GB。运行构建日志存于服务器 `.runtime/navigation-unique-20261021/`。

本任务没有向同机其他产品、IMA 或嵌入服务下发重启命令。服务日志另有 eye-student/eye-admin 在 15:29–15:31 停止、启动的记录，不将其变化归为本次发布操作；最终检查中上述受管服务均为 active。后续同机冷构建应保留可复用的 `.next/cache`，并提前释放构建内存，避免再次在内存紧张时启动编译。

本次仅涉及共享 UI、静态图片及导出/验证工具；不修改数据库、用户配置、模型路由、团队绑定、PBL 状态或对象权限。同期 Admin 管家、模板页等业务修改来自其他工作，不包含在本次提交，也不以本次图像验证宣称其业务通过。

起始与交付时均复核工作树，以下同期修改单独保留，没有覆盖、暂存或发布：`.agents/skills/qitu-project-configurator/`；Admin 的 copilot 页面、API 客户端、模型状态 Hook、知识上传组件、模板与绑定恢复页面、Next 与 TypeScript 配置；学生端 Tutor 与 ChatThread；`packages/contracts/` 的 admin-copilot、project-binding 合同，数据库绑定 schema 与 `packages/model-runtime/` 的 MCP 相关改动；API 的 idempotency、admin-copilot、knowledge、model-registry、team-runtime 和 templates/绑定恢复模块；`tooling/verify-copilot-lifecycle.mjs` 及绑定预览/浏览器验证工具；治理、模型运行时和其他 codex 方案文档，以及根目录既有手工测试批处理。它们的业务行为需要由对应任务独立验证，本次发布仅从干净的 main 提交构建。
