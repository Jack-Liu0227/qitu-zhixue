# 作品展厅

> 学生端第 5 项（`/student/works`）。承载已发布作品、版本历程、项目证据、作品互动。
> 责任域：Works（作品唯一写入者）。
> 实现入口：`apps/student-center/features/works/**`、`services/api/src/modules/works`。

## 1. 页面构成

| 区块 | 内容 |
|---|---|
| 作品卡 / 详情 | 封面 / 视频 + 播放、已完成徽章、描述 + 标签 |
| 操作 | 运行 Demo / 分享作品 |
| 互动计数 | 喜欢 / 评论 / 浏览 |
| 我的反思 | 可编辑，引用「来自我的创作日记」 |
| 版本历程 | 4 步（想法 → 第一次原型 → 测试修改 → 最终版本），带缩略图 |
| 项目证据 | 三列：我独立完成的 / AI帮助我的 / 我遇到的困难（各带清单与截图） |

> 当前代码只有 `/student/works` 列表页；作品详情（`versions` / `reflection`）
> 尚未有独立路由。

## 2. 状态机

```text
draft → reviewing → published → withdrawn
```

- 发布 / 撤回**可逆但不删历史**。
- `visibility`：`private | class | school | public`，默认 `class`（未成年人最小可见）。
- 互动计数中，**点赞必须幂等**（`(artifactId, studentId)` 唯一）；浏览可近似。

## 3. 接口

```http
GET    /api/v1/works/:id                  作品详情（按 visibility 授权）
GET    /api/v1/works/:id/versions         版本历程
PATCH  /api/v1/works/:id                  编辑（描述 / 反思 / 可见性）
POST   /api/v1/works/:id/publish          发布（幂等）
POST   /api/v1/works/:id/withdraw         撤回（幂等）
POST   /api/v1/files/presign              封面 / 视频 / 截图的签名上传 URL
POST   /api/v1/artifacts/:id/like         点赞（幂等）
DELETE /api/v1/artifacts/:id/like         取消点赞
GET    /api/v1/artifacts/:id/stats        互动计数
```

## 4. 硬规则

- 作品只能由服务端状态机推进；客户端不能传 `status` 或统计值。
- 项目证据三列**服务端聚合、只读**（见 [`projects.md`](./projects.md) §5）。
- 封面 / 视频 / 证据截图走**对象存储 + 签名 URL**，不直传业务库。
- 其他学生按 `visibility` 决定可见性；越权返回 403，不泄露存在性。

## 5. 页面状态

| 状态 | 行为 |
|---|---|
| loading | 骨架 |
| empty | 无作品 → 去项目 |
| error | 重试 |
| offline | 只读；禁止发布 / 点赞 |
| permission-denied | 403 页面 |

## 6. 未决事项

- [ ] 作品详情独立路由（`/works/[artifactId]`）与反思编辑接线。
- [ ] 「评论」是否开放给同学（未成年人社交面）。
- [ ] 展厅是否只展示已发布作品（与「我的项目」语义重叠）。
- [ ] 浏览计数的近似口径。

## 7. 相关文档

- [`projects.md`](./projects.md)
- [`workbench.md`](./workbench.md)
