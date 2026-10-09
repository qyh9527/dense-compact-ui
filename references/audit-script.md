# 浏览器内量取脚本

[scripts/dense-audit.js](../scripts/dense-audit.js) 在已打开的 Web 页面里采集量取数据，给 verify.md 的「预览验证」提供数字与位置。只用于 Web；桌面、原生按 context.md 用平台工具。脚本零依赖，不需要安装，也不要求项目加标注。

## 运行

本机有 Node ≥22 和 Chrome / Edge 时，用命令行跑，不必把脚本读进上下文：

```sh
node <技能目录>/scripts/run-audit.mjs http://localhost:5173/nodes --touch --width 390 --height 844 --out audit.json
```

- 目标可以是 URL 或本地 HTML 路径；`--width` / `--height` 设视口，默认 1280×720；`--root <选择器>` 只查一个区域。
- 多个视口用可重复的 `--viewport 宽x高` 代替 `--width` / `--height`，如 `--viewport 1280x720 --viewport 390x844`：同一个浏览器里逐个视口重新加载后采集，输出 `{ schema: "dense-audit-multi-v1", totalFindings, reports }`，`reports` 里每个视口一份普通报告。不传时输出格式不变。
- 有固定顶栏、底栏或吸顶区域时加 `--scroll`：量取后把文档和面积最大的几个滚动容器各滚到顶、滚到底，内容被固定栏永久盖住的记为 DC022，检查完恢复原来的滚动位置。滚动可能触发懒加载或无限滚动请求，只在能接受这些请求的环境里用。
- 页面跟随系统深浅色偏好（`prefers-color-scheme`）时，加 `--color-scheme light,dark`：每种配色各加载一次，输出同多视口格式，`context.colorScheme` 标明配色；两种都给时互相比较，颜色写死没跟主题变的记为 DC021。可与 `--viewport` 一起用。
- 页面加载后默认等 DOM 连续 500ms 不变再采集（最多 10 秒，`--settle <毫秒>` 调整，0 关闭），然后等网页字体加载结束（最多 5 秒）。数据靠接口或异步组件晚到的页面，用 `--wait-for <选择器>` 指定代表真实内容已渲染的元素，比如表格首行；只靠静默等待可能量到加载壳。报告的 `context.ready` 记录实际等待：`settled: false` 表示传了 `--settle 0` 跳过，或等满 10 秒页面仍在变化，后者要检查页面是否有持续动画或轮询。
- `--touch`：输入含触屏时加，才检查 44px 热区；不加时按页面的 `pointer: coarse` 判断。
- 退出码 0 无告警、1 有告警、2 浏览器或页面出错（原因在 stderr）。找不到浏览器时设 `CHROME_PATH`。
- 每个要验收的状态（默认、展开、错误、窄屏）各跑一次，和截图一起记录。需要登录或先操作到某个状态的页面，CLI 到不了时改用下一种方式。

已经用 Playwright、DevTools 或 tauri-pilot 打开并操作到目标状态时，先 `await document.fonts.ready`，再在该页面里注入脚本全文后执行 `denseAudit({ touch: true, root: 'main' })`，参数含义同上，节点超过 20000 会要求缩小 `root`。

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
| DC014 | 整页能横向滚动：报最外层伸出视口右边、又没被横向滚动容器或固定定位收住的元素 | 宽内容放进 `overflow-x: auto` 容器或改成换行；不要给 body 加 `overflow: hidden` 掩盖 |
| DC015 | 焦点环被裁：可聚焦元素离 `overflow` 裁切容器内边的距离小于焦点环伸出的宽度（从页面的 `:focus` / `:focus-visible` 规则估算，没有规则按 2px） | 给容器留内边距，或贴边列表改用内描边；估算不算选择器优先级，有疑问时实际 Tab 一次看 |
| DC016 | 点击被拦截：可交互元素中心点命中了别的元素，或自己的 computed `pointer-events` 是 none；对话框、菜单、listbox、popover 盖住它们外面的控件不算，浮层里的控件被浮层内另一层盖住照常报 | 遮挡层是否该 `pointer-events: none`，层级或定位是否写错；暂时不可用的控件改用 `disabled` / `aria-disabled` |
| DC017 | 字体回退：页面在用的第一字体族，其 `@font-face` 文件全部加载失败；按字体族合并成一条 | `src` 路径、跨域与格式；computed `font-family` 不能证明字体生效 |
| DC018 | 破图：`img` 请求已结束却没有像素，按地址合并（报告里去掉查询串）；塌成 0×0 的也算，懒加载还没触发的不算 | 资源路径、跨域与响应格式；页面加载后才插入的图片要等它请求结束再量 |
| DC019 | 布局属性没生效：写了 `gap`、`align-items`、`justify-content`、`flex-direction`、`grid-template-*` 等非默认值，但当前 `display` 不是 flex / grid（多列布局的 `column-gap`、`justify-content` 除外） | 是否被别的规则或断点改掉了 `display`；有意在这个视口换布局时删掉这些属性 |
| DC020 | 图标字体丢失：直接文字或 `::before` / `::after` 里的私有区字符，所用字体族加载失败；按字体族合并 | 图标字体的 `@font-face` 路径；用连字写的图标（如 `home`）回退后显示成单词，归 DC017 |
| DC021 | 主题残色（只在 `--color-scheme` 给了两种时）：中性色区域两种配色下背景相同，成了和页面底色深浅相反的局部反色（只报最外层）；或某种配色下文字对比度不足，而文字色或背景色两次完全相同 | 换成主题 token；有意固定颜色的代码块、品牌区用 `data-dc-ignore` 写理由。用按钮或类名切主题的页面，在两种主题下各执行一次 `denseAuditColors()`，再用 `denseAuditThemeDiff(前, 后, { scheme })` 比较 |
| DC022 | 滚动遮挡（只在 `--scroll` 时）：滚到顶时被上方固定 / 粘性栏盖住、滚到底时被下方的栏盖住的内容中心，这个方向已经滚不动，用户永远看不到；容器滚不动时两头都算。DC016 已报的元素不重复报 | 滚动区留出与栏等高的内边距或 `scroll-padding`，或让栏占据布局空间；滚动途中暂时压住内容不算 |

`metrics` 是交付时要写出的数字：`lists` 给每个重复对象视图的项数、折叠态行高中位数和一屏完整可见项数；`accentRatio` 是强调色面积占比；`fontSizes`、`radii` 是刻度直方图；`page` 记录文档宽与视口宽、加载失败和仍在加载的字体族。改版时用同一内容、视口和状态跑前后两次对比。

每条发现都是需要复核的线索，按 quality-workflow.md 定级后再决定改不改；命令行量取属于 quality-workflow.md「证据等级」的 C 级，在已操作到目标状态的页面里注入执行属于 B 级；零告警不等于验收通过，`limits` 列出的范围（读屏、软键盘、真实触控、视口外内容）仍要单独验证。有意的局部例外写在元素上：`data-dc-ignore="DC003" data-dc-ignore-reason="独立嵌套对象"`，没有理由不生效。推断不准时可用 `data-dc-role`（`body small number money count error primary`）和 `data-dc-view` 覆盖，但不要求项目添加。
