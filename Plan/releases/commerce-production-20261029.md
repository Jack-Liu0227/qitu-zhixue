# 收费与 Company 主站发布

日期：2026-10-29。主站：`http://122.51.130.204/`。运行代码：`f5b6c7bd273c72552b40c0d1f1b3889988e34fa9`。状态：已部署并完成真实主站验收；真实收款保持关闭。

## 可见变化

- 官网首页「会员方案」展示免费版、体验课、月会员与条件性年卡；页脚「公司管理」进入共享登录，并保留 `/company` 目的地。
- 已开放套餐的选择通过登录传入家长页，等待当前孩子的服务端权益后展示购买确认，不自动下单。
- 家长首页提供「套餐与权益」「我的订单」入口。确认条款和监护授权后创建幂等订单并获取微信付款码；出码失败保留订单，支持重试；提供订单空态、支付状态查询与退款入口。
- 切换孩子清空旧确认，断网禁止购买，权限读取失败清除旧权益和购买控件。订阅策略未启用时不误称免费额度已经生效。
- Company 在 `/company` 提供经营总览、工作、团队、客户、产品、财务、数据、知识及集成 9 个页面。现有管理员使用原账号进入；学生和未获公司授权的家长由 API 拒绝。Admin 仍统一控制模型、技能与教学策略。

## 发布过程与回退点

此前[入口准备记录](./commerce-access-20261029.md)区分了源码同步与运行版本。用户随后明确要求发布，本次完成以下操作：

1. 确认线上数据库迁移停在 0055，公司表尚不存在；备份数据库、旧构建、依赖及 systemd/Nginx 配置到服务器 `/root/qitu-backups/commerce-release-20261029`。数据库 dump 已通过 `pg_restore --list` 校验，备份目录仅 root 可访问。
2. 在独立 checkout 按锁文件安装依赖并顺序构建，保持线上构建不被覆盖；比对构建源码 Git tree 与发布提交完全一致。
3. 在原 postgres 运行身份下执行正式 Drizzle 增量迁移，仅新增 0056；日志与迁移表均确认成功，未导入测试数据。
4. 保留主工作树路径、原环境与会话/上传数据，切换依赖和构建并重启 API、workers、auth、student、parent、teacher、admin，新增 Company 3105 服务。为作品导出安装锁定 Python 依赖并配置独立解释器。
5. 仅为主站 80/3000 server block 增加 Company 路由，Nginx 配置测试通过后 reload；预览站点配置不变。服务停止到全部恢复的脚本阶段约 13.8 秒，所有 8 个单元 active；API 与 Company 没有自动重启。

若回退，先停止新服务，再恢复备份中的旧构建与配置。0056 为增量结构，不能在已有新经营数据后盲目执行 down；数据库恢复需按实际业务写入另行处理。发布脚本准备了失败时恢复旧构建与配置的路径，本次未触发。

## 验证与证据

| 层级 | 结果 |
| --- | --- |
| 构建检查 | 依赖/API/workers 构建、全仓 lint/typecheck、6 个前端生产构建、文档与历史清单检查全部通过，共 13 个步骤 |
| 隔离浏览器 | 首页 13 项、家长购买 7 项通过；覆盖选择透传、授权勾选、自动出码、失败可恢复且不重复建单、切换孩子、断网、权限失败与手机布局 |
| 生产浏览器 | 主站 18 项检查通过：readiness、真实目录、首页入口、Company 9 页面、家长账号、390px 布局、API 权限拒绝以及既有角色页面/静态资源 |
| 数据库 | Drizzle 日志成功，0056 的 SHA-256 与迁移表一致，订单新增字段及 Company 表存在 |

证据：[构建](./assets/commerce-production-20261029/build.json)、[隔离首页](./assets/commerce-production-20261029/home-browser.json)、[隔离家长购买](./assets/commerce-production-20261029/parent-browser.json)、[正式部署](./assets/commerce-production-20261029/deployment.json)、[真实主站浏览器](./assets/commerce-production-20261029/production-browser.json)、[主站首页方案](./assets/commerce-production-20261029/membership-production.png)、[合成付款页面](./assets/commerce-production-20261029/parent-qr-fixture.png)。浏览器未出现 pageerror。合成二维码与隔离交易不能作为真实支付成功证据。

## 收款开放条件

后续后台核查发现 Company 产品页的经营配置链接仍指向不存在的 `/admin/business`，已修正为实际入口 `/admin/settings/ops`。本项只修复跳转，不启用订阅策略、销售或公司助手。

生产实际读取为 `salesEnabled=false`、订阅策略 `enabled=false`、微信商户 `configured=false`。因此当前展示套餐和经营管理，按钮明确显示待开放/咨询；本次没有收款、退款、发送飞书消息或修改学习事实。

正式售卖还需在 Admin 补齐微信商户与经营条款，在 Company 绑定有效课程、发布体验课/月会员并启用订阅策略和销售开关。年卡继续保持条件性方案。操作方法见[Company 使用说明](../../docs/company/README.md)与[家长首页](../../docs/parent/home.md)。账号密码不写入仓库，测试账号可从主站登录页自动填入。
