# Parent 家长陪伴中心

## 责任范围

Parent 面向已授权监护人，提供孩子学习过程的最小化投影：项目进度、成长证据、阶段摘要、消息和反馈。Parent 不直接读取 Tutor 数据库、Graphiti、Mem0 或原始对话。

实现入口：`apps/parent-companion`、`services/api/src/modules/parent`、`services/api/src/modules/growth`、`services/api/src/modules/directory`。

## 可见数据

默认可见：

- 经授权的孩子身份和当前项目摘要；
- 成长轨迹和阶段性里程碑；
- 作品、任务和掌握度的安全投影；
- 班主任或系统发送的消息与反馈；
- 需要家长配合的提醒和明确行动。

默认不可见：

- 其他学生信息；
- 未脱敏原始 AI 对话和语音；
- Agent 完整系统提示词、策略记忆和模型凭证；
- 数据库连接、任意查询、Graphiti namespace 或 Mem0 索引内容。

## 授权规则

- 每次读取都必须校验 guardian link、学生对象范围和数据用途。
- 家长端只能消费服务端 projection，不能写项目阶段、掌握度、成长事实或画像。
- 导出、敏感数据查看和撤销授权必须审计。
- 授权失败不能伪装成“没有数据”，也不能切换到共享或 demo 数据。

## 页面状态

首页、学习进展、消息与反馈必须覆盖 `loading`、`empty`、`error`、`offline`、`permission-denied`。断网时不能把缓存的旧摘要标为最新；投影过期必须显示时间和状态。

## 关联文档

- [STUDENT.md](./STUDENT.md)
- [TEACHER.md](./TEACHER.md)
- [PERMISSIONS.md](./PERMISSIONS.md)
- [ARCHITECTURE.md](./ARCHITECTURE.md)
