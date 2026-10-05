# dense-compact-ui

给 Claude Code、Codex 等编程 Agent 用的技能，指导它们设计、实现和评审紧凑、高信息密度的界面，适合工作台、管理后台、数据表格、编辑器这类信息密集的产品界面。

内容包括密度档位与行模型、1px 分隔线分区、圆角分层、数字与字阶、强调色配额、窄屏重组，以及表格、表单、实时数据、图表、AI 对话、编辑器、树形导航、设置页、登录等专题规则；附 Zinc 深色默认主题、可切换的浅色版和 CSS token（[`assets/tokens.css`](assets/tokens.css)）。

Agent 加载技能后会先问你是否采用这种风格；你已经明确要求紧凑或高密度时直接使用。海报、营销落地页这类追求视觉张扬的页面不适用。

## 安装

把本仓库作为一个技能目录放进 Claude Code / Codex 的 skills 目录（仓库根即技能根，入口为 `SKILL.md`），或在 [cc-switch](https://github.com/farion1231/cc-switch) 中以 `qyh9527/dense-compact-ui` 添加。

## 审计与改进

可以直接说「只评审这个工作台」「打磨筛选栏」「精简重复包装，但保留比较列」或「补齐失败恢复」。Agent 会按任务选择检查路径，给出带位置、证据、影响和复验方法的问题；仅评审时不改文件，明确要求修复时继续实施。详见 [审计与定向改进](references/quality-workflow.md)。

[Impeccable](https://github.com/pbakaus/impeccable) 可补充实现审计、设计评审、文案与边界检查。本技能保留紧凑空间语言，按项目约定处理通用建议与检测告警；无需安装 Impeccable 也能使用。详见 [配合方式与取舍](references/impeccable.md)。

## 版本

技能文件推到 `main` 后由 GitHub Actions 自动发 release，附打包好的技能 zip。默认升 patch 版本；提交标题里写 `[minor]` 或 `[major]` 升对应级别，写 `[skip release]` 则这次不发。

## 许可

[MIT](LICENSE)
