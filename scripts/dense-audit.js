/* dense-compact-ui 浏览器内量取脚本（经典脚本，零依赖，不联网，不改 DOM）。
 *
 * 用法：用任何浏览器工具把本文件全文注入当前页面，再执行
 *   denseAudit({ touch: true, root: 'main', maxFindings: 200 })
 * 返回 dense-audit-v1 报告（纯 JSON 数据）。检出是复核线索，不是判决。
 *
 * 结构：
 *   readTokens(win, doc)       读 --dc-* token，读不到就回落到默认值
 *   collect(win, doc, opts)    只读 DOM，产出 records（纯数据，不含页面正文文本）
 *   collectPage(win, doc)      页面级数据：文档滚动宽度、加载失败的字体族
 *   evaluate(records, ctx)     纯函数：records + ctx -> 报告，可在 Node 里单测
 *   collectColors(win, doc)    颜色快照；themeDiff(a, b) 纯函数比较两种配色方案下的快照（DC021）
 *
 * 字体状态要等 document.fonts.ready 之后才准；run-audit.mjs 会先等，手动注入时先 await 它。
 *
 * 顶层只定义函数，不访问 window / document；只有调用 denseAudit 时才读页面。
 */
(function () {
  'use strict';

  var SCHEMA = 'dense-audit-v1';
  var DEFAULT_MAX_FINDINGS = 200;
  var MAX_NODES = 20000;
  /* DC007 求并集的矩形个数上限，超出时退回逐个相加。 */
  var MAX_UNION_RECTS = 2000;

  var LIMITS = [
    '只覆盖当前视口与状态',
    '不证明点击、读屏、软键盘或真实触控',
    '零告警不等于验收通过',
    '原生平台不适用'
  ];

  /* 读不到 token 时的回落值，与 assets/tokens.css 的默认档（dense、深色）一致。 */
  var DEFAULT_TOKENS = {
    found: true,
    small: 12,
    body: 13,
    title: 16,
    page: 18,
    radii: [0, 4, 6, 10, 14, 9999],
    colors: {
      primaryBg: 'rgb(250, 250, 250)',
      accent: 'rgb(88, 166, 255)',
      success: 'rgb(63, 185, 80)',
      warning: 'rgb(210, 153, 34)',
      danger: 'rgb(248, 81, 73)',
      special: 'rgb(163, 113, 247)'
    }
  };

  var COLOR_TOKEN_VARS = {
    primaryBg: '--dc-primary-bg',
    accent: '--dc-accent',
    success: '--dc-success',
    warning: '--dc-warning',
    danger: '--dc-danger',
    special: '--dc-special'
  };

  /* 可交互元素（DC008）。 */
  var INTERACTIVE_SELECTOR = [
    'button', 'a[href]', 'input:not([type=hidden])', 'select', 'textarea', 'summary',
    '[role=button]', '[role=link]', '[role=tab]', '[tabindex="0"]'
  ].join(',');

  /* 承载正文的元素（DC001 用 body 下限）。 */
  var BODY_TAGS = {
    p: 1, li: 1, td: 1, th: 1, dd: 1, input: 1, textarea: 1, select: 1, button: 1, label: 1
  };
  var BODY_ROLES = { gridcell: 1, cell: 1 };
  var CELL_TAGS = { td: 1, th: 1 };
  var FORM_TAGS = { input: 1, select: 1, textarea: 1, button: 1 };
  /* 这些 input 类型没有可读文字，不算「带文字」。 */
  var NO_TEXT_INPUT = {
    hidden: 1, checkbox: 1, radio: 1, range: 1, color: 1, file: 1, image: 1
  };
  /* 内联链接例外（WCAG 2.5.8 inline）所在的文本段落。 */
  var PARAGRAPH_TAGS = { p: 1, li: 1, dd: 1, dt: 1, blockquote: 1, figcaption: 1 };
  /* 合法盖住页面的浮层（DC016）：命中点落在这些元素里不算拦截。 */
  var OVERLAY_SELECTOR = [
    'dialog[open]', '[role=dialog]', '[role=alertdialog]', '[role=menu]', '[role=listbox]',
    '[aria-modal="true"]', '[popover]'
  ].join(',');
  /* 没有匹配到任何 :focus / :focus-visible 规则时，按浏览器默认焦点环向外约 2px 估算（DC015）。 */
  var DEFAULT_RING = 2;
  /* 页面滚动由视口承担，html / body 的 overflow 会传给视口，不算裁切容器。 */
  var VIEWPORT_TAGS = { html: 1, body: 1 };
  /* 让对齐、间距、方向类属性生效的 display（DC019）。 */
  var FLEX_GRID = { flex: 1, 'inline-flex': 1, grid: 1, 'inline-grid': 1 };
  /* Unicode 私有区字符：图标字体常把图标放在这里（DC020）。含 U+E000–U+F8FF 与补充私有区 A / B。 */
  var PUA = /[\uE000-\uF8FF]|[\uDB80-\uDBFF][\uDC00-\uDFFF]/;

  /* ------------------------------------------------------------------ */
  /* 通用小工具                                                          */
  /* ------------------------------------------------------------------ */

  function hasToken(str, token) {
    if (!str) return false;
    return (' ' + String(str).toLowerCase().split(/[\s,]+/).join(' ') + ' ').indexOf(' ' + token + ' ') >= 0;
  }

  function round1(n) {
    return Math.round(n * 10) / 10;
  }

  function roundHalf(n) {
    return Math.round(n * 2) / 2;
  }

  /* 数字模式：去空白后只含数字与 + - − . , : % $ ¥ € £，末尾最多 3 个字母单位，至少 2 位数字。 */
  function isNumericText(s) {
    s = String(s).replace(/\s+/g, '');
    if (!s) return false;
    if (!/^[+\-−.,:%$¥€£\d]+[A-Za-z]{0,3}$/.test(s)) return false;
    var digits = s.match(/\d/g);
    return !!digits && digits.length >= 2;
  }

  /* 矩形 [x1, y1, x2, y2] 并集面积：x 坐标离散化，每段区间内对 y 区间排序合并后累加。O(n² log n)。 */
  function unionArea(rects) {
    if (!rects.length) return 0;
    var xs = [];
    rects.forEach(function (q) { xs.push(q[0], q[2]); });
    xs.sort(function (a, b) { return a - b; });
    var total = 0;
    for (var k = 0; k + 1 < xs.length; k++) {
      var xa = xs[k];
      var xb = xs[k + 1];
      if (xb <= xa) continue;
      var spans = [];
      rects.forEach(function (q) {
        if (q[0] <= xa && q[2] >= xb) spans.push([q[1], q[3]]);
      });
      if (!spans.length) continue;
      spans.sort(function (a, b) { return a[0] - b[0]; });
      var covered = 0;
      var curStart = spans[0][0];
      var curEnd = spans[0][1];
      for (var s = 1; s < spans.length; s++) {
        if (spans[s][0] > curEnd) {
          covered += curEnd - curStart;
          curStart = spans[s][0];
          curEnd = spans[s][1];
        } else if (spans[s][1] > curEnd) {
          curEnd = spans[s][1];
        }
      }
      covered += curEnd - curStart;
      total += covered * (xb - xa);
    }
    return total;
  }

  function median(nums) {
    var a = nums.slice().sort(function (x, y) { return x - y; });
    var n = a.length;
    if (!n) return 0;
    return n % 2 ? a[(n - 1) / 2] : (a[n / 2 - 1] + a[n / 2]) / 2;
  }

  /* 报告里的资源地址去掉查询串和 # 片段，避免带出令牌；data: 地址只留类型。 */
  function cleanUrl(u) {
    u = String(u || '');
    if (/^data:/i.test(u)) return u.slice(0, Math.max(5, u.search(/[;,]/)));
    return u.split(/[?#]/)[0];
  }

  /* 字体族名规范化：去引号、去首尾空白、转小写。传入 font-family 列表时只取第一项。 */
  function firstFamily(str) {
    var first = String(str || '').split(',')[0] || '';
    return first.trim().replace(/^["']|["']$/g, '').trim().toLowerCase() || null;
  }

  /* ------------------------------------------------------------------ */
  /* 颜色规范化：统一成 rgb(r, g, b) 字符串，不留下任何 DOM 改动          */
  /* ------------------------------------------------------------------ */

  /* 纯字符串解析：rgb()/rgba()/#hex/color(srgb)/transparent；解析不了返回 null。 */
  function parseColor(str) {
    if (typeof str !== 'string') return null;
    var s = str.trim().toLowerCase();
    var m;
    if (s === 'transparent') return { r: 0, g: 0, b: 0, a: 0 };
    if ((m = /^#([0-9a-f]{3,8})$/.exec(s))) {
      var h = m[1];
      if (h.length === 3 || h.length === 4) {
        h = h.replace(/./g, function (c) { return c + c; });
      }
      if (h.length !== 6 && h.length !== 8) return null;
      return {
        r: parseInt(h.slice(0, 2), 16),
        g: parseInt(h.slice(2, 4), 16),
        b: parseInt(h.slice(4, 6), 16),
        a: h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1
      };
    }
    if ((m = /^rgba?\(\s*([\d.]+)(%?)[\s,]+([\d.]+)(%?)[\s,]+([\d.]+)(%?)(?:\s*[\/,]\s*([\d.]+)(%?))?\s*\)$/.exec(s))) {
      var ch = function (v, pct) { return pct ? parseFloat(v) * 2.55 : parseFloat(v); };
      var alpha = m[7] === undefined ? 1 : (m[8] ? parseFloat(m[7]) / 100 : parseFloat(m[7]));
      return {
        r: Math.round(ch(m[1], m[2])),
        g: Math.round(ch(m[3], m[4])),
        b: Math.round(ch(m[5], m[6])),
        a: alpha
      };
    }
    if ((m = /^color\(\s*srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+)(%?))?\s*\)$/.exec(s))) {
      return {
        r: Math.round(parseFloat(m[1]) * 255),
        g: Math.round(parseFloat(m[2]) * 255),
        b: Math.round(parseFloat(m[3]) * 255),
        a: m[4] === undefined ? 1 : (m[5] ? parseFloat(m[4]) / 100 : parseFloat(m[4]))
      };
    }
    return null;
  }

  function rgbString(c) {
    return 'rgb(' + c.r + ', ' + c.g + ', ' + c.b + ')';
  }

  /* 返回 function(str) -> {rgb, a} | null。命名色等字符串解析不了时，
   * 借游离 canvas（不挂进文档）的 fillStyle 赋值再读回，不产生 DOM 改动。 */
  function makeNormalizer(win, doc) {
    var ctx2d = null;
    var tried = false;

    function getCtx() {
      if (!tried) {
        tried = true;
        try {
          var canvas = typeof win.OffscreenCanvas === 'function'
            ? new win.OffscreenCanvas(1, 1)
            : doc.createElement('canvas');
          ctx2d = canvas.getContext('2d');
        } catch (e) {
          ctx2d = null;
        }
      }
      return ctx2d;
    }

    return function normalize(str) {
      var c = parseColor(str);
      if (!c) {
        var g = getCtx();
        if (g && typeof str === 'string' && str.trim()) {
          /* 用两个不同的初值各赋一次：结果不同说明 str 无效，没有被接受。 */
          g.fillStyle = '#000000';
          g.fillStyle = str;
          var v1 = g.fillStyle;
          g.fillStyle = '#ffffff';
          g.fillStyle = str;
          var v2 = g.fillStyle;
          if (v1 === v2) c = parseColor(v1);
        }
      }
      return c ? { rgb: rgbString(c), a: c.a } : null;
    };
  }

  /* ------------------------------------------------------------------ */
  /* readTokens                                                          */
  /* ------------------------------------------------------------------ */

  /* 从 .dc-workbench（没有就退到 <html>）读 --dc-* token。
   * 返回 { found, small, body, title, page, radii, colors }，长度已换算成 px。 */
  function readTokens(win, doc, normalize) {
    var host = doc.querySelector('.dc-workbench') || doc.documentElement;
    var cs = win.getComputedStyle(host);
    var rootPx = parseFloat(win.getComputedStyle(doc.documentElement).fontSize) || 16;
    var hostPx = parseFloat(cs.fontSize) || rootPx;
    normalize = normalize || makeNormalizer(win, doc);

    function raw(name) {
      return (cs.getPropertyValue(name) || '').trim();
    }

    function px(name, fallback) {
      var m = /^(-?[\d.]+)(px|rem|em)?$/.exec(raw(name));
      if (!m) return fallback;
      var n = parseFloat(m[1]);
      if (m[2] === 'rem') return n * rootPx;
      if (m[2] === 'em') return n * hostPx;
      if (m[2] === 'px' || n === 0) return n;
      return fallback;
    }

    var d = DEFAULT_TOKENS;
    var found = !!(raw('--dc-text-body') || raw('--dc-primary-bg') || raw('--dc-radius-1'));
    var colors = {};
    Object.keys(COLOR_TOKEN_VARS).forEach(function (key) {
      var n = normalize(raw(COLOR_TOKEN_VARS[key]));
      colors[key] = n && n.a >= 0.999 ? n.rgb : d.colors[key];
    });

    return {
      found: found,
      small: px('--dc-text-small', d.small),
      body: px('--dc-text-body', d.body),
      title: px('--dc-text-title', d.title),
      page: px('--dc-text-page', d.page),
      radii: [
        px('--dc-radius-0', d.radii[0]),
        px('--dc-radius-1', d.radii[1]),
        px('--dc-radius-2', d.radii[2]),
        px('--dc-radius-3', d.radii[3]),
        px('--dc-radius-4', d.radii[4]),
        px('--dc-radius-full', d.radii[5])
      ],
      colors: colors
    };
  }

  /* 选择器片段：#id 或 tag[:nth-of-type(n)]，同一父元素下的同名兄弟一次算完。collect 与 collectColors 共用。 */
  function makeSegOf(win) {
    var segCache = new Map();

    function escapeId(id) {
      return win.CSS && typeof win.CSS.escape === 'function'
        ? win.CSS.escape(id)
        : id.replace(/([^\w-])/g, '\\$1');
    }

    function segOf(el) {
      if (segCache.has(el)) return segCache.get(el);
      var id = el.getAttribute('id');
      if (id) {
        var s = '#' + escapeId(id);
        segCache.set(el, s);
        return s;
      }
      var tag = el.localName;
      var parent = el.parentElement;
      var seg = tag;
      if (parent) {
        var same = [];
        for (var i = 0; i < parent.children.length; i++) {
          if (parent.children[i].localName === tag) same.push(parent.children[i]);
        }
        if (same.length > 1) {
          /* 同一父元素下的同名兄弟一次性算完，避免反复扫描。 */
          same.forEach(function (sib, k) {
            if (!sib.getAttribute('id')) segCache.set(sib, tag + ':nth-of-type(' + (k + 1) + ')');
          });
          return segCache.get(el);
        }
      }
      segCache.set(el, seg);
      return seg;
    }
    return segOf;
  }

  /* ------------------------------------------------------------------ */
  /* collect：只读 DOM，产出 records                                      */
  /* ------------------------------------------------------------------ */

  /* record 字段（evaluate 与测试共用同一结构；缺省字段按 falsy 处理）：
   *   p        父 record 的下标，-1 为最顶层
   *   outside  true 表示是 root 之外的祖先，只参与祖先链判断，不作为检查对象
   *   seg      选择器片段：#id 或 tag[:nth-of-type(n)]
   *   tag      小写标签名；role / drole：role 与 data-dc-role 属性（小写）
   *   ign / ignWhy   data-dc-ignore 与 data-dc-ignore-reason 原值
   *   alert / invalid / view / popover   role=alert、aria-invalid=true、有 data-dc-view、有 popover
   *   pos      computed position
   *   vis      可见（checkVisibility 且宽高 > 0）
   *   rect     {x, y, width, height}
   *   hasText  有直接非空白文本（或是带文字的表单控件）
   *   num      直接文本匹配数字模式；numAll 仅 trunc 元素：整段文本匹配数字模式（只存布尔）
   *   fs       font-size（px）；fvn  font-variant-numeric
   *   bg       不透明背景色的 rgb 字符串，透明或半透明为 null
   *   radius   左上角圆角（px）
   *   border4  四边都有可见边框；shadow  有 box-shadow
   *   form     表单控件；inter 可交互；disabled 已禁用
   *   inlinePara  位于文本段落内的内联链接
   *   trunc    text-overflow: ellipsis 且内容确实被截断
   *   inCell   自身或祖先是单元格（td、th、role=gridcell|cell），向上只找到最近的 table、grid、treegrid 为止
 *   clipX / clipY   该方向 overflow 不是 visible（会裁切或滚动后代）
 *   clip     clipX / clipY 且可见时的内框（padding box，不含滚动条）{x, y, width, height}
 *   ring     可交互且未禁用：焦点环向外伸出的估算 px（≤0 记 0，表示内描边或没有焦点环）
 *   hitBy    可交互且未禁用：中心点被别的元素盖住时，盖住它的元素的选择器；否则 null
 *   noPointer  可交互且未禁用，但 computed pointer-events 为 none（点击会穿透）
 *   ff       带文字时 computed font-family 的第一项（规范化后）
 *   imgFail  img 请求已结束却没有像素（破图）时的地址（去掉查询串），否则 null；0×0 的破图也记
 *   deadLayout  {display, props}：写了 gap、对齐、方向等属性，但当前 display 不让它们生效
 *   icon / iconText   直接文字或 ::before / ::after 内容含私有区字符时，渲染它的第一字体族；iconText 表示来自直接文字 */
  function collect(win, doc, opts) {
    opts = opts || {};
    var rootEl = opts.root ? doc.querySelector(opts.root) : doc.documentElement;
    if (!rootEl) {
      throw new Error('dense-audit：找不到 root 选择器对应的元素：' + opts.root);
    }
    var total = rootEl.querySelectorAll('*').length + 1;
    if (total > MAX_NODES) {
      throw new Error('dense-audit：root 内有 ' + total + ' 个节点，超过 ' + MAX_NODES + ' 的上限，请用 root 缩小检查范围');
    }

    var normalize = makeNormalizer(win, doc);
    var records = [];
    var segOf = makeSegOf(win);

    function parsePx(value) {
      var n = parseFloat(value);
      return isNaN(n) ? 0 : n;
    }

    function pathOf(el) {
      var parts = [];
      for (var n = el, depth = 0; n && n.nodeType === 1 && depth < 4; n = n.parentElement, depth++) {
        var seg = segOf(n);
        parts.unshift(seg);
        if (seg.charAt(0) === '#') break;
      }
      return parts.join(' > ');
    }

    /* 收集样式表里的 :focus / :focus-visible 规则（跨域样式表读不到时跳过），只读一次。
     * 去掉伪类后的选择器用来匹配元素；:not(:focus…) 与 :focus-within 不是元素自己的焦点态，跳过。
     * 不算优先级，按样式表顺序后者覆盖前者，是近似值。 */
    var focusRules = null;
    function getFocusRules() {
      if (focusRules) return focusRules;
      focusRules = [];
      function walk(list) {
        for (var i = 0; i < list.length; i++) {
          var rule = list[i];
          if (rule.selectorText) {
            if (!/:focus/.test(rule.selectorText)) continue;
            rule.selectorText.split(',').forEach(function (part) {
              if (/:not\([^)]*:focus|:focus-within/.test(part) || !/:focus/.test(part)) return;
              var base = part.replace(/:focus(-visible)?/g, '').trim();
              if (!base || /[>+~]$/.test(base)) base += '*';
              focusRules.push({ sel: base, style: rule.style });
            });
          } else if (rule.cssRules) {
            if (rule.media && rule.media.mediaText && win.matchMedia && !win.matchMedia(rule.media.mediaText).matches) continue;
            walk(rule.cssRules);
          }
        }
      }
      var sheets = doc.styleSheets || [];
      for (var s = 0; s < sheets.length; s++) {
        try { walk(sheets[s].cssRules); } catch (e) { /* 跨域样式表 */ }
      }
      return focusRules;
    }

    /* 焦点环向外伸出多少 px：合并匹配到的焦点规则里的 outline / box-shadow，var() 按元素当前的 computed 值展开。 */
    function focusRingOf(el, cs) {
      var props = {};
      var matched = false;
      getFocusRules().forEach(function (fr) {
        var ok = false;
        try { ok = el.matches(fr.sel); } catch (e) { ok = false; }
        if (!ok) return;
        matched = true;
        ['outline', 'outline-width', 'outline-style', 'outline-offset', 'box-shadow'].forEach(function (name) {
          var v = fr.style.getPropertyValue(name);
          if (v) props[name] = v;
        });
      });
      if (!matched) return DEFAULT_RING;

      function resolve(v) {
        return String(v || '').replace(/var\(\s*(--[\w-]+)\s*(?:,\s*([^)]*))?\)/g, function (_, name, fallback) {
          return cs.getPropertyValue(name).trim() || (fallback || '').trim();
        });
      }
      function lengthOf(token) {
        if (token === 'thin') return 1;
        if (token === 'medium') return 3;
        if (token === 'thick') return 5;
        var m = /^(-?[\d.]+)px$/.exec(token);
        return m ? parseFloat(m[1]) : null;
      }

      var outlineExtent;
      var shorthand = resolve(props.outline).trim();
      var style = resolve(props['outline-style']).trim();
      var widthRaw = resolve(props['outline-width']).trim();
      if (!shorthand && !style && !widthRaw && !props['outline-offset']) {
        /* 焦点规则没碰 outline：浏览器默认焦点环仍在。 */
        outlineExtent = DEFAULT_RING;
      } else {
        var tokens = shorthand ? shorthand.split(/\s+/) : [];
        var none = style === 'none' || shorthand === '0' || tokens.indexOf('none') >= 0;
        var width = lengthOf(widthRaw);
        if (width === null) {
          for (var t = 0; t < tokens.length && width === null; t++) width = lengthOf(tokens[t]);
        }
        if (width === null) width = shorthand || style ? 3 : DEFAULT_RING;
        var offset = lengthOf(resolve(props['outline-offset']).trim()) || 0;
        outlineExtent = none ? 0 : width + offset;
      }

      var shadowExtent = 0;
      var shadow = resolve(props['box-shadow']).trim();
      if (shadow && shadow !== 'none' && !/inset/.test(shadow)) {
        (shadow.match(/-?[\d.]+px/g) || []).forEach(function (n) {
          shadowExtent = Math.max(shadowExtent, parseFloat(n));
        });
      }
      return Math.max(0, round1(Math.max(outlineExtent, shadowExtent)));
    }

    /* 写了只对 flex / grid（gap 与 justify-content 还有多列）生效的属性，但 display 不是它们。只记非默认值；
     * 按钮等控件的 UA 默认 align-items: flex-start 属于默认值，不记。 */
    function deadLayoutOf(cs) {
      var d = cs.display;
      if (FLEX_GRID[d] || d === 'none' || d === 'contents') return null;
      var props = [];
      var multicol = cs.columnCount !== 'auto' || cs.columnWidth !== 'auto';
      var rowGap = parsePx(cs.rowGap) > 0;
      var colGap = !multicol && parsePx(cs.columnGap) > 0;
      if (rowGap && colGap && cs.rowGap === cs.columnGap) props.push('gap: ' + cs.rowGap);
      else {
        if (rowGap) props.push('row-gap: ' + cs.rowGap);
        if (colGap) props.push('column-gap: ' + cs.columnGap);
      }
      if (['normal', 'stretch', 'start', 'flex-start'].indexOf(cs.alignItems) < 0) props.push('align-items: ' + cs.alignItems);
      /* 多列布局里 justify-content 分配列盒，同样有效。 */
      if (!multicol && ['normal', 'start', 'flex-start'].indexOf(cs.justifyContent) < 0) props.push('justify-content: ' + cs.justifyContent);
      if (cs.flexDirection && cs.flexDirection !== 'row') props.push('flex-direction: ' + cs.flexDirection);
      if (cs.flexWrap && cs.flexWrap !== 'nowrap') props.push('flex-wrap: ' + cs.flexWrap);
      if (cs.gridTemplateColumns && cs.gridTemplateColumns !== 'none') props.push('grid-template-columns: ' + cs.gridTemplateColumns);
      if (cs.gridTemplateRows && cs.gridTemplateRows !== 'none') props.push('grid-template-rows: ' + cs.gridTemplateRows);
      return props.length ? { display: d, props: props } : null;
    }

    /* 直接文字或 ::before / ::after 的 content 含私有区字符时，记下渲染它的第一字体族。 */
    function iconOf(el, cs, rec) {
      var text = '';
      for (var n = el.firstChild; n; n = n.nextSibling) {
        if (n.nodeType === 3) text += n.data;
      }
      if (PUA.test(text)) {
        rec.icon = firstFamily(cs.fontFamily);
        rec.iconText = true;
        return;
      }
      var pseudos = ['::before', '::after'];
      for (var k = 0; k < pseudos.length; k++) {
        var ps = win.getComputedStyle(el, pseudos[k]);
        var content = ps.content;
        if (content && content !== 'none' && content !== 'normal' && PUA.test(content)) {
          rec.icon = firstFamily(ps.fontFamily);
          return;
        }
      }
    }

    /* 中心点命中测试：命中自己、后代或关联的 label 都算可点；命中祖先说明中心已被滚动容器裁到外面，不判。
     * 浮层只豁免它盖住的浮层外控件；浮层里的控件被浮层内另一层盖住照常报。 */
    function hitTest(el, rect) {
      var cx = rect.x + rect.width / 2;
      var cy = rect.y + rect.height / 2;
      if (cx < 0 || cy < 0 || cx >= win.innerWidth || cy >= win.innerHeight) return null;
      var h = doc.elementFromPoint(cx, cy);
      if (!h || h === el || el.contains(h) || h.contains(el)) return null;
      if (h.localName === 'label' && h.control === el) return null;
      if (el.closest('[inert],[aria-hidden="true"]')) return null;
      var overlay = h.closest(OVERLAY_SELECTOR);
      if (overlay && !overlay.contains(el)) return null;
      return pathOf(h);
    }

    function directTextInfo(el) {
      var text = '';
      var any = false;
      for (var n = el.firstChild; n; n = n.nextSibling) {
        if (n.nodeType === 3) {
          text += n.data;
          if (/\S/.test(n.data)) any = true;
        }
      }
      return { any: any, numeric: any && isNumericText(text) };
    }

    /* 自身或祖先是单元格（td、th、role=gridcell|cell）；祖先只向上找到最近的 table、grid、treegrid 为止。
     * 借父 record 的结果递推，不必每个节点重新向上爬。 */
    function inCellOf(el, tag, role, parentIdx) {
      if (CELL_TAGS[tag] || BODY_ROLES[role]) return true;
      var par = el.parentElement;
      if (!par || parentIdx < 0) return false;
      var pRole = (par.getAttribute('role') || '').trim().toLowerCase().split(/\s+/)[0];
      if (par.localName === 'table' || pRole === 'grid' || pRole === 'treegrid') return false;
      return !!records[parentIdx].inCell;
    }

    function makeRecord(el, parentIdx, outside) {
      var cs = win.getComputedStyle(el);
      var tag = el.localName;
      var rect = el.getBoundingClientRect();
      var vis = rect.width > 0 && rect.height > 0 && (
        typeof el.checkVisibility === 'function'
          ? el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })
          : (cs.visibility === 'visible' && cs.opacity !== '0')
      );
      var role = (el.getAttribute('role') || '').trim().toLowerCase().split(/\s+/)[0] || null;
      var drole = (el.getAttribute('data-dc-role') || '').trim().toLowerCase() || null;
      var text = directTextInfo(el);
      var form = !!FORM_TAGS[tag];
      var inputType = tag === 'input' ? (el.getAttribute('type') || 'text').toLowerCase() : '';
      var hasText = text.any ||
        tag === 'select' || tag === 'textarea' ||
        (tag === 'input' && !NO_TEXT_INPUT[inputType]);

      var rec = {
        p: parentIdx,
        outside: !!outside,
        seg: segOf(el),
        tag: tag,
        role: role,
        drole: drole,
        ign: el.getAttribute('data-dc-ignore'),
        ignWhy: el.getAttribute('data-dc-ignore-reason'),
        alert: role === 'alert',
        invalid: el.getAttribute('aria-invalid') === 'true',
        view: el.hasAttribute('data-dc-view'),
        popover: el.hasAttribute('popover'),
        pos: cs.position,
        vis: vis,
        rect: {
          x: round1(rect.x),
          y: round1(rect.y),
          width: round1(rect.width),
          height: round1(rect.height)
        },
        hasText: hasText,
        num: text.numeric,
        numAll: false,
        fs: parsePx(cs.fontSize),
        fvn: cs.fontVariantNumeric || 'normal',
        bg: null,
        radius: 0,
        border4: false,
        shadow: false,
        form: form,
        inter: false,
        disabled: false,
        inlinePara: false,
        trunc: false,
        inCell: inCellOf(el, tag, role, parentIdx),
        clipX: cs.overflowX !== 'visible',
        clipY: cs.overflowY !== 'visible',
        clip: null,
        ring: 0,
        hitBy: null,
        noPointer: false,
        ff: hasText ? firstFamily(cs.fontFamily) : null,
        imgFail: null,
        deadLayout: null,
        icon: null,
        iconText: false
      };

      /* 请求已结束（懒加载还没请求时 complete 为 false）却没有像素；破图可能塌成 0×0，所以不要求有尺寸。 */
      if (tag === 'img' && !outside) {
        var src = el.currentSrc || el.getAttribute('src') || '';
        var shown = typeof el.checkVisibility === 'function'
          ? el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })
          : cs.visibility === 'visible';
        if (src && shown && el.complete && el.naturalWidth === 0) rec.imgFail = cleanUrl(src);
      }

      var bg = normalize(cs.backgroundColor);
      if (bg && bg.a >= 0.999) rec.bg = bg.rgb;

      if (vis) {
        if (rec.clipX || rec.clipY) {
          rec.clip = {
            x: round1(rect.x + el.clientLeft),
            y: round1(rect.y + el.clientTop),
            width: el.clientWidth,
            height: el.clientHeight
          };
        }
        /* 圆角取左上角，百分比按元素宽度换算。 */
        var rm = /^(-?[\d.]+)(px|%)/.exec(cs.borderTopLeftRadius || '');
        if (rm) rec.radius = rm[2] === '%' ? parseFloat(rm[1]) * rect.width / 100 : parseFloat(rm[1]);
        rec.border4 = ['Top', 'Right', 'Bottom', 'Left'].every(function (side) {
          return parsePx(cs['border' + side + 'Width']) > 0 && cs['border' + side + 'Style'] !== 'none';
        });
        rec.shadow = !!cs.boxShadow && cs.boxShadow !== 'none';
        rec.deadLayout = deadLayoutOf(cs);
        iconOf(el, cs, rec);

        rec.inter = el.matches(INTERACTIVE_SELECTOR);
        if (rec.inter) {
          rec.disabled = el.matches(':disabled') || el.getAttribute('aria-disabled') === 'true';
          var par = el.parentElement;
          if (tag === 'a' && cs.display === 'inline' && par && PARAGRAPH_TAGS[par.localName]) {
            rec.inlinePara = directTextInfo(par).any;
          }
          if (!rec.disabled && !outside) {
            rec.ring = focusRingOf(el, cs);
            /* 看起来可用却带 pointer-events: none（含继承）：点击会穿透，同样算点不到。 */
            if (cs.pointerEvents === 'none') rec.noPointer = !el.closest('[inert],[aria-hidden="true"]');
            else rec.hitBy = hitTest(el, rect);
          }
        }

        if (cs.textOverflow === 'ellipsis' && el.scrollWidth > el.clientWidth + 1) {
          rec.trunc = true;
          rec.numAll = isNumericText(el.textContent || '');
        }
      }
      return { rec: rec, display: cs.display };
    }

    function push(el, parentIdx, outside) {
      var made = makeRecord(el, parentIdx, outside);
      records.push(made.rec);
      return { idx: records.length - 1, display: made.display };
    }

    /* root 之外的祖先：自上而下先入栈，保证父下标总小于子下标。 */
    var chain = [];
    for (var a = rootEl.parentElement; a; a = a.parentElement) chain.unshift(a);
    var parentIdx = -1;
    chain.forEach(function (anc) {
      parentIdx = push(anc, parentIdx, true).idx;
    });

    /* 前序遍历；display:none 的子树整个跳过（不渲染，也无从量取）。 */
    var stack = [[rootEl, parentIdx]];
    while (stack.length) {
      var item = stack.pop();
      var el = item[0];
      var pushed = push(el, item[1], false);
      if (pushed.display === 'none') continue;
      for (var i = el.children.length - 1; i >= 0; i--) {
        stack.push([el.children[i], pushed.idx]);
      }
    }
    return records;
  }

  /* 页面级数据：文档能否横向滚动（DC014），以及加载失败的字体族（DC017）。
   * 同一族里只要有一个字体文件加载成功就不算失败（unicode-range 分片常见）。 */
  function collectPage(win, doc) {
    var de = doc.documentElement;
    var byFamily = {};
    var pending = 0;
    if (doc.fonts && typeof doc.fonts.forEach === 'function') {
      doc.fonts.forEach(function (face) {
        var fam = firstFamily(face.family);
        if (!fam) return;
        if (!byFamily[fam]) byFamily[fam] = { error: false, loaded: false };
        if (face.status === 'error') byFamily[fam].error = true;
        else if (face.status === 'loaded') byFamily[fam].loaded = true;
        else if (face.status === 'loading') pending++;
      });
    }
    var failed = Object.keys(byFamily).filter(function (f) {
      return byFamily[f].error && !byFamily[f].loaded;
    }).sort();
    return {
      scrollWidth: de.scrollWidth,
      clientWidth: de.clientWidth,
      fontsFailed: failed,
      fontsPending: pending
    };
  }

  /* ------------------------------------------------------------------ */
  /* evaluate：纯函数                                                    */
  /* ------------------------------------------------------------------ */

  function normTokens(t) {
    var d = DEFAULT_TOKENS;
    t = t || {};
    var colors = {};
    Object.keys(d.colors).forEach(function (k) {
      colors[k] = (t.colors && t.colors[k]) || d.colors[k];
    });
    return {
      found: t.found === undefined ? true : !!t.found,
      small: t.small || d.small,
      body: t.body || d.body,
      title: t.title || d.title,
      page: t.page || d.page,
      radii: t.radii || d.radii.slice(),
      colors: colors
    };
  }

  function evaluate(records, ctx) {
    ctx = ctx || {};
    var tk = normTokens(ctx.tokens);
    var viewport = ctx.viewport || { width: 0, height: 0 };
    var touch = !!ctx.touch;
    var rootSel = ctx.root || 'html';
    var maxFindings = ctx.maxFindings > 0 ? ctx.maxFindings : DEFAULT_MAX_FINDINGS;

    var subjects = 0;
    records.forEach(function (r) { if (!r.outside) subjects++; });

    var order = ['DC001', 'DC003', 'DC005', 'DC007', 'DC008', 'DC010', 'DC012', 'DC013',
      'DC014', 'DC015', 'DC016', 'DC017', 'DC018', 'DC019', 'DC020'];
    var buckets = {};
    order.forEach(function (id) { buckets[id] = []; });

    function selectorOf(i) {
      var parts = [];
      var cur = i;
      for (var depth = 0; depth < 5 && cur >= 0; depth++) {
        var r = records[cur];
        var seg = r.seg || r.tag || '*';
        parts.unshift(seg);
        if (seg.charAt(0) === '#') break;
        cur = r.p;
      }
      return parts.join(' > ');
    }

    function rectOf(r) {
      var q = r.rect || { x: 0, y: 0, width: 0, height: 0 };
      return { x: q.x, y: q.y, width: q.width, height: q.height };
    }

    /* 元素或祖先带 data-dc-ignore 含该规则 id 且理由非空才生效。 */
    function ignored(i, rule) {
      for (var a = i; a >= 0; a = records[a].p) {
        var r = records[a];
        if (r.ign && r.ignWhy && String(r.ignWhy).trim() && hasToken(r.ign, rule.toLowerCase())) return true;
      }
      return false;
    }

    function add(rule, i, value, message, rectOverride, selectorOverride) {
      if (ignored(i, rule)) return;
      buckets[rule].push({
        rule: rule,
        selector: selectorOverride || selectorOf(i),
        rect: rectOverride || rectOf(records[i]),
        value: value,
        message: message
      });
    }

    function hasAncestor(i, pred) {
      for (var a = records[i].p; a >= 0; a = records[a].p) {
        if (pred(records[a], a)) return true;
      }
      return false;
    }

    /* ---- DC003 用：表面盒与浮层判断 ---- */
    var surfaceCache = {};
    function isSurface(i) {
      if (surfaceCache[i] !== undefined) return surfaceCache[i];
      var r = records[i];
      var ok = !!(r.vis && r.rect.width >= 64 && r.rect.height >= 40 && !r.form &&
        (r.border4 || r.shadow) && (r.radius || 0) >= 4 && r.bg);
      if (ok) {
        var a = r.p;
        while (a >= 0 && !records[a].bg) a = records[a].p;
        ok = a < 0 || records[a].bg !== r.bg;
      }
      surfaceCache[i] = ok;
      return ok;
    }

    function isOverlay(r) {
      return r.tag === 'dialog' || r.role === 'dialog' || !!r.popover || r.pos === 'fixed';
    }

    /* ---- DC007 用：强调色集合 ---- */
    var accentSet = {};
    ['accent', 'success', 'warning', 'danger', 'special'].forEach(function (k) {
      accentSet[tk.colors[k]] = true;
    });
    var accentRects = [];

    /* ---- DC012 用：分组 ---- */
    var primaryGroups = {};

    function scopeOf(i) {
      for (var a = records[i].p; a >= 0; a = records[a].p) {
        var r = records[a];
        if (r.view || r.tag === 'dialog' || r.role === 'dialog' || r.tag === 'main' || r.role === 'main') return a;
      }
      return -1;
    }

    /* ---- DC013 / 直方图 ---- */
    var fontHist = {};
    var radiusHist = {};
    var fontScale = [tk.small, tk.body, tk.title, tk.page].map(roundHalf);
    var radiusScale = tk.radii.map(roundHalf);
    var offFont = {};
    var offRadius = {};

    function onScale(v, scale) {
      for (var k = 0; k < scale.length; k++) {
        if (Math.abs(v - scale[k]) <= 0.26) return true;
      }
      return false;
    }

    /* ---- lists ---- */
    var listGroups = {};
    function addListItem(containerIdx, itemIdx) {
      if (!listGroups[containerIdx]) listGroups[containerIdx] = [];
      listGroups[containerIdx].push(itemIdx);
    }

    var vw = viewport.width || 0;
    var vh = viewport.height || 0;

    /* ---- DC014 / DC017 用：页面级数据（纯函数单测不传时这两条规则不运行） ---- */
    var page = ctx.page || null;
    var pageLimit = page ? (page.clientWidth || vw) : vw;
    var pageOverflow = !!page && page.scrollWidth > page.clientWidth + 1;
    var overflowCulprit = {};
    var failedFonts = {};
    if (page) (page.fontsFailed || []).forEach(function (f) { failedFonts[f] = true; });
    var fontGroups = {};
    var iconGroups = {};
    var imgGroups = {};

    /* 按 key 分组计数，组内取第一个未忽略的元素报告；忽略的元素不计数。 */
    function group(groups, key, i, rule) {
      if (ignored(i, rule)) return;
      if (!groups[key]) groups[key] = { idx: i, count: 0 };
      groups[key].count++;
    }

    /* 横向能裁住后代的容器（html / body 的 overflow 传给视口，不算），或固定定位（不撑开文档）。 */
    function containsX(anc) {
      return (anc.clipX && !VIEWPORT_TAGS[anc.tag]) || anc.pos === 'fixed';
    }

    records.forEach(function (r, i) {
      if (r.outside) return;
      /* DC018 破图：按地址合并；0×0 的破图看不见也要报，所以放在可见性过滤之前 */
      if (r.imgFail) group(imgGroups, r.imgFail, i, 'DC018');
      if (!r.vis) return;
      var tag = r.tag;
      var droles = r.drole || '';
      var isCell = !!(CELL_TAGS[tag] || BODY_ROLES[r.role]);

      /* DC019 布局属性没生效 */
      if (r.deadLayout) {
        add('DC019', i, r.deadLayout,
          'display 是 ' + r.deadLayout.display + '，这些属性不生效：' + r.deadLayout.props.join('、') + '。' +
          '复核：是否该是 flex / grid（可能被别的规则或断点改掉了 display）；有意在这个视口改成别的布局时删掉这些属性。');
      }

      /* DC020 图标字体丢失：私有区字符的字体族加载失败，图标会显示成方块或乱码 */
      if (r.icon && failedFonts[r.icon]) group(iconGroups, r.icon, i, 'DC020');

      /* DC014 页面级意外横向溢出：只报最外层伸出视口右边、且没被横向容器收住的元素 */
      if (pageOverflow && r.pos !== 'fixed' && r.rect.x + r.rect.width > pageLimit + 1 &&
        !(r.p >= 0 && overflowCulprit[r.p]) && !hasAncestor(i, containsX)) {
        overflowCulprit[i] = true;
        add('DC014', i, { right: round1(r.rect.x + r.rect.width), viewport: pageLimit, scrollWidth: page.scrollWidth },
          '元素右边缘到 ' + round1(r.rect.x + r.rect.width) + 'px，超出视口宽 ' + pageLimit + 'px，把整页撑出横向滚动。复核：' +
          '是否该放进 overflow-x: auto 的容器（表格、代码块），或改成换行 / 收缩；不要靠给 body 加 overflow: hidden 掩盖。');
      }

      /* DC015 焦点环被裁：元素整体在裁切容器里，但离容器内边的距离小于焦点环伸出的宽度 */
      if (r.inter && !r.disabled && r.ring > 0) {
        for (var ca = r.p; ca >= 0; ca = records[ca].p) {
          var c = records[ca];
          if (!c.clip || VIEWPORT_TAGS[c.tag]) continue;
          var gaps = [];
          if (c.clipX) gaps.push(r.rect.x - c.clip.x, c.clip.x + c.clip.width - (r.rect.x + r.rect.width));
          if (c.clipY) gaps.push(r.rect.y - c.clip.y, c.clip.y + c.clip.height - (r.rect.y + r.rect.height));
          if (!gaps.length) continue;
          var minGap = Math.min.apply(null, gaps);
          /* 有一边已经超出容器：元素被滚动到外面了，不是焦点环的问题。 */
          if (minGap < -0.5) continue;
          if (minGap < r.ring - 0.5) {
            add('DC015', i, { ring: r.ring, gap: round1(minGap), container: selectorOf(ca) },
              '焦点环约向外 ' + r.ring + 'px，但元素离裁切容器 ' + selectorOf(ca) + ' 的内边只有 ' + round1(minGap) + 'px，' +
              '键盘聚焦时焦点环会被裁掉。复核：给容器留出内边距，或这里改用内描边（--dc-focus-offset-inset）。');
            break;
          }
        }
      }

      /* DC016 点击被拦截：可交互元素的中心点命中了别的元素，或自己带 pointer-events: none */
      if (r.inter && !r.disabled && r.noPointer) {
        add('DC016', i, 'pointer-events: none',
          '元素看起来可用，但 computed pointer-events 是 none（可能继承自祖先），点击会穿透。' +
          '复核：暂时不可用时改成 disabled 或 aria-disabled，否则去掉 pointer-events: none。');
      } else if (r.hitBy) {
        add('DC016', i, r.hitBy,
          '元素中心点被 ' + r.hitBy + ' 盖住，点击到不了它。复核：遮挡层是否该有 pointer-events: none，' +
          '或层级、定位是否写错；对话框、菜单这类盖住外部控件的有意遮挡不在此列。');
      }

      /* DC017 字体回退：按第一字体族分组；直接文字就是图标字符的元素归 DC020，不重复计 */
      if (r.ff && failedFonts[r.ff] && r.hasText && !r.iconText) group(fontGroups, r.ff, i, 'DC017');

      /* DC001 字号过小 */
      if (r.hasText) {
        var bodyCarrier = !hasToken(droles, 'small') &&
          (!!BODY_TAGS[tag] || !!BODY_ROLES[r.role] || hasToken(droles, 'body'));
        var floor = bodyCarrier ? tk.body : tk.small;
        if (r.fs < floor - 0.01) {
          add('DC001', i, r.fs,
            '字号 ' + r.fs + 'px 低于' + (bodyCarrier ? '正文下限 --dc-text-body（' : '最小字号 --dc-text-small（') +
            floor + 'px）。复核：确认是否真是正文；次要信息可用 small。');
        }
      }

      /* DC003 卡片嵌套：内层表面盒告警 */
      if (isSurface(i) && !isOverlay(r)) {
        for (var a = r.p; a >= 0; a = records[a].p) {
          if (isOverlay(records[a])) break;
          if (isSurface(a)) {
            add('DC003', i, selectorOf(a),
              '带边框或阴影的圆角表面嵌在另一个表面里（外层 ' + selectorOf(a) + '）。复核：能否改成连续分区与 1px 分隔线。');
            break;
          }
        }
      }

      /* DC005 数字未等宽 */
      if ((isCell || r.inCell || hasToken(droles, 'number')) && r.num && String(r.fvn || '').indexOf('tabular-nums') < 0) {
        add('DC005', i, r.fvn || 'normal',
          '数字所在单元格（含单元格里的后代元素）没有 font-variant-numeric: tabular-nums。复核：字体本身是否已等宽。');
      }

      /* DC007 累计强调色面积（嵌套只算最外层） */
      if (r.bg && accentSet[r.bg] &&
        !hasAncestor(i, function (anc) { return !!(anc.bg && accentSet[anc.bg]); })) {
        var x1 = Math.max(r.rect.x, 0);
        var y1 = Math.max(r.rect.y, 0);
        var x2 = Math.min(r.rect.x + r.rect.width, vw);
        var y2 = Math.min(r.rect.y + r.rect.height, vh);
        if (x2 > x1 && y2 > y1) accentRects.push([x1, y1, x2, y2]);
      }

      /* DC008 触屏热区 */
      if (touch && r.inter && !r.disabled && (r.rect.width < 44 - 0.01 || r.rect.height < 44 - 0.01) && !r.inlinePara) {
        add('DC008', i, { width: r.rect.width, height: r.rect.height },
          '触屏下可点击区域 ' + r.rect.width + '×' + r.rect.height + 'px，小于 44px。复核：标签、伪元素是否扩大了实际命中区。');
      }

      /* DC010 关键内容被省略 */
      if (r.trunc) {
        var critical = r.num || r.numAll ||
          !!r.alert || !!r.invalid ||
          hasAncestor(i, function (anc) { return !!(anc.alert || anc.invalid); }) ||
          hasToken(droles, 'error') || hasToken(droles, 'money') || hasToken(droles, 'count');
        if (critical) {
          add('DC010', i, true,
            '数字或错误信息被省略号截断。复核：改为换行、限宽外露或提供完整值。');
        }
      }

      /* DC012 主按钮分组 */
      if ((tag === 'button' || r.role === 'button' || tag === 'a') && !r.disabled &&
        ((r.bg && r.bg === tk.colors.primaryBg) || hasToken(droles, 'primary'))) {
        var scope = scopeOf(i);
        if (!primaryGroups[scope]) primaryGroups[scope] = [];
        primaryGroups[scope].push(i);
      }

      /* 直方图与 DC013 候选 */
      if (r.hasText && r.fs > 0) {
        var fkey = roundHalf(r.fs);
        var fname = String(fkey);
        fontHist[fname] = (fontHist[fname] || 0) + 1;
        if (tk.found && !onScale(fkey, fontScale) && !ignored(i, 'DC013')) {
          if (!offFont[fname]) offFont[fname] = { idx: i, count: 0 };
          offFont[fname].count++;
        }
      }
      if ((r.radius || 0) > 0) {
        var shortSide = Math.min(r.rect.width, r.rect.height);
        var pill = r.radius >= 9999 || r.radius >= shortSide / 2 - 0.5;
        var rkey = pill ? 'pill' : String(roundHalf(r.radius));
        radiusHist[rkey] = (radiusHist[rkey] || 0) + 1;
        if (!pill && tk.found && !onScale(roundHalf(r.radius), radiusScale) && !ignored(i, 'DC013')) {
          if (!offRadius[rkey]) offRadius[rkey] = { idx: i, count: 0 };
          offRadius[rkey].count++;
        }
      }

      /* lists 候选 */
      if (r.role === 'row') {
        for (var g = r.p; g >= 0; g = records[g].p) {
          if (records[g].role === 'grid' || records[g].role === 'treegrid') { addListItem(g, i); break; }
        }
      } else if (tag === 'tr' && r.p >= 0 && records[r.p].tag === 'tbody' && records[r.p].p >= 0 &&
        records[records[r.p].p].tag === 'table') {
        addListItem(records[r.p].p, i);
      } else if (tag === 'li' && r.p >= 0 && (records[r.p].tag === 'ul' || records[r.p].tag === 'ol')) {
        addListItem(r.p, i);
      }
    });

    var firstSubject = -1;
    for (var fi = 0; fi < records.length; fi++) {
      if (!records[fi].outside) { firstSubject = fi; break; }
    }

    /* DC014：整页能横向滚动却找不到伸出的元素（如负外边距、伪元素撑开）时，报在 root 上；只查局部 root 时不报。 */
    if (pageOverflow && !Object.keys(overflowCulprit).length && rootSel === 'html' && firstSubject >= 0) {
      add('DC014', firstSubject, { right: page.scrollWidth, viewport: pageLimit, scrollWidth: page.scrollWidth },
        '文档宽 ' + page.scrollWidth + 'px，超出视口宽 ' + pageLimit + 'px，整页可以横向滚动，但没定位到伸出的元素。' +
        '复核：检查伪元素、负外边距和 transform。', { x: 0, y: 0, width: page.scrollWidth, height: vh }, rootSel);
    }

    /* DC017 */
    Object.keys(fontGroups).sort().forEach(function (fam) {
      var g = fontGroups[fam];
      add('DC017', g.idx, { family: fam, count: g.count },
        '字体族「' + fam + '」的字体文件加载失败，' + g.count + ' 个带文字的元素实际回退到了后备字体。' +
        '复核：@font-face 的 src 路径、跨域与格式；computed font-family 不能证明字体真的生效。');
    });

    /* DC018 */
    Object.keys(imgGroups).sort().forEach(function (src) {
      var g = imgGroups[src];
      add('DC018', g.idx, { src: src, count: g.count },
        '图片 ' + src + ' 请求结束了却没有像素（地址错误、跨域或格式不支持），' + g.count + ' 处使用。' +
        '复核：资源路径与响应；懒加载还没触发的图片不在此列。');
    });

    /* DC020 */
    Object.keys(iconGroups).sort().forEach(function (fam) {
      var g = iconGroups[fam];
      add('DC020', g.idx, { family: fam, count: g.count },
        '图标字体「' + fam + '」加载失败，' + g.count + ' 个图标会显示成方块或乱码。' +
        '复核：图标字体的 @font-face 路径；图标按钮另有可访问名称时，文字说明不受影响。');
    });

    /* DC012：同组多于一个，每个都告警 */
    Object.keys(primaryGroups).forEach(function (scope) {
      var group = primaryGroups[scope];
      if (group.length > 1) {
        group.forEach(function (i) {
          add('DC012', i, group.length,
            '同一视图有 ' + group.length + ' 个主按钮。复核：条件分支是否互斥。');
        });
      }
    });

    /* DC007：相互重叠的强调色矩形按并集面积算；个数超限时退回逐个相加。 */
    var accentArea = 0;
    var accentApprox = false;
    if (accentRects.length > MAX_UNION_RECTS) {
      accentApprox = true;
      accentRects.forEach(function (q) { accentArea += (q[2] - q[0]) * (q[3] - q[1]); });
    } else {
      accentArea = unionArea(accentRects);
    }
    var viewportArea = vw * vh;
    var accentRatio = viewportArea > 0 ? Math.round(accentArea / viewportArea * 1000) / 1000 : 0;
    if (accentRatio > 0.1) {
      var rootIdx = -1;
      for (var ri = 0; ri < records.length; ri++) {
        if (!records[ri].outside) { rootIdx = ri; break; }
      }
      if (rootIdx >= 0) {
        add('DC007', rootIdx, accentRatio,
          '强调色与语义色填充占视口 ' + Math.round(accentRatio * 1000) / 10 + '%，超过 10%。复核：按 color.md 的配额口径复核。',
          { x: 0, y: 0, width: vw, height: vh }, rootSel);
      }
    }

    /* DC013 */
    var offScale = { fontSizes: [], radii: [] };
    function numericKeys(obj) {
      return Object.keys(obj).sort(function (x, y) { return parseFloat(x) - parseFloat(y); });
    }
    numericKeys(offFont).forEach(function (k) {
      offScale.fontSizes.push(k);
      var o = offFont[k];
      add('DC013', o.idx, { kind: 'fontSize', value: parseFloat(k), count: o.count },
        '字号 ' + k + 'px 不在 token 刻度（' + fontScale.join('/') + 'px）上，出现 ' + o.count + ' 次。复核：是有意例外还是漂移。');
    });
    numericKeys(offRadius).forEach(function (k) {
      offScale.radii.push(k);
      var o = offRadius[k];
      add('DC013', o.idx, { kind: 'radius', value: parseFloat(k), count: o.count },
        '圆角 ' + k + 'px 不在 token 刻度（' + radiusScale.join('/') + 'px）上，出现 ' + o.count + ' 次。复核：是有意例外还是漂移。');
    });

    /* lists 指标 */
    var lists = [];
    Object.keys(listGroups).map(Number).sort(function (x, y) { return x - y; }).forEach(function (c) {
      var items = listGroups[c];
      if (items.length < 5) return;
      var fully = items.filter(function (i) {
        var q = records[i].rect;
        return q.x >= 0 && q.y >= 0 && q.x + q.width <= vw && q.y + q.height <= vh;
      }).length;
      lists.push({
        selector: selectorOf(c),
        items: items.length,
        medianRowHeight: round1(median(items.map(function (i) { return records[i].rect.height; }))),
        fullyVisible: fully
      });
    });

    function sortedHist(h) {
      var out = {};
      Object.keys(h).sort(function (x, y) {
        if (x === 'pill') return 1;
        if (y === 'pill') return -1;
        return parseFloat(x) - parseFloat(y);
      }).forEach(function (k) { out[k] = h[k]; });
      return out;
    }

    var all = [];
    order.forEach(function (id) { all = all.concat(buckets[id]); });

    var metrics = {
      accentRatio: accentRatio,
      fontSizes: sortedHist(fontHist),
      radii: sortedHist(radiusHist),
      offScale: offScale,
      lists: lists
    };
    if (accentApprox) metrics.accentApprox = true;
    if (page) {
      metrics.page = {
        scrollWidth: page.scrollWidth,
        clientWidth: page.clientWidth,
        fontsFailed: (page.fontsFailed || []).slice(),
        fontsPending: page.fontsPending || 0
      };
    }

    return {
      schema: SCHEMA,
      context: {
        viewport: { width: vw, height: vh },
        touch: touch,
        tokensFound: tk.found,
        nodes: ctx.nodes !== undefined ? ctx.nodes : subjects,
        root: rootSel
      },
      findings: all.slice(0, maxFindings),
      metrics: metrics,
      truncated: all.length > maxFindings,
      totalFindings: all.length,
      limits: LIMITS.slice()
    };
  }

  /* ------------------------------------------------------------------ */
  /* 主题对比（DC021）：collectColors 在页面里取颜色快照，themeDiff 比较两份快照 */
  /* ------------------------------------------------------------------ */

  /* 内容自带颜色的元素，不随主题变化是正常的，不参与比较。 */
  var MEDIA_TAGS = { img: 1, video: 1, canvas: 1, svg: 1, iframe: 1, picture: 1, object: 1, embed: 1 };

  function round2(n) {
    return Math.round(n * 100) / 100;
  }

  /* 把半透明颜色 top（[r, g, b, a]）叠到不透明的 under（[r, g, b]）上。 */
  function blend(top, under) {
    var a = top[3];
    return [0, 1, 2].map(function (k) { return Math.round(top[k] * a + under[k] * (1 - a)); });
  }

  /* WCAG 相对亮度与对比度。 */
  function luminance(rgb) {
    var ch = [rgb[0], rgb[1], rgb[2]].map(function (v) {
      v = v / 255;
      return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
  }

  function contrast(a, b) {
    var la = luminance(a);
    var lb = luminance(b);
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
  }

  /* 颜色快照，只读 DOM，不含页面正文文本：
   *   canvas  页面底色（body 的有效背景，没有就取 html）[r, g, b]
   *   items   可见元素：k 完整路径（两次加载间对齐用）、sel 报告用的短选择器、rect；
   *           有直接文字时 fg / bg 为叠到底色上的文字色与有效背景色，large 表示大字（门槛按 3:1）；
   *           自身背景不透明时 own 为该色，area 为它在视口内的面积占比
   * 背景链上遇到 background-image 时有效背景未知，跳过该元素；图片、视频、svg 等不参与。 */
  function collectColors(win, doc, opts) {
    opts = opts || {};
    var rootEl = opts.root ? doc.querySelector(opts.root) : doc.documentElement;
    if (!rootEl) {
      throw new Error('dense-audit：找不到 root 选择器对应的元素：' + opts.root);
    }
    if (rootEl.querySelectorAll('*').length + 1 > MAX_NODES) {
      throw new Error('dense-audit：root 内节点超过 ' + MAX_NODES + ' 的上限，请用 root 缩小检查范围');
    }
    var normalize = makeNormalizer(win, doc);
    var segOf = makeSegOf(win);
    var vw = win.innerWidth;
    var vh = win.innerHeight;
    var bgCache = new Map();
    var pathCache = new Map();

    function colorOf(str) {
      var n = normalize(str);
      if (!n) return null;
      var c = parseColor(n.rgb);
      return [c.r, c.g, c.b, n.a];
    }

    function noImage(cs) {
      return !cs.backgroundImage || cs.backgroundImage === 'none';
    }

    /* 有效背景：自身背景叠在父元素的有效背景上；到根还没遇到不透明背景、或遇到背景图时为 null。 */
    function effBg(el) {
      if (bgCache.has(el)) return bgCache.get(el);
      var cs = win.getComputedStyle(el);
      var res = null;
      if (noImage(cs)) {
        var own = colorOf(cs.backgroundColor);
        if (own && own[3] >= 0.999) res = own.slice(0, 3);
        else {
          var under = el.parentElement ? effBg(el.parentElement) : null;
          if (under) res = own && own[3] > 0 ? blend(own, under) : under;
        }
      }
      bgCache.set(el, res);
      return res;
    }

    function pathOf(el) {
      if (pathCache.has(el)) return pathCache.get(el);
      var p = el.parentElement ? pathOf(el.parentElement) + ' > ' + segOf(el) : segOf(el);
      pathCache.set(el, p);
      return p;
    }

    function shortSel(el) {
      var parts = [];
      for (var n = el, depth = 0; n && depth < 5; n = n.parentElement, depth++) {
        var seg = segOf(n);
        parts.unshift(seg);
        if (seg.charAt(0) === '#') break;
      }
      return parts.join(' > ');
    }

    function ignoredEl(el) {
      for (var n = el; n; n = n.parentElement) {
        var why = n.getAttribute('data-dc-ignore-reason');
        if (why && why.trim() && hasToken(n.getAttribute('data-dc-ignore'), 'dc021')) return true;
      }
      return false;
    }

    var items = [];
    var stack = [rootEl];
    while (stack.length) {
      var el = stack.pop();
      var cs = win.getComputedStyle(el);
      if (cs.display === 'none' || MEDIA_TAGS[el.localName]) continue;
      for (var i = el.children.length - 1; i >= 0; i--) stack.push(el.children[i]);
      var rect = el.getBoundingClientRect();
      if (!(rect.width > 0 && rect.height > 0)) continue;
      if (typeof el.checkVisibility === 'function' &&
        !el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) continue;
      if (ignoredEl(el)) continue;
      var bg = effBg(el);
      if (!bg) continue;

      var item = null;
      var text = false;
      for (var n = el.firstChild; n; n = n.nextSibling) {
        if (n.nodeType === 3 && /\S/.test(n.data)) { text = true; break; }
      }
      if (text) {
        var fg = colorOf(cs.color);
        if (fg && fg[3] > 0) {
          var size = parseFloat(cs.fontSize) || 0;
          var weight = parseInt(cs.fontWeight, 10) || 400;
          item = {
            fg: fg[3] >= 0.999 ? fg.slice(0, 3) : blend(fg, bg),
            bg: bg,
            large: size >= 24 || (size >= 18.66 && weight >= 700)
          };
        }
      }
      var own = colorOf(cs.backgroundColor);
      if (own && own[3] >= 0.999 && noImage(cs)) {
        var w = Math.max(0, Math.min(rect.right, vw) - Math.max(rect.left, 0));
        var h = Math.max(0, Math.min(rect.bottom, vh) - Math.max(rect.top, 0));
        var area = vw * vh > 0 ? w * h / (vw * vh) : 0;
        if (area > 0) {
          item = item || {};
          item.own = own.slice(0, 3);
          item.area = Math.round(area * 1000) / 1000;
        }
      }
      if (!item) continue;
      item.k = pathOf(el);
      item.sel = shortSel(el);
      item.rect = { x: round1(rect.x), y: round1(rect.y), width: round1(rect.width), height: round1(rect.height) };
      items.push(item);
    }
    var canvas = (doc.body && effBg(doc.body)) || effBg(doc.documentElement);
    return { canvas: canvas, items: items };
  }

  /* 比较同一页面在两种配色方案下的颜色快照，返回在 b 方案下出现的 DC021 发现（结构同报告 findings）。
   * 只有页面底色亮度明显变化（确实切了深浅）时才比较；按完整路径 k 对齐两次加载的元素。
   *   surface  自身背景两次相同、接近中性灰，在 a 下与底色同深浅、在 b 下相反：成了局部反色，只报最外层
   *   text     在 a 下达标、在 b 下对比度不足，且文字色或背景色有一个两次完全相同：颜色写死了没跟主题
   * 已报 surface 的区域里的元素不再报。 */
  function themeDiff(a, b, ctx) {
    ctx = ctx || {};
    var out = [];
    if (!a || !b || !a.canvas || !b.canvas) return out;
    if (Math.abs(luminance(a.canvas) - luminance(b.canvas)) < 0.3) return out;
    var scheme = ctx.scheme || null;
    var byKey = {};
    a.items.forEach(function (it) { byKey[it.k] = it; });
    function dark(rgb) { return luminance(rgb) < 0.18; }
    function same(x, y) { return !!x && !!y && x[0] === y[0] && x[1] === y[1] && x[2] === y[2]; }
    function neutral(rgb) { return Math.max(rgb[0], rgb[1], rgb[2]) - Math.min(rgb[0], rgb[1], rgb[2]) <= 30; }
    function css(rgb) { return 'rgb(' + rgb[0] + ', ' + rgb[1] + ', ' + rgb[2] + ')'; }
    var islands = [];

    b.items.forEach(function (it) {
      var prev = byKey[it.k];
      if (!prev) return;
      for (var s = 0; s < islands.length; s++) {
        if (it.k.indexOf(islands[s] + ' > ') === 0) return;
      }
      if (it.own && prev.own && it.area >= 0.01 && same(it.own, prev.own) && neutral(it.own) &&
        dark(prev.own) === dark(a.canvas) && dark(it.own) !== dark(b.canvas)) {
        islands.push(it.k);
        out.push({
          rule: 'DC021',
          selector: it.sel,
          rect: it.rect,
          value: { scheme: scheme, kind: 'surface', bg: css(it.own), area: it.area },
          message: '切到 ' + (scheme || '另一种配色') + ' 后这块区域仍是 ' + css(it.own) + '，和页面底色深浅相反，成了局部反色。' +
            '复核：背景改用主题 token；确需固定颜色的内容（代码块、品牌区）用 data-dc-ignore 写明理由。'
        });
        return;
      }
      if (it.fg && prev.fg) {
        var need = it.large ? 3 : 4.5;
        var now = contrast(it.fg, it.bg);
        var before = contrast(prev.fg, prev.bg);
        var stuck = same(it.fg, prev.fg) ? 'color' : (same(it.bg, prev.bg) ? 'background' : null);
        if (now < need && before >= need && stuck) {
          out.push({
            rule: 'DC021',
            selector: it.sel,
            rect: it.rect,
            value: { scheme: scheme, kind: 'text', contrast: round2(now), unchanged: stuck, fg: css(it.fg), bg: css(it.bg) },
            message: '切到 ' + (scheme || '另一种配色') + ' 后文字对比度只有 ' + round2(now) + ':1（需要 ≥' + need + ':1），' +
              (stuck === 'color' ? '文字颜色' : '背景色') + '没有跟着主题变。复核：把写死的颜色换成主题 token。'
          });
        }
      }
    });
    return out;
  }

  /* ------------------------------------------------------------------ */
  /* 入口                                                                */
  /* ------------------------------------------------------------------ */

  function denseAudit(opts) {
    opts = opts || {};
    var win = window;
    var doc = document;
    var touch = opts.touch !== undefined
      ? !!opts.touch
      : !!(win.matchMedia && win.matchMedia('(pointer: coarse)').matches);
    var records = collect(win, doc, opts);
    var ctx = {
      viewport: { width: win.innerWidth, height: win.innerHeight },
      touch: touch,
      tokens: readTokens(win, doc),
      page: collectPage(win, doc),
      root: opts.root || 'html',
      maxFindings: opts.maxFindings > 0 ? opts.maxFindings : DEFAULT_MAX_FINDINGS
    };
    return evaluate(records, ctx);
  }

  globalThis.denseAudit = denseAudit;
  globalThis.denseAuditEvaluate = evaluate;
  globalThis.denseAuditColors = function (opts) { return collectColors(window, document, opts); };
  globalThis.denseAuditThemeDiff = themeDiff;
})();
