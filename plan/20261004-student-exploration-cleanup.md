# 学生端推荐项目与自由探索清理计划

日期：2026-10-04
范围：`apps/student-center`、Tutor/Projects 相关合同、产品与架构文档

## 冻结目标

- 保留灵感空间的“推荐项目”标签、推荐卡、推荐模板详情和既有推荐项目确认合同。
- 只有“自由探索”按钮进入 `/student/tutor`，使用 `source: 'exploration'` 的统一 Tutor 对话。
- 推荐项目不得被重定向为自由探索或普通 Tutor 入口；推荐来源必须保留 `recommended` 和 `templateVersionId`。
- 删除已经被统一 Tutor 流程替代的自由探索独立页面、旧学生端语音/能力入口和对应活动文档引用。
- 不删除仍属于推荐项目、Projects owner、意图确认和模板版本合同的代码。

## 执行清单

- [x] 恢复推荐卡到 `/student/inspiration/recommended/:templateId`，补齐推荐详情页接线；确认继续由 Projects owner 既有接口处理。
- [x] 保持自由探索入口只进入 `/student/tutor`，并确保 Tutor 以自由探索上下文启动。
- [x] 清理自由探索旧路由、旧组件、旧传输引用和过时设计说明；保留推荐项目说明。
- [x] 校正产品文档、ADR、学生端设计文档和 SDK 说明，使推荐与自由探索语义一致。
- [x] 扫描零残留调用方，完成活动代码/文档清理扫描。
- [ ] 在依赖可用环境中运行完整前端/API typecheck、test 和 build。

## 执行结果

- 推荐卡已恢复为 `/student/inspiration/recommended/:templateId`，并新增只读推荐详情页；没有把推荐来源伪装成 Tutor session。
- 自由探索仍唯一进入 `/student/tutor`，Tutor 负责 `free` exploration 上下文。
- 活跃代码和非归档文档扫描通过：无 `/student/inspiration/explore`、旧 voice/capability surface 或旧 Tutor SSE 客户端引用。
- Tutor 前端旧 capability rail 的入口配置和 `invokeCapability` 暴露面已删除；服务端 pedagogic policy 与回合合同保留。
- 合同 typecheck 与 `git diff --check` 通过。
- 学生端完整 typecheck 仍受当前工作区缺失 `react`、`@qitu/ui` 等依赖阻塞；因此最终验证项保持未完成。

## 验收标准

1. 推荐卡链接不等于 `/student/tutor`，且目标路由包含模板 ID。
2. 自由探索链接等于 `/student/tutor`，不存在 `/student/inspiration/explore` 活跃路由。
3. 当前代码与非归档文档不再把推荐项目描述为自由探索，也不再把自由探索描述为推荐项目详情页。
4. 不存在对已删除 voice/capability surface 的活动代码引用。
5. `packages/contracts` typecheck 与 `git diff --check` 通过；完整构建若受工作区依赖或 UNC 路径阻塞，必须在结果中明确记录。

## 风险与边界

- 推荐详情页若缺少独立 API，使用现有推荐模板数据源只读展示；正式项目创建仍只能走 Projects owner 的确认接口。
- 不恢复旧的自由探索独立对话或第二套 session 链路。
- 不关闭 GitHub Issue #14，不把 ADR 0010 标记为 Accepted，直到独立复审和完整构建通过。
