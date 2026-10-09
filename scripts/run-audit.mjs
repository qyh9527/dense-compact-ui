#!/usr/bin/env node
// 命令行入口：用本机 Chromium 内核浏览器打开页面，注入 dense-audit.js，把报告写到 stdout。
// Agent 不必把脚本全文读进上下文再粘贴注入。零依赖，Node >= 22（用全局 WebSocket 与 fetch）。
//
// 用法：
//   node scripts/run-audit.mjs <URL 或本地 html 路径> [--touch] [--root <选择器>]
//                              [--wait-for <选择器>] [--settle 500]
//                              [--width 1280 --height 720] [--screenshot <目录>] [--out report.json]
//   多视口：用可重复的 --viewport 宽x高 代替 --width / --height，同一个浏览器里逐个视口重载并审计，
//   输出 { schema: 'dense-audit-multi-v1', totalFindings, reports: [每个视口一份 dense-audit-v1] }。
// --steps steps.json：加载后按步骤文件依次 click / fill / press / hover / select / wait / expect，
//   在 { "audit": "状态名" } 处量取（没写就在最后量一次）；某一步做不了或期望没达成记 DC023 并停下，
//   在失败处再量一次。输出同多视口格式，context.state 标明状态。
// --scroll：量取后把文档和主要滚动容器各滚到顶、滚到底，内容被固定栏永久盖住的报 DC022，最后恢复滚动位置。
// --screenshot <目录>：每份报告量取前截一张当前视口的 PNG 存进该目录，文件名带序号、视口、配色、状态，路径写在 context.screenshot。
// --color-scheme light,dark：按系统深浅色偏好（prefers-color-scheme）各加载一次；给了两种时互相比较，
//   颜色写死没跟主题变的报 DC021，记在出问题的那种配色的报告里。输出同多视口格式。
// --wait-for：load 之后等该选择器存在且可见（上限 60 秒，超时按出错处理）。
// --settle：再等 DOM 连续这么多毫秒没有变化（默认 500，最多等 10 秒；0 跳过）。
// 退出码：0 没有告警；1 有告警；2 浏览器、导航或脚本出错（原因写到 stderr）。
//
// 也导出 runAudit / runAudits / checkSteps / screenshotName / findBrowser / browserCandidates / browserMissingMessage，
// 供测试复用同一套 CDP 逻辑与浏览器查找。
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

/** 要查找的浏览器路径：CHROME_PATH 在前，再按平台列 Edge / Chrome 的常见安装位置。 */
export function browserCandidates({ env = process.env, platform = process.platform, home = os.homedir() } = {}) {
  const byPlatform = {
    win32: [
      'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    ],
    darwin: [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
      `${home}/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`,
      `${home}/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge`,
    ],
  };
  const fallback = ['/usr/bin/google-chrome', '/usr/bin/chromium'];
  return [env.CHROME_PATH, ...(byPlatform[platform] || fallback)].filter(Boolean);
}

/** 按 browserCandidates 的顺序找第一个存在的浏览器，找不到返回 null。 */
export function findBrowser({ exists = fs.existsSync, ...opts } = {}) {
  return browserCandidates(opts).find((p) => exists(p)) || null;
}

/** 找不到浏览器时的中文原因：列出查过的路径，并给出设置 CHROME_PATH 的办法。 */
export function browserMissingMessage({ env = process.env, platform = process.platform, ...opts } = {}) {
  const checked = browserCandidates({ env, platform, ...opts });
  const example = {
    win32: '$env:CHROME_PATH = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"',
    darwin: 'export CHROME_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"',
  }[platform] || 'export CHROME_PATH=/usr/bin/chromium';
  return [
    '未找到 Chromium 内核浏览器（Chrome / Edge / Chromium），没有执行任何量取。',
    env.CHROME_PATH ? `CHROME_PATH 指向的文件不存在：${env.CHROME_PATH}` : null,
    `已查找：${checked.join('；')}`,
    `请安装 Chrome 或 Edge，或把 CHROME_PATH 设为浏览器可执行文件的完整路径，例如：${example}`,
  ].filter(Boolean).join('\n');
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
    this.listeners = new Map();
    ws.addEventListener('message', (event) => {
      const msg = JSON.parse(String(event.data));
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject, method } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(`CDP ${method} 失败：${msg.error.message}`));
        else resolve(msg.result);
        return;
      }
      if (!msg.method) return;
      (this.listeners.get(msg.method) || []).forEach((fn) => fn(msg.params));
      if (this.waiters.has(msg.method)) {
        const list = this.waiters.get(msg.method);
        this.waiters.delete(msg.method);
        list.forEach((fn) => fn(msg.params));
      }
    });
  }

  // 持续监听某个事件，不影响 waitEvent；返回取消监听的函数。
  on(method, fn) {
    if (!this.listeners.has(method)) this.listeners.set(method, []);
    this.listeners.get(method).push(fn);
    return () => this.listeners.set(method, (this.listeners.get(method) || []).filter((f) => f !== fn));
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
 * screenshot 给目录时，每份报告量取前截一张当前视口的 PNG 存进去，路径写进 report.context.screenshot。
 * waitTimeoutMs 只给测试缩短超时用，命令行不暴露。
 * 失败抛出中文错误；无论成败都会杀掉浏览器进程并删除临时目录。
 */
export async function runAudit({ width = 1280, height = 720, ...opts } = {}) {
  const { runs } = await runAudits({ ...opts, viewports: [{ width, height }] });
  return runs[0];
}

// ---- 交互步骤（--steps） ----

const STEP_ACTIONS = ['click', 'fill', 'press', 'hover', 'select', 'wait', 'expect', 'audit'];
// 步骤里 wait / expect 的默认等待上限与允许的最大值（毫秒）。
const STEP_WAIT = 5000;
const STEP_WAIT_CAP = 60_000;
// 常用按键：[windowsVirtualKeyCode, code, 产生的文字]。
const KEYS = {
  Enter: [13, 'Enter', '\r'],
  Tab: [9, 'Tab'],
  Escape: [27, 'Escape'],
  Backspace: [8, 'Backspace'],
  Delete: [46, 'Delete'],
  ArrowUp: [38, 'ArrowUp'],
  ArrowDown: [40, 'ArrowDown'],
  ArrowLeft: [37, 'ArrowLeft'],
  ArrowRight: [39, 'ArrowRight'],
  Home: [36, 'Home'],
  End: [35, 'End'],
  PageUp: [33, 'PageUp'],
  PageDown: [34, 'PageDown'],
  Space: [32, 'Space', ' '],
};

/** 检查步骤数组的格式，不对时抛出指明第几步的中文错误。 */
export function checkSteps(steps) {
  if (!Array.isArray(steps) || !steps.length) throw new Error('步骤文件要是非空的 JSON 数组');
  steps.forEach((step, i) => {
    const at = `第 ${i + 1} 步`;
    if (!step || typeof step !== 'object' || Array.isArray(step)) throw new Error(`${at}要是对象`);
    const actions = Object.keys(step).filter((k) => STEP_ACTIONS.includes(k));
    if (actions.length !== 1) throw new Error(`${at}要恰好写一个动作（${STEP_ACTIONS.join(' / ')}），实际：${actions.join('、') || '没有'}`);
    const action = actions[0];
    if (typeof step[action] !== 'string' || !step[action].trim()) throw new Error(`${at}的 ${action} 要是非空字符串`);
    if ((action === 'fill' || action === 'select') && typeof step.value !== 'string') throw new Error(`${at}的 ${action} 要有字符串 value`);
    if (action === 'press' && !KEYS[step.press] && [...step.press].length !== 1) {
      throw new Error(`${at}的 press 只支持单个字符或 ${Object.keys(KEYS).join(' / ')}`);
    }
    if (step.timeout !== undefined && !(Number.isInteger(step.timeout) && step.timeout > 0 && step.timeout <= STEP_WAIT_CAP)) {
      throw new Error(`${at}的 timeout 要是 1–${STEP_WAIT_CAP} 的整数（毫秒）`);
    }
    if (step.count !== undefined && !(Number.isInteger(step.count) && step.count >= 0)) throw new Error(`${at}的 count 要是非负整数`);
    if (step.text !== undefined && typeof step.text !== 'string') throw new Error(`${at}的 text 要是字符串`);
    if (step.visible !== undefined && typeof step.visible !== 'boolean') throw new Error(`${at}的 visible 要是 true 或 false`);
  });
  return steps;
}

// 页面里的可见判断，与 dense-audit.js 同一口径。
const VISIBLE_FN = `(el) => {
  const r = el.getBoundingClientRect();
  if (!(r.width > 0 && r.height > 0)) return false;
  return typeof el.checkVisibility === 'function'
    ? el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })
    : getComputedStyle(el).visibility === 'visible';
}`;

// 找到元素、滚进视口，返回中心点与矩形；focus 为真时聚焦并选中已有内容（给 fill 用）。
const TARGET_PROBE = `((sel, focus) => {
  const visible = ${VISIBLE_FN};
  const el = document.querySelector(sel);
  if (!el) return { found: false };
  el.scrollIntoView({ block: 'center', inline: 'center' });
  const r = el.getBoundingClientRect();
  const out = {
    found: true, visible: visible(el),
    x: r.left + r.width / 2, y: r.top + r.height / 2,
    rect: { x: Math.round(r.x * 10) / 10, y: Math.round(r.y * 10) / 10, width: Math.round(r.width * 10) / 10, height: Math.round(r.height * 10) / 10 },
  };
  if (focus) {
    el.focus();
    if (typeof el.select === 'function') el.select();
    else if (el.isContentEditable) {
      const range = document.createRange();
      range.selectNodeContents(el);
      const selection = getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
    }
    out.focused = document.activeElement === el;
  }
  return out;
})`;

// 选中下拉框里 value 或文字等于给定值的选项，派发 input / change。
const SELECT_PROBE = `((sel, value) => {
  const el = document.querySelector(sel);
  if (!el) return { ok: false, actual: '找不到元素' };
  if (el.localName !== 'select') return { ok: false, actual: '目标不是 select 元素' };
  if (el.matches(':disabled')) return { ok: false, actual: '下拉框已禁用' };
  const opt = Array.from(el.options).find((o) => o.value === value || o.text.trim() === value);
  if (!opt) return { ok: false, actual: '没有值或文字为「' + value + '」的选项' };
  if (opt.disabled || (opt.parentElement && opt.parentElement.localName === 'optgroup' && opt.parentElement.disabled)) {
    return { ok: false, actual: '选项「' + value + '」已禁用' };
  }
  el.value = opt.value;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  return { ok: true };
})`;

// 在 timeout 内轮询选择器：返回总数、可见数、可见元素里是否含有 text。不带回页面文字。
const MATCH_PROBE = `(async (sel, text, want, timeout) => {
  const visible = ${VISIBLE_FN};
  const t0 = performance.now();
  for (;;) {
    const all = Array.from(document.querySelectorAll(sel));
    const shown = all.filter(visible);
    const textFound = text === null || shown.some((el) => (el.textContent || '').includes(text));
    const first = shown[0] || all[0];
    const r = first ? first.getBoundingClientRect() : null;
    const result = {
      total: all.length, shown: shown.length, textFound,
      rect: r ? { x: Math.round(r.x * 10) / 10, y: Math.round(r.y * 10) / 10, width: Math.round(r.width * 10) / 10, height: Math.round(r.height * 10) / 10 } : null,
    };
    const ok = want.hidden ? shown.length === 0
      : (want.count !== null ? shown.length === want.count : shown.length > 0) && textFound;
    if (ok) return { ok: true, ...result };
    if (performance.now() - t0 >= timeout) return { ok: false, ...result };
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
})`;

function describeStep(step) {
  if (step.click) return `点击 ${step.click}`;
  if (step.fill !== undefined) return `在 ${step.fill} 输入「${step.value}」`;
  if (step.press) return `按 ${step.press}`;
  if (step.hover) return `悬停到 ${step.hover}`;
  if (step.select) return `在 ${step.select} 选择「${step.value}」`;
  if (step.wait) return `等待 ${step.wait} 出现`;
  if (step.expect) return `检查 ${step.expect}`;
  return `量取「${step.audit}」`;
}

async function pressKey(cdp, key) {
  const known = KEYS[key];
  const vk = known ? known[0] : key.toUpperCase().charCodeAt(0);
  const code = known ? known[1] : (/^[a-z]$/i.test(key) ? `Key${key.toUpperCase()}` : (/^[0-9]$/.test(key) ? `Digit${key}` : ''));
  const text = known ? known[2] : key;
  const keyName = key === 'Space' ? ' ' : key;
  const base = { key: keyName, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk };
  await cdp.send('Input.dispatchKeyEvent', { type: text ? 'keyDown' : 'rawKeyDown', ...base, ...(text ? { text, unmodifiedText: text } : {}) });
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', ...base });
}

/**
 * 执行一步。返回 { ok: true } 或 { ok: false, expected, actual, rect }：
 * 找不到元素、元素不可见、选项不存在、等待超时、期望不符都算没达成，由调用方记 DC023。
 */
async function runStep(cdp, step) {
  const target = async (sel, focus = false) => cdp.evaluate(`${TARGET_PROBE}(${JSON.stringify(sel)}, ${focus})`);
  const mouse = async (type, x, y) => cdp.send('Input.dispatchMouseEvent', {
    type, x, y, button: type === 'mouseMoved' ? 'none' : 'left', clickCount: type === 'mouseMoved' ? 0 : 1,
  });
  const reach = async (sel, focus) => {
    const t = await target(sel, focus);
    if (!t.found) return { fail: { expected: `${sel} 存在`, actual: '找不到元素', rect: null } };
    if (!t.visible) return { fail: { expected: `${sel} 可见`, actual: '元素不可见', rect: t.rect } };
    return { t };
  };

  if (step.click || step.hover) {
    const { t, fail } = await reach(step.click || step.hover, false);
    if (fail) return { ok: false, ...fail };
    await mouse('mouseMoved', t.x, t.y);
    if (step.click) {
      await mouse('mousePressed', t.x, t.y);
      await mouse('mouseReleased', t.x, t.y);
    }
    return { ok: true };
  }
  if (step.fill !== undefined) {
    const { t, fail } = await reach(step.fill, true);
    if (fail) return { ok: false, ...fail };
    if (!t.focused) return { ok: false, expected: `${step.fill} 能聚焦并输入`, actual: '元素无法获得焦点', rect: t.rect };
    if (step.value) await cdp.send('Input.insertText', { text: step.value });
    else await pressKey(cdp, 'Backspace');
    return { ok: true };
  }
  if (step.press) {
    await pressKey(cdp, step.press);
    return { ok: true };
  }
  if (step.select) {
    // 和点击一样，用户看不见的下拉框选不了。
    const { t, fail } = await reach(step.select, false);
    if (fail) return { ok: false, ...fail };
    const r = await cdp.evaluate(`${SELECT_PROBE}(${JSON.stringify(step.select)}, ${JSON.stringify(step.value)})`);
    return r.ok ? { ok: true } : { ok: false, expected: `${step.select} 可以选「${step.value}」`, actual: r.actual, rect: t.rect };
  }
  const sel = step.wait || step.expect;
  const timeout = step.timeout ?? (step.wait ? STEP_WAIT : 2000);
  const want = {
    hidden: step.visible === false,
    count: step.count === undefined ? null : step.count,
  };
  const text = step.text === undefined ? null : step.text;
  const m = await cdp.evaluate(`${MATCH_PROBE}(${JSON.stringify(sel)}, ${JSON.stringify(text)}, ${JSON.stringify(want)}, ${timeout})`, {
    awaitPromise: true, timeoutMs: timeout + 15_000,
  });
  if (m.ok) return { ok: true };
  const expected = want.hidden ? `${sel} 不可见`
    : `${sel} ${want.count !== null ? `可见 ${want.count} 个` : '可见'}${text !== null ? `且含「${text}」` : ''}`;
  const actual = `${timeout}ms 内可见 ${m.shown} 个（共 ${m.total} 个）${text !== null && !m.textFound ? `，可见元素里没有「${text}」` : ''}`;
  return { ok: false, expected, actual, rect: m.rect };
}

/**
 * 把页面外算出的发现并入报告：排在已有发现之后，超出上限时截断并更新计数。
 * force 为真时（步骤失败的 DC023）这些发现一定留下，必要时挤掉末尾的普通发现。
 */
export function addFindings(report, list, { force = false } = {}) {
  if (!list.length) return;
  const room = Math.max(0, MAX_FINDINGS - report.findings.length);
  if (force && list.length > room) {
    const kept = list.slice(0, MAX_FINDINGS);
    report.findings = report.findings.slice(0, MAX_FINDINGS - kept.length).concat(kept);
  } else {
    report.findings.push(...list.slice(0, room));
  }
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

// --screenshot 的文件名：序号-视口[-配色][-状态].png，序号与报告顺序一致；状态名里文件名不能用的字符换成 _，
// 再按 UTF-8 截到 120 字节（约 40 个汉字或 30 个 emoji），整个文件名远低于常见文件系统单段 255 字节的上限。
export function screenshotName(index, { width, height }, scheme, state) {
  const parts = [String(index).padStart(2, '0'), `${width}x${height}`];
  if (scheme) parts.push(scheme);
  let label = '';
  let bytes = 0;
  for (const ch of String(state || '').replace(/[<>:"/\x5c|?*\u0000-\u001f]/g, '_').replace(/\s+/g, ' ')) {
    bytes += Buffer.byteLength(ch);
    if (bytes > 120) break;
    label += ch;
  }
  label = label.trim();
  if (label) parts.push(label);
  return `${parts.join('-')}.png`;
}

/**
 * 同一个浏览器里按 viewports 顺序逐个视口审计：每个视口先切尺寸，再重新加载页面并等就绪，
 * 量到的是在该尺寸下首次布局的结果。返回 { runs: [{ report, htmlLengthBefore, htmlLengthAfter }] }。
 * steps：加载后按顺序执行的步骤（见 checkSteps）；在 audit 步骤处各量一次，没有 audit 步骤就在最后量一次，
 *   某一步没达成时在该处量一次并记 DC023，后面的步骤不再执行。context.state 标明状态，context.stepsDone 为已执行的步数。
 * scroll：量取后检查滚到顶 / 底时被固定栏永久盖住的内容（DC022）；DC016 已报的元素不重复报。
 * colorSchemes（如 ['light', 'dark']）：每个视口按每种 prefers-color-scheme 各加载一次，runs 按视口、配色顺序排列；
 * 给了两种以上时两两比较颜色快照，DC021 记在出问题的那种配色的报告里。
 * screenshot：截图目录，文件名见 screenshotName，序号按 runs 的顺序。
 * 其余参数与 runAudit 相同。
 */
export async function runAudits({
  target, touch = false, root, viewports, colorSchemes, scroll = false, steps, screenshot,
  waitFor, settle = DEFAULT_SETTLE, waitTimeoutMs = STEP_TIMEOUT,
} = {}) {
  if (!target) throw new Error('缺少要检查的页面：请给 URL 或本地 html 路径');
  if (!Array.isArray(viewports) || !viewports.length) throw new Error('缺少视口：viewports 至少要有一项');
  if (steps) checkSteps(steps);
  const bin = findBrowser();
  if (!bin) throw new Error(browserMissingMessage());
  const url = toUrl(target);
  // 截图目录先建好：路径不能用时在启动浏览器前就报错。
  if (screenshot) {
    try {
      fs.mkdirSync(screenshot, { recursive: true });
    } catch (err) {
      throw new Error(`截图目录建不了：${screenshot}（${err.message}）`);
    }
  }
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
    const { frameTree } = await cdp.send('Page.getFrameTree');
    const mainFrameId = frameTree.frame.id;

    const runs = [];
    let loads = 0;
    let shots = 0;
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

        // 在当前页面状态量取一次；state 与 stepsDone 只在跑步骤时写进报告。
        const auditHere = async (state, stepsDone) => {
          // 截图在量取之前，截到的就是这份报告量的画面。
          const shot = screenshot ? path.resolve(screenshot, screenshotName(++shots, { width, height }, scheme, state)) : null;
          if (shot) {
            const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' });
            fs.writeFileSync(shot, Buffer.from(data, 'base64'));
          }
          const htmlLengthBefore = await cdp.evaluate('document.documentElement.outerHTML.length');
          await cdp.evaluate(scriptSource);
          const options = { touch: touch ? true : undefined, root: root || undefined };
          const json = await cdp.evaluate(`JSON.stringify(denseAudit(${JSON.stringify(options)}))`);
          const report = JSON.parse(json);
          if (scroll) {
            const scrollOptions = JSON.stringify({ root: root || undefined });
            const covered = JSON.parse(await cdp.evaluate(`denseAuditScroll(${scrollOptions}).then(JSON.stringify)`, { awaitPromise: true }));
            addFindings(report, covered.filter((f) => !report.findings.some((g) => g.rule === 'DC016' && g.selector === f.selector)));
            report.context.scrollChecked = true;
          }
          const htmlLengthAfter = await cdp.evaluate('document.documentElement.outerHTML.length');
          report.context.ready = ready;
          if (shot) report.context.screenshot = shot;
          if (scheme) report.context.colorScheme = scheme;
          if (steps) {
            report.context.state = state;
            report.context.stepsDone = stepsDone;
          }
          const run = { report, htmlLengthBefore, htmlLengthAfter };
          if (themeDiff) {
            const colorOptions = JSON.stringify({ root: root || undefined });
            run.colors = JSON.parse(await cdp.evaluate(`JSON.stringify(denseAuditColors(${colorOptions}))`));
          }
          return run;
        };

        const states = [];
        if (!steps) states.push(await auditHere(null, 0));
        else {
          let failed = false;
          for (const [i, step] of steps.entries()) {
            if (step.audit) {
              states.push(await auditHere(step.audit, i));
              continue;
            }
            // 动作可能引发整页跳转（链接、表单提交、脚本改 location）：动作前开始监听，跳转了就等新页面加载完。
            let navigated = false;
            const stopWatch = cdp.on('Page.frameStartedLoading', (p) => { if (p.frameId === mainFrameId) navigated = true; });
            const loaded = cdp.waitEvent('Page.loadEventFired');
            let result;
            try {
              result = await runStep(cdp, step);
              if (!step.wait && !step.expect) await sleep(150);
              if (navigated) await loaded;
              else loaded.cancel();
            } catch (err) {
              loaded.cancel();
              throw err;
            } finally {
              stopWatch();
            }
            if (!result.ok) {
              const run = await auditHere(`第 ${i + 1} 步失败`, i);
              addFindings(run.report, [{
                rule: 'DC023',
                selector: step.click || step.fill || step.hover || step.select || step.wait || step.expect || 'document',
                rect: result.rect || { x: 0, y: 0, width, height },
                value: { step: i + 1, action: step, expected: result.expected, actual: result.actual },
                message: `第 ${i + 1} 步「${describeStep(step)}」没达成：期望 ${result.expected}，实际 ${result.actual}。` +
                  '复核：操作是否真的生效（按钮被遮挡、事件没绑定、请求失败），或步骤里的选择器与期望写错了。后面的步骤没有执行。',
              }], { force: true });
              states.push(run);
              failed = true;
              break;
            }
            // 动作之后等 DOM 静默，再做下一步。跳转晚于 150ms 才开始时，静默探针会碰上上下文被销毁：等新页面加载完再探一次。
            if (!step.wait && !step.expect && settle > 0) {
              const quiet = () => cdp.evaluate(`${READY_PROBE}(null, ${settle}, 0, ${SETTLE_CAP})`, { awaitPromise: true, timeoutMs: SETTLE_CAP + 15_000 });
              const late = cdp.waitEvent('Page.loadEventFired');
              try {
                await quiet();
                late.cancel();
              } catch (err) {
                if (!/context|Inspected target navigated/i.test(err.message)) {
                  late.cancel();
                  throw err;
                }
                await late;
                await quiet();
              }
            }
          }
          if (!failed && !steps.some((step) => step.audit)) states.push(await auditHere('步骤结束', steps.length));
        }
        group.push(states);
      }

      // 同一视口下两两比较配色方案，按同一状态对齐：b 相对 a 出现的问题记在 b 的报告里。
      if (themeDiff) {
        for (const [j, states] of group.entries()) {
          for (const [i, base] of group.entries()) {
            if (i === j) continue;
            states.forEach((run, k) => {
              const peer = base[k];
              if (peer && peer.report.context.state === run.report.context.state) {
                addFindings(run.report, themeDiff(peer.colors, run.colors, { scheme: schemes[j] }));
              }
            });
          }
        }
      }
      for (const states of group) {
        for (const run of states) {
          delete run.colors;
          runs.push(run);
        }
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
    else if (a === '--scroll') opts.scroll = true;
    else if (a === '--steps') {
      const stepsFile = needValue(a, i++);
      let parsed;
      try {
        parsed = JSON.parse(fs.readFileSync(stepsFile, 'utf8'));
      } catch (err) {
        throw new Error(`读不了步骤文件 ${stepsFile}：${err.message}`);
      }
      opts.steps = checkSteps(parsed);
    }
    else if (a === '--root') opts.root = needValue(a, i++);
    else if (a === '--out') opts.out = needValue(a, i++);
    else if (a === '--screenshot') opts.screenshot = needValue(a, i++);
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
  if (rest.length !== 1) throw new Error('用法：node scripts/run-audit.mjs <URL 或本地 html 路径> [--touch] [--root <选择器>] [--wait-for <选择器>] [--settle 500] [--scroll] [--steps steps.json] [--width 1280 --height 720 | --viewport 1280x720 --viewport 390x844 …] [--color-scheme light,dark] [--screenshot <目录>] [--out report.json]');
  if (viewports.length && (opts.width || opts.height)) throw new Error('--viewport 不能和 --width / --height 同时使用');
  if (viewports.length) opts.viewports = viewports;
  if (schemes.length) opts.colorSchemes = schemes;
  opts.target = rest[0];
  return opts;
}

async function main() {
  try {
    const { out, ...opts } = parseArgs(process.argv.slice(2));
    // 传了 --viewport、--color-scheme 或 --steps 就输出多份报告：每个视口、配色、状态一份 dense-audit-v1；都不传时输出与以前完全相同。
    let result;
    let total;
    if (opts.viewports || opts.colorSchemes || opts.steps) {
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
