# 团队关联模板的展示与管理操作

团队详情的关联模板按模板聚合，默认展示名称、状态、关联版本数、生效绑定数和项目引用数。绑定状态按需展开为表格，不再常驻显示内部绑定 ID，也不使用内层固定高度滚动框。

每个模板提供编辑和删除入口。草稿与其他现存模板进入模板库编辑器；归档模板通过原 restore owner 恢复、回读新草稿后进入编辑。删除复用模板库的范围核对及确认弹窗，明确提示模板及关联学习记录的删除范围；未确认不会提交删除，当前在架课程仍受模板 owner 的归档要求约束。删除完成后重新读取团队关联，读取失败明确显示错误，不凭本地缓存声称列表已经更新。

这次修改仅涉及关联区域，不改变导航、模板权限、冻结内容或删除 owner。模板库删除流程由现有 `TemplateDeleteDialog`、`deletion-impact`、`with-records` 合同提供；本次不执行生产模板的删除或恢复作为验收。

## 验收与发布

2026-10-26 已发布 `study-remote`，Admin 构建标识 `5F5LzCkBPJxN1HhFiR7aI`。此次发布仅包含关联面板、局部样式和本文档；未覆盖并发任务中的模板删除实现或其他设置页面。复用了已发布的模板库删除 owner。管理端 lint、类型检查和生产构建通过，API readiness 的 PostgreSQL/Redis 均正常，主要应用和 Workers 服务 active。

浏览器在 1860 和 1280 宽度检查真实团队，2 个模板聚合为 2 行，默认关联区高度约 276 px；绑定明细可展开，内部 ID 不再常驻展示，窄屏无面板横向溢出。真实删除范围接口成功返回，确认弹窗默认不可提交；仅检查和取消，未删除或恢复线上模板。

隔离请求验证归档恢复失败提示、同幂等键重试、恢复后打开新草稿；删除权限失败、范围核对、完整标题与显式数据确认、回读失败时保留弹窗、同幂等键重试，以及成功后回读团队关联。空关联、权限失败和断网均显示明确状态，页面运行错误为 0。

记录：[浏览器验收](assets/20261026-team-template-panel-actions/browser.json)、[发布摘要](assets/20261026-team-template-panel-actions/release.json)、[宽屏效果](assets/20261026-team-template-panel-actions/desktop.png)、[紧凑布局](assets/20261026-team-template-panel-actions/compact.png)。备份位于 `/root/qitu-backups/team-template-panel-20261026`。
