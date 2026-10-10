// run-audit.mjs 里不用浏览器的纯函数：步骤格式校验、发现合并、截图文件名、浏览器查找。
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  addFindings, browserCandidates, browserMissingMessage, checkSteps, findBrowser, parseAttach, runAudit, screenshotName,
} from '../scripts/run-audit.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));

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

const MAC_CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const MAC_EDGE = '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge';

test('browserCandidates：CHROME_PATH 在前，再按平台列常见安装路径', () => {
  const mac = browserCandidates({ env: {}, platform: 'darwin', home: '/Users/a' });
  assert.deepEqual(mac, [
    MAC_CHROME, MAC_EDGE,
    '/Users/a/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Users/a/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  ]);
  assert.equal(browserCandidates({ env: { CHROME_PATH: '/x/chrome' }, platform: 'darwin', home: '/Users/a' })[0], '/x/chrome');
  assert.deepEqual(browserCandidates({ env: {}, platform: 'win32' }), [
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  ]);
  assert.deepEqual(browserCandidates({ env: {}, platform: 'linux' }), ['/usr/bin/google-chrome', '/usr/bin/chromium']);
});

test('findBrowser：按顺序返回第一个存在的路径；CHROME_PATH 不存在时往后找；都不在返回 null', () => {
  const only = (...paths) => (p) => paths.includes(p);
  const mac = { env: {}, platform: 'darwin', home: '/Users/a' };
  assert.equal(findBrowser({ ...mac, exists: only(MAC_EDGE) }), MAC_EDGE);
  assert.equal(findBrowser({ ...mac, exists: only(MAC_CHROME, MAC_EDGE) }), MAC_CHROME);
  assert.equal(findBrowser({ ...mac, env: { CHROME_PATH: '/x/chrome' }, exists: only('/x/chrome', MAC_CHROME) }), '/x/chrome');
  assert.equal(findBrowser({ ...mac, env: { CHROME_PATH: '/x/chrome' }, exists: only(MAC_EDGE) }), MAC_EDGE);
  assert.equal(findBrowser({ ...mac, exists: () => false }), null);
});

test('browserMissingMessage：写明没执行量取、查过的路径、按平台的 CHROME_PATH 示例，指出无效的 CHROME_PATH', () => {
  const mac = browserMissingMessage({ env: {}, platform: 'darwin', home: '/Users/a' });
  assert.match(mac, /没有执行任何量取/);
  assert.ok(mac.includes(MAC_EDGE));
  assert.match(mac, /export CHROME_PATH="\/Applications\/Google Chrome\.app/);
  assert.doesNotMatch(mac, /指向的文件不存在/);
  const win = browserMissingMessage({ env: { CHROME_PATH: 'D:\\no\\chrome.exe' }, platform: 'win32' });
  assert.match(win, /CHROME_PATH 指向的文件不存在：D:\\no\\chrome\.exe/);
  assert.match(win, /\$env:CHROME_PATH = /);
});

test('CLI：找不到浏览器时退出码 2，stderr 写原因与恢复办法，stdout 不输出报告', () => {
  // 子进程里让所有候选路径都「不存在」，模拟没装浏览器的机器。
  const bogus = path.join(here, 'no-such-browser');
  const hidden = browserCandidates({ env: { CHROME_PATH: bogus } });
  const hook = `import fs from 'node:fs'; const hidden = new Set(${JSON.stringify(hidden)}); const real = fs.existsSync; fs.existsSync = (p) => !hidden.has(String(p)) && real(p);`;
  const r = spawnSync(process.execPath, [
    '--import', `data:text/javascript,${encodeURIComponent(hook)}`,
    path.join(here, '..', 'scripts', 'run-audit.mjs'), path.join(here, 'fixtures', 'clean.html'),
  ], { encoding: 'utf8', env: { ...process.env, CHROME_PATH: bogus }, timeout: 60_000 });
  assert.equal(r.status, 2, r.stderr);
  assert.equal(r.stdout, '');
  assert.match(r.stderr, /未找到 Chromium 内核浏览器/);
  assert.match(r.stderr, /CHROME_PATH 指向的文件不存在/);
  assert.match(r.stderr, /CHROME_PATH 设为浏览器可执行文件的完整路径/);
});

test('parseAttach：端口、host:端口、http 地址都规范成 http://host:端口，非本机地址或格式不对时报错', () => {
  assert.equal(parseAttach('9222'), 'http://127.0.0.1:9222');
  assert.equal(parseAttach('localhost:9333'), 'http://localhost:9333');
  assert.equal(parseAttach('http://127.0.0.1:9222/'), 'http://127.0.0.1:9222');
  assert.equal(parseAttach('http://[::1]:9222'), 'http://[::1]:9222');
  assert.throws(() => parseAttach('http://192.168.1.2:9222'), /只接入本机的调试端口/);
  assert.throws(() => parseAttach('example.com:9222'), /只接入本机的调试端口/);
  for (const bad of ['', 'abc', 'http://127.0.0.1', 'ws://127.0.0.1:9222', 'http://127.0.0.1:9222/json/list',
    '0', 'http://127.0.0.1:0', 'http://127.0.0.1:9222?x=1', 'http://127.0.0.1:9222#a', 'http://user@127.0.0.1:9222', 'http://u:p@127.0.0.1:9222']) {
    assert.throws(() => parseAttach(bad), /--attach 需要调试端口/, bad);
  }
});

test('--attach 连上的端口不是 CDP 时如实说明，不误报成「连不上」；调试连接地址不在该端口上时拒绝接入', async (t) => {
  // 一个本机 HTTP 服务按路径前缀模拟各种「不是调试端口」的回应。
  let mode = 'html';
  const srv = http.createServer((req, res) => {
    if (mode === 'html') res.writeHead(200, { 'content-type': 'text/html' }).end('<!doctype html><title>dev</title>');
    else if (mode === '404') res.writeHead(404, { 'content-type': 'application/json' }).end('{"error":"not found"}');
    else if (mode === 'object') res.writeHead(200, { 'content-type': 'application/json' }).end('{"targets":[]}');
    else if (mode === 'redirect') res.writeHead(302, { location: 'http://example.com/json/list' }).end();
    else res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify([
      { type: 'page', url: 'http://app/', title: 'app', webSocketDebuggerUrl: 'ws://203.0.113.9:9222/devtools/page/1' },
    ]));
  });
  await new Promise((resolve) => srv.listen(0, '127.0.0.1', resolve));
  t.after(() => srv.close());
  const attach = String(srv.address().port);
  const cases = [
    ['html', /不像是 Chromium 远程调试端口（\/json\/list：.*JSON/],
    ['404', /不像是 Chromium 远程调试端口（\/json\/list：HTTP 404）/],
    ['object', /不像是 Chromium 远程调试端口（\/json\/list：返回的不是目标列表）/],
    ['redirect', /不像是 Chromium 远程调试端口（\/json\/list：返回了重定向）/],
    ['foreign-ws', /调试连接地址 ws:\/\/203\.0\.113\.9:9222\/devtools\/page\/1 不在 http:\/\/127\.0\.0\.1:\d+ 上，拒绝接入/],
  ];
  for (const [m, reason] of cases) {
    mode = m;
    await assert.rejects(runAudit({ attach }), reason, m);
  }
});
