# 标准与技术参考

仅在需要核对平台要求、规范细节或组件 API 时读对应原文；本文不替代当前项目约定。

| 资料 | 核对内容 |
| --- | --- |
| [Material 3：Density](https://m3.material.io/foundations/layout/grids-spacing/density) / [Material 2：Applying density](https://m2.material.io/design/layout/applying-density.html) | 聚焦型任务不压密度；密度由用户选择、不随断点自动变；切换入口用标准热区；密组件配松网格 |
| [Carbon：Data table](https://www.carbondesignsystem.com/building-blocks/core/components/data-table/guidelines) / [Spacing](https://www.carbondesignsystem.com/building-blocks/foundations/spacing/overview) | 表头与数据行同高、工具栏与行高配套；局部可以密，整页要留让视线休息的留白 |
| [Fluent 2：Shapes](https://fluent2.microsoft.design/shapes) | 形状构成一致的视觉词汇；圆角随组件尺寸与角色分层；区分矩形、圆形、胶囊 |
| [Microsoft：Geometry in Windows](https://learn.microsoft.com/en-us/windows/apps/design/signature-experiences/geometry) | 按容器、控件与邻接关系处理圆角；接触边不留圆角缺口 |
| [W3C：CSS Backgrounds and Borders §4.2–4.3](https://www.w3.org/TR/css-backgrounds-3/#corner-shaping) | 内边缘半径扣除边框与内边距；裁切与指针命中遵循实际曲线 |
| [W3C：目标尺寸最小值](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html) / [增强要求](https://www.w3.org/WAI/WCAG22/Understanding/target-size-enhanced.html) | 24×24px 最低线与 44×44px 设计目标 |
| [W3C：文字最小对比度](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html) / [非文字对比度](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html) | 4.5:1 与 3:1 |
| [shadcn/ui 主题语义](https://ui.shadcn.com/docs/theming) | 主题变量映射，`accent` 与交互蓝分离 |
| [Primer 色彩使用](https://primer.style/product/getting-started/foundations/color-usage/) | 语义色用法 |
| [Apple HIG：Playing haptics](https://developer.apple.com/design/human-interface-guidelines/playing-haptics) / [Buttons](https://developer.apple.com/design/human-interface-guidelines/buttons) / [Tab bars](https://developer.apple.com/design/human-interface-guidelines/tab-bars) | 按系统含义使用触感、优先系统控件；44×44pt 热区；标签栏 |
| [Android：Haptics design principles](https://developer.android.com/develop/ui/views/haptics/haptics-principles) / [HapticFeedbackConstants](https://developer.android.com/reference/android/view/HapticFeedbackConstants) / [Material 3](https://m3.material.io/) | 清晰触感优于嗡嗡振动、按重要性定强度、用语义常量；按窗口宽度选导航栏 / 导航轨 / 抽屉；48dp 热区；预测性返回 |
| [web.dev：Sign-in form best practices](https://web.dev/articles/sign-in-form-best-practices) / [Passkey form autofill](https://web.dev/articles/passkey-form-autofill) / [Chromium：Password form styles](https://www.chromium.org/developers/design-documents/form-styles-that-chromium-understands/) / [Create Amazing Password Forms](https://www.chromium.org/developers/design-documents/create-amazing-password-forms/) | `autocomplete` 取值、显示密码、分步登录带隐藏账号字段、隐含信息用隐藏字段补上、条件式通行密钥 |
| [W3C：Accessible Authentication (Minimum)](https://www.w3.org/WAI/WCAG22/Understanding/accessible-authentication-minimum.html) | 不阻止粘贴与自动填充、不强制转写；支持密码管理器填写和粘贴即算「有协助机制」，不靠记忆的认证方式是更进一步的选项 |
| [OWASP：Authentication Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html) / [NIST SP 800-63B](https://pages.nist.gov/800-63-4/sp800-63b.html) | 统一的登录与找回提示，防止账号枚举；密码长度与不强制组合、不定期强制改密 |
| [web.dev：Font best practices](https://web.dev/articles/font-best-practices) | `font-display`、子集化与 `unicode-range`、只预加载关键字体、回退字体度量 |
| [Tailwind：Theme variables](https://tailwindcss.com/docs/theme) / [Ant Design：Customize theme](https://ant.design/docs/react/customize-theme) / [MUI：Density](https://mui.com/material-ui/customization/density/) / [Carbon：Data table](https://www.carbondesignsystem.com/components/data-table/usage/) / [Fluent UI](https://react.fluentui.dev/) | 各库的紧凑入口与主题入口（`@theme`、`componentSize`、`defaultProps`、DataTable `xs` 24px / `sm` 32px、Table `extra-small`） |
| [Tabler Icons](https://tabler.io/icons) / [Lucide](https://lucide.dev/icons) | 操作对应的图标名称（Tabler 逐个核对过存在；Lucide 名称按 lucide-static 1.51.0 的文件逐个核对，用规范名而不是别名） |
| [MDN：@starting-style](https://developer.mozilla.org/en-US/docs/Web/CSS/@starting-style) / [transition-behavior](https://developer.mozilla.org/en-US/docs/Web/CSS/transition-behavior) / [View Transition API](https://developer.mozilla.org/en-US/docs/Web/API/View_Transition_API) | 弹出层进出、展开收起、视图切换的写法与降级 |
| [shadcn/ui：Message Scroller](https://ui.shadcn.com/docs/components/base/message-scroller) | 对话滚动组件的行为与可访问性入口 |
| [W3C APG：Tree View](https://www.w3.org/WAI/ARIA/apg/patterns/treeview/) / [Window Splitter](https://www.w3.org/WAI/ARIA/apg/patterns/windowsplitter/) | 树的角色、键盘操作、多选模型、按首字母跳转；可拖动分隔条的角色、取值和键盘操作 |
| [VS Code：UX Guidelines](https://code.visualstudio.com/api/ux-guidelines/overview) / [Views](https://code.visualstudio.com/api/ux-guidelines/views) | 树节点行尾操作不超过 3 个、树节点不当按钮用；空视图给引导；设置项都有默认值和说明 |
| [Android：Settings](https://developer.android.com/design/ui/mobile/guides/patterns/settings) / [Microsoft：App settings](https://learn.microsoft.com/en-us/windows/apps/design/app-settings/guidelines-for-app-settings) | 分组用小标题与分隔线、15 项以上分子页或加搜索、依赖项说明不可用原因、改了即生效、入口名与子页面标题一致、内容区限宽 |
| [MUI：Density](https://mui.com/material-ui/customization/density/) / [Element Plus：Dark Mode](https://element-plus.org/en-US/guide/dark-mode) / [Ant Design：Customize theme](https://ant.design/docs/react/customize-theme) / [shadcn/ui：Theming](https://ui.shadcn.com/docs/theming) | stacks.md 配置片段里的 `defaultProps`、`html.dark` 变量覆盖、shadcn 的 `--color-muted` / `--color-accent` 同名变量。片段经 antd 6.6.5 `getDesignToken()` 与 @mui/material 9.4.0 `createTheme()` 实测：`compactAlgorithm` 以 `fontSizeSM` 为基准派生，配 `fontSize: 13` 得到 10px 正文，所以片段不用它；MUI `typography.fontSize` 是换算基准，正文按变体设 |
| [Lighthouse：Avoid an excessive DOM size](https://developer.chrome.com/docs/lighthouse/performance/dom-size) / [web.dev：content-visibility](https://web.dev/articles/content-visibility) | DOM 体积按整页节点数诊断（约 800 警告、约 1,400 报错），不是行数阈值；`content-visibility` 与 `contain-intrinsic-size` 的占位写法 |
| [WebKit：Designing Websites for iPhone X](https://webkit.org/blog/7929/designing-websites-for-iphone-x/) / [MDN：Using environment variables](https://developer.mozilla.org/en-US/docs/Web/CSS/Guides/Environment_variables/Using) | 横屏左右安全区、`max(<内边距>, env(safe-area-inset-*))`、吸底栏用 `env()` 补位 |
| [W3C：Media Queries Level 5](https://drafts.csswg.org/mediaqueries-5/#prefers-color-scheme) / [Mozilla bug 1643656](https://bugzilla.mozilla.org/show_bug.cgi?id=1643656) | `prefers-color-scheme` 只剩 `light` / `dark`，`no-preference` 已删除，系统无偏好时报告 `light`，所以「跟随系统」不能兼当默认深色 |
| [Babel parser](https://babeljs.io/docs/babel-parser) / [parse5](https://parse5.js.org/) | JSX / TSX 与 HTML AST 的解析入口 |
| [MDN：getComputedStyle](https://developer.mozilla.org/en-US/docs/Web/API/Window/getComputedStyle) | Web 适配器读取已解析样式；不代表真实交互验证 |
| [Claude Code：Hooks reference](https://code.claude.com/docs/en/hooks) | 可选 PostToolUse 适配器的事件、输入、exec form 和 additionalContext 协议 |
