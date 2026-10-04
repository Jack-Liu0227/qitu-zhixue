# 制作工作台

> 项目内页面（`/student/projects/[projectId]/workbench`）。高交互画布 + 模拟器 +
> 自动保存 / 版本。实现入口：`apps/student-center/features/workbench/**`、
> `services/api/src/modules/projects`（工作台子资源）。

## 1. 页面构成

- 面包屑（替换问候横幅）：`我的项目 / <项目名> / 制作工作台`。
- 项目头：封面 + 阶段条（与项目详情同一冻结 `TemplateStage[]` 数据源）。
- 左栏「项目阶段」：纵向时间轴 + 「当前处于第 N 阶段」提示。
- 中栏工作台：标签 **流程设计 / 代码 / 模拟器 / 测试**；画布（开始 → 节点 → 分支 → 结束）、
  缩放 100%、撤销 / 重做。
- 右栏模拟器：重置对话 + 试聊。
- 右栏 AI搭档：换话题 + 「我可以帮你」+「结合当前项目的建议」+ 输入框。
- 底部状态条：`已自动保存 HH:MM` + 预览效果 / 保存成果 / **完成后进入作品展厅**。

> 头部 4 步阶段条与左栏 5 步纵向轨是**同一份冻结 `TemplateStage[]` 的两种视图**，
> 不硬编码数目。

## 2. 草稿模型与乐观锁

```typescript
interface WorkbenchDraft {
  projectId: string;
  kind: 'flow' | 'code' | 'sim' | 'test';
  revision: number;      // 乐观锁
  content: unknown;      // flow: 节点/边；code: 文本；sim: 配置
  updatedAt: string;
}
```

- 高频自动保存 → `PATCH /projects/:id/workbench/:kind`，**必须带 `If-Match: <revision>`**。
- revision 不匹配 → **409 + 当前服务端 revision**，前端提示冲突并让用户选择合并 / 覆盖。
- 快照：`POST /projects/:id/workbench/:kind/snapshots` 保留可回溯版本。

## 3. 接口

```http
GET   /api/v1/projects/:id/workbench/:kind                  读取草稿
PATCH /api/v1/projects/:id/workbench/:kind                  保存（If-Match: revision）
POST  /api/v1/projects/:id/workbench/:kind/snapshots        创建快照
POST  /api/v1/projects/:id/workbench/preview                预览效果
POST  /api/v1/projects/:id/simulator-runs                   模拟器试聊
```

## 4. 页面状态（唯一不能「出错即丢」的页面）

| 状态 | 行为 |
|---|---|
| loading | 画布骨架 |
| empty | 新项目 → 初始节点模板 |
| error | **不丢草稿**：本地暂存 + 冲突提示 |
| offline | **强制只读 + 本地暂存**；恢复后提示合并，不再允许新编辑 |
| permission-denied | 403 页面 |

- 草稿本地暂存只含孩子自己写的内容（流程 / 代码），**不含任何对话或语音转写**。

## 5. 未决事项

- [ ] 断网时是否允许编辑（建议：只读 + 本地暂存）。
- [ ] `preview` 同步返回还是异步轮询。
- [ ] 画布技术选型（自研只读渲染 + 简单拖拽 vs React Flow）。
- [ ] 离线草稿写入 `localStorage` 的未成年人数据合规确认。

## 6. 相关文档

- [`projects.md`](./projects.md)
- [`works.md`](./works.md)
