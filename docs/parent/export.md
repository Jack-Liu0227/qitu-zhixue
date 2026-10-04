# 成长导出

> 家长端能力：把孩子的成长投影导出为可下载文件。属于敏感数据导出，
> **必须审计**。实现入口：`services/api/src/modules/parent`、
> 表 `parent_growth_exports`。

## 1. 流程

```text
家长请求导出
  → 校验 guardian_link + 学生范围 + 用途
  → 生成导出任务（parent_growth_exports）
  → 完成后提供签名下载 URL
  → 审计导出记录
```

## 2. 接口

```http
POST /api/v1/parent/children/:childId/growth-exports            请求导出（幂等）
GET  /api/v1/parent/growth-exports/:exportId/download          下载（签名 URL）
```

## 3. 规则

- 导出内容只包含家长可见字段投影，**不含**未脱敏原始对话、语音、Agent 提示词、模型凭证。
- 请求与下载都重新执行对象级授权；越权 403，不泄露导出存在性。
- 导出请求幂等；重复请求不产生重复导出记录。
- 每次导出写 `audit_logs`。
- 下载链接为签名 URL，具备有效期；过期需重新请求。

## 4. 页面状态

| 状态 | 行为 |
|---|---|
| loading | 生成中状态（异步任务） |
| empty | 无导出记录 |
| error | 失败可重试，不静默成功 |
| offline | 禁止发起导出 |
| permission-denied | 403 页面 |

## 5. 未决事项

- [ ] 导出格式（PDF / Markdown / 结构化数据）与字段清单。
- [ ] 签名 URL 有效期与下载次数限制。
- [ ] 导出记录的保留与删除策略。
- [ ] 是否需要二次确认 / 水印。

## 6. 相关文档

- [`progress.md`](./progress.md)
- [`../admin/database.md`](../admin/database.md)
