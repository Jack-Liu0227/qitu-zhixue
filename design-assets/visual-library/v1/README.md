# 启途智学全站视觉素材库 v1

已生成 55 个独立素材母版，包含 10 款可复用助手头像。制作使用 Codex 内置 `image_gen`，工具未暴露具体底层模型名称；元数据据实记录为 `not_exposed`。现有蓝白搭档图仅作为风格参考。

- [素材预览](./index.html)
- [全套缩略图](./contact-sheet.png)
- [资产与派生文件清单](./manifest.json)
- [生成提示词与回执](./generation-receipts.json)
- [生成时使用的风格参考快照](./style-reference.png)

`originals/` 保存全部选中母版。运行时文件位于 `packages/ui/assets/library/`，共 110 个 PNG 派生文件，合计 2,195,952 字节。头像与图标提供 64/256 像素，封面和插画提供 64 像素预览与 640×360 像素版本。所有文件的实际尺寸、透明度及 SHA-256 见清单。

46 个非封面母版通过 alpha 通道检查。封面允许浅色场景背景。图片用于身份与内容主题展示，不能作为实验测量、教学完成或作品通过的证据。

运行 `node tooling/prepare-visual-assets.mjs` 可从保存的母版重新导出运行时文件、索引、清单及预览。该脚本只做确定性缩放和编码，不再次调用图片模型。
