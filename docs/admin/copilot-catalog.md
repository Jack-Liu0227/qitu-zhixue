# 管家助手与团队目录

启途智学管家 `/admin/copilot` 的“交互助手”只读取 Admin 持久化目录：

- `GET /api/v1/admin/ai-runtime/assistants`
- `GET /api/v1/admin/ai-runtime/teams`

分组名称、成员关系、助手名称和启用状态来自本次服务端响应，不使用写死的演示团队、内置角色列表或 `qitu.admin.custom_assistants.v2` / `qitu.admin.custom_teams.v2` 缓存。历史会话仍保留，但会话中的示例或历史作品卡片不是当前团队注册事实。

## 删除与刷新

删除团队后，目录不再展示该团队分组。删除团队不等于删除成员助手；仍存在且启用的独立助手显示在“未分组助手”中。要同时停用成员，须到 AI 助手设置执行相应管理操作，不能通过前端按名称猜测并隐藏或删除。

页面首次进入、重新获得焦点、重新可见、恢复联网以及管家创建助手/团队后重新读取目录。发送前再次读取，避免继续使用另一管理页面已删除的助手。最新请求优先，过期响应不能恢复旧目录。失效选择回到实际存在的管家助手或当前首个有效助手；无有效助手则停用发送。

两份目录必须都读取成功。loading、empty、error、断网、401/403 都明确展示；失败时清空可选名单并提供重试，不回退到本地预设。目录已同步只表示元数据读取成功，不证明模型、Agent SDK 或技能真实请求成功。对象级权限与写入幂等仍由现有 API 校验，此修复不扩大权限、不自动修改 Admin 配置。

## 验证

Node 支持 TypeScript 原生执行时：

```bash
node --test tooling/copilot-catalog.test.mjs
```

Linux Node 22 发行版未包含 TypeScript 执行支持时使用锁文件中的工具：

```bash
pnpm --filter @qitu/database exec tsx --test ../../tooling/copilot-catalog.test.mjs
pnpm --filter @qitu/admin-console build
```

六项回归覆盖真实分组、团队删除后的成员保留、重命名与停用、失效选择、跨请求旧响应、部分失败/重试、断网与卸载。浏览器验收还应覆盖当前团队名单、旧 localStorage 不污染名单、切回页面刷新以及无权限/断网时禁用选择。
