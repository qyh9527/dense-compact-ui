# 浏览器内量取脚本

[scripts/dense-audit.js](../scripts/dense-audit.js) 在已打开的 Web 页面里采集量取数据，给 verify.md 的「预览验证」提供数字与位置。只用于 Web 内容，包括 Electron、Tauri 桌面应用里的网页界面；原生界面和 WebView 外的窗口外壳按 context.md 用平台工具。脚本零依赖，不需要安装，也不要求项目加标注。

## 运行

本机有 Node ≥22 和 Chrome / Edge 时，用命令行跑，不必把脚本读进上下文：

```sh
node <技能目录>/scripts/run-audit.mjs http://localhost:5173/nodes --touch --width 390 --height 844 --out audit.json
```

- 目标可以是 URL 或本地 HTML 路径；`--width` / `--height` 设视口，默认 1280×720；`--root <选择器>` 只查一个区域。
- 多个视口用可重复的 `--viewport 宽x高` 代替 `--width` / `--height`，如 `--viewport 1280x720 --viewport 390x844`：同一个浏览器里逐个视口重新加载后采集，输出 `{ schema: "dense-audit-multi-v1", totalFindings, reports }`，`reports` 里每个视口一份普通报告。不传时输出格式不变。
- 有固定顶栏、底栏或吸顶区域时加 `--scroll`：量取后把文档和面积最大的几个滚动容器各滚到顶、滚到底（首屏之外的容器先滚进视口），内容被固定栏永久盖住的记为 DC022，检查完恢复原来的滚动位置。滚动可能触发懒加载或无限滚动请求，只在能接受这些请求的环境里用。
- 页面跟随系统深浅色偏好（`prefers-color-scheme`）时，加 `--color-scheme light,dark`：每种配色各加载一次，输出同多视口格式，`context.colorScheme` 标明配色；两种都给时互相比较，颜色写死没跟主题变的记为 DC021。可与 `--viewport` 一起用。
- `--screenshot <目录>`：每份报告量取前截一张当前视口的 PNG 存进该目录（没有就新建，同名覆盖），文件名形如 `03-390x844-dark-展开.png`（序号与报告顺序一致，没有配色或状态时省略），路径写在 `context.screenshot`。修复前后各存一个目录，同名文件就是同一视口、配色和状态，供 quality-workflow.md 的观感检查并排对比。截图不影响告警和退出码；画面里有真实数据时，按数据的敏感程度保存和分享。
- 页面加载后默认等 DOM 连续 500ms 不变再采集（最多 10 秒，`--settle <毫秒>` 调整，0 关闭），然后等网页字体加载结束（最多 5 秒）。数据靠接口或异步组件晚到的页面，用 `--wait-for <选择器>` 指定代表真实内容已渲染的元素，比如表格首行；只靠静默等待可能量到加载壳。报告的 `context.ready` 记录实际等待：`settled: false` 表示传了 `--settle 0` 跳过，或等满 10 秒页面仍在变化，后者要检查页面是否有持续动画或轮询。
- `--touch`：输入含触屏时加，才检查 44px 热区；不加时按页面的 `pointer: coarse` 判断。
- 退出码 0 无告警、1 有告警、2 浏览器或页面出错（原因在 stderr）。
- 浏览器按 `CHROME_PATH`、再按平台的常见安装位置查找：Windows 查 Edge、Chrome 的默认目录，macOS 查 `/Applications` 与 `~/Applications` 下的 Chrome、Edge，其他系统查 `/usr/bin/google-chrome`、`/usr/bin/chromium`。装在别处时把 `CHROME_PATH` 设为可执行文件的完整路径，如 macOS 的 `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`。找不到时退出码 2，stderr 列出查过的路径；这时没有执行任何量取，静态检查照做，需要浏览器的视觉与运行时项标「未验证」，验收结论按 quality-workflow.md 记 blocked 或 partial，不能当作零告警。
- 每个要验收的状态（默认、展开、错误、窄屏）各跑一次，和截图一起记录。要先操作才能到达的状态，用 `--steps` 写步骤文件；需要登录等 CLI 到不了的状态，改用下一种方式。
- `--steps steps.json`：加载后按顺序执行步骤，每步写一个动作——`click`、`hover`（选择器）、`fill`（选择器 + `value`）、`press`（Enter、Escape、Tab、方向键等或单个字符）、`select`（选择器 + 选项的 `value` 或文字）、`wait`（等选择器可见，默认 5 秒）、`expect`（选择器，可加 `count`、`text`、`visible: false`，默认等 2 秒）；`timeout` 可改等待毫秒数。在 `{ "audit": "状态名" }` 处各量一次，没写就在最后量一次；某一步找不到元素或期望落空时记 DC023、在该处量一次并停下。输出同多视口格式，`context.state` 是状态名。只执行文件里写的动作；提交、删除、发送这类步骤只对模拟数据或沙箱环境跑。

```json
[
  { "click": "#filters .apply" },
  { "expect": "table tbody tr", "count": 20 },
  { "audit": "筛选后" },
  { "fill": "#search", "value": "订单 B" },
  { "press": "Enter" },
  { "expect": "#result", "text": "订单 B" }
]
```

已经用 Playwright、DevTools 或 tauri-pilot 打开并操作到目标状态时，先 `await document.fonts.ready`，再在该页面里注入脚本全文后执行 `denseAudit({ touch: true, root: 'main' })`，参数含义同上，节点超过 20000 会要求缩小 `root`。

### 接入运行中的桌面应用

Electron 或 Windows Tauri（WebView2）应用开着远程调试端口时，用 `--attach` 量它当前的页面，不必手工注入：

```sh
node <技能目录>/scripts/run-audit.mjs --attach 9222 --screenshot shots --out audit.json
```

- 开端口：Electron 加启动参数 `--remote-debugging-port=9222`；从 VS Code 终端启动时先去掉继承的 `ELECTRON_RUN_AS_NODE`，否则它会当成 Node 运行、不开窗口。Tauri 在调试构建的窗口配置 `additionalBrowserArgs` 里加 `--remote-debugging-port=9222`（这个配置会替换 Tauri 默认的参数，原有参数要一起写上）；宿主不以管理员身份运行时，也可在启动前设环境变量 `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222`，WebView2 Runtime 150 起，管理员身份运行的宿主会忽略这个变量。端口只开在本机，不在发行版里开。
- `--attach` 接受端口或 `http://127.0.0.1:端口`，只连本机地址。端口上有多个页面时报错并列出 URL 与标题，用 `--attach-target <URL 或标题片段>` 选一个。
- 接入时不导航、不重载，结束时只断开连接，不关闭应用。视口就是窗口当前的实际尺寸，写在 `context.viewport`；`context.attached` 记录端口、页面 URL、标题和 `devicePixelRatio`；截图按设备像素保存，尺寸是视口乘以 `devicePixelRatio`。
- 不能和 URL、`--viewport`、`--width` / `--height`、`--color-scheme` 同用：它们要改视口或重新加载页面。要换尺寸就调整窗口，要换配色就在应用或系统里切换后再跑一次。
- `--wait-for`、`--settle`、`--root`、`--touch`、`--scroll`、`--screenshot` 照常可用；`--steps` 会真的操作这个应用，只在能接受这些操作的数据和环境里跑。量取会在页面里留下 `denseAudit` 等全局函数，应用下次重载后消失。
- 连不上端口、目标不唯一或截图失败（窗口最小化时可能截不了）时退出码 2，stderr 写明原因。量取在应用的真实状态上进行，属于 quality-workflow.md「证据等级」的 B 级；窗口外壳、系统菜单和原生弹窗不在范围内，仍要单独验证。

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
| DC019 | 布局属性没生效：写了 `gap`、`align-items`、`justify-content`、`flex-direction`、`grid-template-*` 等非默认值，但当前 `display` 不是 flex / grid（多列布局的 `column-gap`、`justify-content`，以及 select、button、input 等表单控件除外） | 是否被别的规则或断点改掉了 `display`；有意在这个视口换布局时删掉这些属性 |
| DC020 | 图标字体丢失：直接文字或 `::before` / `::after` 里的私有区字符，所用字体族加载失败；按字体族合并 | 图标字体的 `@font-face` 路径；用连字写的图标（如 `home`）回退后显示成单词，归 DC017 |
| DC021 | 主题残色（只在 `--color-scheme` 给了两种时）：中性色区域两种配色下背景相同，成了和页面底色深浅相反的局部反色（只报最外层）；或某种配色下文字对比度不足，而文字色或背景色两次完全相同 | 换成主题 token；有意固定颜色的代码块、品牌区用 `data-dc-ignore` 写理由。用按钮或类名切主题的页面，在两种主题下各执行一次 `denseAuditColors()`，再用 `denseAuditThemeDiff(前, 后, { scheme })` 比较 |
| DC022 | 滚动遮挡（只在 `--scroll` 时）：滚到顶时被上方固定 / 粘性栏盖住、滚到底时被下方的栏盖住的内容中心，这个方向已经滚不动，用户永远看不到；容器滚不动时两头都算。DC016 已报的元素不重复报 | 滚动区留出与栏等高的内边距或占位元素，或让栏进入文档流；`scroll-padding` 不增加可滚动范围，解决不了。滚动途中暂时压住内容不算 |
| DC023 | 交互步骤没达成（只在 `--steps` 时）：元素找不到或不可见、选项不存在、`wait` 超时、`expect` 的数量或文字不符；`value` 里有步骤号、动作、期望与实际 | 操作是否真的生效（被遮挡、事件没绑定、请求失败），还是步骤里的选择器或期望写错了 |

`metrics` 是交付时要写出的数字：`lists` 给每个重复对象视图的项数、折叠态行高中位数和一屏完整可见项数；`accentRatio` 是强调色面积占比；`fontSizes`、`radii` 是刻度直方图；`page` 记录文档宽与视口宽、加载失败和仍在加载的字体族。改版时用同一内容、视口和状态跑前后两次对比。

每条发现都是需要复核的线索，按 quality-workflow.md 定级后再决定改不改；命令行量取属于 quality-workflow.md「证据等级」的 C 级，在已操作到目标状态的页面里注入执行属于 B 级；零告警不等于验收通过，`limits` 列出的范围（读屏、软键盘、真实触控、视口外内容）仍要单独验证。有意的局部例外写在元素上：`data-dc-ignore="DC003" data-dc-ignore-reason="独立嵌套对象"`，没有理由不生效。推断不准时可用 `data-dc-role`（`body small number money count error primary`）和 `data-dc-view` 覆盖，但不要求项目添加。
