// 真实浏览器端到端测试：通过 scripts/run-audit.mjs 导出的 runAudit（CDP 驱动 Chromium 内核浏览器）
// 把 scripts/dense-audit.js 注入 fixture 页面执行，检查报告；并真实执行 CLI 检查退出码。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { findBrowser, runAudit, runAudits } from '../scripts/run-audit.mjs';

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

test('真实浏览器：SPA 在 load 之后才渲染时的就绪等待', { timeout: STEP_TIMEOUT }, async (t) => {
  if (!findBrowser()) {
    t.skip(SKIP_REASON);
    return;
  }

  await t.test('waitFor: table 等到表格出现后检出 DC001，并记录 ready', async () => {
    const started = Date.now();
    const { report, htmlLengthBefore, htmlLengthAfter } = await runAudit({
      target: fixture('spa.html'), waitFor: 'table',
    });
    t.diagnostic(`waitFor: table -> ready=${JSON.stringify(report.context.ready)}，总用时 ${Date.now() - started}ms`);
    const dc001 = report.findings.filter((f) => f.rule === 'DC001');
    assert.ok(dc001.length >= 1, `应检出 DC001：${JSON.stringify(ruleCounts(report))}`);
    assert.equal(report.context.ready.waitFor, 'table');
    assert.equal(report.context.ready.settled, true);
    assert.ok(report.context.ready.waitedMs >= 1000, `应至少等到表格渲染（约 1.5 秒），实际 ${report.context.ready.waitedMs}ms`);
    assert.equal(htmlLengthAfter, htmlLengthBefore, '等待与审计不得改动 DOM');
  });

  for (const sel of ['#hidden-v', '#hidden-o']) {
    await t.test(`waitFor 的目标已存在但被 ${sel === '#hidden-v' ? 'visibility: hidden' : 'opacity: 0'} 藏着：等到显示后才审计`, async () => {
      const { report } = await runAudit({ target: fixture('spa-hidden.html'), waitFor: sel, settle: 200 });
      t.diagnostic(`${sel} -> ready=${JSON.stringify(report.context.ready)}`);
      assert.ok(report.context.ready.waitedMs >= 1000, `应等到约 1.5 秒后显示，实际 ${report.context.ready.waitedMs}ms`);
      assert.ok(report.findings.some((f) => f.rule === 'DC001'), `显示后的表格应检出 DC001：${JSON.stringify(ruleCounts(report))}`);
    });
  }

  await t.test('默认 settle、不传 waitFor：1.5 秒内 DOM 没有变化，表格出现前就判定静默', async () => {
    const started = Date.now();
    const { report } = await runAudit({ target: fixture('spa.html') });
    t.diagnostic(`默认 settle -> ready=${JSON.stringify(report.context.ready)}，检出 ${JSON.stringify(ruleCounts(report))}，总用时 ${Date.now() - started}ms`);
    // 不对检出结果下结论：它取决于静默窗口与渲染时刻的先后，这正是该用 waitFor 的原因。
    assert.equal(report.context.ready.settled, true);
    assert.equal(report.context.ready.waitFor, null);
    assert.equal(typeof report.context.ready.waitedMs, 'number');
  });

  await t.test('settle: 0 跳过静默等待', async () => {
    const { report } = await runAudit({ target: fixture('spa.html'), settle: 0 });
    t.diagnostic(`settle: 0 -> ready=${JSON.stringify(report.context.ready)}`);
    assert.equal(report.context.ready.settled, false, '跳过时没有验证过静默');
    assert.ok(report.context.ready.waitedMs < 400, `跳过静默窗口应很快返回，实际 ${report.context.ready.waitedMs}ms`);
  });

  await t.test('waitFor 的选择器一直不存在：超时后抛出含选择器的中文错误', async () => {
    const started = Date.now();
    await assert.rejects(
      runAudit({ target: fixture('spa.html'), waitFor: '#no-such-element', waitTimeoutMs: 2000 }),
      (err) => /超时/.test(err.message) && err.message.includes('#no-such-element'),
    );
    t.diagnostic(`不存在的选择器 2000ms 超时，实际用时 ${Date.now() - started}ms`);
  });

  await t.test('CLI：--wait-for 与 --settle 生效，ready 写进报告', () => {
    const result = runCli([fixture('spa.html'), '--wait-for', 'table', '--settle', '200']);
    assert.equal(result.status, 1, `退出码应为 1，stderr：${result.stderr}`);
    const { context } = JSON.parse(result.stdout);
    assert.equal(context.ready.waitFor, 'table');
    assert.equal(context.ready.settled, true);
  });

  await t.test('CLI：--settle 需要非负整数', () => {
    const result = runCli([fixture('spa.html'), '--settle', '-1']);
    assert.equal(result.status, 2);
    assert.match(result.stderr, /--settle/);
  });
});

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
    assert.ok(
      report.findings.some((f) => f.rule === 'DC005' && f.selector === '#dc005-span'),
      `DC005 应检出单元格里的数字 span：${JSON.stringify(report.findings.filter((f) => f.rule === 'DC005').map((f) => f.selector))}`,
    );
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

  await t.test('CLI：经目录链接运行（cc-switch 等以软链接安装技能）仍输出报告', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dense-audit-link-'));
    const link = path.join(tmp, 'scripts');
    try {
      fs.symlinkSync(path.dirname(cli), link, 'junction');
      const result = spawnSync(process.execPath, [path.join(link, 'run-audit.mjs'), fixture('clean.html'), '--touch'], {
        encoding: 'utf8',
        timeout: STEP_TIMEOUT,
        maxBuffer: 16 * 1024 * 1024,
      });
      assert.equal(result.status, 0, `退出码应为 0，stderr：${result.stderr}`);
      assert.equal(JSON.parse(result.stdout).schema, 'dense-audit-v1');
    } finally {
      // 先只拆链接本身，避免递归删除顺着链接进到 scripts/
      try { fs.unlinkSync(link); } catch { try { fs.rmdirSync(link); } catch { /* 链接未建成 */ } }
      fs.rmSync(tmp, { recursive: true, force: true });
    }
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

test('真实浏览器：运行时探针 DC014–DC020 的坏例与好例，多视口', { timeout: STEP_TIMEOUT * 2 }, async (t) => {
  if (!findBrowser()) {
    t.skip(SKIP_REASON);
    return;
  }
  const viewports = [{ width: 1280, height: 720 }, { width: 390, height: 844 }];

  await t.test('runtime-bad.html：两个视口都检出 DC014–DC020，且不改 DOM', async () => {
    const { runs } = await runAudits({ target: fixture('runtime-bad.html'), viewports });
    assert.equal(runs.length, 2);
    runs.forEach(({ report, htmlLengthBefore, htmlLengthAfter }, k) => {
      const counts = ruleCounts(report);
      t.diagnostic(`runtime-bad ${JSON.stringify(report.context.viewport)}：${JSON.stringify(counts)} page=${JSON.stringify(report.metrics.page)}`);
      assert.deepEqual(report.context.viewport, viewports[k]);
      for (const rule of ['DC014', 'DC015', 'DC017', 'DC018', 'DC019', 'DC020']) {
        assert.equal(counts[rule], 1, `${rule} 应恰好一条：${JSON.stringify(counts)}`);
      }
      const by = (rule) => report.findings.find((f) => f.rule === rule);
      assert.equal(by('DC015').selector, '#flush');
      assert.equal(by('DC015').value.ring, 4, '焦点环宽度应从 :focus-visible 规则的 token 展开为 2px + 2px');
      // 页面上的透明层、对话框内部的遮挡层、自身 pointer-events: none 各一条。
      assert.deepEqual(
        report.findings.filter((f) => f.rule === 'DC016').map((f) => f.selector).sort(),
        ['#covered', '#covered-in-dialog', '#no-pointer'],
      );
      assert.equal(report.findings.find((f) => f.selector === '#no-pointer').value, 'pointer-events: none');
      assert.deepEqual(by('DC017').value, { family: 'missing brand', count: 1 });
      // 三张同一地址的破图合并成一条，含 0×0 的那张；报告里不带查询串。
      assert.equal(by('DC018').selector, '#broken-1');
      assert.equal(by('DC018').value.count, 3);
      assert.ok(by('DC018').value.src.endsWith('/no-such-image.png'), by('DC018').value.src);
      assert.equal(by('DC019').selector, '#dead-toolbar');
      assert.deepEqual(by('DC019').value, { display: 'block', props: ['gap: 8px', 'align-items: center'] });
      assert.equal(by('DC020').selector, '#dead-icon');
      assert.deepEqual(by('DC020').value, { family: 'missing icons', count: 1 });
      assert.equal(by('DC014').value.viewport, viewports[k].width);
      assert.equal(htmlLengthAfter, htmlLengthBefore, '注入与执行不得改动 DOM');
    });
  });

  await t.test('runtime-good.html：横向滚动容器、内描边、角标、装饰层、非模态对话框、未使用的字体、懒加载图片、多列间距都不告警', async () => {
    const { runs } = await runAudits({ target: fixture('runtime-good.html'), viewports });
    for (const { report } of runs) {
      assert.deepEqual(report.findings, [], `${JSON.stringify(report.context.viewport)} 不应有告警：${JSON.stringify(report.findings, null, 2)}`);
      assert.equal(report.metrics.page.scrollWidth, report.metrics.page.clientWidth);
    }
  });

  await t.test('CLI：重复 --viewport 输出多视口报告，有告警时退出码 1', () => {
    const result = runCli([fixture('runtime-bad.html'), '--viewport', '1280x720', '--viewport', '390x844']);
    assert.equal(result.status, 1, `退出码应为 1，stderr：${result.stderr}`);
    const out = JSON.parse(result.stdout);
    assert.equal(out.schema, 'dense-audit-multi-v1');
    assert.deepEqual(out.reports.map((r) => r.context.viewport), viewports);
    assert.equal(out.totalFindings, out.reports.reduce((s, r) => s + r.totalFindings, 0));
    for (const r of out.reports) assert.equal(r.schema, 'dense-audit-v1');
  });

  await t.test('CLI：--viewport 格式错误或与 --width 混用时退出码 2', () => {
    const bad = runCli([fixture('runtime-good.html'), '--viewport', '390*844']);
    assert.equal(bad.status, 2);
    assert.match(bad.stderr, /--viewport/);
    const mixed = runCli([fixture('runtime-good.html'), '--viewport', '390x844', '--width', '1280']);
    assert.equal(mixed.status, 2);
    assert.match(mixed.stderr, /不能和 --width/);
  });
});

test('真实浏览器：--color-scheme 深浅两种配色下的主题残色 DC021', { timeout: STEP_TIMEOUT * 2 }, async (t) => {
  if (!findBrowser()) {
    t.skip(SKIP_REASON);
    return;
  }

  await t.test('theme-bad.html：浅色下报写死的浅灰字，深色下报白色孤岛、写死的深灰字与半透明黑字', async () => {
    const { runs } = await runAudits({
      target: fixture('theme-bad.html'), viewports: [{ width: 1280, height: 720 }], colorSchemes: ['light', 'dark'],
    });
    assert.deepEqual(runs.map((r) => r.report.context.colorScheme), ['light', 'dark']);
    const pick = (report) => report.findings.filter((f) => f.rule === 'DC021').map((f) => [f.selector, f.value.kind]);
    t.diagnostic(`light: ${JSON.stringify(pick(runs[0].report))} dark: ${JSON.stringify(pick(runs[1].report))}`);
    assert.deepEqual(pick(runs[0].report), [['#hard-light-text', 'text']]);
    assert.deepEqual(pick(runs[1].report), [['#legacy', 'surface'], ['#hard-dark-text', 'text'], ['#alpha-text', 'text']]);
    assert.equal(runs[1].report.findings.find((f) => f.selector === '#alpha-text').value.unchanged, 'color');
    for (const { report, htmlLengthBefore, htmlLengthAfter } of runs) {
      assert.equal(report.totalFindings, report.findings.length);
      assert.equal(htmlLengthAfter, htmlLengthBefore, '注入与执行不得改动 DOM');
    }
  });

  await t.test('theme-good.html：颜色走主题变量、品牌色按钮、带理由忽略的固定深色代码块都不告警', async () => {
    const { runs } = await runAudits({
      target: fixture('theme-good.html'), viewports: [{ width: 1280, height: 720 }], colorSchemes: ['light', 'dark'],
    });
    for (const { report } of runs) {
      assert.deepEqual(report.findings, [], `${report.context.colorScheme} 不应有告警：${JSON.stringify(report.findings, null, 2)}`);
    }
  });

  await t.test('CLI：--color-scheme light,dark 输出两份报告且有告警时退出码 1；非法取值退出码 2', () => {
    const result = runCli([fixture('theme-bad.html'), '--color-scheme', 'light,dark']);
    assert.equal(result.status, 1, `退出码应为 1，stderr：${result.stderr}`);
    const out = JSON.parse(result.stdout);
    assert.equal(out.schema, 'dense-audit-multi-v1');
    assert.deepEqual(out.reports.map((r) => [r.context.colorScheme, r.context.viewport.width]), [['light', 1280], ['dark', 1280]]);
    assert.equal(out.totalFindings, 4);
    const bad = runCli([fixture('theme-good.html'), '--color-scheme', 'sepia']);
    assert.equal(bad.status, 2);
    assert.match(bad.stderr, /--color-scheme/);
  });
});

test('真实浏览器：--scroll 滚到顶 / 底时被固定栏永久盖住的内容 DC022', { timeout: STEP_TIMEOUT * 2 }, async (t) => {
  if (!findBrowser()) {
    t.skip(SKIP_REASON);
    return;
  }

  await t.test('scroll-bad.html：顶部标题在滚到顶时、最后两行在滚到底时被盖住，首屏外面板的最后一行被粘底栏盖住；不开 --scroll 时不检查', async () => {
    const plain = (await runAudit({ target: fixture('scroll-bad.html') })).report;
    assert.equal(plain.findings.filter((f) => f.rule === 'DC022').length, 0);
    assert.equal(plain.context.scrollChecked, undefined);

    const { report, htmlLengthBefore, htmlLengthAfter } = await runAudit({ target: fixture('scroll-bad.html'), scroll: true });
    const hits = report.findings.filter((f) => f.rule === 'DC022');
    t.diagnostic(`scroll-bad：${JSON.stringify(hits.map((f) => [f.selector, f.value]))}`);
    assert.equal(report.context.scrollChecked, true);
    const by = (sel) => hits.find((f) => f.selector === sel);
    assert.deepEqual(by('#first-title').value, { at: 'top', coveredBy: 'html > body > header', scroller: 'document' });
    assert.deepEqual(by('#last-row').value, { at: 'bottom', coveredBy: 'html > body > footer', scroller: 'document' });
    assert.deepEqual(by('#pane-last').value, { at: 'bottom', coveredBy: '#pane-foot', scroller: '#pane' });
    assert.ok(hits.filter((f) => f.selector !== '#pane-last').every((f) => f.value.scroller === 'document'));
    assert.equal(report.totalFindings, report.findings.length);
    assert.equal(htmlLengthAfter, htmlLengthBefore, '滚动检查不得改动 DOM');
  });

  await t.test('scroll-good.html：留了内边距、内部吸顶表头、角落悬浮按钮都不告警', async () => {
    const { report } = await runAudit({ target: fixture('scroll-good.html'), scroll: true });
    assert.deepEqual(report.findings, [], JSON.stringify(report.findings, null, 2));
  });

  await t.test('CLI：--scroll 生效，有告警时退出码 1', () => {
    const result = runCli([fixture('scroll-bad.html'), '--scroll']);
    assert.equal(result.status, 1, `退出码应为 1，stderr：${result.stderr}`);
    const report = JSON.parse(result.stdout);
    assert.equal(report.schema, 'dense-audit-v1');
    assert.ok(report.findings.some((f) => f.rule === 'DC022' && f.selector === '#last-row'));
  });
});

test('真实浏览器：--steps 按步骤操作到目标状态再量取，期望没达成记 DC023', { timeout: STEP_TIMEOUT * 2 }, async (t) => {
  if (!findBrowser()) {
    t.skip(SKIP_REASON);
    return;
  }
  const readSteps = (name) => JSON.parse(fs.readFileSync(fixture(name), 'utf8'));
  const states = (runs) => runs.map((r) => [r.report.context.state, r.report.context.stepsDone]);

  await t.test('steps-ok.json：点击、输入、回车、选择、悬停都生效，在两个标记处各量一次；面板展开后才量到 11px 文字', async () => {
    const { runs } = await runAudits({
      target: fixture('steps-app.html'), viewports: [{ width: 1280, height: 720 }], steps: readSteps('steps-ok.json'),
    });
    assert.deepEqual(states(runs), [['面板展开', 2], ['全部完成', 10]]);
    for (const { report } of runs) {
      assert.ok(!report.findings.some((f) => f.rule === 'DC023'), JSON.stringify(report.findings));
      assert.ok(report.findings.some((f) => f.rule === 'DC001' && f.selector === '#panel > p:nth-of-type(2)'));
    }
    const before = (await runAudit({ target: fixture('steps-app.html') })).report;
    assert.ok(!before.findings.some((f) => f.rule === 'DC001'), '面板没展开时量不到 11px 文字');
  });

  await t.test('steps-fail.json：点了没反应的按钮，第 3 步期望落空记 DC023，在失败处量一次，后面的步骤不执行', async () => {
    const { runs } = await runAudits({
      target: fixture('steps-app.html'), viewports: [{ width: 1280, height: 720 }], steps: readSteps('steps-fail.json'),
    });
    assert.deepEqual(states(runs), [['初始', 0], ['第 3 步失败', 2]]);
    const dc023 = runs[1].report.findings.filter((f) => f.rule === 'DC023');
    assert.equal(dc023.length, 1);
    assert.equal(dc023[0].selector, '#panel');
    assert.deepEqual(dc023[0].value, {
      step: 3, action: { expect: '#panel', timeout: 500 }, expected: '#panel 可见', actual: '500ms 内可见 0 个（共 1 个）',
    });
    assert.equal(runs[1].report.totalFindings, runs[1].report.findings.length);
  });

  await t.test('没有 audit 步骤时在最后量一次；找不到元素记 DC023', async () => {
    const done = await runAudits({
      target: fixture('steps-app.html'), viewports: [{ width: 1280, height: 720 }], steps: [{ click: '#open' }],
    });
    assert.deepEqual(states(done.runs), [['步骤结束', 1]]);
    const missing = await runAudits({
      target: fixture('steps-app.html'), viewports: [{ width: 1280, height: 720 }], steps: [{ click: '#nope' }],
    });
    assert.deepEqual(states(missing.runs), [['第 1 步失败', 0]]);
    const f = missing.runs[0].report.findings.find((x) => x.rule === 'DC023');
    assert.equal(f.value.actual, '找不到元素');
  });

  await t.test('CLI：--steps 输出多状态报告；步骤文件格式不对时退出码 2', () => {
    const result = runCli([fixture('steps-app.html'), '--steps', fixture('steps-ok.json')]);
    assert.equal(result.status, 1, `有 DC001 时退出码应为 1，stderr：${result.stderr}`);
    const out = JSON.parse(result.stdout);
    assert.equal(out.schema, 'dense-audit-multi-v1');
    assert.deepEqual(out.reports.map((r) => r.context.state), ['面板展开', '全部完成']);

    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dense-steps-'));
    try {
      const bad = path.join(tmp, 'bad.json');
      fs.writeFileSync(bad, JSON.stringify([{ tap: '#open' }]));
      const invalid = runCli([fixture('steps-app.html'), '--steps', bad]);
      assert.equal(invalid.status, 2);
      assert.match(invalid.stderr, /第 1 步要恰好写一个动作/);
      const missingFile = runCli([fixture('steps-app.html'), '--steps', path.join(tmp, 'none.json')]);
      assert.equal(missingFile.status, 2);
      assert.match(missingFile.stderr, /读不了步骤文件/);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});

test('真实浏览器：--steps 跟得上整页跳转，选不了看不见或已禁用的下拉框', { timeout: STEP_TIMEOUT * 2 }, async (t) => {
  if (!findBrowser()) {
    t.skip(SKIP_REASON);
    return;
  }
  const run = (steps) => runAudits({ target: fixture('steps-app.html'), viewports: [{ width: 1280, height: 720 }], steps });
  const dc023 = (runs) => runs.flatMap((r) => r.report.findings.filter((f) => f.rule === 'DC023').map((f) => f.value.actual));

  await t.test('点链接跳到第二页后再 expect 与量取；400ms 后才跳转也能等到新页面', async () => {
    const now = await run([
      { click: '#next' }, { expect: '#next-title' }, { expect: '#loaded-later', text: '稍后加载的内容' }, { audit: '第二页' },
    ]);
    assert.deepEqual(now.runs.map((r) => r.report.context.state), ['第二页']);
    assert.deepEqual(dc023(now.runs), []);
    const late = await run([{ click: '#late-next' }, { expect: '#next-title' }, { audit: '晚跳转' }]);
    assert.deepEqual(late.runs.map((r) => r.report.context.state), ['晚跳转']);
    assert.deepEqual(dc023(late.runs), []);
  });

  await t.test('已禁用、隐藏的下拉框与禁用的选项都记 DC023', async () => {
    assert.deepEqual(dc023((await run([{ select: '#locked', value: '甲' }])).runs), ['下拉框已禁用']);
    assert.deepEqual(dc023((await run([{ select: '#hidden-select', value: '乙' }])).runs), ['元素不可见']);
    assert.deepEqual(dc023((await run([{ select: '#density', value: '禁用项' }])).runs), ['选项「禁用项」已禁用']);
  });
});

test('真实浏览器：--screenshot 每份报告量取前存一张当前视口的 PNG', { timeout: STEP_TIMEOUT * 2 }, async (t) => {
  if (!findBrowser()) {
    t.skip(SKIP_REASON);
    return;
  }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dense-shot-'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  // PNG 文件头之后是 IHDR，第 16–23 字节是宽和高。
  const pngSize = (file) => {
    const buf = fs.readFileSync(file);
    assert.equal(buf.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', `${file} 不是 PNG`);
    return [buf.readUInt32BE(16), buf.readUInt32BE(20)];
  };

  await t.test('多视口 × 步骤：每个状态一张，文件名按报告顺序带序号、视口与状态，尺寸等于视口', async () => {
    const dir = path.join(tmp, 'steps');
    const { runs } = await runAudits({
      target: fixture('steps-app.html'),
      viewports: [{ width: 1280, height: 720 }, { width: 390, height: 844 }],
      steps: JSON.parse(fs.readFileSync(fixture('steps-ok.json'), 'utf8')),
      screenshot: dir,
    });
    const names = ['01-1280x720-面板展开.png', '02-1280x720-全部完成.png', '03-390x844-面板展开.png', '04-390x844-全部完成.png'];
    assert.deepEqual(runs.map((r) => r.report.context.screenshot), names.map((n) => path.join(dir, n)));
    assert.deepEqual(fs.readdirSync(dir).sort(), [...names].sort());
    assert.deepEqual(pngSize(path.join(dir, names[0])), [1280, 720]);
    assert.deepEqual(pngSize(path.join(dir, names[2])), [390, 844]);
    assert.ok(!fs.readFileSync(path.join(dir, names[0])).equals(fs.readFileSync(path.join(dir, names[1]))), '两个状态的画面应当不同');
  });

  await t.test('配色：文件名带配色，深浅两张画面不同；不传 screenshot 时报告里没有截图路径', async () => {
    const dir = path.join(tmp, 'theme');
    const { runs } = await runAudits({
      target: fixture('theme-good.html'), viewports: [{ width: 390, height: 844 }], colorSchemes: ['light', 'dark'], screenshot: dir,
    });
    const [light, dark] = runs.map((r) => r.report.context.screenshot);
    assert.deepEqual([light, dark], [path.join(dir, '01-390x844-light.png'), path.join(dir, '02-390x844-dark.png')]);
    assert.ok(!fs.readFileSync(light).equals(fs.readFileSync(dark)), '深浅两种配色的画面应当不同');
    const plain = await runAudit({ target: fixture('clean.html') });
    assert.equal(plain.report.context.screenshot, undefined);
  });

  await t.test('CLI：只加 --screenshot 时仍输出单份报告；目录建不了或缺参数时退出码 2', () => {
    const dir = path.join(tmp, 'cli');
    const result = runCli([fixture('clean.html'), '--screenshot', dir]);
    assert.equal(result.status, 0, result.stderr);
    const report = JSON.parse(result.stdout);
    assert.equal(report.schema, 'dense-audit-v1');
    assert.equal(report.context.screenshot, path.join(dir, '01-1280x720.png'));
    assert.deepEqual(pngSize(report.context.screenshot), [1280, 720]);
    const notDir = runCli([fixture('clean.html'), '--screenshot', fixture('clean.html')]);
    assert.equal(notDir.status, 2);
    assert.match(notDir.stderr, /截图目录建不了/);
    const missing = runCli([fixture('clean.html'), '--screenshot']);
    assert.equal(missing.status, 2);
    assert.match(missing.stderr, /参数 --screenshot 缺少值/);
  });
});
