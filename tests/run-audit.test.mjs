// run-audit.mjs 里不用浏览器的纯函数：步骤格式校验、发现合并、截图文件名。
import test from 'node:test';
import assert from 'node:assert/strict';
import { addFindings, checkSteps, screenshotName } from '../scripts/run-audit.mjs';

const report = (n) => ({
  findings: Array.from({ length: n }, (_, i) => ({ rule: 'DC001', selector: `#n${i}` })),
  totalFindings: n,
  truncated: false,
});

test('addFindings：有空位时追加到末尾', () => {
  const r = report(2);
  addFindings(r, [{ rule: 'DC021', selector: '#a' }]);
  assert.deepEqual(r.findings.map((f) => f.selector), ['#n0', '#n1', '#a']);
  assert.equal(r.totalFindings, 3);
  assert.equal(r.truncated, false);
});

test('addFindings：已满 200 条时普通发现被截掉，只更新计数', () => {
  const r = report(200);
  addFindings(r, [{ rule: 'DC021', selector: '#a' }]);
  assert.equal(r.findings.length, 200);
  assert.ok(!r.findings.some((f) => f.selector === '#a'));
  assert.equal(r.totalFindings, 201);
  assert.equal(r.truncated, true);
});

test('addFindings：force 的发现（步骤失败的 DC023）在已满时挤掉末尾的普通发现', () => {
  const r = report(200);
  addFindings(r, [{ rule: 'DC023', selector: '#step' }], { force: true });
  assert.equal(r.findings.length, 200);
  assert.equal(r.findings[199].selector, '#step');
  assert.equal(r.findings[198].selector, '#n198');
  assert.equal(r.totalFindings, 201);
  assert.equal(r.truncated, true);
});

test('checkSteps：合法步骤原样返回，格式不对时指明第几步', () => {
  const steps = [{ click: '#a' }, { fill: '#b', value: '' }, { press: 'Escape' }, { expect: '#c', visible: false }, { audit: '状态' }];
  assert.equal(checkSteps(steps), steps);
  assert.throws(() => checkSteps({}), /非空的 JSON 数组/);
  assert.throws(() => checkSteps([{ click: '#a' }, { tap: '#b' }]), /第 2 步要恰好写一个动作/);
  assert.throws(() => checkSteps([{ select: '#s' }]), /第 1 步的 select 要有字符串 value/);
  assert.throws(() => checkSteps([{ expect: '#c', count: -1 }]), /count 要是非负整数/);
});

test('screenshotName：序号补零，按视口、配色、状态拼接；文件名不能用的字符换成 _，状态名按 UTF-8 截到 120 字节', () => {
  assert.equal(screenshotName(1, { width: 1280, height: 720 }, null, null), '01-1280x720.png');
  assert.equal(screenshotName(12, { width: 390, height: 844 }, 'dark', '第 3 步失败'), '12-390x844-dark-第 3 步失败.png');
  assert.equal(screenshotName(2, { width: 390, height: 844 }, null, ' 弹窗/确认?  "删除"\x5c '), '02-390x844-弹窗_确认_ _删除__.png');
  assert.equal(screenshotName(3, { width: 1, height: 1 }, 'light', '长'.repeat(80)), `03-1x1-light-${'长'.repeat(40)}.png`);
  const emoji = screenshotName(4, { width: 1280, height: 720 }, 'dark', '\u{1F600}'.repeat(60));
  assert.equal(emoji, `04-1280x720-dark-${'\u{1F600}'.repeat(30)}.png`);
  assert.ok(Buffer.byteLength(emoji) <= 255, `${Buffer.byteLength(emoji)} 字节`);
});
