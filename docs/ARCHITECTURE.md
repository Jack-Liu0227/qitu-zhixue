# 启途智学架构摘要

四个平台是四个独立前端应用，共享一套认证、API、数据模型和 AI 服务。首期采用模块化单体后端与异步任务，不提前拆分大量微服务。

```text
apps/* → API / identity → domain modules → PostgreSQL
                         ├→ object storage
                         ├→ Redis
                         └→ queue / workers → AI and notifications
```

## 代码边界

- `apps/`：平台应用，只组合 features，不互相导入业务代码。
- `packages/contracts/`：跨端 API 和领域类型。
- `packages/permissions/`：权限判断和权限类型，后端必须再次执行。
- `services/api/`：模块化单体 API。
- `services/workers/`：转写、摘要、成长计算、告警和通知等异步任务。
- `database/`：迁移、种子和 fixture。

后端模块、数据表、状态机和 API 以产品开发基线文档为准；出现冲突时，先更新文档和 Issue，再修改实现。
