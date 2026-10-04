# 工作台动效

工作台的动效只用来说明「发生了什么变化」：出现、消失、展开、移动、成功或失败。不做滚动叙事、入场编排和装饰性循环。浏览器支持度和库的用法变化快，下面给出做法和去查的方向，动手前按当前文档核对。

## 规则

- 时长取 `--dc-duration`（进入 120ms）/ `--dc-duration-exit`（退出 80ms）；抽屉、整块面板这类大面积位移可到 180–240ms，不超过 300ms。
- 缓动取变量：进入用减速 `--dc-ease-enter`，退出用加速 `--dc-ease-exit`；匀速只给进度条和旋转。
- 位移、缩放、淡入淡出只动 `transform` 和 `opacity`；高度展开是例外，只用于小区域。悬停、按压、选中的颜色短过渡（`background-color`、`border-color`、`color`，时长不超过 `--dc-duration`）可以用，它们只触发重绘；不过渡 `width`、`top` 这类会引起重排的属性。
- 动画可打断：快速连续操作时直接设到最终状态，状态更新不依赖动画结束事件。
- `prefers-reduced-motion: reduce` 时，位移和缩放改为淡入淡出或直接切换。
- 长列表、表格行不逐项入场；数据刷新不做闪烁，变化的数字可以短暂高亮底色（不超过 1 秒）。
- 加载用骨架屏，规则见 patterns.md 的「加载状态」。

## 场景与做法

| 场景 | 做法 | 去查 |
| --- | --- | --- |
| 悬停、按压、选中 | CSS transition：背景色、边框色、按压时 `scale(0.98)` | — |
| 弹出层、对话框出现与消失（含 `display: none`） | `@starting-style` 给出起始状态，`transition` 里给 `display`、`overlay` 加 `allow-discrete` | MDN：@starting-style、transition-behavior |
| 展开 / 收起高度 | `interpolate-size: allow-keywords` 或 `calc-size()`；不支持时用 `grid-template-rows: 0fr → 1fr` 兜底；不用 `max-height` 猜值 | MDN：interpolate-size |
| 列表增删、重新排序 | FLIP（记下旧位置 → 改 DOM → 反向 `transform` 再归零），或给元素设 `view-transition-name` 走视图过渡；也可用轻量库 | MDN：View Transition API；「FLIP animation」 |
| 同页面视图切换 | `document.startViewTransition()`，不支持时直接切换 | MDN：Document.startViewTransition |
| 拖拽跟手 | Pointer Events + `transform`，在 `requestAnimationFrame` 里更新；松手后短动画吸附到位 | MDN：Pointer events |
| toast、抽屉 | 进入减速，退出加速且更短 | — |
| 数字变化 | 直接替换 + 短暂底色高亮；不做滚动计数 | — |
| JS 驱动的复杂交互动画 | Web Animations API（`element.animate()`）；React 项目可用 Motion 这类库 | MDN：Web Animations API |

去查时确认三件事：浏览器支持情况（Baseline 状态）；不支持时的降级是不是只是「没有动画」、功能不受影响；减少动态效果设置下的表现。
