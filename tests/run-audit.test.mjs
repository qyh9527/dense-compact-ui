// run-audit.mjs 里不用浏览器的纯函数：步骤格式校验、发现合并。
import test from 'node:test';
import assert from 'node:assert/strict';
import { addFindings, checkSteps } from '../scripts/run-audit.mjs';

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
