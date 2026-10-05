import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const remove = args.includes('--remove');
const project = args.find(a => !a.startsWith('--'));
try {
  if (!project || args.some(a => a.startsWith('--') && a !== '--remove')) throw new Error('用法：node scripts/install-hook.mjs <项目目录> [--remove]');
  const root = fs.realpathSync(project);
  const file = path.join(root, '.claude', 'settings.local.json');
  const script = fileURLToPath(new URL('./dense-hook.mjs', import.meta.url));
  const settings = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
  if (!settings || Array.isArray(settings) || typeof settings !== 'object') throw new Error('现有设置必须为 JSON 对象。');
  if (settings.hooks !== undefined && (!settings.hooks || Array.isArray(settings.hooks) || typeof settings.hooks !== 'object')) throw new Error('现有 hooks 必须为 JSON 对象，未修改。');
  const groups = settings.hooks?.PostToolUse || [];
  if (!Array.isArray(groups)) throw new Error('现有 PostToolUse 设置无效。');
  const own = hook => hook.type === 'command' && Array.isArray(hook.args) && hook.args.length === 1 && hook.args[0] === script;
  const cleaned = groups.map(g => ({ ...g, hooks: g.hooks.filter(h => !own(h)) })).filter(g => g.hooks.length);
  if (!remove) cleaned.push({ matcher: 'Write|Edit|MultiEdit|Bash', hooks: [{ type: 'command', command: process.execPath,
    args: [script], timeout: 10, statusMessage: '检查紧凑界面源码' }] });
  settings.hooks ??= {};
  settings.hooks.PostToolUse = cleaned;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(`${file}.dense-ui.tmp`, JSON.stringify(settings, null, 2) + '\n');
  fs.renameSync(`${file}.dense-ui.tmp`, file);
  const config = path.join(root, '.dense-ui.json');
  if (!remove && !fs.existsSync(config)) fs.writeFileSync(config, JSON.stringify({ enabled: true, mode: 'operate', minBody: 13 }, null, 2) + '\n');
  console.log(remove ? '已移除本安装路径的 Hook；现有配置与其他 Hook 保留。' : '已注册可选源码 Hook；现有 .dense-ui.json 保留，请核对 enabled 与 mode。需要宿主支持 command + args。');
} catch (e) { console.error(e.message); process.exitCode = 2; }
