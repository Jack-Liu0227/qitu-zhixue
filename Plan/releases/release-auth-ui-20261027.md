# 登录与注册 UI 发布记录

2026-10-27 已发布到 study-remote。登录入口：`http://122.51.130.204/login`；个人注册入口：`http://122.51.130.204/login?mode=register`。

本次统一登录、注册的品牌框架与表单样式。桌面展示项目探索情境和账号表单双栏，手机优先展示表单；支持四类登录身份、学生/家长个人注册、密码显示切换、键盘选择身份和明确的提交反馈。手机号未开通时显示说明与邮箱注册入口。旧账号、数据和既有注册 API 合同保持原状。

## 范围与发布

- 应用变更限于 `apps/auth-portal/app/login/` 的 8 个文件，另发布 [UI 设计范围](../issues/20261027-auth-ui.md)。没有新依赖、数据库迁移或服务端权限修改。
- 基于服务器 `b5de9023f90aa3efa0ceaec25ba67714e05e54dd` 的现有部署叠加页面变更。逐个校验目标文件的旧、新 SHA-256，持有三个既有发布锁后执行；仅重新构建并重启 `qitu-auth`。
- 构建 ID：`NP4yf0mlLFeoJFHHFhteK`。备份：`/var/backups/qitu-auth-ui-20261027`；保留旧静态资源供已打开的页面继续加载。
- 清单与构建步骤见 [release.json](../issues/assets/20261027-auth-ui/release.json)。构建与资源检查失败会恢复此次源文件和原 `.next`。

## 验证

- 本地通过源代码依赖映射的 auth TypeScript 检查，以及本次 8 个页面文件的 Prettier 检查；服务器通过 `pnpm --filter @qitu/auth-portal typecheck` 和生产构建。
- 隔离数据库浏览器流程通过：学生、家长分别注册邮箱账号并登录；注册重放幂等性、成功后的身份/账号预填、密码不持久化、对象权限与旧邀请接口失效。手机号流程使用合成短信，不发送真实短信。见 [流程结果](../issues/assets/20261027-auth-ui/browser-results.json)。
- UI 检查通过：320/390/768/1440 像素布局、密码显示、键盘身份选择、减少动画偏好、必填验证、密码不一致、说明加载失败重试、断网、401/429/权限提示、提交中禁用切换及错误恢复。检查截图时修复了全局按钮样式挤压注册身份文字的问题。见 [最终界面结果](../issues/assets/20261027-auth-ui/ui-smoke-results.json)。
- 公网浏览器只读验收通过：首页进入注册、登录/注册切换、手机布局、身份选择、密码显示、断网禁用、手机号待开通及返回邮箱。没有向生产创建测试账号，无浏览器页面异常。见 [公网结果](../issues/assets/20261027-auth-ui/production/production-results.json)。
- `/login`、`/login?mode=register`、`/` 引用的 CSS/JS 均可访问；发布后 API、Auth、Student、Parent、Teacher、Admin、Workers、Profile Growth 共 8 个服务为 active。

最终公网截图：[桌面登录](../issues/assets/20261027-auth-ui/production/login-1440.png)、[手机注册](../issues/assets/20261027-auth-ui/production/registration-390.png)、[手机号待开通](../issues/assets/20261027-auth-ui/production/phone-unconfigured-mobile.png)。

## 数据与并行改动

阿里云短信签名与模板仍待申请，生产手机号注册未开启。现有公网地址仍使用 HTTP；本次没有变更域名与 TLS 配置。没有测试真实短信或支付。

工作区已有的独立修改保持原样：Admin 的 `LessonDraftEditor.tsx`；学生 Tutor 的 `LessonAssessmentCard.tsx`、`LessonLearningDock.tsx`、`DialogueLessonPanel*`、`tutorApiDataSource.ts`、`tutorStream.ts`、`useTutorSession.ts`；以及相应 `packages/ai-client`、教学合同、API Tutor/learning-plan/templates/works 和教学文档。之前个人注册发布中的首页、业务后台、数据库和 API 修改也未在本次重传。服务器已有的 Admin 页头提交保留。此次验证只覆盖登录应用及相关注册回归；其他学习功能的完整验收归其独立任务。发布后的服务状态与首页资源另行检查通过。
