---
name: dense-compact-ui
description: 紧凑高信息密度界面的设计、实现与评审指导：高密排版与 1px 分隔线分区、按角色分层的圆角、数字与字阶、强调色配额、窄屏重组，附 Zinc 深色默认主题（另有可切换的浅色附加版）与 CSS token，并按需索引表格、表单、实时数据、图表、AI 对话、编辑器、树形导航、设置页、图标、动效、组件库落地、改版、原生 App、字体、登录等专题规则。用于前端、UI、UX、界面、页面、组件、布局、样式、CSS、Tailwind、响应式、移动端适配、仪表盘、管理后台、工作台、编辑器、数据表格、图表、图标、动效、表单、AI 聊天界面、文件树、设置页、登录注册、iOS / Android / 桌面应用界面、字体选用、设计稿、界面改版或评审相关任务，以及从参考图提炼空间语言、为已有项目整理一页 DESIGN.md。不用于不涉及界面呈现的纯 JS 逻辑、接口、构建配置问题，也不用于追求视觉张扬的海报和营销落地页。触发后先询问用户是否采用本风格；用户已明确要求紧凑或高密度风格时直接使用。
---

# 紧凑高密度 UI

本文件是入口和索引：每次都做「确认 → 判读 → 按索引读参考 → 检查并贴出结果」；细则都在 references/，只读当前任务用得到的文件。

审计、评审、打磨、精简或加固已有界面时，先读 [quality-workflow.md](references/quality-workflow.md) 选择路径与完成条件；只要求审计或评审时只报告，要求修复时再改文件。

## 1. 先判页面任务，再确认是否采用

按当前页面或区域的主要任务判模式：operate（操作、比较、编辑、监控）推荐完整空间体系；read（阅读正文）只借用阅读、响应式与可达性检查；persuade（购买、报名）与 experience（作品、沉浸内容）默认不采用紧凑视觉体系。模式不代替用户选择，混合页面按区域划分，已有确认继续有效；判不准时读 [context.md](references/context.md) 的「按页面判模式」。

本技能会被宽泛的前端 / UI / UX 关键词加载，加载不等于用户要这种风格。

- 用户已明确要紧凑、高密度、dense、compact 风格，或本会话已确认过 → 直接用，不再问。
- 否则用 AskUserQuestion 问一次（没有该工具就用一句话问）：
  1. **采用紧凑风格**（推荐给工作台、仪表盘、后台、编辑器这类信息密集界面）
  2. **只借用检查**：风格沿用现有项目或用户指定的，只用 [verify.md](references/verify.md) 和下方索引里的专题文件
  3. **不使用本技能**：不再读 references，按用户原本的要求继续
- 同一会话只问一次，答案对后续界面任务继续有效，用户改口再变。
- 没有人能回答时（非交互运行、子代理、无头模式），按「只借用检查」做，并在交付说明里写明这个默认。委派界面任务时，把用户的答案写进委派说明。

## 2. 判读与准备

1. **先说判读。** 动手前在回复里写一行：「判读：<界面> 给 <用户>，平台 <Web / 桌面 / 原生 / 跨平台>，形态 <手机 / 平板 / 桌面窗口，可多选>，输入 <鼠标键盘 / 触屏 / 两者>，主要任务 <…>，总览 <需要一页看全 N 项 / 只看局部>，密度 <dense（默认）/ compact / comfortable>，主题 <Zinc Graphite Dark / 沿用项目>，<新建 / 改版·保留 / 改版·重做>。」判读可能和需求有出入时只问一个问题；能确定就不问。平台和形态以用户对本项目的说明为准；通用指令要求的平台和它冲突时，问一次并写进判读。
2. **读上下文。** 先读现有产品事实（如 PRODUCT.md），再读 DESIGN.md 与页面约定，最后核对组件和 token；已有文档沿用原路径，不强制新建 PRODUCT.md。技术栈和单位从项目文件识别，不假定浏览器、Tailwind 或 CSS；桌面、原生或跨平台项目读 [context.md](references/context.md)。
3. **列任务。** 写清用户要看什么、做什么、哪些上下文切换后必须保留；操作按频率分成常驻 / 按需展开 / 收进具名入口。
4. **定空间预算。** 列表、表格、树这类重复对象的视图，把预算贴在回复里、判读下面：折叠态的列（字段、宽度、截断方式）、折叠态行高、展开后放什么、内容区宽度、一页全量还是分页及理由（概念见 [layout-density.md](references/layout-density.md) 的「行模型」）。列和行高都写出具体值后再动手。按这个顺序定，前一步的结论约束后一步：平台、形态与任务 → 总览需求 → 默认列 → 行高与宽度预算 → 性能策略 → 主题与装饰。交给别人实现时，委派里附上这份预算。

## 3. 不变的底线

以下 px 是 Web 起点。原生和跨平台按布局单位、字体缩放和平台热区规范映射，具体见 platforms.md；空间预算与验证不能用 CSS 尺寸代替实际渲染和命中区域。

- 目标是同一块屏幕里能看懂、能点到的有效信息更多。紧凑来自空间组织，不靠缩字：正文 ≥13px，不用负字距。
- 默认高密档（行 24px / 控件视觉高 22px / 正文 13px），区域不包卡片，用 1px 分隔线分区；组件越密，分组间距越要拉开；工具栏、表头、数据行同档，同档指最小高度，文字放大时条带自己撑高。
- 聚焦型任务保持标准尺寸：菜单选择、逐项填写的长表单、引导、登录、结账、破坏性确认。密度由用户选择，不随断点自动变。
- 三层分开维护：**空间**（分组、对齐、距离、密度）、**交互**（任务优先级、操作作用域、状态）、**主题**（色彩、边界、字重、圆角）；改一层不牵动另两层。
- 彩色只给语义，强调色 ≤10%，每个视图一个主按钮；整页一个主题，新建默认 Zinc Graphite Dark（画布 `#191A1B`），浅色只在需要时加；已有项目和提供切换时的默认主题见 color.md 的「默认主题与切换」。
- 数字用 `tabular-nums`；金额、计数、错误信息不截断。触屏热区 44px，文字对比 ≥4.5:1。

## 4. 索引：遇到什么读什么

先按界面类型找起点，再按主题补读。

| 界面类型 | 先读 |
| --- | --- |
| 数据表格页、列表页、日志列表 | tables、patterns、layout-density |
| 仪表盘、监控看板 | charts、realtime、layout-density |
| 新建 / 编辑表单页 | forms、patterns |
| 设置页、偏好面板 | settings、forms |
| AI 对话、聊天、智能体工作台 | chat、motion、responsive |
| 编辑器、卡片 / 条目编辑、属性面板 | editor、forms、tree |
| 文件树、目录、文件管理 | tree、tables |
| 登录、注册、找回密码 | auth、forms |
| 手机或桌面原生 App | platforms、responsive |

| 主题 | 读 |
| --- | --- |
| 布局、密度档位、行模型与空间预算、卡片与分隔线、承载结构、控件排布、字体与数字、参考图 | [layout-density.md](references/layout-density.md) |
| 圆角、嵌套表面、共边组合 | [shape-radius.md](references/shape-radius.md) |
| 窄屏、移动端网页、区域关系、滚动、安全区 | [responsive.md](references/responsive.md) |
| 配色、主题、深浅切换、对比度；CSS 变量起点 | [color.md](references/color.md)、[tokens.css](assets/tokens.css) |
| 长内容截断、加载状态、URL 状态、导航反馈、操作命名、快捷键、拖拽 | [patterns.md](references/patterns.md) |
| 表格：列宽、排序筛选、选择与批量操作、分页与虚拟滚动、行内编辑 | [tables.md](references/tables.md) |
| 表单：布局、字段、校验、提交、草稿 | [forms.md](references/forms.md) |
| 实时数据：刷新节奏、不打断阅读、连接状态、播报 | [realtime.md](references/realtime.md) |
| 图表选型与通用规则、仪表盘 | [charts.md](references/charts.md) |
| AI 对话：输入框、流式输出与滚动、消息操作 | [chat.md](references/chat.md) |
| 编辑器：分栏、属性面板、保存与撤销、命令面板 | [editor.md](references/editor.md) |
| 树形导航、文件管理、拖放 | [tree.md](references/tree.md) |
| 设置页：分组、搜索、保存方式、恢复默认 | [settings.md](references/settings.md) |
| 改版已有界面、项目已有组件库 | [redesign.md](references/redesign.md) |
| 审计、设计评审、打磨、精简、边界加固；问题证据、优先级与复验 | [quality-workflow.md](references/quality-workflow.md) |
| 产品事实与视觉约定分层、页面模式细则、桌面 / 原生 / 跨平台验证 | [context.md](references/context.md) |
| Tailwind、shadcn、Ant Design、Element Plus、MUI 等落地密度与主题（含配置片段） | [stacks.md](references/stacks.md) |
| 选图标库、图标尺寸、操作对应的图标 | [icons.md](references/icons.md) |
| 动效：弹出层、展开收起、列表增删、视图切换、拖拽 | [motion.md](references/motion.md) |
| iOS / Android / 桌面原生、Tauri 移动端、React Native、Flutter、触感反馈 | [platforms.md](references/platforms.md) |
| 品牌字体、网络字体加载、中文字体 | [fonts.md](references/fonts.md) |
| 登录、注册、找回密码、验证码、通行密钥 | [auth.md](references/auth.md) |
| 整理一页 DESIGN.md | [design-md.md](references/design-md.md) |
| 标准、平台指南与组件 API | [sources.md](references/sources.md) |

界面类型表里的名称对应 references/ 下的同名 `.md` 文件。一个任务涉及多行就各读一次；专题文件末尾的「检查」并入交付前检查。

## 5. 交付前检查

用真实内容逐项过 [verify.md](references/verify.md)，按判读里的形态与输入取舍检查项（规则见 verify.md 的「边界场景」）；非 Web 平台按 context.md 选验证工具。有预览时按 quality-workflow.md 的「复验与停止」集中检查、批量修复，停止前做一次观感检查。交付时把检查结果贴在回复里，每项标「预览验证 / 静态检查 / 未验证」；没贴出检查结果，不算完成。最低要求：

- [ ] 长内容、200% 文字缩放、矮视口时核心任务都能完成；形态含手机时再查窄到 360px 和软键盘弹出，只用于桌面窗口时查小窗口（如 1280×720）
- [ ] 重复对象视图量过折叠态行高、一屏可辨认的项数和内容区宽度利用（见 verify.md 的「评价方式」）
- [ ] 选中、焦点、悬停、进行中、错误各自可辨，焦点环没被父容器裁掉
- [ ] 输入含触屏时，常用操作实际热区约 44×44px，热区互不重叠
- [ ] 文字对比 ≥4.5:1，必要的控件与状态线索 ≥3:1
- [ ] 可见文案逐条重读过；没有占位式假数据，彩色圆点只表示真实状态
- [ ] 有预览时，同一内容的前后截图并排过了观感检查（见 quality-workflow.md 的「复验与停止」）

## 6. 交付

按任务交付界面、实现、设计规格或评审结论，用当前产品的名称和内容。简述关键空间决策、圆角体系、窄屏行为、主题和验证结果。评审先按实际影响分级，同级按可达性 > 触控与交互 > 性能 > 布局与响应式 > 字体与色彩 > 动效与装饰排序。
