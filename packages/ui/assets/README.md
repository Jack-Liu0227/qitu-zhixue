# 共享运行图片

本目录保存各应用通过 `@qitu/ui` 使用的运行图片。跨应用共用的导航、头像、模板封面和品牌图片集中维护；只有单应用独占的资源才放入对应 app。

- `navigation/`：导航图标，提供 64 和 128 像素规格。
- `library/`：助手头像、情绪、模板封面等素材，提供缩略图和大图。
- `brand/`、`logo/`、`assistant/`：品牌及助手相关图片。

导航和素材库文件使用「用途名称 + 尺寸」命名，例如 `avatar-general-64.png`，已移除文件名中的 `v1` 标识。静态导入分别由 `src/navigation-artwork-files.ts` 和 `src/visual-asset-files.ts` 维护。

数据库和合同中已使用的素材 ID（如 `avatar-general-v1`）继续作为稳定引用，由 UI 映射到当前文件名。文件重命名不改变已有头像、团队或模板绑定。

原 `design-assets/` 中的母版、预览与生成回执，以及依赖该目录的三个 `prepare-*-assets.mjs` 导出脚本已清理；历史内容可从 Git 记录恢复。后续更新运行图片时，同步维护导入映射并运行 `node --test tooling/visual-layout.test.mjs`。
