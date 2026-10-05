export const RULES = ['DC001', 'DC003', 'DC005', 'DC008', 'DC010', 'DC012'];

export function inspect(records, { evidence = 'source', touch = false, minBody = 13, mode = 'operate' } = {}) {
  const findings = [];
  const index = new Map(records.map(n => [n.id, n]));
  const emit = (n, rule, message) => {
    if (n.ignore?.includes(rule) && typeof n.ignoreReason === 'string' && n.ignoreReason.trim()) return;
    findings.push({ rule, location: n.location || n.id, evidence, message });
  };
  const roles = n => new Set(n.roles || []);
  const visible = records.filter(n => {
    const seen = new Set();
    let current = n;
    while (current && !seen.has(current.id)) {
      if (current.hidden) return false;
      seen.add(current.id); current = index.get(current.parent);
    }
    return true;
  });
  for (const n of visible) {
    const r = roles(n);
    if (r.has('body') && Number.isFinite(n.fontSize) && n.fontSize < minBody) {
      emit(n, 'DC001', `正文尺寸 ${n.fontSize}px，低于当前 Web 下限 ${minBody}px；核对正文角色与实际渲染。`);
    }
    if (mode === 'operate' && r.has('card')) {
      let ancestor = index.get(n.parent);
      const visited = new Set();
      while (ancestor && !visited.has(ancestor.id)) {
        visited.add(ancestor.id);
        if (roles(ancestor).has('overlay')) break;
        if (roles(ancestor).has('card')) {
          emit(n, 'DC003', '卡片角色嵌套；核对是否可用连续分区表达关系。');
          break;
        }
        ancestor = index.get(ancestor.parent);
      }
    }
    if (evidence === 'rendered' && ['number', 'money', 'count'].some(x => r.has(x)) && !n.tabular) {
      emit(n, 'DC005', '数字角色未声明 tabular-nums；核对所用字体的等宽数字能力。');
    }
    if (evidence === 'rendered' && touch && n.interactive && !n.disabled && (n.width < 44 || n.height < 44)) {
      emit(n, 'DC008', `可交互元素边界 ${n.width}×${n.height}px，小于 44px Web 触屏设计目标；核对标签、伪元素与真实命中区域。`);
    }
    if (['money', 'count', 'error'].some(x => r.has(x)) && n.ellipsis && (evidence === 'source' || n.clipped)) {
      emit(n, 'DC010', '金额、计数或错误角色使用省略裁切；提供完整可读内容。');
    }
  }
  if (mode === 'operate') {
    const scopes = new Map();
    for (const n of visible.filter(n => roles(n).has('primary') && n.view && !n.disabled)) {
      const list = scopes.get(n.view) || [];
      list.push(n); scopes.set(n.view, list);
    }
    for (const list of scopes.values()) if (list.length > 1) {
      for (const n of list) emit(n, 'DC012', `同一显式视图有 ${list.length} 个主操作；源码条件分支与运行时可见性需核对。`);
    }
  }
  return { findings, checkedRules: evidence === 'source' ? ['DC001', 'DC003', 'DC010', 'DC012'] : RULES,
    coverage: { nodes: records.length, semanticNodes: records.filter(n => n.roles?.length).length },
    note: evidence === 'source' ? '源码疑点：未解析 CSS 级联、组件渲染或条件可见性；零结果不代表验收通过。' : '当前 Web 快照：只覆盖已标记角色和可见交互元素；不证明真实手势、读屏或全部 WCAG 要求。' };
}
