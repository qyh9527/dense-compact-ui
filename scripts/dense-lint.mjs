import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { inspect } from './lint-core.mjs';

const excluded = new Set(['.git', 'node_modules', 'dist', 'build', 'target', 'vendor', '.dense-ui-cache']);
export function loadConfig(root) {
  const file = path.join(root, '.dense-ui.json');
  const config = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
  if (!config || Array.isArray(config) || typeof config !== 'object') throw new Error('检测配置必须为 JSON 对象。');
  if (config.enabled !== undefined && typeof config.enabled !== 'boolean') throw new Error('enabled 必须为布尔值。');
  if (config.minBody !== undefined && (!Number.isFinite(config.minBody) || config.minBody <= 0)) throw new Error('minBody 必须为正数。');
  if (config.mode !== undefined && !['operate', 'read', 'persuade', 'experience'].includes(config.mode)) throw new Error('mode 无效。');
  return config;
}

export async function scanFiles(targets, root, config = {}) {
  const { parseSource } = await import('./source-parser.mjs');
  root = fs.realpathSync(root);
  const files = new Set();
  const errors = [];
  const gather = target => {
    if (files.size >= 1000) throw new Error('超过 1000 文件上限，请缩小检查范围。');
    const stat = fs.lstatSync(target);
    if (stat.isSymbolicLink()) { errors.push(`${target}: 跳过符号链接`); return; }
    const rel = path.relative(root, fs.realpathSync(target));
    if (rel.startsWith(`..${path.sep}`) || rel === '..' || path.isAbsolute(rel)) throw new Error('目标超出项目根目录。');
    if (stat.isDirectory()) {
      for (const entry of fs.readdirSync(target).sort()) if (!excluded.has(entry)) gather(path.join(target, entry));
    } else if (/\.(html|jsx|tsx)$/.test(target)) files.add(target);
    else if (targets.some(t => path.resolve(root, t) === target)) errors.push(`${target}: 没有此类型的源码适配器，未扫描。`);
  };
  for (const target of targets) {
    try { gather(path.resolve(root, target)); } catch (e) { errors.push(`${target}: ${e.message}`); }
  }
  const results = [];
  for (const file of files) {
    try {
      if (fs.statSync(file).size > 1024 * 1024) throw new Error('超过 1MiB，未扫描。');
      const name = path.relative(root, file).split(path.sep).join('/');
      const records = parseSource(fs.readFileSync(file, 'utf8'), name);
      results.push({ file: name, ...inspect(records, { ...config, evidence: 'source' }) });
    } catch (e) { errors.push(`${path.relative(root, file)}: ${e.message}`); }
  }
  if (!files.size && !errors.length) errors.push('没有支持的 HTML / JSX / TSX 文件，未扫描。');
  return { adapter: 'source', results, errors, findings: results.flatMap(r => r.findings),
    note: '只检查 HTML / Web JSX / TSX 的显式语义标记、字面样式和完整 AST；CSS 级联、动态表达式及其他平台未验证。' };
}

export function scanSnapshot(snapshot, config = {}) {
  if (snapshot.schema !== 'dense-ui-web-v1' || snapshot.context?.platform !== 'web' || snapshot.context?.unit !== 'css-px' || !Array.isArray(snapshot.nodes) || snapshot.nodes.length > 20000) throw new Error('Web 快照格式无效。');
  if (new Set(snapshot.nodes.map(n => n.id)).size !== snapshot.nodes.length) throw new Error('快照节点 ID 重复。');
  for (const n of snapshot.nodes) {
    if (typeof n.id !== 'string' || !Array.isArray(n.roles) || !n.roles.every(r => typeof r === 'string') ||
      !Number.isFinite(n.fontSize) || !Number.isFinite(n.width) || !Number.isFinite(n.height)) throw new Error('快照节点字段无效。');
  }
  return { adapter: 'web-snapshot', context: snapshot.context, ...inspect(snapshot.nodes, { ...config, evidence: 'rendered', touch: snapshot.context?.touch === true }) };
}

async function main(args) {
  let root = process.cwd(), snapshot, json = false, warnOnly = false;
  const targets = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--root' || args[i] === '--snapshot') {
      const key = args[i], value = args[++i];
      if (!value) throw new Error(`${key} 需要路径。`);
      if (key === '--root') root = path.resolve(value); else snapshot = value;
    } else if (args[i] === '--json') json = true;
    else if (args[i] === '--warn-only') warnOnly = true;
    else if (args[i] === '--help') { console.log('node scripts/dense-lint.mjs [目录或文件] [--root 项目路径] [--snapshot Web快照.json] [--json] [--warn-only]'); return; }
    else if (args[i].startsWith('--')) throw new Error(`未知参数：${args[i]}`);
    else targets.push(args[i]);
  }
  const config = loadConfig(root);
  const report = snapshot ? scanSnapshot(JSON.parse(fs.readFileSync(snapshot, 'utf8')), config) : await scanFiles(targets.length ? targets : ['.'], root, config);
  if (json) console.log(JSON.stringify(report, null, 2));
  else {
    for (const f of report.findings) console.log(`${f.rule} [${f.evidence}] ${f.location}: ${f.message}`);
    for (const e of report.errors || []) console.error(e);
    console.log(`${report.findings.length} 项发现。${report.note}`);
  }
  process.exitCode = report.errors?.length ? 2 : report.findings.length && !warnOnly ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).catch(e => { console.error(e.message); process.exitCode = 2; });
}
