# 主页思考气泡素材来源

- 原图：用户附件 `1000118993.png`，同一文件位于用户自己的仓库
  `linhlinsiyi217/LinH-Pocket-YI` main 分支 `uploads/20261005_225043_tg4y.png`
  （指定直链 `https://cdn.statically.io/gh/linhlinsiyi217/LinH-Pocket-YI/main/uploads/20261005_225043_tg4y.png`，
  2026-10-05 访问返回 404，改用 GitHub API 原样下载同一文件）。
- 原图规格：1920×1920 RGBA，透明背景上的黑色云朵思考气泡剪影（主体 + 左下凸起 + 独立小泡泡）。
- 派生方式：按原图 alpha 通道裁出形状区域（left 153, top 498, width 1652, height 977），
  lanczos3 缩放到 480×284；不重画、不拉伸、不改轮廓。
  - `bubble-mask.png`：白色 + 原 alpha，用作 CSS `mask-image`，承载白色液态玻璃。
  - `bubble-rim.png`：alpha 减去半径 3px 腐蚀后的细边，用作边缘高光。
- 权利：素材由用户本人提供并指定用于本项目主页气泡。
