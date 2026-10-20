# Skills 生命周期

统一目录为 `.agents/skills`，教学助手仅使用 runtime=teaching、publicationStatus=published、status=ready 的 canonical ID。技能中心可见与运行时可执行是两个状态。

| action | input | 回读 |
| --- | --- | --- |
| skill.create | `{id,description,version,content}` | `{id,version,digest,status:"draft",enabled:false}` |
| skill.publish | `{id,digest:<创建回执中的完整 64 位摘要>}` | published、enabled=true |
| skill.revoke | `{id,digest:<当前发布内容摘要>}`，仅 global | revoked、enabled=false |

id 使用小写字母开头的小写字母、数字、连字符，最多 64 字符；description 最多 500 字符，version 最多 40。content 是不含 frontmatter 的教学 Markdown，最多 7500 字符；元数据由服务端生成。不能创建任意路径、脚本、admin 指令或覆盖既有 ID。

```json
{"reply":"创建、发布教学技能，并绑定新助手。","actions":[
  {"id":"skill","kind":"skill.create","label":"创建探究技能草稿","input":{
    "id":"optics-evidence-coach-v2","description":"帮助学生比较授权模拟中的观测证据","version":"2.0.0",
    "content":"只使用服务端提供的任务、实验域和观察记录。引导学生提出比较问题并解释证据；不写掌握度或放行实践。"
  }},
  {"id":"publish","kind":"skill.publish","label":"发布探究技能","input":{"id":{"$ref":"skill.id"},"digest":{"$ref":"skill.digest"}}},
  {"id":"coach","kind":"assistant.create","label":"创建探究教练","input":{
    "name":"光学探究教练","description":"引导比较观测证据","role":"探究教练",
    "instructions":"按服务端任务和权限使用已发布技能。","enabledSkills":[{"$ref":"publish.id"}]
  }}
]}
```

只有明确要求启用时才发布，草稿不能绑定。修订使用新的 canonical ID，再更新指定助手数组，保留其他技能。撤销是全局收紧，影响所有引用该技能的当前运行时；不能通过重发旧草稿恢复已撤销内容，也不能改历史冻结快照。

正文文件本身最多 8000 字符，多个教学技能总正文预算 24000；超长技能不以截断规则执行。老技能缺元数据仅在服务端精确 hash 兼容清单命中时可用，不应复制这种例外作为新技能格式。

管家管理技能的 references 属于部署的 Admin 资源包，skill.create 当前不能创建额外 references/scripts 文件。该限制不能用 content 中写文件路径绕过。

HTTP：`GET /api/v1/admin/ai-runtime` 查看已发布目录；`POST /api/v1/admin/copilot/turns` 提交上述 actions。当前没有通用 `/admin/skills` 创建/发布 API，也没有任意文件编辑工具。助手绑定使用 assistant.update。binding.draft 的 packageDigest 使用发布后的真实摘要，草稿 digest 与发布内容 digest 不能混用。

## 加载测试与移除

`skill.test {id}` 测试该 canonical source 的运行准入。草稿、撤销或 deprecated 状态返回失败；已发布且 ready 的教学来源通过。该测试不执行教学对话或 Skill 声明的外部工具。

`skill.delete {id,digest}` 仅 global，要求当前准确摘要。服务端加锁、审计并原子写入 deprecated，回读 unavailable；这是软删除，保留正文、canonical ID 和历史引用。当前绑定立即失去执行权，不能通过重建同名技能恢复。管理技能禁止删除。反复提交旧删除摘要只回读同一次移除，不重复改写正文。
