import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { loadConfig, scanFiles } from './dense-lint.mjs';

try {
  let input = '';
  for await (const chunk of process.stdin) {
    input += chunk;
    if (input.length > 2 * 1024 * 1024) throw new Error('Hook 输入过大。');
  }
  const event = JSON.parse(input);
  if (event.hook_event_name === 'PostToolUse' && typeof event.cwd === 'string') {
    const root = fs.realpathSync(process.env.CLAUDE_PROJECT_DIR || event.cwd);
    const config = loadConfig(root);
    if (config.enabled === true) {
      let targets = [];
      if (['Write', 'Edit', 'MultiEdit'].includes(event.tool_name) && typeof event.tool_input?.file_path === 'string') targets = [event.tool_input.file_path];
      else if (event.tool_name === 'Bash') {
        // 只读 Git 工作树，不执行用户传入的命令；包含 staged、unstaged 和 untracked。
        const options = { cwd: root, encoding: 'utf8', timeout: 2000, maxBuffer: 1024 * 1024 };
        for (const args of [['diff', '--relative', '--name-only', '-z', '--diff-filter=ACMR'], ['diff', '--cached', '--relative', '--name-only', '-z', '--diff-filter=ACMR'], ['ls-files', '--others', '--exclude-standard', '-z']]) {
          targets.push(...execFileSync('git', args, options).split('\0').filter(Boolean));
        }
      }
      targets = [...new Set(targets)].filter(f => /\.(html|jsx|tsx)$/.test(f));
      const omitted = Math.max(0, targets.length - 50);
      targets = targets.slice(0, 50);
      if (targets.length) {
        const report = await scanFiles(targets, root, config);
        const lines = report.findings.slice(0, 20).map(f => `${f.rule} ${f.location}: ${f.message}`);
        if (omitted) lines.push(`未扫描：另有 ${omitted} 个候选文件超过本轮上限。`);
        if (report.errors.length) lines.push(...report.errors.slice(0, 3).map(e => `未扫描：${e}`));
        if (lines.length) console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PostToolUse',
          additionalContext: `紧凑界面源码疑点（需核对渲染；不自动修改）：\n${lines.join('\n')}\n最多检查 50 个文件、显示 20 项；完整审计请运行 CLI。` } }));
      }
    }
  }
} catch (e) {
  console.error(`dense-compact-ui Hook 未完成检查：${e.message}`);
}
// 检测工具故障不阻断编辑；无发现时不声称验收通过。
