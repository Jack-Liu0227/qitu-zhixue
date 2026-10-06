# 模型运行时 SDK

> 服务端专用包：`@qitu/model-runtime`。源码基于 Pi AI `0.87.1` 迁入并按启途边界改造。

## 1. 包边界

- 只由 `services/api`、workers 等服务端代码导入。
- 浏览器继续使用 `@qitu/api-client`；`@qitu/ai-client` 不依赖该包。
- 不包含 pi-coding-agent 的 CLI、TUI、shell、文件工具和 `auth.json` 登录。
- Provider、Model 和密钥仍由 `ModelRegistryService` 管理；Usage 只保留为旧 SDK 的兼容解析入口。

## 2. 运行链路

```text
Tutor / Domain service
  → ModelGateway（兼容门面）
    → @qitu/model-runtime
      → Provider / Model / Context adapter
        → 上游文本模型
```

运行时接收服务端解析后的 `usageId`，也可以接收已通过 Agent 配置校验的
`providerId + modelId` 直选对；浏览器不能直接传入模型选择或凭证。

## 3. 当前接入范围

| 能力 | 状态 |
|---|---|
| `openai-completions` | 已迁入适配器 |
| `openai-responses` | 已迁入适配器 |
| `anthropic-messages` | 已迁入适配器 |
| 文本 `complete` | 已接入兼容门面 |
| 文本 `stream` | 通过显式引擎开关启用，仍需 Tutor 安全门禁验证 |
| `tutor.live` 音频 | 不在本批次 |
| `knowledge.embed` | 不在本批次 |
| 直接执行项目/成长/掌握度工具 | 禁止；必须回到领域 owner |

## 4. 引擎开关

```env
QITU_MODEL_RUNTIME_ENGINE=legacy
```

- `legacy`：现有 `ModelGateway` 协议适配器。
- `qitu`：使用 `@qitu/model-runtime`。
- 未设置时按 `legacy` 处理，便于回滚。

切换前必须完成本地 mock provider、API 回归和远程 `qitu_test` 验证。

## 5. 凭证和安全

生产请求不使用 Pi 的 `auth.json`、OAuth 登录或环境变量自动回落。凭证由服务端注册表解密后仅在本次请求的 Provider auth resolver 中使用。

日志、错误、`ModelRuntimeResult`、SSE 和审计记录不得包含：

- API Key 或 Authorization header
- 上游原始错误响应体
- 未脱敏的学生输入或模型原始思考内容

Pi 返回的 thinking 内容不会直接发送给学生；模型输出仍须经过 Tutor 的提示等级和答案泄露检查。

## 6. 上游同步

版本、commit、许可证、本地改动和更新规则见 [`packages/model-runtime/UPSTREAM.md`](../../packages/model-runtime/UPSTREAM.md)。升级上游时必须重新审查认证、telemetry、网络传输、工具调用和数据脱敏边界。
