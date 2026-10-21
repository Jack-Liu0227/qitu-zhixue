# Skills 生命周期

统一目录为 `.agents/skills`。一个职责只维护一个 canonical ID 和一个当前源码包；教学助手仅使用 runtime=teaching、publicationStatus=published、status=ready 的目录条目。技能中心可见与运行时可执行是两个状态。

| action | input | 回读 |
| --- | --- | --- |
| skill.create | `{id,description,version,content}` | `{id,version,digest,status:"draft",enabled:false}` |
| skill.publish | `{id,digest:<创建回执中的完整 64 位摘要>}` | published、enabled=true |
| skill.revoke | `{id,digest:<当前发布内容摘要>}`，仅 global | revoked、enabled=false |

id 使用小写字母开头的小写字母、数字、连字符，最多 64 字符；description 最多 500 字符，version 最多 40。content 是不含 frontmatter 的教学 Markdown，正文不设固定字符上限；元数据由服务端生成。不能创建任意路径、脚本、Admin 指令或覆盖既有 ID。

```json
{"reply":"创建、发布教学技能，并绑定助手","actions":[
  {"id":"skill","kind":"skill.create","label":"创建探究技能草稿","input":{
    "id":"optics-evidence-coach","description":"帮助学生比较授权模拟中的观测证据","version":"1.0.0",
    "content":"只使用服务端提供的任务、实验域和观察记录。引导学生提出比较问题并解释证据；不写掌握度或放行实践。"
  }},
  {"id":"publish","kind":"skill.publish","label":"发布探究技能","input":{"id":{"$ref":"skill.id"},"digest":{"$ref":"skill.digest"}}},
  {"id":"coach","kind":"assistant.create","label":"创建探究教练","input":{
    "name":"光学探究教练","description":"引导比较观测证据","role":"探究教练",
    "instructions":"按服务端任务和权限使用已发布技能。","enabledSkills":[{"$ref":"publish.id"}]
  }}
]}
```

只有明确要求启用时才发布，草稿不能绑定。已有技能继续使用原 canonical ID，不为修订复制带版本后缀的技能。当前管家 API 不支持在线改写既有发布正文；源码修订应在该目录完成审核、重新部署并以真实 packageDigest 重审团队及绑定。不得修改历史冻结快照或 hash 兼容清单来伪造一致性。

撤销是全局收紧，影响所有引用该技能的当前运行时；不能通过重发旧草稿恢复已撤销内容。正文文件、已声明 references 和多个技能组合均不设固定字符上限，也不静默截断。实际模型上下文容量仍由模型提供商决定，超出时必须如实报错。references 仅加载包内声明的文本路径，并一起进入 packageDigest；缺失或越界时该包不可用。老技能缺元数据仅在服务端精确 hash 兼容清单命中时可用，不应复制这种例外作为新技能格式。

管家管理技能的 references 属于部署的 Admin 资源包，skill.create 当前不能创建额外 references/scripts 文件。该限制不能用 content 中写文件路径绕过。

HTTP：`GET /api/v1/admin/ai-runtime` 查看已发布目录；`POST /api/v1/admin/copilot/turns` 提交上述 actions。当前没有通用 `/admin/skills` 创建/发布 API，也没有任意文件编辑工具。助手绑定使用 assistant.update。binding.draft 的 packageDigest 使用发布后的真实摘要，草稿 digest 与发布内容 digest 不能混用。

## 加载测试与移除

`skill.test {id}` 测试该 canonical source 的运行准入。草稿、撤销及 deprecated 状态返回失败；已发布且 ready 的教学来源通过。该测试不执行教学对话或 Skill 声明的外部工具。

`skill.delete {id,digest}` 仅 global，要求当前准确摘要。服务端加锁、审计并原子写入 deprecated，回读 unavailable；这是软删除，保留正文、canonical ID 和历史引用。当前绑定立即失去执行权，不能通过重建同名技能恢复。管理技能禁止删除。反复提交旧删除摘要只回读同一次移除，不重复改写正文。
