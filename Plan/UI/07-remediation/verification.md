# 验证说明

## 环境

Windows、Node 24.19.0、pnpm 10.10.0。独立本地目录安装锁定依赖，避免 UNC `node_modules` 快照造成解析混淆。`tooling/prepare-ui-validation.py` 复制源码，排除环境变量文件、密钥与运行目录。

最终构建目录为 `C:/Users/HK/AppData/Local/Temp/qitu-ui-validation-final-20261021`。浏览器访问 `http://127.0.0.1:4180`，五个 Next 服务和测试 API 均监听回环地址。浏览器使用开发服务，生产构建另行验证。

## 结果

- API 构建通过；五个前端类型检查和生产构建通过。
- API 测试源重新编译后执行全量测试，1158 项通过，0 失败。
- `node --test tooling/ui-remediation.test.mjs` 的 5 项检查通过，覆盖安全返回、上海跨日、当前项目、中文显示与光学批准域。

| 证据 | 覆盖 |
|---|---|
| [browser-verification.json](browser-verification.json) | 官网和登录 320/390/1440；四角色深链登录；代表页面；手机设置检索；38 张截图、无运行错误 |
| [tutor-browser-verification.json](tutor-browser-verification.json) | 375/768/1440 输入区、阅读空间、公式局部滚动、Mermaid 恢复与面板互斥 |
| [parent-race-verification.json](parent-race-verification.json) | 三页面 A→B→A；旧成功/失败最后返回；六场景，无写请求 |
| [admin-matrix-verification.json](admin-matrix-verification.json) | 键盘、canonical ID、幂等键、回读、部分失败与固定定位，无运行错误 |
| [validation-summary.json](validation-summary.json) | 命令、结果和验证环境汇总 |
| [index.html](index.html) | 修复后截图分类索引，Fixture/Synthetic 为合成投影 |

## 复现顺序

1. `pnpm install --frozen-lockfile --prefer-offline`。
2. 按依赖图执行 `pnpm -r --workspace-concurrency=1 --filter '@qitu/api...' build`，先构建 contracts、database、ai-client 等依赖。
3. 五个前端分别执行 `typecheck` 和 `build`。
4. API 测试使用 `tsc -p tsconfig.json --incremental false --outDir .tmp/test-dist` 重新编译，再执行 `node --test --test-reporter=tap '.tmp/test-dist/**/*.test.js'`。

首次运行暴露旧冻结绑定 fixture、迁移登记和新管家参考包同步问题。验证快照按真实源文件补齐；提醒接缝复用隔离 fixture。正式绑定门禁与断言保留。

## 限制

- 本地内存 API 不包含生产数据库、Redis、模型提供商或真实学习记录，没有真实模型请求成功的结论。
- Tutor 内容、矩阵失败与家长乱序使用合成投影。后端权限、读模型和幂等由独立 API 测试覆盖。
- 未在真实 iOS/Android 上测试软键盘；可视视口适配与 Chromium 窄屏检查已完成。
- 未执行完整辅助技术、对比度与 400% 缩放认证。减少动态效果下完整内容、可见焦点和矩阵键盘操作已检查。
- 未发布生产。正式管理员就绪后需要记录发布版本并重新验收。
