# 归档课程直接删除

用户要求：归档课程可直接删除；没有历史引用即可删除，包括曾上架的课程。

入口仍为 Admin 项目模板库 → 全部课程 → 更多 → 删除课程，不改导航。保留“恢复并编辑”与“查看归档内容”。确认框说明删除不可恢复及历史引用保护；失败保留卡片并显示服务端原因，只有删除回执与列表回读均确认后才移除卡片。同一操作失败后重试复用幂等键，避免重复审计。

沿用 `DELETE /api/v1/admin/project-templates/:id`，只允许管理员执行。服务端允许归档课程及所有版本均为草稿的编辑中课程删除；在架课程和含非草稿版本的编辑中课程需先归档。数据库在事务中锁定课程与版本，清理所属教学配置、版本、课程并写 `template.delete` 审计，保留原状态及删除原因。项目、探索、计划、作品、冻结绑定和质量验证记录的外键引用继续阻止删除，事务整体回滚，不级联删除学生数据。

错误：无权限 403；对象不存在 `TEMPLATE_NOT_FOUND`；状态或历史引用保护 409 `TEMPLATE_DELETE_PROTECTED`；幂等键缺失/冲突沿用既有合同。失败不得返回成功。

验证覆盖：归档草稿、曾试点/发布课程、空归档、在架保护、历史引用、权限、删除重放、审计失败回滚、数据库锁内状态复核和依赖配置的原子清理。没有已上架课程时仍保留“全部课程”切换入口，避免归档课程无法进入。

## 验证结果（2026-10-26）

- 按 contracts → database → infra → agent-memory → ai-client → model-runtime 顺序构建独立输出，再编译 API 和检查 Admin 类型，均通过。安装目录中的 `@qitu/*` 是 UNC 快照，验证通过 `tooling/verify-workspace-source.mjs` 与生成的 TypeScript paths 指向本次源码输出，未改写安装快照。
- 当前快照缺少飞书 SDK 和 PDF 依赖；使用隔离目录中的已安装精确版本 `@larksuiteoapi/node-sdk@1.76.0`、`pdfjs-dist@6.4.299` 完成验证，未修改依赖清单。构建配置与日志位于 `services/api/.tmp/archive-delete/run-1793014920561-43636/`。
- 模板治理、恢复、学生目录、名称唯一性和管家生命周期等 56 项后端回归通过。数据库验证发现 RESTRICT 可能返回 `23001`，已与 `23503` 一同转为明确的引用保护错误；修正后的删除服务/数据库存储测试 16 项通过（包含新增的 RESTRICT 用例）。
- `node --test tooling/template-delete.test.mjs`：3 项通过，覆盖正确回执、列表回读、读取失败与同键重试。
- `tooling/test-template-delete-postgres.mjs`：10 项隔离 PGlite PostgreSQL 检查通过，执行实际 PostgresTemplateStore SQL，从真实 schema 读取外键，在最小合成表结构中验证七类历史外键引用、未使用绑定清理、审计回滚和上架状态保护。该检查不连接生产数据库，不代表生产部署验收或多连接并发测试。
- 任务涉及文件的 `git diff --check` 通过，代码文件均少于 2500 行。

## 既有工作与范围

开始时已有名称唯一性相关修改：`templates.store.ts`、`templates.store.postgres.ts`、`templates-governance.service.test.ts`、`templates.service.test.ts`、`templates-name.test.ts`、`packages/database/src/schema/project-templates.ts` 及 Admin 治理文档。本次保留这些改动，名称冲突及恢复回归随上述测试单独覆盖。

工作区另外存在学生对话/课件样式、Admin 设置/管家页面、模型/知识/成长模块、迁移以及视觉资源整理等未提交修改，本任务未回滚或覆盖，也未把它们认作本次实现。工作区全局差异检查中的 `docs/student/tutor.md` 既有尾随空白未改动。

本次已完成源码、隔离验证及线上部署，无数据库迁移。线上验收仅创建和清理两门专用临时草稿，原有课程与学生记录未改动。

## 线上部署（2026-10-26 20:27，北京时间）

已部署到 `study-remote` 的 `/root/qitu-zhixue`，入口为 [项目模板库](http://122.51.130.204/admin/settings/templates)。在“全部课程”中打开归档卡片的“更多”菜单即可直接删除，无需先恢复。没有历史引用的归档课程允许删除，包括曾上架的课程；已有学习或质量验证记录的课程继续保留引用保护。

发布前逐文件核对线上基线，12 个文件清单包含 6 个产品源码文件及测试、文档。名称唯一性、页面滚动及其他已部署功能完整保留；另行记录的 1959 个源码文件发布后 hash 均未变化。正式运行目录保持主工作树，只更新 API 与 Admin，其他四个前端继续运行。

API 按真实依赖图构建，通过 57 项服务器行为回归和 3 项前端回读测试；Admin 类型检查、生产构建通过。新 Admin BUILD_ID 为 `J1wRCNO8B0_C79VoYz40n`。六个正式服务均为 active，live readiness 中数据库与 Redis 均为 ok；浏览器访问的 66 个静态资源全部返回 200，无页面脚本错误。

Playwright 公网验收通过 10 项：未登录删除 401；学生、教师、家长删除 403；归档卡片删除入口与取消；真实 owner API 删除及同键重放；回读 503 时保留卡片，重试沿用相同幂等键；没有上架课程时仍能切换全部课程；手机端删除入口；既有课程目录不变与测试课程回收。回读失败和空目录状态通过浏览器请求拦截注入，实际删除和权限检查调用线上 API。390px 手机视口中的删除按钮可滚动到完整可见且可点击。

本次只用正式 owner API 创建、归档并删除两门专用验收草稿，不上架测试课程，不创建学生项目。最终只读数据库核对：测试课程和版本剩余均为 0，`template.delete` 审计恰为 2 条，幂等重试没有重复审计。原有 14 门课程（10 门上架、4 门归档）完整保持。

源码、API/依赖运行产物和旧 Admin 构建备份位于 `/var/backups/qitu-template-archive-delete-20261026-1222`。构建日志位于 `/tmp/qitu-template-archive-delete-20261026-1222`。回退时应先停止 API/Admin，核对后续并发修改，再恢复匹配的源码与构建并验证健康；不回退数据库或学生数据。旧静态资源保留到新构建中，兼容已打开页面。

机器记录见 [release.json](assets/20261026-template-archive-delete/release.json)，界面见[桌面归档菜单](assets/20261026-template-archive-delete/archive-menu-desktop.png)和[手机归档菜单](assets/20261026-template-archive-delete/archive-menu-mobile.png)。
