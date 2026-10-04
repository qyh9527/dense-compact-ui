# 技术栈与组件库落地

项目已有技术栈或组件库时读。原则：沿用项目已有的库和主题机制，只把本技能的密度、空间与配色映射进去。组件库的参数名会随版本变化，下表写的是「找什么入口」，动手前按「去查」一栏核对当前版本的官方文档。

## 目录

- 步骤
- 速查
- 配置片段：Tailwind CSS v4、shadcn/ui、Ant Design、Element Plus、MUI、Carbon / Fluent UI / Primer
- 注意

## 步骤

1. 从 `package.json` 等文件确认用了哪个库、主版本是多少。
2. 先找库自带的紧凑 / 尺寸入口：全局配置优先，其次单个组件的属性。
3. 再把 `tokens.css` 的颜色、圆角、字体映射到库的主题变量；映射不了的少量补 CSS，不整套覆盖。
4. 按 verify.md 实测：工具栏、表头、数据行同档，触屏 44px 兜底仍然生效。

## 速查

| 库 | 紧凑入口 | 主题入口 | 去查 |
| --- | --- | --- | --- |
| Tailwind CSS v4 | 没有内置档位；用 `--dc-*` 变量配高度类，或在 `@theme` 里定义尺寸变量 | `@theme` 把 `--dc-*` 映射成 `--color-*`、`--radius-*`、`--font-*`；变量引用其他变量时用 `@theme inline` | tailwindcss.com/docs/theme |
| shadcn/ui | 没有全局尺寸；改组件源码里的高度类，或加一个紧凑 `size` 变体 | `:root` / `.dark` 下的 CSS 变量（`--background`、`--foreground`、`--border`、`--ring` 等），对照 color.md 的「集成」 | ui.shadcn.com/docs/theming |
| Ant Design | `ConfigProvider` 的 `theme.algorithm` 加入 `theme.compactAlgorithm`（可与 `darkAlgorithm` 组合）；`componentSize="small"` | `theme.token`（主色、圆角、字体等）与 `theme.components` 组件 token | ant.design/docs/react/customize-theme |
| Element Plus | `el-config-provider` 的 `size="small"` | 覆盖 `--el-*` CSS 变量 | element-plus.org 的 Config Provider、Theming |
| MUI | 官方 Density 做法：在 theme 的 `components.*.defaultProps` 里设 `size: 'small'`、`margin: 'dense'`、`dense: true`，Toolbar 用 `variant: 'dense'` | `createTheme` 的 palette、shape、typography，或 CSS 变量模式 | mui.com/material-ui/customization/density |
| Carbon | 组件的 `size` 属性；DataTable 的 `xs`（24px）/ `sm`（32px）正好对应 dense / compact，工具栏配小号 | Carbon 主题（如 g100）再覆盖 token | carbondesignsystem.com 的 Data table |
| Fluent UI v9 | 组件 `size="small"`；Table 用 `size="extra-small"` 或 `"small"` | `FluentProvider` 的 `theme` | react.fluentui.dev |
| Primer React | 组件 `size="small"` | Primer 主题与 CSS 变量 | primer.style |

去查时用这类关键词：「<库名> <主版本> density / size / compact」「<库名> theme tokens / CSS variables」。

## 配置片段

下面的片段是起点：颜色都引用 `tokens.css` 的 `--dc-*`，先把 tokens.css 引入项目。片段按 Tailwind v4、Ant Design v5 / v6、Element Plus 2.x、MUI v5–v7、Fluent UI v9 写；粘贴前核对项目的主版本，改完实测行高和控件高。

### Tailwind CSS v4

```css
@import "tailwindcss";
@import "./tokens.css";

@theme inline {
  --color-canvas: var(--dc-canvas);
  --color-surface: var(--dc-surface);
  --color-raised: var(--dc-raised);
  --color-line: var(--dc-border);
  --color-fg: var(--dc-text);
  --color-muted: var(--dc-text-muted);
  --color-accent: var(--dc-accent);
  --color-danger: var(--dc-danger-ink);
  --radius-control: var(--dc-radius-control);
  --radius-pane: var(--dc-radius-pane);
  --font-sans: var(--dc-font-sans);
}
```

高度直接引用密度变量，切换档位时跟着变：控件写 `min-h-[max(var(--dc-control-height),var(--dc-hit-size))]`，可点的行写 `min-h-[max(var(--dc-row-height),var(--dc-hit-size))]`。`--dc-control-height` 只是视觉高度，单独写 `h-(--dc-control-height)` 会得到 22px 的控件，触屏上也到不了 44px。

### shadcn/ui

```css
.dark {
  --background: var(--dc-canvas);
  --foreground: var(--dc-text);
  --card: var(--dc-surface);
  --popover: var(--dc-raised);
  --muted-foreground: var(--dc-text-muted);
  --border: var(--dc-border);
  --input: var(--dc-border-control);
  --ring: var(--dc-accent);
  --destructive: var(--dc-danger);
  --radius: 6px;
}
```

`--accent` 和 `--primary` 的取舍见 color.md 的「集成」。紧凑尺寸：在 `components/ui/button.tsx` 的 `size` 变体里加一档 `dense: "min-h-[max(var(--dc-control-height),var(--dc-hit-size))] px-2 text-xs"`；表格在 `table.tsx` 里把 `TableHead`、`TableCell` 的高度改成 `h-(--dc-row-height)`，上下内边距改为 0。

### Ant Design

```tsx
import { ConfigProvider, theme } from 'antd';

<ConfigProvider
  componentSize="small"
  theme={{
    algorithm: [theme.darkAlgorithm, theme.compactAlgorithm],
    token: {
      colorBgBase: '#191a1b',
      colorTextBase: '#fafafa',
      colorPrimary: '#58a6ff',
      borderRadius: 6,
      fontSize: 13,
    },
  }}
>
  <App />
</ConfigProvider>
```

`token` 只接受具体颜色值，不能写 `var(--dc-*)`（算法要据此派生色阶）。紧凑算法加 `small` 后控件仍可能略高于 22px：用 `token.controlHeight` 和 `components.Table` 的单元格内边距 token 微调，改完量一下。

### Element Plus

```ts
// main.ts：引入暗色变量，并给 <html> 加 class="dark"
import 'element-plus/theme-chalk/dark/css-vars.css'
import './styles/element-dc.css'   // 放在 Element Plus 样式之后
```

```vue
<el-config-provider size="small">
  <App />
</el-config-provider>
```

```css
/* element-dc.css */
html.dark {
  --el-bg-color-page: var(--dc-canvas);
  --el-bg-color: var(--dc-surface);
  --el-bg-color-overlay: var(--dc-raised);
  --el-border-color: var(--dc-border);
  --el-text-color-primary: var(--dc-text);
  --el-text-color-regular: var(--dc-text-secondary);
  --el-border-radius-base: var(--dc-radius-control);
}
```

`small` 档控件高 24px，接近 dense 档。主色由 SCSS 派生出 `--el-color-primary-light-3` 到 `-light-9` 和 `-dark-2`，只改 `--el-color-primary` 时这些派生色不会跟着变：要么一起覆盖，要么用官方 SCSS 变量重新生成。

### MUI

```ts
import { createTheme } from '@mui/material/styles';

const theme = createTheme({
  palette: {
    mode: 'dark',
    background: { default: '#191a1b', paper: '#212225' },
    primary: { main: '#58a6ff' },
    divider: '#2e2f33',
  },
  shape: { borderRadius: 6 },
  typography: { fontSize: 13 },
  components: {
    MuiButton: { defaultProps: { size: 'small' } },
    MuiIconButton: { defaultProps: { size: 'small' } },
    MuiTextField: { defaultProps: { size: 'small', margin: 'dense' } },
    MuiListItem: { defaultProps: { dense: true } },
    MuiToolbar: { defaultProps: { variant: 'dense' } },
    MuiTable: { defaultProps: { size: 'small' } },
    MuiTableCell: { styleOverrides: { sizeSmall: { paddingBlock: 2, paddingInline: 8 } } },
  },
});
```

`defaultProps` 这部分来自 MUI 官方 Density 页；表格行要压到 24px，还要像最后一行那样改单元格内边距。

### Carbon、Fluent UI、Primer

```jsx
// Carbon：g100 暗色主题 + xs 表格（24px 行）
<Theme theme="g100">
  <DataTable size="xs" rows={rows} headers={headers}>{/* … */}</DataTable>
</Theme>

// Fluent UI v9：暗色主题，覆盖背景 token；表格用 extra-small
<FluentProvider theme={{ ...webDarkTheme, colorNeutralBackground1: '#212225' }}>
  <Table size="extra-small">{/* … */}</Table>
</FluentProvider>

// Primer React：夜间模式，组件逐个用 small
<ThemeProvider colorMode="night"><BaseStyles><Button size="small">保存</Button></BaseStyles></ThemeProvider>
```

## 注意

- 库的紧凑档和本技能的档位不完全对应：以本技能的行高、控件高为准，实测后再微调。
- 组件库默认颜色往往饱和度高：普通操作改回中性色，强调色守住 10% 配额。
- 只通过库提供的入口改；不用高优先级选择器大面积覆盖库的内部类名，升级时会坏。
- 交互密集的部分（虚拟列表、实时数据、拖拽）按 tables.md 的「数据量与分页」选渲染策略，实现时去查「<框架> virtual list / memo」，优先用项目已有的方案。
