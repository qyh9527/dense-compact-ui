/* dense-compact-ui 浏览器内量取脚本（经典脚本，零依赖，不联网，不改 DOM）。
 *
 * 用法：用任何浏览器工具把本文件全文注入当前页面，再执行
 *   denseAudit({ touch: true, root: 'main', maxFindings: 200 })
 * 返回 dense-audit-v1 报告（纯 JSON 数据）。检出是复核线索，不是判决。
 *
 * 结构：
 *   readTokens(win, doc)       读 --dc-* token，读不到就回落到默认值
 *   collect(win, doc, opts)    只读 DOM，产出 records（纯数据，不含页面正文文本）
 *   evaluate(records, ctx)     纯函数：records + ctx -> 报告，可在 Node 里单测
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
   *   inCell   自身或祖先是单元格（td、th、role=gridcell|cell），向上只找到最近的 table、grid、treegrid 为止 */
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

    function parsePx(value) {
      var n = parseFloat(value);
      return isNaN(n) ? 0 : n;
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
        inCell: inCellOf(el, tag, role, parentIdx)
      };

      var bg = normalize(cs.backgroundColor);
      if (bg && bg.a >= 0.999) rec.bg = bg.rgb;

      if (vis) {
        /* 圆角取左上角，百分比按元素宽度换算。 */
        var rm = /^(-?[\d.]+)(px|%)/.exec(cs.borderTopLeftRadius || '');
        if (rm) rec.radius = rm[2] === '%' ? parseFloat(rm[1]) * rect.width / 100 : parseFloat(rm[1]);
        rec.border4 = ['Top', 'Right', 'Bottom', 'Left'].every(function (side) {
          return parsePx(cs['border' + side + 'Width']) > 0 && cs['border' + side + 'Style'] !== 'none';
        });
        rec.shadow = !!cs.boxShadow && cs.boxShadow !== 'none';

        rec.inter = el.matches(INTERACTIVE_SELECTOR);
        if (rec.inter) {
          rec.disabled = el.matches(':disabled') || el.getAttribute('aria-disabled') === 'true';
          var par = el.parentElement;
          if (tag === 'a' && cs.display === 'inline' && par && PARAGRAPH_TAGS[par.localName]) {
            rec.inlinePara = directTextInfo(par).any;
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

    var order = ['DC001', 'DC003', 'DC005', 'DC007', 'DC008', 'DC010', 'DC012', 'DC013'];
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

    records.forEach(function (r, i) {
      if (r.outside || !r.vis) return;
      var tag = r.tag;
      var droles = r.drole || '';
      var isCell = !!(CELL_TAGS[tag] || BODY_ROLES[r.role]);

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
      root: opts.root || 'html',
      maxFindings: opts.maxFindings > 0 ? opts.maxFindings : DEFAULT_MAX_FINDINGS
    };
    return evaluate(records, ctx);
  }

  globalThis.denseAudit = denseAudit;
  globalThis.denseAuditEvaluate = evaluate;
})();
