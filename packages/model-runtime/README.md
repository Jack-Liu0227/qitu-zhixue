# @qitu/model-runtime

启途智学服务端模型运行时。该包迁入并适配 Pi AI 的模型调用核心，但对业务代码只暴露启途自己的接口。

## 边界

- 只在服务端使用，不供浏览器导入。
- Provider、Model、Usage 和凭证仍由启途 `ModelRegistryService` 管理。
- 不包含 Pi Coding Agent 的 CLI、TUI、shell 或文件工具。
- `tutor.live` 音频和 `knowledge.embed` embedding 不由本包处理。

## 来源

Pi AI 源码来源、版本和本地改造范围见 [`UPSTREAM.md`](./UPSTREAM.md)。
