# 主站统一发布与管家目录修复

> 历史发布记录。2026-10-20 起六个正式服务全部改为主工作树 `/root/qitu-zhixue` 运行；
> 本文提到的 `/root/qitu-releases/*`、release launcher 和 release drop-in 已全部删除。
> 当前部署与回滚流程见 [部署文档 §3.7](./deployment.md#37-主工作树统一运行2026-10-20)。

## 发布事实

- 生产代码提交：`63e3be882f1b1d7ccfbc0122bc14bf0b354785e3`；包含 `02be3a8` 的飞书二维码、16 课时模板和运行身份变更，以及管家目录修复。
- 切换完成：2026-10-19 21:39:47 +08:00。当时产物目录为 `/root/qitu-releases/63e3be882f1b1d7ccfbc0122bc14bf0b354785e3`，现已删除。
- GitHub `main` 与服务器 `/root/qitu-zhixue` 的 `main` 均已快进至该提交；后续发布记录提交只同步文档，不改变生产代码产物 SHA。
- 正式服务 `qitu-api/auth/student/parent/teacher/admin.service` 当时全部重启并 active，统一指向该 release；实际 Node/Next 进程 cwd 已复核。Nginx 配置检查及 reload 成功。
- 服务器两处独立 preferences 修改的 SHA-256 在同步前后保持一致，仍为未提交修改，没有混入发布。旧 release、单元配置和受限备份此后已在主工作树迁移中清理。

本次不启动原本停用的独立 worker，不重启其他分支的 eyeprotect 测试站或共享 IMA/embedding 服务，也不重启 PostgreSQL/Redis。相关测试站原有 auto-restart 状态不是本次主站发布成功的证据。

## 构建与数据库

Node 22.22.1、pnpm 10.10.0，依赖使用冻结锁文件，以 postgres 执行串行构建。初次离线安装缺 `pdfjs-dist@6.4.299`，按同一锁文件联网补齐；没有修改锁文件或使用旧版本冒充构建。

`02be3a8` 隔离产物完成 API/worker 依赖图构建、Linux API **1040 tests / 78 suites / 1040 pass / 0 fail**、AI 客户端断言、飞书前端 4 项与部署脚本 9 项测试，以及五端 production build。`63e3be8` 只增加 Admin 目录修复，复用同源码的 API/四端产物，在独立目录重新链接冻结依赖、执行目录与飞书共 10 项测试、Admin typecheck 和 production build。最终 release 的 **1547 个 Git blob** 与提交逐一匹配。

服务器 Node 不含 TypeScript 原生执行支持，前端测试最终使用锁文件中的 `tsx --test`；不是忽略失败。Windows UNC 工作树的 Admin typecheck 曾因 PDF 安装快照缺依赖失败，以 Linux 干净依赖下完整 typecheck/build 作为本次应用验证。

迁移预检只有 `0036_learning_session_titles` 待执行。先将生产 schema 和迁移账本复制到不含业务数据的隔离库 `qitu_release_02be3a8`，验证标准 migrate、down 和重新 forward；再使用仓库备份脚本生成生产加密备份，以标准 `pnpm --filter @qitu/database migrate` 应用迁移。生产列为 `learning_sessions.title:text nullable`，账本 38 条，最新时间戳 `1792281600008`。未回填旧课时语义、未写教学 fixture 或门禁事实。

备份在服务器受限目录 `/var/lib/postgresql/qitu-backups/`，本次迁移前备份为 `qitu-20261019T133850Z.dump.enc`；密码文件在仓库外，未打印或提交。先前备份已通过完整解密与 archive TOC 校验。历史 `0011/0012` 账本 hash 与当前源码存在差异，未篡改历史账本；本次只执行新迁移，不将历史差异声称已修复。

## 管家问题与线上验收

截图中已删除团队仍显示的根因是 Copilot 写死团队分组和助手注册表，并合并旧 localStorage 列表。实际服务器团队接口只有光学团队，删除没有被数据库撤销。修复改为并行读取两份 Admin 持久化目录，不以旧缓存补齐，不在失败时回退到示例。

线上使用页面自带演示管理员登录，确认下拉只显示“未分组助手”和真实光学团队。仍存在的战机/动能助手显示在未分组区，因为删除团队不等于删除成员助手；没有擅自停用或删除这些助手。详细规则与可重跑测试见 [管家目录](./copilot-catalog.md)。

浏览器验证包括旧缓存不恢复选项、断网禁用且保留输入、重连恢复、403 清空目录与重试、已删除选择回到真实管家、团队删除后移除分组。403/删除测试使用浏览器响应 fixture 和事件，不修改生产配置。最终移除 fixture 后重新读取真实目录，无 pageerror 或 HTTP 5xx；浏览器存在 CSS preload 警告，不声称零 console warning。

服务端 Nginx 的 12 条路由、145 个页面引用 CSS/JS 请求均通过；匿名项目 API 401。公网浏览器 readiness HTTP 200，`dataMode=live`、`status=ready`，database/redis 均 `ok`。

## 交付限制与回滚

这是代码同步和主站运行验证，不是完整教学产品验收。未执行 16 课时模板 bootstrap/绑定激活、真实飞书授权、真实教学推理或 IMA 请求；没有注入 `TheoryMastered`、批准报告或成长事实。不可变教学 artifact/profile/Skill 完整冻结、项目级 IMA provenance 和正式实验 action/evidence 仍未完成。

只读配置预检发现 17 个已启用助手中 13 个仍绑定未发布的历史技能 ID；4 个光学助手的 canonical ID 可解析。新运行身份解析对此 fail closed，会影响这些旧助手的真实调用，包括探索接引助手。未删除未知绑定或绕过治理；需要 Admin 按真实运行目录审查修正，目录可见不代表助手可执行。

本次受限证据曾位于 release 的 `.release-audit/`：`build.sh`、`source-verification.json`、`activation.json`、`migration-production.log`、`verify.py`、`live-verification.json` 和单元备份；基础全量构建/API 日志在 `02be3a8` 的独立 release。上述目录现已删除，不能再执行当时的回滚脚本。

当前回滚只能在 `/root/qitu-zhixue` 检出已验证的 Git 提交后重新安装、构建并逐服务重启；0036 是兼容性加列，应用代码回滚时保留，不自动删列。迁移后没有执行过回滚演练。

## Follow-up release: assistant/team display contract

Release commit `c899f49` (code change `19fc1a7`) separates the Admin Copilot toolbar into independent live
Assistant and Team selectors. The Assistant selector renders only enabled
assistant records; the Team selector renders only enabled teams and reports a
member count derived from enabled assistants. Team members are no longer
flattened into assistant groups, and stale local storage is not used as a
fallback. Deleted or disabled records reset only their own selector.

Focused regression coverage is in `tooling/copilot-catalog.test.mjs` (6/6
passing). The Windows UNC Admin typecheck remains blocked by the pre-existing
missing `pdfjs-dist` installation snapshot; no changed-file TypeScript error was
reported. The historical Linux release directory
`/root/qitu-releases/c899f498d9abb2cfad79763aebd3dfbd5fc416a7` was built from the
frozen lockfile and has since been deleted: Admin typecheck, all five frontend
production builds, API/worker dependency builds, and the 10 focused catalog/
Feishu QR tests passed. All six formal `qitu-{api,auth,student,parent,teacher,admin}.service`
units now run from `/root/qitu-zhixue`; readiness and the five frontend probes
return HTTP 200. Existing preferences edits remain uncommitted on the server.
Independent eye/IMA/embedding services were intentionally not restarted.
