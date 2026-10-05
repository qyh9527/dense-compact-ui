# 设计依据与取舍

本文面向维护者，记录这套空间语言与视觉默认值从哪里来、为什么这样取舍。它不属于技能运行指令，不从 SKILL.md 加载；`.gitattributes` 将 docs 排除在发布包外。改动主题、密度、动效时长、字体或卡片规则前先读这里，确认原来的理由是否仍然成立。运行时核对规范原文用 [references/sources.md](../references/sources.md)。

## 主依据

本技能以用户提供的《Dense Compact UI Design Language》为主要依据：保留通用密度语言、连续拼接原则和独立主题层，改写成可推导、可验证的流程。圆角起始尺度沿用其第 31 节；语义 token、嵌套表面规则和密度处理是为通用紧凑界面做的推导。

## 吸收的设计资料

| 资料 | 吸收了什么 |
| --- | --- |
| [TokenTracker DESIGN.md](https://github.com/xiufengsun/TokenTracker/blob/main/DESIGN.md) | 数字 `tabular-nums` 与等宽用途、固定字阶与限宽大指标、强调色 ≤10% 配额、图表分类色分离、不用纯黑白、带色相中性色、不嵌套卡片、Tab 单行横滑、表格窄屏收列、按压反馈、一页 DESIGN.md 的写法 |
| [taste-skill](https://github.com/Leonxlnx/taste-skill) | 动手前一行判读；改版先判模式、先审计、不悄悄改的清单；已有官方设计系统时沿用官方包；去模板味清单（装饰性状态点、假精确数字、占位人名、序号眉标、`·` 滥用）与文案自查；高密度下禁用通用卡片、改用细分隔线；整页主题锁定；阴影带底色色相；只对 transform / opacity 做动画；不假定依赖 |
| [ui-ux-pro-max](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill) | 评审按优先级排序；DESIGN.md 主文件 + 页面覆盖；长内容截断与可操作的「+n」；实时计数播报与 `aria-sort`；长列表虚拟化；表单错误关联与错误汇总；批量撤销；只读与禁用区分；图表规则；骨架屏、退出比进入快、动画可打断；安全区；路由切换后的焦点、toast 不抢焦点；图标一致；不假定技术栈；视图状态进 URL；草稿与未保存保护；响应时限（100ms / 1s / 10s）；`Intl` 本地化；每个视图一个主按钮；快捷键不占用系统键；面包屑与同层导航不混用；拖拽起始阈值；进入减速退出加速、长列表不逐项入场；不用负字距；图表图例切换、时间粒度、导出；优先原生控件 |
| [Anthropic：Skill authoring best practices](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices) | SKILL.md 作为目录式入口，细则按领域拆到 references；参考文件只从入口链出一层；超过 100 行的参考文件开头放目录；同一信息只放一处 |

## 取舍说明

ui-ux-pro-max 的图表库（charts 数据）和图标库、taste-skill 的图标规则，按工作台场景改写为 charts.md、icons.md；它们的 GSAP 动效预设与 taste-skill 的液态玻璃不吸收，工作台动效只保留说明状态变化的做法（motion.md）。

取舍说明：TokenTracker 的触屏热区是 ≥40px，本技能保留 44×44px 设计目标；其 150–250ms 动效时长与本技能 80–180ms 不同，紧凑界面取更短的反馈。

长列表：ui-ux-pro-max 的「长列表虚拟化」保留为手段，原先「约 50 行就虚拟化或分页」的行数门槛已删除，因为它让轻量的管理列表被切成小页，打断了全量总览。现在分页按任务定，渲染策略按实测成本依次升级（tables.md）；行会展开、高度不一的列表用 `content-visibility` 时，占位高度和真实高度对不上会让恢复的滚动位置跳动，这是实际项目里踩过的问题。

对话、编辑器、树、设置页四个专题参考了公开的 DESIGN.md 与组件文档，只吸收交互和可达性规则；它们的配色、大圆角气泡、Inter 字体、三点跳动的打字动画没有吸收，视觉仍按本技能的密度与主题。

用户偏好：深色画布从原版 `#09090B` 提亮到 `#191A1B`，其余表面同步提亮；默认密度为 dense（行 24px / 控件 22px / 正文 13px）；dense 档按 taste-skill「高密度禁用通用卡片」改为贴边分区 + 1px 分隔线，但只绑定 dense 档，不沿用其数字门槛。

taste-skill 面向落地页和作品集，首屏、Bento、眉标配额、配图、GSAP 等规则没有吸收；它默认同时做深浅两套，本技能新建项目只做深色一套；它不推荐 Inter、推荐 Geist 等字体，本技能用系统字体栈；它在高密度下数字一律用等宽字体，本技能用 `tabular-nums`。ui-ux-pro-max 的检索脚本与数据库没有吸收；它的正文行高 1.5、触控目标间距 8px 与本技能的紧凑标尺不同，本技能以热区实际不重叠为准。
