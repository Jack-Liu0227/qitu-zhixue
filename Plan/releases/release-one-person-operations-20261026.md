# study-remote 一人运营发布记录

2026-10-26，用户明确授权“上线 study-remote 并完成测试”。四阶段工程和前端已发布，完成 Linux 回归、公网浏览器及线上权限验证。真实收付款和实际家庭试运营仍未验收。

## 发布内容

- 服务地址：<http://122.51.130.204>；经营工作区 `/admin/settings/ops`，官网项目展厅 `/showcase`，家长订单 `/parent`，家庭邀请 `/login`。
- 唯一运行目录仍为 `/root/qitu-zhixue`，沿用 systemd 和 nginx。没有建立新的生产 worktree。
- 基于远端 `e1ca2f7fdaf3213b9fe5b61b9409b2f63a44a0a2` 的实际工作树按清单同步 79 个文件，包含实现、文档及既有测试证据。发布不等于该 Git commit 单独包含全部变更；本次没有提交、推送或重置工作区。
- 构建依赖包、API 和 worker；重新构建并切换 Admin、家长端和官网。保留上一版哈希静态资源，学生端和教师端沿用原构建并检查可用性。
- `0054_business_operations` 已执行，迁移记录共 56 条，新增八张业务/认证表均存在。家庭邀请签名密钥已在服务器受限配置中生成，仅验证是否存在，未输出或写入仓库。
- 公网当前为 HTTP，浏览器不提供 `crypto.randomUUID()`。经营操作幂等键已改用 `crypto.getRandomValues()`；真实浏览器点击运营检查并成功回读，验证了该兼容修复。

完整文件哈希及构建标识见 [release.json](../issues/assets/20261026-one-person-operations-release/release.json)，执行步骤见 [checks.json](../issues/assets/20261026-one-person-operations-release/checks.json)。最终核对 79 个发布文件和 1,956 个其他源码文件，均与预期哈希一致。随后补写的发布记录与文档状态更新另行记录，不属于原始构建清单。

## 验证结果

| 检查 | 结果及边界 |
| --- | --- |
| Linux 行为回归 | 169 项通过，0 失败、0 跳过；覆盖业务、支付适配、认证、项目/计划确认、模型网关和完整应用启动。支付测试使用隔离替身，不代表真实商户联调 |
| 构建与静态检查 | 依赖顺序构建、API lint、Admin/家长/官网类型检查及三端生产构建通过 |
| 路由与资源 | `/login`、`/showcase`、`/parent`、`/admin/settings/ops`、`/student/today`、`/teacher/dashboard` 均返回 200；页面引用的共 80 项脚本/样式检查通过；nginx 配置检查通过 |
| 服务与数据依赖 | API、五个前端、workers、profile-growth 共八个服务 active/running；工作目录均为主工作树；数据库、Redis ready，数据模式 live |
| 线上访问控制 | 匿名访问 Admin 返回 401；家长、学生、教师访问经营管理返回 403；非监护关系订单拒绝；家长只能读取自己孩子订单 |
| 线上拒绝路径 | 客户端价格、不完整售卖配置被拒绝；无效邀请返回 401；商户缺失时支付通知返回 503，不写支付事实 |
| 登录持久化 | 四个角色登录后重启 API，全部会话仍有效；退出后再次读取身份返回 401 |
| 公网浏览器 | 桌面/390px 手机、Admin 操作后回读、断网禁写、家长订单空态、官网空目录、无效邀请提示通过；无页面脚本错误 |

线上 API 记录见 [live-api.json](../issues/assets/20261026-one-person-operations-release/live-api.json)，浏览器记录见 [browser-live.json](../issues/assets/20261026-one-person-operations-release/browser-live.json)，最终服务/源码/数据库计数见 [final-audit.json](../issues/assets/20261026-one-person-operations-release/final-audit.json)。最后一次完整核对时间为北京时间 2026-10-26 23:02:55。

线上验证使用已有演示账户，没有创建项目包、订单、邀请、费用或学习记录，没有调用真实支付、修改掌握度或发送外部消息。只执行了登录/退出和人工运营检查；后者写入真实检查时间并回读结果。最终项目包、订单、邀请和费用记录数均为 0。

截图：[经营总览桌面](../issues/assets/20261026-one-person-operations-release/admin-overview-desktop.png)、[经营总览手机](../issues/assets/20261026-one-person-operations-release/admin-overview-mobile.png)、[经营配置](../issues/assets/20261026-one-person-operations-release/admin-settings-desktop.png)、[家长订单空态](../issues/assets/20261026-one-person-operations-release/parent-orders-empty.png)、[官网](../issues/assets/20261026-one-person-operations-release/showcase-desktop.png)、[无效邀请](../issues/assets/20261026-one-person-operations-release/invitation-invalid-mobile.png)。截图是上线状态证据，不代表付费用户或教学效果。

## 备份与未验证事项

发布前备份位于服务器受限目录 `/var/backups/qitu-business-20261026-r4`，包含变更前源码、运行构建、配置和加密数据库备份。已验证备份可解密且 PostgreSQL 能读取备份目录；没有执行生产恢复或完整恢复演练。原始部署/测试日志在 `/tmp/qitu-business-20261026/`，临时日志不能代替长期备份。

需要回滚时，先停受影响运行服务，再从本次备份恢复相应源码和构建；数据库回滚须先核查发布后新增记录并另做备份，不直接执行 down SQL 或覆盖线上库。此次迁移为新增表，代码回退可暂留表以保留数据。恢复后重新检查依赖健康、静态资源及登录。

售卖开关保持关闭，微信商户未配置，也没有正式项目包。真实经营主体、条款、客服、定价、商户 HTTPS 通知地址、真实支付/退款/重复通知验收及家庭试运营仍需实际业务资料和执行记录。当前公网入口为 HTTP，正式付费开放前还需配置并验证 HTTPS。自动运营检查仍默认关闭，手工检查成功不代表五分钟定时周期已验收。

本次保留工作区原有 Admin 技能/团队/知识库、学生 Tutor、模板治理、资源整理等其他修改。没有将整个脏工作区同步覆盖远端；对现有服务做了启动/路由/资源及相关业务回归，未把其他未关联功能宣称为完整验收。
