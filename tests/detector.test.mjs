import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseSource } from '../scripts/source-parser.mjs';
import { inspect } from '../scripts/lint-core.mjs';
import { scanFiles, scanSnapshot } from '../scripts/dense-lint.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const codes = report => report.findings.map(f => f.rule);
const source = (s, file = 'index.html') => inspect(parseSource(s, file));
const node = (id, extra = {}) => ({ id, roles: [], fontSize: 13, width: 44, height: 44, ...extra });
const snapshot = nodes => ({ schema: 'dense-ui-web-v1', context: { platform: 'web', unit: 'css-px', touch: true }, nodes });
function temp(t) { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dense-ui-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true })); return dir; }
function run(script, args = [], options = {}) { return spawnSync(process.execPath, [path.join(root, 'scripts', script), ...args], { encoding: 'utf8', ...options }); }

test('HTML 字号仅检查明确正文；合格值与次要文本不误报', () => {
  assert.deepEqual(codes(source('<p data-dc-role="body" style="font-size:12px">正文</p>')), ['DC001']);
  assert.deepEqual(codes(source('<p data-dc-role="body" style="font-size:13px">正文</p><small style="font-size:12px">备注</small>')), []);
});
test('TSX AST 可处理大于号、注释、嵌套和数字样式，不扫描字符串内的假 JSX', () => {
  const s = 'const fake = "<p data-dc-role=body style=font-size:8px>"; export default () => <div title={a > 2 ? "x" : "y"} data-dc-role="card"><div data-dc-role="card"><p data-dc-role="body" style={{fontSize:12}}>x</p></div></div>';
  assert.deepEqual(codes(source(s, 'Panel.tsx')).sort(), ['DC001', 'DC003']);
});
test('动态字体和 CSS 变量保持未知，不套默认尺寸', () => {
  assert.deepEqual(codes(source('const P=()=> <p data-dc-role="body" style={{fontSize:size}}>x</p>', 'P.jsx')), []);
  assert.deepEqual(codes(source('<p data-dc-role="body" style="font-size:var(--body)">x</p>')), []);
  assert.deepEqual(codes(source('const P=()=> <p data-dc-role="body" style={{fontSize:12,...theme}}>x</p>', 'P.jsx')), []);
  assert.deepEqual(codes(source('const P=()=> <p data-dc-role="body" style={{fontSize:12}} {...props}>x</p>', 'P.jsx')), []);
  assert.deepEqual(codes(source('const P=()=> <p data-dc-role="body" className="text-[12px]" style={{fontSize:size}}>x</p>', 'P.jsx')), []);
  assert.deepEqual(codes(source('<p data-dc-role="body" class="text-[12px]" style="font-size:var(--body)">x</p>')), []);
  assert.deepEqual(codes(source('const P=()=> <p {...props} data-dc-role="body" className="text-[12px]">x</p>', 'P.jsx')), []);
});
test('Tailwind 只识别精确无变体声明，保留响应式分支未知', () => {
  assert.deepEqual(codes(source('<p data-dc-role="body" class="text-[12px]">x</p>')), ['DC001']);
  assert.deepEqual(codes(source('<p data-dc-role="body" class="md:text-[12px]">x</p>')), []);
});
test('卡片浮层边界与有理由的局部例外', () => {
  assert.deepEqual(codes(source('<div data-dc-role="card"><div data-dc-role="overlay"><div data-dc-role="card"></div></div></div>')), []);
  const prefix = '<div data-dc-role="card"><div data-dc-role="card" data-dc-ignore="DC003"';
  assert.deepEqual(codes(source(prefix + '></div></div>')), ['DC003']);
  assert.deepEqual(codes(source(prefix + ' data-dc-ignore-reason="独立嵌套对象"></div></div>')), []);
});
test('金额裁切和明确同视图主操作；独立作用域同名也不合并', () => {
  assert.deepEqual(codes(source('<span data-dc-role="money" class="truncate">100</span>')), ['DC010']);
  const a = '<main data-dc-view="x"><button data-dc-role="primary">A</button><button data-dc-role="primary">B</button></main>';
  assert.deepEqual(codes(source(a)), ['DC012', 'DC012']);
  const b = '<div data-dc-view="x"><button data-dc-role="primary">A</button></div>';
  assert.deepEqual(codes(source(b + b)), []);
  assert.deepEqual(codes(source('<main data-dc-view="x"><button data-dc-role="primary">A</button><div hidden><button data-dc-role="primary">B</button></div></main>')), []);
});
test('渲染检查考虑触屏、裁切和隐藏/禁用状态', () => {
  const data = snapshot([node('money', {roles:['money'],ellipsis:true,clipped:true}), node('button',{interactive:true,width:24,height:24}),
    node('hidden',{roles:['primary'],view:'x',hidden:true}),node('active',{roles:['primary'],view:'x'}),node('disabled',{roles:['primary'],view:'x',disabled:true})]);
  assert.deepEqual(codes(scanSnapshot(data)).sort(), ['DC005','DC008','DC010']);
  data.context.touch = false;
  data.nodes[0].tabular = true; data.nodes[0].clipped = false;
  assert.deepEqual(codes(scanSnapshot(data)), []);
});
test('不凭行高或元素总数推断违规；read 模式不套操作型结构规则', () => {
  assert.deepEqual(codes(inspect([node('r', {height:48,roles:['row']})],{evidence:'rendered',touch:true})), []);
  assert.deepEqual(codes(inspect(parseSource('<div data-dc-role="card"><div data-dc-role="card"></div></div>','x.html'),{mode:'read'})), []);
});
test('拒绝原生单位冒充 Web 快照，以及重复 ID', () => {
  const data = snapshot([node('a')]); data.context.unit='dp';
  assert.throws(()=>scanSnapshot(data), /快照格式/);
  assert.throws(()=>scanSnapshot(snapshot([node('a'),node('a')])), /重复/);
});
test('语法错误作为未扫描报告，符号链接不越界', async t => {
  const dir=temp(t);fs.writeFileSync(path.join(dir,'bad.tsx'),'<div>');
  const outside=temp(t);fs.writeFileSync(path.join(outside,'x.html'),'<p/>');
  fs.symlinkSync(path.join(outside,'x.html'),path.join(dir,'link.html'));
  const result=await scanFiles(['.'],dir);
  assert.equal(result.errors.length,2); assert.equal(result.results.length,0);
});
test('CLI 区分发现与解析错误，warn-only 不吞语法错误', t => {
  const dir=temp(t);fs.writeFileSync(path.join(dir,'x.html'),'<p data-dc-role="body" style="font-size:12px">x</p>');
  assert.equal(run('dense-lint.mjs',['x.html','--root',dir]).status,1);
  assert.equal(run('dense-lint.mjs',['x.html','--root',dir,'--warn-only']).status,0);
  fs.writeFileSync(path.join(dir,'bad.tsx'),'<div>');
  assert.equal(run('dense-lint.mjs',['bad.tsx','--root',dir,'--warn-only']).status,2);
  fs.writeFileSync(path.join(dir,'App.vue'),'<template><p/></template>');
  assert.equal(run('dense-lint.mjs',['App.vue','--root',dir,'--warn-only']).status,2);
});
test('Bash Hook 覆盖无 HEAD 仓库与仓库内子项目，不拼错 Git 相对路径', t => {
  const dir=temp(t);const git=args=>spawnSync('git',args,{cwd:dir,encoding:'utf8'});
  assert.equal(git(['init']).status,0);
  const sub=path.join(dir,'packages/ui');fs.mkdirSync(sub,{recursive:true});
  fs.writeFileSync(path.join(sub,'.dense-ui.json'),'{"enabled":true}');
  fs.writeFileSync(path.join(sub,'Panel.html'),'<p data-dc-role="body" style="font-size:12px">x</p>');
  const env={...process.env,CLAUDE_PROJECT_DIR:sub};
  const event={hook_event_name:'PostToolUse',cwd:sub,tool_name:'Bash',tool_input:{command:'ignored'}};
  assert.match(run('dense-hook.mjs',[],{env,input:JSON.stringify(event)}).stdout,/DC001/);
  assert.equal(git(['add','packages/ui/Panel.html']).status,0);
  assert.match(run('dense-hook.mjs',[],{env,input:JSON.stringify(event)}).stdout,/DC001/);
});
test('Hook 无授权配置不扫描，有配置输出规范 JSON；恶意命令不执行', t => {
  const dir=temp(t), file=path.join(dir,'x.html');fs.writeFileSync(file,'<p data-dc-role="body" style="font-size:12px">x</p>');
  const event={hook_event_name:'PostToolUse',cwd:dir,tool_name:'Write',tool_input:{file_path:file,command:'touch injected'}};
  assert.equal(run('dense-hook.mjs',[],{input:JSON.stringify(event)}).stdout,'');
  fs.writeFileSync(path.join(dir,'.dense-ui.json'),' {"enabled":true} ');
  const result=run('dense-hook.mjs',[],{input:JSON.stringify(event)});
  const body=JSON.parse(result.stdout);assert.equal(result.status,0);assert.equal(body.hookSpecificOutput.hookEventName,'PostToolUse');
  assert.match(body.hookSpecificOutput.additionalContext,/DC001/);assert.equal(fs.existsSync(path.join(dir,'injected')),false);
});
test('Hook 输入格式错误不阻断编辑，也不伪称检查完成', () => {
  const result=run('dense-hook.mjs',[],{input:'{broken'});assert.equal(result.status,0);assert.match(result.stderr,/未完成检查/);assert.equal(result.stdout,'');
});
test('安装幂等、卸载精确，并保留权限与其他 Hook/config', t => {
  const dir=temp(t);fs.mkdirSync(path.join(dir,'.claude'));
  const file=path.join(dir,'.claude/settings.local.json');
  const existing={permissions:{allow:['Read']},hooks:{PostToolUse:[{matcher:'Edit',hooks:[{type:'command',command:'existing'}]}]}};
  fs.writeFileSync(file,JSON.stringify(existing));fs.writeFileSync(path.join(dir,'.dense-ui.json'),'{"enabled":false,"mode":"read"}');
  assert.equal(run('install-hook.mjs',[dir]).status,0);assert.equal(run('install-hook.mjs',[dir]).status,0);
  const settings=JSON.parse(fs.readFileSync(file));assert.equal(settings.hooks.PostToolUse.length,2);assert.deepEqual(settings.permissions,existing.permissions);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir,'.dense-ui.json'))).enabled,false);
  assert.equal(run('install-hook.mjs',[dir,'--remove']).status,0);
  assert.deepEqual(JSON.parse(fs.readFileSync(file)),existing);
});
test('安装拒绝无效 hooks，保持原设置字节不变', t => {
  const dir=temp(t);fs.mkdirSync(path.join(dir,'.claude'));const file=path.join(dir,'.claude/settings.local.json');
  const original=JSON.stringify({permissions:{allow:['Read']},hooks:[]});fs.writeFileSync(file,original);
  assert.equal(run('install-hook.mjs',[dir]).status,2);assert.equal(fs.readFileSync(file,'utf8'),original);
});
