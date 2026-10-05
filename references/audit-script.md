# 浏览器内量取脚本

[scripts/dense-audit.js](../scripts/dense-audit.js) 在已打开的 Web 页面里采集量取数据，给 verify.md 的「预览验证」提供数字与位置。只用于 Web；桌面、原生按 context.md 用平台工具。脚本零依赖，不需要安装，也不要求项目加标注。

## 运行

本机有 Node ≥22 和 Chrome / Edge 时，用命令行跑，不必把脚本读进上下文：

```sh
node <技能目录>/scripts/run-audit.mjs http://localhost:5173/nodes --touch --width 390 --height 844 --out audit.json
```

- 目标可以是 URL 或本地 HTML 路径；`--width` / `--height` 设视口，默认 1280×720；`--root <选择器>` 只查一个区域。
- `--touch`：输入含触屏时加，才检查 44px 热区；不加时按页面的 `pointer: coarse` 判断。
- 退出码 0 无告警、1 有告警、2 浏览器或页面出错（原因在 stderr）。找不到浏览器时设 `CHROME_PATH`。
- 每个要验收的状态（默认、展开、错误、窄屏）各跑一次，和截图一起记录。需要登录或先操作到某个状态的页面，CLI 到不了时改用下一种方式。

已经用 Playwright、DevTools 或 tauri-pilot 打开并操作到目标状态时，在该页面里注入脚本全文后执行 `denseAudit({ touch: true, root: 'main' })`，参数含义同上，节点超过 20000 会要求缩小 `root`。

## 读报告

| 规则 | 查什么 | 复核要点 |
| --- | --- | --- |
| DC001 | 文字低于 `--dc-text-small`，或正文类元素低于 `--dc-text-body` | 确认是否真是正文；次要信息可用 small |
| DC003 | 带边框或阴影的圆角表面嵌套；浮层是边界，浮层里的卡片不算嵌在外层卡片里 | 能否改成连续分区与 1px 分隔线 |
| DC005 | 表格单元格里的数字没有 `tabular-nums` | 字体本身是否已等宽 |
| DC007 | 强调色与语义色填充面积超过视口 10% | 按 color.md 的配额口径复核 |
| DC008 | 触屏下可交互元素小于 44px | 标签、伪元素是否扩大了实际命中区 |
| DC010 | 数字或错误信息被省略号截断 | 改为换行、限宽外露或提供完整值 |
| DC012 | 同一视图有多个主按钮 | 条件分支是否互斥 |
| DC013 | 字号或圆角不在 token 刻度上 | 是有意例外还是漂移 |

`metrics` 是交付时要写出的数字：`lists` 给每个重复对象视图的项数、折叠态行高中位数和一屏完整可见项数；`accentRatio` 是强调色面积占比；`fontSizes`、`radii` 是刻度直方图。改版时用同一内容、视口和状态跑前后两次对比。

每条发现都是需要复核的线索，按 quality-workflow.md 定级后再决定改不改；零告警不等于验收通过，`limits` 列出的范围（读屏、软键盘、真实触控、视口外内容）仍要单独验证。有意的局部例外写在元素上：`data-dc-ignore="DC003" data-dc-ignore-reason="独立嵌套对象"`，没有理由不生效。推断不准时可用 `data-dc-role`（`body small number money count error primary`）和 `data-dc-view` 覆盖，但不要求项目添加。
