# 产品与四端开发基线

> 本文件保留为 CI 和外部链接兼容入口。当前规范已经按责任域拆分，不应继续在本文件扩写独立产品规则。

## 当前阅读入口

- 总索引：[docs/README.md](./README.md)
- Admin：[docs/ADMIN.md](./ADMIN.md)
- Student：[docs/STUDENT.md](./STUDENT.md)
- Teacher：[docs/TEACHER.md](./TEACHER.md)
- Parent：[docs/PARENT.md](./PARENT.md)
- SDK：[docs/SDK.md](./SDK.md)

## 不变量

- 学生未确认意图不得创建正式项目。
- `TheoryMastered` 之前不得进入实践阶段。
- 项目状态、掌握度、成长档案、画像和审计不能由客户端或模型直接写入。
- 前端权限只负责显示，后端必须重新执行对象级授权。
- 一个学生同一时间只能有一个当前班主任。
- 涉及未成年人数据时采用最小可见范围并保留审计记录。

详细系统边界见 [ARCHITECTURE.md](./ARCHITECTURE.md)，数据和迁移见 [DATABASE.md](./DATABASE.md)，权限见 [PERMISSIONS.md](./PERMISSIONS.md)。
