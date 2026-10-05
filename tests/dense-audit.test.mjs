// dense-audit.js 的 evaluate 单元测试：用 node:vm 加载脚本，喂手写 records。
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(here, '..', 'scripts', 'dense-audit.js'), 'utf8');

// 脚本顶层不能访问 window / document：沙箱里不提供它们，加载成功即证明这一点。
const sandbox = {};
vm.createContext(sandbox);
vm.runInContext(source, sandbox);

const evaluateInVm = sandbox.denseAuditEvaluate;

test('脚本导出 denseAudit 与 denseAuditEvaluate', () => {
  assert.equal(typeof sandbox.denseAudit, 'function');
  assert.equal(typeof evaluateInVm, 'function');
});

// 跨 realm 的对象原型不同，统一转成 JSON 再断言。
function run(records, ctx = {}) {
  const report = evaluateInVm(records, {
    viewport: { width: 1000, height: 500 },
    touch: false,
    ...ctx,
  });
  return JSON.parse(JSON.stringify(report));
}

// 一条默认 record：可见、100×30、13px、没有文字。
function rec(over = {}) {
  return {
    p: -1,
    outside: false,
    seg: over.tag || 'div',
    tag: 'div',
    role: null,
    drole: null,
    ign: null,
    ignWhy: null,
    alert: false,
    invalid: false,
    view: false,
    popover: false,
    pos: 'static',
    vis: true,
    rect: { x: 0, y: 0, width: 100, height: 30 },
    hasText: false,
    num: false,
    numAll: false,
    fs: 13,
    fvn: 'normal',
    bg: null,
    radius: 0,
    border4: false,
    shadow: false,
    form: false,
    inter: false,
    disabled: false,
    inlinePara: false,
    trunc: false,
    ...over,
  };
}

const rulesOf = (report) => report.findings.map((f) => f.rule);
const only = (report, rule) => report.findings.filter((f) => f.rule === rule);

test('报告骨架与 limits', () => {
  const report = run([rec()]);
  assert.equal(report.schema, 'dense-audit-v1');
  assert.deepEqual(report.findings, []);
  assert.equal(report.truncated, false);
  assert.equal(report.totalFindings, 0);
  assert.equal(report.context.touch, false);
  assert.equal(report.context.root, 'html');
  assert.equal(report.limits.length, 4);
  assert.ok(report.limits.includes('零告警不等于验收通过'));
});

test('DC001：td 11px 告警', () => {
  const report = run([rec({ tag: 'td', hasText: true, fs: 11 })]);
  assert.equal(only(report, 'DC001').length, 1);
  assert.equal(only(report, 'DC001')[0].value, 11);
});

test('DC001：12px 的 span 不告警（只用 small 下限）', () => {
  const report = run([rec({ tag: 'span', hasText: true, fs: 12 })]);
  assert.equal(only(report, 'DC001').length, 0);
});

test('DC001：12px 的 td 告警（正文类用 body 下限）', () => {
  const report = run([rec({ tag: 'td', hasText: true, fs: 12 })]);
  assert.equal(only(report, 'DC001').length, 1);
});

test('DC001：data-dc-role=small 的 td 只用 small 下限；role=body 的 span 用 body 下限', () => {
  const report = run([
    rec({ tag: 'td', hasText: true, fs: 12, drole: 'small' }),
    rec({ tag: 'span', hasText: true, fs: 12, drole: 'body' }),
  ]);
  assert.equal(only(report, 'DC001').length, 1);
  assert.equal(only(report, 'DC001')[0].selector, 'span');
});

test('DC001：不可见元素与没有直接文字的元素不告警', () => {
  const report = run([
    rec({ tag: 'td', hasText: true, fs: 11, vis: false }),
    rec({ tag: 'td', hasText: false, fs: 11 }),
  ]);
  assert.equal(only(report, 'DC001').length, 0);
});

const surface = (over = {}) => rec({
  rect: { x: 0, y: 0, width: 200, height: 100 },
  border4: true,
  radius: 6,
  bg: 'rgb(33, 34, 37)',
  ...over,
});

test('DC003：卡片嵌套告警内层', () => {
  const report = run([
    surface(),
    surface({ p: 0, bg: 'rgb(40, 41, 44)' }),
  ]);
  const hits = only(report, 'DC003');
  assert.equal(hits.length, 1);
  assert.match(hits[0].message, /表面/);
});

test('DC003：外层是 dialog 时内层不告警', () => {
  const report = run([
    surface({ tag: 'dialog' }),
    surface({ p: 0, bg: 'rgb(40, 41, 44)' }),
  ]);
  assert.equal(only(report, 'DC003').length, 0);
});

test('DC003：夹着 position:fixed 的浮层也停止向上查找', () => {
  const report = run([
    surface(),
    rec({ p: 0, pos: 'fixed' }),
    surface({ p: 1, bg: 'rgb(40, 41, 44)' }),
  ]);
  assert.equal(only(report, 'DC003').length, 0);
});

test('DC003：与祖先背景相同、圆角不足、尺寸太小、表单控件都不算表面盒', () => {
  const sameBg = run([surface(), surface({ p: 0 })]);
  assert.equal(only(sameBg, 'DC003').length, 0);
  const smallRadius = run([surface(), surface({ p: 0, bg: 'rgb(1, 2, 3)', radius: 2 })]);
  assert.equal(only(smallRadius, 'DC003').length, 0);
  const tiny = run([surface(), surface({ p: 0, bg: 'rgb(1, 2, 3)', rect: { x: 0, y: 0, width: 50, height: 30 } })]);
  assert.equal(only(tiny, 'DC003').length, 0);
  const form = run([surface(), surface({ p: 0, bg: 'rgb(1, 2, 3)', form: true, tag: 'input' })]);
  assert.equal(only(form, 'DC003').length, 0);
});

test('DC003：只有阴影没有边框也算表面盒', () => {
  const report = run([
    surface({ border4: false, shadow: true }),
    surface({ p: 0, bg: 'rgb(40, 41, 44)', border4: false, shadow: true }),
  ]);
  assert.equal(only(report, 'DC003').length, 1);
});

test('DC005：td 里的数字没有 tabular-nums 告警，有则不告警', () => {
  const bad = run([rec({ tag: 'td', hasText: true, num: true, fvn: 'normal' })]);
  assert.equal(only(bad, 'DC005').length, 1);
  const good = run([rec({ tag: 'td', hasText: true, num: true, fvn: 'tabular-nums' })]);
  assert.equal(only(good, 'DC005').length, 0);
});

test('DC005：非单元格需 data-dc-role=number 才检查', () => {
  const plain = run([rec({ tag: 'span', hasText: true, num: true })]);
  assert.equal(only(plain, 'DC005').length, 0);
  const marked = run([rec({ tag: 'span', hasText: true, num: true, drole: 'number' })]);
  assert.equal(only(marked, 'DC005').length, 1);
  const gridcell = run([rec({ tag: 'div', role: 'gridcell', hasText: true, num: true })]);
  assert.equal(only(gridcell, 'DC005').length, 1);
});

test('DC008：touch=false 时不出现，touch=true 时 30px 按钮告警', () => {
  const records = [rec({ tag: 'button', inter: true, rect: { x: 0, y: 0, width: 80, height: 30 } })];
  assert.equal(only(run(records, { touch: false }), 'DC008').length, 0);
  assert.equal(rulesOf(run(records, { touch: false })).includes('DC008'), false);
  assert.equal(only(run(records, { touch: true }), 'DC008').length, 1);
});

test('DC008：44px、已禁用、段落内联链接不告警', () => {
  const big = run([rec({ tag: 'button', inter: true, rect: { x: 0, y: 0, width: 80, height: 44 } })], { touch: true });
  assert.equal(only(big, 'DC008').length, 0);
  const disabled = run([rec({ tag: 'button', inter: true, disabled: true, rect: { x: 0, y: 0, width: 20, height: 20 } })], { touch: true });
  assert.equal(only(disabled, 'DC008').length, 0);
  const inline = run([rec({ tag: 'a', inter: true, inlinePara: true, rect: { x: 0, y: 0, width: 60, height: 18 } })], { touch: true });
  assert.equal(only(inline, 'DC008').length, 0);
  const wide = run([rec({ tag: 'a', inter: true, rect: { x: 0, y: 0, width: 30, height: 60 } })], { touch: true });
  assert.equal(only(wide, 'DC008').length, 1, '宽小于 44 同样告警');
});

test('DC010：被截断的数字、错误信息、money 告警；普通文字不告警', () => {
  const num = run([rec({ trunc: true, hasText: true, num: true })]);
  assert.equal(only(num, 'DC010').length, 1);
  const numAll = run([rec({ trunc: true, hasText: true, numAll: true })]);
  assert.equal(only(numAll, 'DC010').length, 1);
  const alertAncestor = run([rec({ role: 'alert', alert: true }), rec({ p: 0, trunc: true, hasText: true })]);
  assert.equal(only(alertAncestor, 'DC010').length, 1);
  const invalidAncestor = run([rec({ invalid: true }), rec({ p: 0, trunc: true, hasText: true })]);
  assert.equal(only(invalidAncestor, 'DC010').length, 1);
  const money = run([rec({ trunc: true, hasText: true, drole: 'money' })]);
  assert.equal(only(money, 'DC010').length, 1);
  const plain = run([rec({ trunc: true, hasText: true })]);
  assert.equal(only(plain, 'DC010').length, 0);
  const notTruncated = run([rec({ trunc: false, hasText: true, num: true })]);
  assert.equal(only(notTruncated, 'DC010').length, 0);
});

const primary = (over = {}) => rec({ tag: 'button', bg: 'rgb(250, 250, 250)', inter: true, ...over });

test('DC012：同一视图两个主按钮各告警一次', () => {
  const report = run([rec({ tag: 'main' }), primary({ p: 0 }), primary({ p: 0 })]);
  assert.equal(only(report, 'DC012').length, 2);
  assert.equal(only(report, 'DC012')[0].value, 2);
});

test('DC012：两个不同 view 各一个主按钮不告警', () => {
  const report = run([
    rec({ tag: 'section', view: true }),
    primary({ p: 0 }),
    rec({ tag: 'section', view: true }),
    primary({ p: 2 }),
  ]);
  assert.equal(only(report, 'DC012').length, 0);
});

test('DC012：dialog 内的主按钮与页面主按钮分属两组；禁用的不计；data-dc-role=primary 计入', () => {
  const dialogSplit = run([
    rec({ tag: 'main' }),
    primary({ p: 0 }),
    rec({ tag: 'dialog' }),
    primary({ p: 2 }),
  ]);
  assert.equal(only(dialogSplit, 'DC012').length, 0);
  const disabled = run([rec({ tag: 'main' }), primary({ p: 0 }), primary({ p: 0, disabled: true })]);
  assert.equal(only(disabled, 'DC012').length, 0);
  const marked = run([
    rec({ tag: 'main' }),
    primary({ p: 0 }),
    rec({ tag: 'button', p: 0, drole: 'primary', bg: null }),
  ]);
  assert.equal(only(marked, 'DC012').length, 2);
});

test('DC007：强调色面积 10% 阈值（> 0.10 才告警）', () => {
  // 视口 1000×500 = 500000；10% = 50000。
  const accent = 'rgb(88, 166, 255)';
  const at = run([rec({ bg: accent, rect: { x: 0, y: 0, width: 1000, height: 50 } })]);
  assert.equal(at.metrics.accentRatio, 0.1);
  assert.equal(only(at, 'DC007').length, 0);
  const over = run([rec({ bg: accent, rect: { x: 0, y: 0, width: 1000, height: 51 } })], { root: 'main' });
  assert.equal(over.metrics.accentRatio, 0.102);
  const hits = only(over, 'DC007');
  assert.equal(hits.length, 1);
  assert.equal(hits[0].selector, 'main');
  assert.deepEqual(hits[0].rect, { x: 0, y: 0, width: 1000, height: 500 });
});

test('DC007：只算与视口相交的部分，嵌套同类只算最外层', () => {
  const accent = 'rgb(88, 166, 255)';
  const clipped = run([rec({ bg: accent, rect: { x: 0, y: 400, width: 1000, height: 400 } })]);
  assert.equal(clipped.metrics.accentRatio, 0.2, '只有 y 400-500 的 100 高度在视口内');
  const nested = run([
    rec({ bg: accent, rect: { x: 0, y: 0, width: 500, height: 100 } }),
    rec({ p: 0, bg: 'rgb(63, 185, 80)', rect: { x: 0, y: 0, width: 400, height: 80 } }),
  ]);
  assert.equal(nested.metrics.accentRatio, 0.1, '内层不重复计入');
});

test('ignore：有理由才生效，祖先上的也生效', () => {
  const noReason = run([rec({ tag: 'td', hasText: true, fs: 11, ign: 'DC001' })]);
  assert.equal(only(noReason, 'DC001').length, 1, '没有 data-dc-ignore-reason 不生效');
  const blank = run([rec({ tag: 'td', hasText: true, fs: 11, ign: 'DC001', ignWhy: '   ' })]);
  assert.equal(only(blank, 'DC001').length, 1, '理由为空白不生效');
  const withReason = run([rec({ tag: 'td', hasText: true, fs: 11, ign: 'DC001', ignWhy: '法律脚注' })]);
  assert.equal(only(withReason, 'DC001').length, 0);
  const ancestor = run([
    rec({ ign: 'DC001', ignWhy: '法律脚注' }),
    rec({ p: 0, tag: 'td', hasText: true, fs: 11 }),
  ]);
  assert.equal(only(ancestor, 'DC001').length, 0);
  const otherRule = run([rec({ tag: 'td', hasText: true, fs: 11, ign: 'DC003', ignWhy: '独立嵌套对象' })]);
  assert.equal(only(otherRule, 'DC001').length, 1, '只忽略列出的规则');
  const multi = run([rec({ tag: 'td', hasText: true, fs: 11, ign: 'DC003 DC001', ignWhy: 'x' })]);
  assert.equal(only(multi, 'DC001').length, 0);
});

test('DC013：仅 tokensFound=true 时统计偏离刻度；pill 圆角不算偏离', () => {
  const records = [
    rec({ tag: 'span', hasText: true, fs: 11, radius: 8, rect: { x: 0, y: 0, width: 60, height: 30 } }),
    rec({ tag: 'span', hasText: true, fs: 11 }),
    rec({ tag: 'span', hasText: true, fs: 13, radius: 6 }),
    rec({ tag: 'span', hasText: true, fs: 13, radius: 15, rect: { x: 0, y: 0, width: 60, height: 30 } }),
    rec({ tag: 'span', hasText: true, fs: 13, radius: 9999 }),
  ];
  const report = run(records, { tokens: { found: true } });
  assert.deepEqual(report.metrics.offScale, { fontSizes: ['11'], radii: ['8'] });
  assert.deepEqual(report.metrics.fontSizes, { 11: 2, 13: 3 });
  assert.deepEqual(report.metrics.radii, { 6: 1, 8: 1, pill: 2 });
  const hits = only(report, 'DC013');
  assert.equal(hits.length, 2);
  assert.deepEqual(hits[0].value, { kind: 'fontSize', value: 11, count: 2 });
  assert.deepEqual(hits[1].value, { kind: 'radius', value: 8, count: 1 });

  const noTokens = run(records, { tokens: { found: false } });
  assert.deepEqual(noTokens.metrics.offScale, { fontSizes: [], radii: [] });
  assert.equal(only(noTokens, 'DC013').length, 0);
  assert.equal(noTokens.context.tokensFound, false);
});

test('lists：>=5 个可见行才输出，给出中位行高与完整可见数', () => {
  const rows = [];
  const recs = [rec({ tag: 'table' }), rec({ p: 0, tag: 'tbody' })];
  for (let k = 0; k < 6; k++) {
    rows.push(rec({ p: 1, tag: 'tr', seg: `tr:nth-of-type(${k + 1})`, rect: { x: 0, y: k * 24 + 470, width: 300, height: 24 } }));
  }
  const report = run(recs.concat(rows));
  assert.equal(report.metrics.lists.length, 1);
  const list = report.metrics.lists[0];
  assert.equal(list.items, 6);
  assert.equal(list.medianRowHeight, 24);
  assert.equal(list.fullyVisible, 1, '只有 y=470 的一行完全落在 500 高的视口内');
  assert.equal(list.selector, 'table');
  const few = run(recs.concat(rows.slice(0, 4)));
  assert.equal(few.metrics.lists.length, 0);
});

test('lists：grid 的 role=row 与 ul 的直接 li', () => {
  const recs = [rec({ role: 'grid' })];
  for (let k = 0; k < 5; k++) recs.push(rec({ p: 0, role: 'row', rect: { x: 0, y: k * 20, width: 100, height: 20 } }));
  recs.push(rec({ tag: 'ul' }));
  for (let k = 0; k < 5; k++) recs.push(rec({ p: 6, tag: 'li', rect: { x: 0, y: k * 31, width: 100, height: 31 } }));
  const report = run(recs);
  assert.equal(report.metrics.lists.length, 2);
  assert.equal(report.metrics.lists[0].medianRowHeight, 20);
  assert.equal(report.metrics.lists[1].medianRowHeight, 31);
  assert.equal(report.metrics.lists[1].fullyVisible, 5);
});

test('selector：有 id 用 #id，否则向上最多 5 级，用 > 连接', () => {
  const recs = [
    rec({ tag: 'html', seg: 'html' }),
    rec({ p: 0, tag: 'body', seg: 'body' }),
    rec({ p: 1, tag: 'main', seg: 'main' }),
    rec({ p: 2, tag: 'table', seg: 'table' }),
    rec({ p: 3, tag: 'tbody', seg: 'tbody' }),
    rec({ p: 4, tag: 'tr', seg: 'tr:nth-of-type(2)' }),
    rec({ p: 5, tag: 'td', seg: 'td:nth-of-type(3)', hasText: true, fs: 11 }),
    rec({ p: 5, tag: 'td', seg: '#price', hasText: true, fs: 11 }),
  ];
  const report = run(recs);
  const hits = only(report, 'DC001');
  assert.equal(hits[0].selector, 'main > table > tbody > tr:nth-of-type(2) > td:nth-of-type(3)');
  assert.equal(hits[1].selector, '#price');
});

test('outside 祖先不作为检查对象，也不计入 nodes', () => {
  const report = run([
    rec({ outside: true, tag: 'td', hasText: true, fs: 11 }),
    rec({ p: 0, tag: 'span' }),
  ]);
  assert.equal(only(report, 'DC001').length, 0);
  assert.equal(report.context.nodes, 1);
});

test('maxFindings：超出截断并注明总数', () => {
  const recs = [];
  for (let k = 0; k < 5; k++) recs.push(rec({ tag: 'td', hasText: true, fs: 11 }));
  const report = run(recs, { maxFindings: 3, tokens: { found: false } });
  assert.equal(report.findings.length, 3);
  assert.equal(report.truncated, true);
  assert.equal(report.totalFindings, 5);
});

test('findings 按规则号排序，且不含页面文本字段', () => {
  const report = run([
    rec({ tag: 'td', hasText: true, num: true, fs: 11 }),
  ], { tokens: { found: false } });
  assert.deepEqual(rulesOf(report), ['DC001', 'DC005']);
  for (const f of report.findings) {
    assert.deepEqual(Object.keys(f).sort(), ['message', 'rect', 'rule', 'selector', 'value']);
  }
});
