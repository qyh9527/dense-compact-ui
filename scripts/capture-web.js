// 可在已授权的页面内执行；只读取角色、计算样式和几何尺寸，不收集正文或发送数据。
globalThis.captureDenseUI = function captureDenseUI({ touch = false } = {}) {
  const all = [...document.querySelectorAll('*')];
  if (all.length > 20000) throw new Error('页面超过 20000 节点，请先限定检查页面。');
  const ids = new Map(all.map((el, i) => [el, `node-${i}`]));
  const nodes = [];
  for (const el of all) {
    const style = getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    const hidden = !el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true });
    const roles = (el.getAttribute('data-dc-role') || '').split(/\s+/).filter(Boolean);
    const interactive = el.matches('button, a[href], input:not([type="hidden"]), select, textarea, [role="button"], [role="link"], [tabindex="0"]');
    nodes.push({ id: ids.get(el), parent: ids.get(el.parentElement) || null,
      location: el.id ? `#${el.id}` : `${el.localName}[node=${ids.get(el)}]`, roles,
      view: ids.get(el.closest('[data-dc-view]')) || null,
      fontSize: parseFloat(style.fontSize), width: rect.width, height: rect.height,
      tabular: style.fontVariantNumeric.includes('tabular-nums'),
      ellipsis: style.textOverflow === 'ellipsis', clipped: ['hidden', 'clip', 'scroll', 'auto'].includes(style.overflowX) && el.scrollWidth > el.clientWidth,
      interactive, disabled: el.matches(':disabled') || el.getAttribute('aria-disabled') === 'true', hidden,
      ignore: (el.getAttribute('data-dc-ignore') || '').split(/\s+/), ignoreReason: el.getAttribute('data-dc-ignore-reason') });
  }
  return { schema: 'dense-ui-web-v1', context: { touch, viewport: { width: innerWidth, height: innerHeight },
    capturedAt: new Date().toISOString(), platform: 'web', unit: 'css-px' }, nodes };
};
