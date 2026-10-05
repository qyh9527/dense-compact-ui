# 自动检查与可选 Hook

核心设计流程不依赖检测器。按平台选择工具，源码疑点、渲染尺寸、真实交互和主观任务评审分别记录。自动检查不会修改源码；零告警不能证明验收通过。

## 首版范围

| 规则 | 自动检查 | 边界 |
| --- | --- | --- |
| DC001 | 显式正文角色的字号低于项目 Web 下限 | 源码只识别字面样式；原生字号与缩放交给平台测试 |
| DC003 | 显式卡片角色嵌套 | 浮层角色是边界；先核对对象关系，再考虑连续分区 |
| DC005 | 显式数字角色未声明 tabular-nums | 需要 Web 计算样式；实际字体可能已有等宽数字，需核对 |
| DC008 | Web 触屏快照中可交互元素边界小于 44px 设计目标 | 不宣称违反 WCAG；标签、伪元素及实际命中路径仍需验证 |
| DC010 | 金额、计数、错误角色使用省略裁切 | 源码给疑点；快照要求发生横向裁切 |
| DC012 | 同一显式视图有多个主操作 | 源码条件分支可能互斥；快照只统计可见且可用项 |

行高偏差、圆角邻接、卡片是否过多、强调色面积、换行选择、工具栏与行档位是否协调，继续按 layout-density.md、shape-radius.md、color.md 和 verify.md 做任务评审。文字缩放、展开行与触屏热区都可能合理抬高行高，不能统一判为违规。

## 源码检查

可选工具要求 Node.js ≥20。在本技能目录执行 `npm ci --ignore-scripts`，解析依赖仅用于工具，不进入被设计产品的依赖。

```sh
node <技能目录>/scripts/dense-lint.mjs src --root <项目目录> --json
```

支持 HTML、Web JSX / TSX，使用 HTML / JS AST 解析，不用正则假装理解组件树。动态样式、CSS 级联、条件显示、跨文件组件展开不解析；源码结论统一为疑点。Vue / Svelte、原生与其他栈沿用平台工具与静态评审，未支持的输入不能视为通过。

用显式标记表达产品语义；DOM 标签、class 命名和颜色不能可靠判断正文、卡片或主操作：

```html
<main data-dc-view="nodes">
  <p data-dc-role="body">节点管理</p>
  <span data-dc-role="number">18ms</span>
  <button data-dc-role="primary">检查选中节点</button>
</main>
```

角色可空格分隔：`body card overlay number money count error primary`。作用域用 `data-dc-view`；此标记是 Web 适配器协议，不要求原生组件添加 HTML 属性。输出含节点覆盖数，未标记的语义检查不会凭空推断。

局部例外用 `data-dc-ignore="DC003" data-dc-ignore-reason="此处为独立嵌套对象"`，仅忽略该节点列出的规则；没有理由时不生效。不因风格偏好关闭整类可达性检查。

退出码：0 无本轮发现，1 有发现，2 解析或范围错误；`--warn-only` 仅将发现改为退出 0，不吞解析错误。JSON 结果的 `errors` 和覆盖数必须一起读。

## Web 渲染快照

在已授权的当前页面内执行 `scripts/capture-web.js`，调用 `captureDenseUI({touch: true})`（桌面鼠标为 false）。用现有自动化工具把返回对象保存为 JSON，再运行：

```sh
node <技能目录>/scripts/dense-lint.mjs --snapshot <快照.json> --root <项目目录> --json
```

脚本只采集角色、计算样式与几何信息，不采集正文、不联网。快照是当前视口与状态的观察，不含点击、读屏或软键盘操作；只在 Web 使用，不把 CSS px 套到 pt / dp / sp。原生和桌面适配器见 context.md。获取快照不要求安装另一套浏览器工具，使用项目现有的浏览器自动化或调试环境即可。

## 可选编辑后反馈

当前只提供 Claude Code 的 PostToolUse 适配器（宿主需支持 command + args）；其余 Agent 可手动运行相同 CLI 或接入自身测试流程，不宣称跨宿主 Hook 通用。

```sh
node <技能目录>/scripts/install-hook.mjs <项目目录>
node <技能目录>/scripts/install-hook.mjs <项目目录> --remove
```

安装合并到项目 `.claude/settings.local.json`，保留其他设置、权限与 Hook，重复安装不增加副本。首次创建 `.dense-ui.json`：`{"enabled":true,"mode":"operate","minBody":13}`；已有配置不覆盖。只在确认使用后安装，`enabled:false` 暂停反馈，卸载保留项目配置。技能目录及其解析依赖需仍然可用；工具只读源文件，不运行项目代码。

Write / Edit / MultiEdit 检查目标文件，Bash 后只读 Git 的已暂存、未暂存和未跟踪候选；不读取或执行事件里的命令，不读 transcript，不联网。每次最多 50 个支持的文件、每文件 1MiB、反馈最多 20 项，超出范围的完整审计用 CLI。路径限定项目内，符号链接跳过并报告；检测失败给出未完成信息并不阻断编辑。

共享语义规则与 CLI 输出可供将来的其他平台适配器复用；平台适配器必须说明单位、可见性、角色映射和验证范围，不能沿用 Web 快照格式冒充原生测量。
