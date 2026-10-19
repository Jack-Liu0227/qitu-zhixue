# 历史接管发布与当前交付边界

> Release update (2026-10-19 21:39:47 +08:00): `63e3be8` is deployed, main is synchronized, and migration 0036 is applied. Earlier offline-only statements below describe the pre-release round. Full teaching acceptance and 16-session bootstrap activation are still not complete. [Release evidence](../../admin/release-20261019-main.md).

> 状态：历史发布记录索引，当前轮次未重新部署。2026-10-19。
> 原始报告已逐字节保留在 [接管验证快照](../../archive/codex-before-capability-20261019/snapshot/takeover-validation-20261019.md)。归档 hash 见 [清单](../../archive/codex-before-capability-20261019/manifest.json)。

## 1. 历史记录说了什么

此前接管读取了三个 Antigravity 对话，处理文档/光学 Tutor/模型入口，并保留用户并行 UI 与文档改动。历史报告记录代码发布 SHA 为 `8413ef811e19cf0e1c029fc05150325b39076111`，随后 `8409043` 回填发布文档。当前源码参考 HEAD 为后续知识中心提交 `43a0307`。

历史报告中的本地/API/浏览器/Linux 测试、`study-remote` systemd 切换、GitHub push、readiness 和静态资源检查只适用于该报告的发布产物。当前轮次没有重放它们，不把报告中的 947 项测试或线上成功计为本轮结果。

| 层次 | 历史报告内容 | 当前可作什么结论 |
| --- | --- | --- |
| 发布产物 | `8413ef8` 独立 release 构建与服务切换 | 历史记录，不推断服务器当前运行 SHA |
| Git 同步 | 该代码与后续文档按授权推 main | 不证明当前工作树已提交/推送 |
| 运行环境 | 六个服务、数据库/Redis、静态路由的当时复核 | 不替代本轮在线探测 |
| 教学能力 | 安全修复、模型治理、前端集成 | 非完整动态 PBL、16 课时或新 Skills 发布 |

## 2. 本轮交付不能冒充发布

本轮唯一模板合同、新 16 节实际正文草稿、纯编译器与 Tutor/SDK 身份一致性已有源码，focused 通过，本地全量离线复核已通过。artifact 持久化、profile/content digest/Skill 确认冻结、0036 课时标题迁移部署、IMA 项目授权和实验事实闭环仍在 [实施计划](./implementation-plan.md) 中。实际验证以 [当前记录](./validation-20261019.md) 和 [状态文件](./delivery-status.json) 为准，不复制旧发布数字。

源码存在、已配置、发布启用、真实请求与学习效果分别验收。没有当前构建 SHA/部署日志/线上核验时，不写“已部署到 study-remote”。来源锁的联网时间也不是生产发布时间。

## 3. 后续发布要求

部署前核对远端 HEAD、工作树、运行目录、受控配置和数据库兼容性。先在冻结 SHA 的隔离目录构建与测试，保留旧产物、服务配置与审计，健康与权限复核成功后再同步主分支。不能因服务器配置允许 `updateInstead` 就直接推工作目录并让未构建源码先进入运行树。

本轮只读核查发现远端两处 preferences 未提交改动，曾按协作规则暂停。用户已授权继续并保留这两处改动、隔离发布；它们不是本轮修复，不回滚、不自动合入发布提交。此授权不等于发布完成，新的 release/push 成功仍待独立执行证据。

回滚以当次实际保存的产物和单元配置为准，先确认路径/版本再操作，不从历史报告盲目执行旧回滚脚本。回滚不得绕过快照、门禁、当前撤权或对象权限；不删除合法历史证据，不通过 SQL/手工注入制造成功。

生产操作不输出凭据、不读取原始学生对话、不顺手启动独立 worker 或修改无关 IMA/embedding/eyeprotect 服务。新发布须单独追加构建 SHA、测试边界、环境和匿名/认证请求范围，历史原文仍保留。
