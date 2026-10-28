# DeepTutor 知识库界面迁移

用户授权调整知识库界面。参考源码固定为 HKUDS/DeepTutor `6cf793bd868ba5ecbe64722936d4be8fab5a01df`：CreateKbModal、KnowledgeBaseDetail、KbFilesTab、来源与索引版本面板。图标及上游 MIT 许可保留在 `apps/admin-console/public/knowledge-engine-icons`。功能现状以 [知识中心](../../docs/admin/knowledge-center.md) 为准。

## 结构

- 路由保持 `/admin/settings/knowledge`，页面只挂载 `lib/components/knowledge-library/KnowledgeLibrary.tsx`。
- CreateLibraryModal 管理两种创建方式、引擎配置复用与助手选择；LibraryDetail 管理文件、来源、索引、逐库助手和设置。组件样式集中在 KnowledgeLibrary.module.css，继续使用平台导航、认证与蓝色视觉。
- 后端继续集中在 `services/api/src/modules/knowledge`。KnowledgeConnectionService 负责来源预检/登记；KnowledgeLibraryService 负责设置、逻辑文件夹和原文目录；原 Center/Worker/Retrieval 保留事务、授权和索引发布职责。
- Python linked_runtime 只读既有原生索引；bridge/engine_runtime 复用固定上游原始 pipeline/客户端。不会暴露 DeepTutor 管理 HTTP 服务。

## 验收边界

新建与关联、已配置引擎复用、内联配置、文件/文件夹、原文、来源、版本、逐库多助手绑定、撤权和删除均需真实接口。配置已保存与服务就绪分开显示。没有配置的外部服务不显示假成功。

本次保留服务器端文件上限：18 种格式、10 MiB/文件、20 份/库、正文合计 7 MiB；不宣称支持上游全部 301 种解析器或 200 MB。网络来源仍只允许经服务器批准的纯文本/Markdown 单页；多用户服务器不开放任意路径、任意仓库或内网 URL。WeKnora/LightRAG 未公开目录读取的适配器仅检索，管理文件回原服务。

## 交付核验

最新 main 创建独立 worktree；API 全量测试、Python 桥测试、lint、API/admin 生产构建；隔离数据库真实 BGE/DeepTutor 和浏览器桌面/390px 操作验收；最后合入 main，推送、迁移、只重启 API/admin，检查正式 Nginx 路由与进程，清理本任务 worktree。
