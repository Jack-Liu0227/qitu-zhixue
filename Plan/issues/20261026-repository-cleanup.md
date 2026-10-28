# 2026-10-26 分支、工作副本与文档整理

用户要求完成 study-remote 的分支、worktree 与文档清理。范围为仓库组织和历史构建资产，不修改学习事实、数据库、运行时配置或应用业务代码。

## 保存与执行边界

- 执行基线为 `3bd71540de672f338227a8c4f5a56d146d45aed4`。
- 主目录的 10 个已修改文件和 6 个未跟踪文件单独备份并按 SHA-256 保护；不纳入本次提交。本地共享目录的并行界面、后端和文档删除不覆盖远端。
- 私有恢复目录：`study-remote:/root/qitu-cleanup-archive-20261026`。其中保存完整 Git bundle、15 份 stash 的提交引用、工作区补丁与文件、历史任务归档及文件清单。目录仅 root 可访问，不提交备份中的配置、原始对话或数据库内容。
- `fix/tutor-lazy-exploration-20261024` 的独有提交先收入 bundle；GitHub 的 `feat/qitu-zhixue-night-fix` 已为 main 祖先，删除时检查服务器端分支仍指向已核验提交。
- 正式服务使用主仓库。遗留的隔离验证 Node 程序以实际 PID、脚本和工作目录核对后退出；生产服务不重启。

## 文档

恢复批量删除后仍被引用的 74 个文件，原提交与 hash 见 [恢复清单](../codex/recovery-manifest-20261026.json)。所有恢复的 Markdown 明示历史边界；原交付状态和来源锁不升级为当前生产结论。

重新组织计划与问题入口；整理前入口、两个旧测试稿、两份参赛稿保留在 [历史资料](../archive/repository-cleanup-20261026/README.md)。移除六个已退役的根目录诊断脚本，其字节保留在私有恢复目录及 Git 历史中。

`configuration-binding-recovery-20261021.md` 未找到已提交原文，因此恢复为说明缺失事实与后续入口的页面，不补造原结果。雷霆录屏原清单未入库且远端缺失，保留缺失说明。

## 录屏任务归档

原 `.codex-tasks/20261024-recorded-journeys/review/` 中的审阅页面与截图属于本机临时证据，随整个历史任务保存到上述私有恢复目录。历史文档中的临时链接改指向本节；此说明不等于原视频或截图可公开访问。历史正文中的路径、时间、成功与失败记录不重写。

## 验证

- 两个文档校验器均通过：199 份当前/索引文档、1355 个本地链接；Codex 检查 72 份文档、17 个 JSON、2 份归档清单和 15 个归档 hash，问题数均为 0。
- 校验器回归分别为 11 项与 11 项通过；74 条恢复记录的原 Git 内容 hash 全部匹配。
- Git bundle 已在全新的裸仓库中恢复并通过 `git fsck --full`，15 个 stash 引用逐一匹配。随后移除旧本地分支、旧 GitHub 分支、stash 和临时备份引用。
- 69 个历史目录、独立诊断文件或失效链接完成清理；96,001 个保留文件/链接逐项核验，493 个可重建构建/缓存目录未保留。
- 历史工作副本归档为 4,418,817,883 字节。磁盘使用量从备份基线的 79,546,408,960 字节降到 23,379,849,216 字节，约释放 52.31 GiB；该数包含同时发生的运行日志变化，不作为逐文件删除字节之和。
- 主目录 16 个未提交文件的 hash 全部保持不变；15 个服务仍 active/running，10 个入口清理前后均返回相同的 200 或 307。
- 主仓库的活动依赖、应用构建、知识服务和 `.runtime/qitu` 保留；未修改数据库、模型配置或学习记录，也未重启生产服务。

以上是文档结构、归档完整性和服务存活验证，不替代业务端到端验收。本次临时 worktree 在文档提交合入主分支后移除；最终 Git 状态写入私有恢复目录中的 `final-verification.json`。

## 并行修改保护补记

最终复核期间，其他工作同步了五个界面文件：`apps/admin-console/app/(console)/settings/layout.tsx`、`apps/admin-console/app/(console)/settings/settings-compact.css`、`apps/admin-console/app/detail-polish.css`、`apps/admin-console/app/globals.css`、`apps/student-center/styles/projects.css`。

这些文件保持未提交，单独保存于私有恢复目录的 `concurrent-changes.tar.gz`、补丁与 hash 清单。与共享目录逐文件比较时，统一 CRLF/LF 后的 SHA-256 全部相同；本轮不把它们纳入清理提交，也不宣称其业务测试通过。原先保护的 16 个文件仍逐字节不变。

另移除一个校验期间出现的 `tooling/__pycache__` 可重建缓存；生产依赖和活动运行时继续保留。
