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

2026-10-19 已随 `63e3be8` 上线，并完成真实目录及浏览器响应 fixture 验证，结果与范围见 [发布记录](./release-20261019-main.md)。

## Display contract

The Copilot toolbar has two independent selectors:

- **Assistant** reads only enabled records from the assistant endpoint. Team members are not rendered as a team optgroup, and disabled assistants are excluded even if a team row still references them.
- **Team** reads only enabled team records from the team endpoint. Selecting a team changes the collaboration scope label; it does not copy team members into the assistant selector.

The UI never infers a team from an assistant name, member label, or stale local storage. When either object is deleted or disabled, only that selector resets. A missing team leaves the assistant selection intact; a missing assistant disables sending until the live directory supplies a valid enabled assistant.

## Architecture conclusion

The Admin Copilot now has three separate contracts:

1. **Assistant registry**: `admin_assistants` owns the enabled runtime identities, model pair, tools, MCP bindings and canonical Skill IDs. The toolbar's Assistant selector renders only `enabled=true` records.
2. **Team registry**: `admin_teams` owns collaboration scope, leader and member references. The toolbar's Team selector renders only `enabled=true` teams. It does not flatten team members into the Assistant selector. The member count is computed from enabled assistant records only.
3. **Runtime binding**: selecting an assistant and an optional team is a UI intent only. The server must resolve the actual frozen project/session binding, intersect current Admin authorization with object permissions, and fail closed for missing members, Skills, tools or model configuration. The client cannot advance stages, grant Skills, or infer a team from a name.

The current toolbar uses a live metadata catalog and is not evidence that a model request or Skill execution succeeded. The next server-side boundary should accept `assistantId` and optional `teamId` only as selectors, then re-resolve both against the current object and frozen project scope.

## Skills conclusion

There is currently **one installed teaching Skill**:

- `.agents/skills/tutor-guided-learning/SKILL.md` (`tutor-guided-learning@1.0.0`)

The IDs listed in `docs/plan/codex/skills-catalog.md` are reviewed candidates, not installed Skills. In particular, `pbl-driving-question`, `pbl-hypothesis-coach`, `pbl-concept-probe`, `pbl-experiment-design`, `pbl-data-literacy`, `pbl-cer-coach`, `pbl-source-literacy`, and `pbl-reflection-coach` do not currently have runtime files. They must not be selected or silently normalized by the client.

Recommended order for adding Skills:

1. `pbl-driving-question` and `pbl-hypothesis-coach` for exploration evidence.
2. `pbl-concept-probe` for TheoryMastered preparation and remediation.
3. `pbl-experiment-design` and `pbl-data-literacy` for the guided-practice boundary.
4. `pbl-cer-coach` and `pbl-reflection-coach` for deliverable review.
5. `pbl-source-literacy` only after project-scoped IMA provenance is live.
6. `optics-wave-inquiry` only after registered diffraction/scattering actions and observations are persisted.

Each new Skill needs a canonical directory, reviewed `SKILL.md`, version/digest, license/provenance, adversarial evaluation, publication state and explicit assistant binding. Adding a row to the candidate document or adding a database ID is not installation. The 13 historical unknown Skill bindings found in production remain unresolved by design; they need Admin review rather than a fallback alias.
