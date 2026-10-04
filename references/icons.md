# 图标

## 选库

- 项目已有图标库就沿用，全项目只用一套。
- 新项目从 Tabler Icons、Lucide、Phosphor 中选一套。下表给出 Tabler 和 Lucide 的名称，两者差异不小；Phosphor 等其他库的名称各不相同，用前都在官方图标站（tabler.io/icons、lucide.dev/icons、phosphoricons.com）逐个确认存在。
- 线宽全项目统一（1.5–2）；同一层级不混用填充与线框；不手写图标路径，不用 emoji 当图标。

## 尺寸

| 档位 | 图标视觉尺寸 | 热区 |
| --- | --- | --- |
| dense | 14–16px | 鼠标 24px，触屏 44px |
| compact | 16px | 28px |
| comfortable | 18–20px | 36px |

图标与文字垂直居中对齐；图标尺寸和热区分开算（`--dc-icon-size` / `--dc-hit-size`）。

## 常见操作对应的图标

| 操作 | Tabler | Lucide |
| --- | --- | --- |
| 搜索 | `search` | `search` |
| 筛选 | `filter`；多条件筛选 `adjustments-horizontal` | `filter`；`sliders-horizontal` |
| 排序 | 未排序 `selector`；`sort-ascending` / `sort-descending` | `arrow-up-down`；`arrow-up-narrow-wide` / `arrow-down-wide-narrow` |
| 新建 | `plus` | `plus` |
| 编辑 | `pencil` | `pencil` |
| 删除 | `trash` | `trash` |
| 复制 | `copy` | `copy` |
| 更多操作 | 行内 `dots`；卡片、列表右侧 `dots-vertical` | `ellipsis`；`ellipsis-vertical` |
| 刷新、重试 | `refresh` | `refresh-cw` |
| 撤销 / 重做 | `arrow-back-up` / `arrow-forward-up` | `undo-2` / `redo-2` |
| 下载 / 上传 | `download` / `upload` | `download` / `upload` |
| 链接 / 外部链接 | `link` / `external-link` | `link` / `external-link` |
| 分享 | `share` | `share` |
| 设置 | `settings` | `settings` |
| 展开 / 进入 | `chevron-down` / `chevron-right` | `chevron-down` / `chevron-right` |
| 关闭 | `x` | `x` |
| 确认 | `check` | `check` |
| 显示 / 隐藏 | `eye` / `eye-off` | `eye` / `eye-off` |
| 锁定 | `lock` | `lock` |
| 拖拽手柄 | `grip-vertical` | `grip-vertical` |
| 固定 / 收藏 | `pin` / `star` | `pin` / `star` |
| 侧栏开关 / 列设置 | `layout-sidebar` / `columns-3` | `panel-left` / `columns-3` |
| 最大化 / 还原 | `maximize` / `minimize` | `maximize` / `minimize` |
| 菜单 / 通知 / 帮助 | `menu-2` / `bell` / `help-circle` | `menu` / `bell` / `circle-help` |
| 加载中（旋转；减少动态效果时不转） | `loader-2` | `loader-circle` |
| 成功 / 警告 / 错误 / 信息 | `circle-check` / `alert-triangle` / `alert-circle` / `info-circle` | `circle-check` / `triangle-alert` / `circle-alert` / `info` |
| 运行 / 暂停 / 停止 | `player-play` / `player-pause` / `player-stop` | `play` / `pause` / `square` |
| 历史 / 退出登录 | `history` / `logout` | `history` / `log-out` |

## 用法

- 图标旁有文字时，图标设 `aria-hidden="true"`；纯图标按钮要有 `aria-label` 和悬停提示，名称与界面里的操作名一致。
- 不同含义不共用同一个图标：关闭用 `x`，删除用 `trash`。
- 状态图标除颜色外还要靠形状或文字区分。
