# 启途智学

AI 教育平台，面向 10–18 岁学生，提供 AI搭档、项目式学习、作品沉淀和家长/班主任协同能力。

## 当前状态

项目处于工程初始化阶段，产品开发基线见：

- [`docs/AI教育平台前后端开发文档_v1.0.md`](docs/AI教育平台前后端开发文档_v1.0.md)
- [`docs/ROADMAP.md`](docs/ROADMAP.md)
- [`docs/TEAM_SETUP.md`](docs/TEAM_SETUP.md)

## 平台边界

- `student-center`：学生学习中心
- `parent-companion`：家长陪伴中心
- `teacher-workspace`：班主任工作台
- `admin-console`：平台管理后台

## 仓库结构

```text
apps/       四个平台前端应用
packages/   共享 UI、权限、契约和客户端模块
services/   API、Worker、实时网关
 database/  数据库迁移、种子和测试数据
docs/       产品和工程文档
tooling/    工具链和脚本
```

## 协作方式

1. `main` 是受保护的稳定分支。
2. 一个 Issue 对应一个可验收任务。
3. 从 `main` 创建功能分支。
4. 通过 Pull Request 合并，至少一名成员审核。
5. 不直接向 `main` push，不提交密钥和个人认证文件。

详细规则见 [`CONTRIBUTING.md`](CONTRIBUTING.md)。
