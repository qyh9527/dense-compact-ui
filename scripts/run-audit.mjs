#!/usr/bin/env node
// 命令行入口：用本机 Chromium 内核浏览器打开页面，注入 dense-audit.js，把报告写到 stdout。
// Agent 不必把脚本全文读进上下文再粘贴注入。零依赖，Node >= 22（用全局 WebSocket 与 fetch）。
//
// 用法：
//   node scripts/run-audit.mjs <URL 或本地 html 路径> [--touch] [--root <选择器>]
//                              [--width 1280 --height 720] [--out report.json]
// 退出码：0 没有告警；1 有告警；2 浏览器、导航或脚本出错（原因写到 stderr）。
//
// 也导出 runAudit / findBrowser，供 tests/browser.test.mjs 复用同一套 CDP 逻辑。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT_PATH = path.join(here, 'dense-audit.js');

// 所有等待的上限。
const STEP_TIMEOUT = 60_000;

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

  send(method, params = {}) {
    const id = this.nextId++;
    const reply = new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, method });
    });
    this.ws.send(JSON.stringify({ id, method, params }));
    return withTimeout(reply, STEP_TIMEOUT, `CDP 请求 ${method}`);
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

  async evaluate(expression) {
    const result = await this.send('Runtime.evaluate', { expression, returnByValue: true });
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
 * 失败抛出中文错误；无论成败都会杀掉浏览器进程并删除临时目录。
 */
export async function runAudit({ target, touch = false, root, width = 1280, height = 720 } = {}) {
  if (!target) throw new Error('缺少要检查的页面：请给 URL 或本地 html 路径');
  const bin = findBrowser();
  if (!bin) throw new Error('未找到 Chromium 内核浏览器：请安装 Edge 或 Chrome，或用 CHROME_PATH 指定可执行文件');
  const url = toUrl(target);
  const scriptSource = fs.readFileSync(SCRIPT_PATH, 'utf8');

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
      const launched = await launchBrowser(bin, dir, width, height);
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
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width, height, deviceScaleFactor: 1, mobile: false,
    });

    const loaded = cdp.waitEvent('Page.loadEventFired');
    let nav;
    try {
      nav = await cdp.send('Page.navigate', { url });
    } catch (err) {
      loaded.cancel();
      throw err;
    }
    if (nav.errorText) {
      // 导航已失败，load 事件不会再来：取消等待，立即以错误结束。
      loaded.cancel();
      throw new Error(`导航失败：${nav.errorText}（${url}）`);
    }
    await loaded;

    const htmlLengthBefore = await cdp.evaluate('document.documentElement.outerHTML.length');
    await cdp.evaluate(scriptSource);
    const options = { touch: touch ? true : undefined, root: root || undefined };
    const json = await cdp.evaluate(`JSON.stringify(denseAudit(${JSON.stringify(options)}))`);
    const htmlLengthAfter = await cdp.evaluate('document.documentElement.outerHTML.length');
    return { report: JSON.parse(json), htmlLengthBefore, htmlLengthAfter };
  } finally {
    if (cdp) cdp.close();
    await killBrowser(child);
    for (const dir of userDataDirs) await removeDir(dir);
  }
}

function parseArgs(argv) {
  const opts = { touch: false };
  const rest = [];
  const needValue = (name, i) => {
    if (i + 1 >= argv.length) throw new Error(`参数 ${name} 缺少值`);
    return argv[i + 1];
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--touch') opts.touch = true;
    else if (a === '--root') opts.root = needValue(a, i++);
    else if (a === '--out') opts.out = needValue(a, i++);
    else if (a === '--width' || a === '--height') {
      const n = Number(needValue(a, i++));
      if (!Number.isInteger(n) || n <= 0) throw new Error(`参数 ${a} 需要正整数`);
      opts[a.slice(2)] = n;
    } else if (a.startsWith('--')) throw new Error(`未知参数：${a}`);
    else rest.push(a);
  }
  if (rest.length !== 1) throw new Error('用法：node scripts/run-audit.mjs <URL 或本地 html 路径> [--touch] [--root <选择器>] [--width 1280 --height 720] [--out report.json]');
  opts.target = rest[0];
  return opts;
}

async function main() {
  try {
    const { out, ...opts } = parseArgs(process.argv.slice(2));
    const { report } = await runAudit(opts);
    const text = JSON.stringify(report, null, 2) + '\n';
    if (out) fs.writeFileSync(out, text);
    else process.stdout.write(text);
    process.exitCode = report.totalFindings > 0 ? 1 : 0;
  } catch (err) {
    process.stderr.write(`dense-audit 出错：${err.message}\n`);
    process.exitCode = 2;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
