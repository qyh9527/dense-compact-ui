#!/usr/bin/env node
// 命令行入口：用本机 Chromium 内核浏览器打开页面，注入 dense-audit.js，把报告写到 stdout。
// Agent 不必把脚本全文读进上下文再粘贴注入。零依赖，Node >= 22（用全局 WebSocket 与 fetch）。
//
// 用法：
//   node scripts/run-audit.mjs <URL 或本地 html 路径> [--touch] [--root <选择器>]
//                              [--wait-for <选择器>] [--settle 500]
//                              [--width 1280 --height 720] [--out report.json]
//   多视口：用可重复的 --viewport 宽x高 代替 --width / --height，同一个浏览器里逐个视口重载并审计，
//   输出 { schema: 'dense-audit-multi-v1', totalFindings, reports: [每个视口一份 dense-audit-v1] }。
// --color-scheme light,dark：按系统深浅色偏好（prefers-color-scheme）各加载一次；给了两种时互相比较，
//   颜色写死没跟主题变的报 DC021，记在出问题的那种配色的报告里。输出同多视口格式。
// --wait-for：load 之后等该选择器存在且可见（上限 60 秒，超时按出错处理）。
// --settle：再等 DOM 连续这么多毫秒没有变化（默认 500，最多等 10 秒；0 跳过）。
// 退出码：0 没有告警；1 有告警；2 浏览器、导航或脚本出错（原因写到 stderr）。
//
// 也导出 runAudit / runAudits / findBrowser，供 tests/browser.test.mjs 复用同一套 CDP 逻辑。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import vm from 'node:vm';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT_PATH = path.join(here, 'dense-audit.js');

// 所有等待的上限。
const STEP_TIMEOUT = 60_000;
// 报告 findings 的条数上限，与 dense-audit.js 的默认值一致。
const MAX_FINDINGS = 200;
const COLOR_SCHEMES = ['light', 'dark'];
// 默认的 DOM 静默窗口，以及等静默的总上限。
const DEFAULT_SETTLE = 500;
const SETTLE_CAP = 10_000;

// 在页面里一次完成：先轮询 waitFor（存在且可见），再等 DOM 连续 settle 毫秒没有变化，
// 最后等 document.fonts.ready（最多 5 秒），字体加载失败才能在报告里看到（DC017）。
// 返回 { waitTimedOut, settled }；Observer 用完即 disconnect，不留 DOM 改动。
const READY_PROBE = `(async (sel, settle, waitTimeout, settleCap) => {
  // 与 dense-audit.js 同一口径：有尺寸，且 display / visibility / opacity 都没把它藏起来。
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    if (!(r.width > 0 && r.height > 0)) return false;
    if (typeof el.checkVisibility === 'function') {
      return el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true });
    }
    if (getComputedStyle(el).visibility !== 'visible') return false;
    for (let n = el; n; n = n.parentElement) {
      const cs = getComputedStyle(n);
      if (cs.display === 'none' || Number(cs.opacity) === 0) return false;
    }
    return true;
  };
  if (sel) {
    const t0 = performance.now();
    for (;;) {
      const el = document.querySelector(sel);
      if (el && visible(el)) break;
      if (performance.now() - t0 >= waitTimeout) return { waitTimedOut: true, settled: false };
      await new Promise((r) => setTimeout(r, 50));
    }
  }
  const fontsReady = () => document.fonts
    ? Promise.race([document.fonts.ready, new Promise((r) => setTimeout(r, 5000))])
    : null;
  if (!(settle > 0)) {
    await fontsReady();
    return { waitTimedOut: false, settled: false };
  }
  const settled = await new Promise((resolve) => {
    let quiet;
    let cap;
    const finish = (ok) => { obs.disconnect(); clearTimeout(quiet); clearTimeout(cap); resolve(ok); };
    const obs = new MutationObserver(() => {
      clearTimeout(quiet);
      quiet = setTimeout(() => finish(true), settle);
    });
    obs.observe(document, { subtree: true, childList: true, attributes: true, characterData: true });
    quiet = setTimeout(() => finish(true), settle);
    cap = setTimeout(() => finish(false), settleCap);
  });
  await fontsReady();
  return { waitTimedOut: false, settled };
})`;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// 所有等待都带上限：超时抛出带中文原因的错误，不无限挂起。
function withTimeout(promise, ms, reason) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`超时（${ms / 1000} 秒）：${reason}`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/** 按 CHROME_PATH、Edge、Chrome、Linux 路径的顺序找浏览器，找不到返回 null。 */
export function findBrowser() {
  const candidates = [
    process.env.CHROME_PATH,
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
  ];
  return candidates.find((p) => p && fs.existsSync(p)) || null;
}

// 启动浏览器并等 DevToolsActivePort 出现，返回调试端口。
async function launchBrowser(bin, userDataDir, width, height) {
  const args = [
    '--headless=new',
    '--remote-debugging-port=0',
    `--user-data-dir=${userDataDir}`,
    '--no-first-run',
    `--window-size=${width},${height}`,
  ];
  // CI 的 Linux 容器里常没有可用的沙箱，只在 CI 环境下关闭。
  if (process.env.CI && process.platform === 'linux') args.push('--no-sandbox');
  args.push('about:blank');

  const child = spawn(bin, args, {
    stdio: 'ignore',
    detached: process.platform !== 'win32',
    windowsHide: true,
  });
  let exited = null;
  child.on('exit', (code, signal) => { exited = { code, signal }; });
  child.on('error', (err) => { exited = { error: String(err) }; });

  const portFile = path.join(userDataDir, 'DevToolsActivePort');
  const deadline = Date.now() + STEP_TIMEOUT;
  while (Date.now() < deadline) {
    if (exited) {
      throw new Error(`浏览器启动后提前退出：${JSON.stringify(exited)}（${bin}）`);
    }
    if (fs.existsSync(portFile)) {
      const port = Number(fs.readFileSync(portFile, 'utf8').split(/\r?\n/)[0]);
      if (port > 0) return { child, port };
    }
    await sleep(100);
  }
  throw new Error(`超时（${STEP_TIMEOUT / 1000} 秒）：等待浏览器写出 DevToolsActivePort（${portFile}）`);
}

async function killBrowser(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const exitPromise = new Promise((resolve) => child.once('exit', resolve));
  try {
    if (process.platform === 'win32') {
      spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore', timeout: 30_000 });
    } else {
      try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); }
    }
  } catch {
    child.kill('SIGKILL');
  }
  // 用完要清掉计时器，否则 CLI 进程会多挂 10 秒才退出。
  let timer;
  await Promise.race([exitPromise, new Promise((resolve) => { timer = setTimeout(resolve, 10_000); })]);
  clearTimeout(timer);
}

async function removeDir(dir) {
  // Windows 下进程刚退出时目录可能还被占用，短暂重试。
  for (let attempt = 0; attempt < 15; attempt++) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
      return;
    } catch (err) {
      if (attempt === 14) throw err;
      await sleep(200);
    }
  }
}

// 最小 CDP 客户端：请求与事件等待都有 60 秒上限。
class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.nextId = 1;
    this.pending = new Map();
    this.waiters = new Map();
    ws.addEventListener('message', (event) => {
      const msg = JSON.parse(String(event.data));
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject, method } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(`CDP ${method} 失败：${msg.error.message}`));
        else resolve(msg.result);
      } else if (msg.method && this.waiters.has(msg.method)) {
        const list = this.waiters.get(msg.method);
        this.waiters.delete(msg.method);
        list.forEach((fn) => fn(msg.params));
      }
    });
  }

  static async connect(url) {
    const ws = new WebSocket(url);
    await withTimeout(new Promise((resolve, reject) => {
      ws.addEventListener('open', resolve, { once: true });
      ws.addEventListener('error', () => reject(new Error(`WebSocket 连接失败：${url}`)), { once: true });
    }), STEP_TIMEOUT, `连接 CDP WebSocket（${url}）`);
    return new Cdp(ws);
  }

  send(method, params = {}, timeoutMs = STEP_TIMEOUT) {
    const id = this.nextId++;
    const reply = new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, method });
    });
    this.ws.send(JSON.stringify({ id, method, params }));
    return withTimeout(reply, timeoutMs, `CDP 请求 ${method}`);
  }

  // 先调用拿到 promise，再触发会产生事件的动作，避免漏掉事件。
  // 返回的 promise 带 cancel()：取消后清掉计时器和等待者，promise 永远不再结算，
  // 不会留下未处理的 rejection，也不会让进程多挂到超时。
  waitEvent(method) {
    let timer;
    let cancel;
    const promise = new Promise((resolve, reject) => {
      const waiter = (params) => { clearTimeout(timer); resolve(params); };
      if (!this.waiters.has(method)) this.waiters.set(method, []);
      this.waiters.get(method).push(waiter);
      timer = setTimeout(() => {
        this.waiters.set(method, (this.waiters.get(method) || []).filter((fn) => fn !== waiter));
        reject(new Error(`超时（${STEP_TIMEOUT / 1000} 秒）：等待 CDP 事件 ${method}`));
      }, STEP_TIMEOUT);
      cancel = () => {
        clearTimeout(timer);
        this.waiters.set(method, (this.waiters.get(method) || []).filter((fn) => fn !== waiter));
      };
    });
    promise.cancel = cancel;
    return promise;
  }

  // awaitPromise 时表达式可返回 Promise，请求超时要自己给（默认 60 秒不够长等待用）。
  async evaluate(expression, { awaitPromise = false, timeoutMs = STEP_TIMEOUT } = {}) {
    const result = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise }, timeoutMs);
    if (result.exceptionDetails) {
      const detail = result.exceptionDetails.exception?.description || result.exceptionDetails.text;
      throw new Error(`页面内执行出错：${detail}`);
    }
    return result.result.value;
  }

  close() {
    try { this.ws.close(); } catch { /* 连接已断开 */ }
  }
}

async function getPageWebSocketUrl(port) {
  const deadline = Date.now() + STEP_TIMEOUT;
  while (Date.now() < deadline) {
    const response = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(10_000) });
    const targets = await response.json();
    const page = targets.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
    if (page) return page.webSocketDebuggerUrl;
    await sleep(200);
  }
  throw new Error(`超时（${STEP_TIMEOUT / 1000} 秒）：/json/list 里没有出现 page 目标`);
}

// 带协议头的当 URL，其余当本地路径转成 file:// URL。
function toUrl(target) {
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(target)) return target;
  const abs = path.resolve(target);
  if (!fs.existsSync(abs)) throw new Error(`本地文件不存在：${abs}`);
  return pathToFileURL(abs).href;
}

/**
 * 打开页面、注入 dense-audit.js 并执行，返回 { report, htmlLengthBefore, htmlLengthAfter }。
 * 视口用 Emulation.setDeviceMetricsOverride 设成精确的 width×height。
 * load 之后先等 waitFor（选择器存在且可见，上限 waitTimeoutMs，默认 60 秒，超时抛错），
 * 再等 DOM 连续 settle 毫秒（默认 500，0 跳过，最多等 10 秒）没有变化；结果写进 report.context.ready。
 * waitTimeoutMs 只给测试缩短超时用，命令行不暴露。
 * 失败抛出中文错误；无论成败都会杀掉浏览器进程并删除临时目录。
 */
export async function runAudit({ width = 1280, height = 720, ...opts } = {}) {
  const { runs } = await runAudits({ ...opts, viewports: [{ width, height }] });
  return runs[0];
}

// 把页面外算出的发现并入报告：排在已有发现之后，超出上限时截断并更新计数。
function addFindings(report, list) {
  if (!list.length) return;
  const room = Math.max(0, MAX_FINDINGS - report.findings.length);
  report.findings.push(...list.slice(0, room));
  report.totalFindings += list.length;
  report.truncated = report.truncated || list.length > room;
}

// dense-audit.js 顶层只定义函数，在 Node 的 vm 里加载后取纯函数 themeDiff 用。
function loadThemeDiff(source) {
  const sandbox = {};
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox);
  return (a, b, ctx) => JSON.parse(JSON.stringify(sandbox.denseAuditThemeDiff(a, b, ctx)));
}

/**
 * 同一个浏览器里按 viewports 顺序逐个视口审计：每个视口先切尺寸，再重新加载页面并等就绪，
 * 量到的是在该尺寸下首次布局的结果。返回 { runs: [{ report, htmlLengthBefore, htmlLengthAfter }] }。
 * colorSchemes（如 ['light', 'dark']）：每个视口按每种 prefers-color-scheme 各加载一次，runs 按视口、配色顺序排列；
 * 给了两种以上时两两比较颜色快照，DC021 记在出问题的那种配色的报告里。
 * 其余参数与 runAudit 相同。
 */
export async function runAudits({
  target, touch = false, root, viewports, colorSchemes,
  waitFor, settle = DEFAULT_SETTLE, waitTimeoutMs = STEP_TIMEOUT,
} = {}) {
  if (!target) throw new Error('缺少要检查的页面：请给 URL 或本地 html 路径');
  if (!Array.isArray(viewports) || !viewports.length) throw new Error('缺少视口：viewports 至少要有一项');
  const bin = findBrowser();
  if (!bin) throw new Error('未找到 Chromium 内核浏览器：请安装 Edge 或 Chrome，或用 CHROME_PATH 指定可执行文件');
  const url = toUrl(target);
  const scriptSource = fs.readFileSync(SCRIPT_PATH, 'utf8');
  const schemes = colorSchemes && colorSchemes.length ? colorSchemes : [null];
  const themeDiff = schemes.length > 1 ? loadThemeDiff(scriptSource) : null;
  const windowWidth = Math.max(...viewports.map((v) => v.width));
  const windowHeight = Math.max(...viewports.map((v) => v.height));

  const userDataDirs = [];
  let child = null;
  let cdp = null;
  try {
    // 调试端口是随机的，偶尔会落在 Node fetch 拒绝访问的「坏端口」上（报 bad port）：
    // 换一个全新的浏览器实例重试，最多 5 次。
    let wsUrl;
    for (let attempt = 1; ; attempt++) {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dense-audit-'));
      userDataDirs.push(dir);
      const launched = await launchBrowser(bin, dir, windowWidth, windowHeight);
      child = launched.child;
      try {
        wsUrl = await getPageWebSocketUrl(launched.port);
        break;
      } catch (err) {
        const badPort = /bad port/.test(String(err?.cause?.message || err?.message));
        if (!badPort || attempt >= 5) throw err;
        await killBrowser(child);
        child = null;
      }
    }
    cdp = await Cdp.connect(wsUrl);
    await cdp.send('Page.enable');

    const runs = [];
    let loads = 0;
    for (const { width, height } of viewports) {
      await cdp.send('Emulation.setDeviceMetricsOverride', {
        width, height, deviceScaleFactor: 1, mobile: false,
      });

      const group = [];
      for (const scheme of schemes) {
        if (scheme) {
          await cdp.send('Emulation.setEmulatedMedia', {
            features: [{ name: 'prefers-color-scheme', value: scheme }],
          });
        }

        // 第一次导航过去；之后重新加载，避免同一 URL 带 # 时变成不触发 load 的页内跳转。
        const loaded = cdp.waitEvent('Page.loadEventFired');
        let nav;
        try {
          nav = loads++ === 0
            ? await cdp.send('Page.navigate', { url })
            : await cdp.send('Page.reload', {});
        } catch (err) {
          loaded.cancel();
          throw err;
        }
        if (nav?.errorText) {
          // 导航已失败，load 事件不会再来：取消等待，立即以错误结束。
          loaded.cancel();
          throw new Error(`导航失败：${nav.errorText}（${url}）`);
        }
        await loaded;

        // load 之后 SPA 可能还在异步渲染：先等 waitFor，再等 DOM 静默，审计的才是渲染完的页面。
        const readyStart = Date.now();
        const probeArgs = [waitFor || null, settle, waitTimeoutMs, SETTLE_CAP].map((v) => JSON.stringify(v)).join(', ');
        const probe = await cdp.evaluate(`${READY_PROBE}(${probeArgs})`, {
          awaitPromise: true,
          timeoutMs: waitTimeoutMs + SETTLE_CAP + 15_000,
        });
        if (probe.waitTimedOut) {
          throw new Error(`超时（${waitTimeoutMs / 1000} 秒）：等待选择器 ${waitFor} 出现并可见（--wait-for）。请确认选择器正确，且页面确实会渲染出该元素`);
        }
        const ready = { waitFor: waitFor || null, settled: probe.settled, waitedMs: Date.now() - readyStart };

        const htmlLengthBefore = await cdp.evaluate('document.documentElement.outerHTML.length');
        await cdp.evaluate(scriptSource);
        const options = { touch: touch ? true : undefined, root: root || undefined };
        const json = await cdp.evaluate(`JSON.stringify(denseAudit(${JSON.stringify(options)}))`);
        const htmlLengthAfter = await cdp.evaluate('document.documentElement.outerHTML.length');
        const report = JSON.parse(json);
        report.context.ready = ready;
        if (scheme) report.context.colorScheme = scheme;
        const run = { report, htmlLengthBefore, htmlLengthAfter };
        if (themeDiff) {
          const colorOptions = JSON.stringify({ root: root || undefined });
          run.colors = JSON.parse(await cdp.evaluate(`JSON.stringify(denseAuditColors(${colorOptions}))`));
        }
        group.push(run);
      }

      // 同一视口下两两比较配色方案：b 相对 a 出现的问题记在 b 的报告里。
      if (themeDiff) {
        for (const [j, run] of group.entries()) {
          for (const [i, base] of group.entries()) {
            if (i !== j) addFindings(run.report, themeDiff(base.colors, run.colors, { scheme: schemes[j] }));
          }
        }
      }
      for (const run of group) {
        delete run.colors;
        runs.push(run);
      }
    }
    return { runs };
  } finally {
    if (cdp) cdp.close();
    await killBrowser(child);
    for (const dir of userDataDirs) await removeDir(dir);
  }
}

function parseViewport(value) {
  const m = /^(\d+)x(\d+)$/i.exec(value);
  const width = m && Number(m[1]);
  const height = m && Number(m[2]);
  if (!(width > 0 && height > 0)) throw new Error(`参数 --viewport 需要 宽x高 的正整数，如 390x844，实际：${value}`);
  return { width, height };
}

function parseArgs(argv) {
  const opts = { touch: false };
  const rest = [];
  const viewports = [];
  const schemes = [];
  const needValue = (name, i) => {
    if (i + 1 >= argv.length) throw new Error(`参数 ${name} 缺少值`);
    return argv[i + 1];
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--touch') opts.touch = true;
    else if (a === '--root') opts.root = needValue(a, i++);
    else if (a === '--out') opts.out = needValue(a, i++);
    else if (a === '--wait-for') opts.waitFor = needValue(a, i++);
    else if (a === '--viewport') viewports.push(parseViewport(needValue(a, i++)));
    else if (a === '--color-scheme') {
      for (const v of needValue(a, i++).split(',').map((x) => x.trim()).filter(Boolean)) {
        if (!COLOR_SCHEMES.includes(v)) throw new Error(`参数 --color-scheme 只接受 light、dark，实际：${v}`);
        if (!schemes.includes(v)) schemes.push(v);
      }
    }
    else if (a === '--settle') {
      const n = Number(needValue(a, i++));
      if (!Number.isInteger(n) || n < 0) throw new Error(`参数 ${a} 需要非负整数（毫秒，0 表示跳过静默等待）`);
      opts.settle = n;
    } else if (a === '--width' || a === '--height') {
      const n = Number(needValue(a, i++));
      if (!Number.isInteger(n) || n <= 0) throw new Error(`参数 ${a} 需要正整数`);
      opts[a.slice(2)] = n;
    } else if (a.startsWith('--')) throw new Error(`未知参数：${a}`);
    else rest.push(a);
  }
  if (rest.length !== 1) throw new Error('用法：node scripts/run-audit.mjs <URL 或本地 html 路径> [--touch] [--root <选择器>] [--wait-for <选择器>] [--settle 500] [--width 1280 --height 720 | --viewport 1280x720 --viewport 390x844 …] [--color-scheme light,dark] [--out report.json]');
  if (viewports.length && (opts.width || opts.height)) throw new Error('--viewport 不能和 --width / --height 同时使用');
  if (viewports.length) opts.viewports = viewports;
  if (schemes.length) opts.colorSchemes = schemes;
  opts.target = rest[0];
  return opts;
}

async function main() {
  try {
    const { out, ...opts } = parseArgs(process.argv.slice(2));
    // 传了 --viewport 或 --color-scheme 就输出多份报告：每个视口、每种配色一份 dense-audit-v1；都不传时输出与以前完全相同。
    let result;
    let total;
    if (opts.viewports || opts.colorSchemes) {
      const { width = 1280, height = 720, ...rest } = opts;
      const { runs } = await runAudits({ ...rest, viewports: opts.viewports || [{ width, height }] });
      const reports = runs.map((r) => r.report);
      total = reports.reduce((sum, r) => sum + r.totalFindings, 0);
      result = { schema: 'dense-audit-multi-v1', totalFindings: total, reports };
    } else {
      result = (await runAudit(opts)).report;
      total = result.totalFindings;
    }
    const text = JSON.stringify(result, null, 2) + '\n';
    if (out) fs.writeFileSync(out, text);
    else process.stdout.write(text);
    process.exitCode = total > 0 ? 1 : 0;
  } catch (err) {
    process.stderr.write(`dense-audit 出错：${err.message}\n`);
    process.exitCode = 2;
  }
}

// 技能常经软链接或目录链接安装：import.meta.url 是解析后的真实路径，argv[1] 是链接路径，比较前都取 realpath。
function isEntryPoint() {
  if (!process.argv[1]) return false;
  try {
    return fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isEntryPoint()) {
  await main();
}
