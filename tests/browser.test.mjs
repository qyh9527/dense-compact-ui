// 真实浏览器端到端测试：通过 scripts/run-audit.mjs 导出的 runAudit（CDP 驱动 Chromium 内核浏览器）
// 把 scripts/dense-audit.js 注入 fixture 页面执行，检查报告；并真实执行 CLI 检查退出码。
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { findBrowser, runAudit } from '../scripts/run-audit.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const cli = path.join(here, '..', 'scripts', 'run-audit.mjs');
const fixture = (name) => path.join(here, 'fixtures', name);

const STEP_TIMEOUT = 60_000;
const SKIP_REASON = '未找到 Chromium 内核浏览器';

function ruleCounts(report) {
  const counts = {};
  for (const f of report.findings) counts[f.rule] = (counts[f.rule] || 0) + 1;
  return counts;
}

function runCli(args) {
  return spawnSync(process.execPath, [cli, ...args], {
    encoding: 'utf8',
    timeout: STEP_TIMEOUT,
    maxBuffer: 16 * 1024 * 1024,
  });
}

test('真实浏览器：dense-audit.js 对 fixture 的检出', { timeout: STEP_TIMEOUT }, async (t) => {
  if (!findBrowser()) {
    t.skip(SKIP_REASON);
    return;
  }

  await t.test('violations.html 触发全部目标规则并给出量取指标', async () => {
    const { report, htmlLengthBefore, htmlLengthAfter } = await runAudit({
      target: fixture('violations.html'), touch: true, width: 1280, height: 720,
    });
    const counts = ruleCounts(report);
    t.diagnostic(`violations 规则计数：${JSON.stringify(counts)}`);
    t.diagnostic(`violations metrics：${JSON.stringify(report.metrics)}`);

    assert.equal(report.schema, 'dense-audit-v1');
    assert.equal(report.context.tokensFound, true);
    assert.equal(report.context.touch, true);
    assert.deepEqual(report.context.viewport, { width: 1280, height: 720 }, '视口应精确等于模拟值');
    assert.equal(report.truncated, false);
    for (const rule of ['DC001', 'DC003', 'DC005', 'DC007', 'DC008', 'DC010', 'DC012', 'DC013']) {
      assert.ok(counts[rule] >= 1, `${rule} 应至少检出一条，实际计数 ${JSON.stringify(counts)}`);
    }
    // 横幅 1280 宽，高 120 加上下 padding 各 12 共 144，占 1280×720 视口的 20%。
    assert.equal(report.metrics.accentRatio, 0.2);
    assert.ok(report.metrics.offScale.fontSizes.includes('11'), '11px 应列入 offScale.fontSizes');
    assert.ok(report.metrics.offScale.radii.includes('8'), '8px 应列入 offScale.radii');
    assert.ok(report.metrics.lists.length >= 1, '应至少有一个 lists 项');
    const median = report.metrics.lists[0].medianRowHeight;
    assert.ok(median >= 23 && median <= 26, `行高中位数应在 23-26px，实际 ${median}`);
    assert.equal(htmlLengthAfter, htmlLengthBefore, '注入与执行不得改动 DOM');
  });

  await t.test('clean.html 零告警', async () => {
    const { report, htmlLengthBefore, htmlLengthAfter } = await runAudit({
      target: fixture('clean.html'), touch: true,
    });
    t.diagnostic(`clean metrics：${JSON.stringify(report.metrics)}`);

    assert.equal(report.context.tokensFound, true);
    assert.deepEqual(report.findings, [], `clean.html 不应有告警：${JSON.stringify(report.findings, null, 2)}`);
    assert.ok(report.metrics.lists.length >= 1);
    assert.equal(htmlLengthAfter, htmlLengthBefore, '注入与执行不得改动 DOM');
  });

  await t.test('root 选项只查指定区域，找不到时抛错', async () => {
    const scoped = (await runAudit({ target: fixture('clean.html'), touch: true, root: '.pane' })).report;
    const whole = (await runAudit({ target: fixture('clean.html'), touch: true })).report;
    assert.equal(scoped.context.root, '.pane');
    assert.ok(scoped.context.nodes < whole.context.nodes, 'root 范围内的节点数应更少');
    assert.deepEqual(scoped.findings, []);
    await assert.rejects(
      runAudit({ target: fixture('clean.html'), root: '#不存在' }),
      /找不到 root/,
    );
  });

  await t.test('CLI：violations.html 退出码 1 且 stdout 是 JSON', () => {
    const result = runCli([fixture('violations.html'), '--touch']);
    assert.equal(result.status, 1, `退出码应为 1，stderr：${result.stderr}`);
    const report = JSON.parse(result.stdout);
    assert.equal(report.schema, 'dense-audit-v1');
    assert.ok(report.totalFindings > 0);
    assert.deepEqual(report.context.viewport, { width: 1280, height: 720 });
  });

  await t.test('CLI：clean.html 退出码 0', () => {
    const result = runCli([fixture('clean.html'), '--touch', '--width', '1280', '--height', '720']);
    assert.equal(result.status, 0, `退出码应为 0，stderr：${result.stderr}`);
    assert.deepEqual(JSON.parse(result.stdout).findings, []);
  });

  await t.test('CLI：导航失败时 10 秒内以退出码 2 结束', () => {
    const started = Date.now();
    const result = spawnSync(process.execPath, [cli, 'http://127.0.0.1:1/'], {
      encoding: 'utf8',
      timeout: 10_000,
    });
    assert.equal(result.error, undefined, `应在 10 秒内结束：${result.error}`);
    assert.equal(result.status, 2, `退出码应为 2，stderr：${result.stderr}`);
    assert.match(result.stderr, /导航失败/);
    assert.doesNotMatch(result.stderr, /超时/, '不应留下未处理的超时 rejection');
    t.diagnostic(`导航失败用时 ${Date.now() - started}ms`);
  });

  await t.test('CLI：出错时退出码 2 并在 stderr 写中文原因', () => {
    const result = runCli([fixture('不存在.html')]);
    assert.equal(result.status, 2);
    assert.match(result.stderr, /本地文件不存在/);
    assert.equal(result.stdout, '');
  });
});
