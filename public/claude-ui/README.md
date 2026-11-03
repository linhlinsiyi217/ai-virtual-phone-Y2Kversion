# Claude 工坊视觉素材

这套素材已经画好，TRA 只需引用，不需要自行临摹。

## 文件

- `thinking-star.svg`：思考中的旋转星芒
- `crab/idle.svg`：待命
- `crab/thinking.svg`：思考/工具运行
- `crab/success.svg`：完成
- `crab/error.svg`：失败
- `icons.svg`：14 个统一线性图标
- `claude-ui-assets.css`：颜色变量与动效
- `preview.svg`：整套视觉预览

## 引用

```html
<img src="/claude-ui/thinking-star.svg" class="claude-thinking-star" alt="正在思考" />
<svg aria-hidden="true"><use href="/claude-ui/icons.svg#tool" /></svg>
```

状态必须来自真实的推理/工具调用记录：`idle → thinking → success/error`，不能用定时器伪造。
