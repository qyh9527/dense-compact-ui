# 来源与推导

本技能以用户提供的《Dense Compact UI Design Language》为主要依据：保留通用密度语言、连续拼接原则和独立主题层，改写成可推导、可验证的流程。圆角起始尺度沿用其第 31 节；语义 token、嵌套表面规则和密度处理是为通用紧凑界面做的推导。

| 资料 | 吸收了什么 |
| --- | --- |
| [TokenTracker DESIGN.md](https://github.com/xiufengsun/TokenTracker/blob/main/DESIGN.md) | 数字 `tabular-nums` 与等宽用途、固定字阶与限宽大指标、强调色 ≤10% 配额、图表分类色分离、不用纯黑白、带色相中性色、不嵌套卡片、Tab 单行横滑、表格窄屏收列、按压反馈、一页 DESIGN.md 的写法 |
| [Material 3：Density](https://m3.material.io/foundations/layout/grids-spacing/density) / [Material 2：Applying density](https://m2.material.io/design/layout/applying-density.html) | 聚焦型任务不压密度；密度由用户选择、不随断点自动变；切换入口用标准热区；密组件配松网格 |
| [Carbon：Data table](https://www.carbondesignsystem.com/building-blocks/core/components/data-table/guidelines) / [Spacing](https://www.carbondesignsystem.com/building-blocks/foundations/spacing/overview) | 表头与数据行同高、工具栏与行高配套；局部可以密，整页要留让视线休息的留白 |
| [Fluent 2：Shapes](https://fluent2.microsoft.design/shapes) | 形状构成一致的视觉词汇；圆角随组件尺寸与角色分层；区分矩形、圆形、胶囊 |
| [Microsoft：Geometry in Windows](https://learn.microsoft.com/en-us/windows/apps/design/signature-experiences/geometry) | 按容器、控件与邻接关系处理圆角；接触边不留圆角缺口 |
| [W3C：CSS Backgrounds and Borders §4.2–4.3](https://www.w3.org/TR/css-backgrounds-3/#corner-shaping) | 内边缘半径扣除边框与内边距；裁切与指针命中遵循实际曲线 |
| [W3C：目标尺寸最小值](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html) / [增强要求](https://www.w3.org/WAI/WCAG22/Understanding/target-size-enhanced.html) | 24×24px 最低线与 44×44px 设计目标 |
| [W3C：文字最小对比度](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html) / [非文字对比度](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html) | 4.5:1 与 3:1 |
| [shadcn/ui 主题语义](https://ui.shadcn.com/docs/theming) | 主题变量映射，`accent` 与交互蓝分离 |
| [Primer 色彩使用](https://primer.style/product/getting-started/foundations/color-usage/) | 语义色用法 |
| [taste-skill](https://github.com/Leonxlnx/taste-skill) | 动手前一行判读；改版先判模式、先审计、不悄悄改的清单；已有官方设计系统时沿用官方包；去模板味清单（装饰性状态点、假精确数字、占位人名、序号眉标、`·` 滥用）与文案自查；高密度下禁用通用卡片、改用细分隔线；整页主题锁定；阴影带底色色相；只对 transform / opacity 做动画；不假定依赖 |
| [ui-ux-pro-max](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill) | 评审按优先级排序；DESIGN.md 主文件 + 页面覆盖；长内容截断与可操作的「+n」；实时计数播报与 `aria-sort`；长列表虚拟化；表单错误关联与错误汇总；批量撤销；只读与禁用区分；图表规则；骨架屏、退出比进入快、动画可打断；安全区；路由切换后的焦点、toast 不抢焦点；图标一致；不假定技术栈；视图状态进 URL；草稿与未保存保护；响应时限（100ms / 1s / 10s）；`Intl` 本地化；每个视图一个主按钮；快捷键不占用系统键；面包屑与同层导航不混用；拖拽起始阈值；进入减速退出加速、长列表不逐项入场；不用负字距；图表图例切换、时间粒度、导出；优先原生控件 |
| [Anthropic：Skill authoring best practices](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices) | SKILL.md 作为目录式入口，细则按领域拆到 references；参考文件只从入口链出一层；超过 100 行的参考文件开头放目录；同一信息只放一处 |
| [Apple HIG：Playing haptics](https://developer.apple.com/design/human-interface-guidelines/playing-haptics) / [Buttons](https://developer.apple.com/design/human-interface-guidelines/buttons) / [Tab bars](https://developer.apple.com/design/human-interface-guidelines/tab-bars) | 按系统含义使用触感、优先系统控件；44×44pt 热区；标签栏 |
| [Android：Haptics design principles](https://developer.android.com/develop/ui/views/haptics/haptics-principles) / [HapticFeedbackConstants](https://developer.android.com/reference/android/view/HapticFeedbackConstants) / [Material 3](https://m3.material.io/) | 清晰触感优于嗡嗡振动、按重要性定强度、用语义常量；按窗口宽度选导航栏 / 导航轨 / 抽屉；48dp 热区；预测性返回 |
| [web.dev：Sign-in form best practices](https://web.dev/articles/sign-in-form-best-practices) / [Passkey form autofill](https://web.dev/articles/passkey-form-autofill) / [Chromium：Password form styles](https://www.chromium.org/developers/design-documents/form-styles-that-chromium-understands/) | `autocomplete` 取值、显示密码、分步登录带隐藏账号字段、条件式通行密钥 |
| [W3C：Accessible Authentication (Minimum)](https://www.w3.org/WAI/WCAG22/Understanding/accessible-authentication-minimum.html) | 不阻止粘贴与自动填充、不强制转写、提供不靠记忆的认证方式 |
| [OWASP：Authentication Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html) / [NIST SP 800-63B](https://pages.nist.gov/800-63-4/sp800-63b.html) | 统一的登录与找回提示，防止账号枚举；密码长度与不强制组合、不定期强制改密 |
| [web.dev：Font best practices](https://web.dev/articles/font-best-practices) | `font-display`、子集化与 `unicode-range`、只预加载关键字体、回退字体度量 |
| [Tailwind：Theme variables](https://tailwindcss.com/docs/theme) / [Ant Design：Customize theme](https://ant.design/docs/react/customize-theme) / [MUI：Density](https://mui.com/material-ui/customization/density/) / [Carbon：Data table](https://www.carbondesignsystem.com/components/data-table/usage/) / [Fluent UI](https://react.fluentui.dev/) | 各库的紧凑入口与主题入口（`@theme`、`componentSize`、`defaultProps`、DataTable `xs` 24px / `sm` 32px、Table `extra-small`） |
| [Tabler Icons](https://tabler.io/icons) | 操作对应的图标名称（逐个核对过存在） |
| [MDN：@starting-style](https://developer.mozilla.org/en-US/docs/Web/CSS/@starting-style) / [transition-behavior](https://developer.mozilla.org/en-US/docs/Web/CSS/transition-behavior) / [View Transition API](https://developer.mozilla.org/en-US/docs/Web/API/View_Transition_API) | 弹出层进出、展开收起、视图切换的写法与降级 |
| [Vercel：Web Interface Guidelines](https://github.com/vercel-labs/web-interface-guidelines) | 加载态的出现延迟与最短显示时间、会打开下一步的菜单项以「…」结尾、跳转用真链接、拖动时禁止选中文字、快捷键按平台显示、乐观更新失败可回滚 |
| [Smashing Magazine：Designing Stable Interfaces For Streaming Content](https://www.smashingmagazine.com/2026/05/designing-stable-interfaces-streaming-content/) / [shadcn/ui：Message Scroller](https://ui.shadcn.com/docs/components/base/message-scroller) / [accessibility.build：Accessible AI Chat](https://accessibility.build/guides/accessible-ai-chat) | 只在底部时跟随、用户上滚即停、新一轮锚定到视口上部、按帧写入、停止后标记未完成；流式节点不设 `aria-live`，开始和结束各播一次，焦点留在输入框；重开会话定位到最后一轮 |
| [W3C APG：Tree View](https://www.w3.org/WAI/ARIA/apg/patterns/treeview/) / [Window Splitter](https://www.w3.org/WAI/ARIA/apg/patterns/windowsplitter/) | 树的角色、键盘操作、多选模型、按首字母跳转；可拖动分隔条的角色、取值和键盘操作 |
| [VS Code：UX Guidelines](https://code.visualstudio.com/api/ux-guidelines/overview) / [Views](https://code.visualstudio.com/api/ux-guidelines/views) | 树节点行尾操作不超过 3 个、树节点不当按钮用；空视图给引导；设置项都有默认值和说明 |
| [vocab.design：Inspector](https://vocab.design/inspector) | 属性面板跟随选择、未选中时给说明、多选显示「混合」、切换对象时宽度与字段位置不变、窄屏改抽屉 |
| [Android：Settings](https://developer.android.com/design/ui/mobile/guides/patterns/settings) / [Microsoft：App settings](https://learn.microsoft.com/en-us/windows/apps/design/app-settings/guidelines-for-app-settings) | 分组用小标题与分隔线、15 项以上分子页或加搜索、依赖项说明不可用原因、改了即生效、入口名与子页面标题一致、内容区限宽 |
| [MUI：Density](https://mui.com/material-ui/customization/density/) / [Element Plus：Dark Mode](https://element-plus.org/en-US/guide/dark-mode) / [Ant Design：Customize theme](https://ant.design/docs/react/customize-theme) / [shadcn/ui：Theming](https://ui.shadcn.com/docs/theming) | stacks.md 配置片段里的 `defaultProps`、`html.dark` 变量覆盖、shadcn 的 `--color-muted` / `--color-accent` 同名变量。片段经 antd 6.6.5 `getDesignToken()` 与 @mui/material 9.4.0 `createTheme()` 实测：`compactAlgorithm` 以 `fontSizeSM` 为基准派生，配 `fontSize: 13` 得到 10px 正文，所以片段不用它；MUI `typography.fontSize` 是换算基准，正文按变体设 |
| [Lighthouse：Avoid an excessive DOM size](https://developer.chrome.com/docs/lighthouse/performance/dom-size) / [web.dev：content-visibility](https://web.dev/articles/content-visibility) | DOM 体积按整页节点数诊断（约 800 警告、约 1,400 报错），不是行数阈值；`content-visibility` 与 `contain-intrinsic-size` 的占位写法 |

ui-ux-pro-max 的图表库（charts 数据）和图标库、taste-skill 的图标规则，按工作台场景改写为 charts.md、icons.md；它们的 GSAP 动效预设与 taste-skill 的液态玻璃不吸收，工作台动效只保留说明状态变化的做法（motion.md）。

取舍说明：TokenTracker 的触屏热区是 ≥40px，本技能保留 44×44px 设计目标；其 150–250ms 动效时长与本技能 80–180ms 不同，紧凑界面取更短的反馈。

长列表：ui-ux-pro-max 的「长列表虚拟化」保留为手段，原先「约 50 行就虚拟化或分页」的行数门槛已删除，因为它让轻量的管理列表被切成小页，打断了全量总览。现在分页按任务定，渲染策略按实测成本依次升级（tables.md）；行会展开、高度不一的列表用 `content-visibility` 时，占位高度和真实高度对不上会让恢复的滚动位置跳动，这是实际项目里踩过的问题。

对话、编辑器、树、设置页四个专题参考了公开的 DESIGN.md 与组件文档，只吸收交互和可达性规则；它们的配色、大圆角气泡、Inter 字体、三点跳动的打字动画没有吸收，视觉仍按本技能的密度与主题。

用户偏好：深色画布从原版 `#09090B` 提亮到 `#191A1B`，其余表面同步提亮；默认密度为 dense（行 24px / 控件 22px / 正文 13px）；dense 档按 taste-skill「高密度禁用通用卡片」改为贴边分区 + 1px 分隔线，但只绑定 dense 档，不沿用其数字门槛。

taste-skill 面向落地页和作品集，首屏、Bento、眉标配额、配图、GSAP 等规则没有吸收；它默认同时做深浅两套，本技能默认只做深色；它不推荐 Inter、推荐 Geist 等字体，本技能用系统字体栈；它在高密度下数字一律用等宽字体，本技能用 `tabular-nums`。ui-ux-pro-max 的检索脚本与数据库没有吸收；它的正文行高 1.5、触控目标间距 8px 与本技能的紧凑标尺不同，本技能以热区实际不重叠为准。
