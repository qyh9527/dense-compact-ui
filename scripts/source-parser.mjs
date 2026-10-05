import { parse } from '@babel/parser';
import { parse as parseHtml } from 'parse5';

function literal(node) {
  if (!node) return undefined;
  if (['StringLiteral', 'NumericLiteral', 'BooleanLiteral'].includes(node.type)) return node.value;
  if (node.type === 'JSXExpressionContainer') return literal(node.expression);
  if (node.type === 'ObjectExpression' && node.properties.every(p => p.type === 'ObjectProperty' && !p.computed)) return Object.fromEntries(node.properties
    .filter(p => p.type === 'ObjectProperty' && !p.computed)
    .map(p => [p.key.name || p.key.value, literal(p.value)]));
  return undefined;
}

function record(attrs, id, parent, line, view, tag) {
  const raw = attrs.style;
  const style = typeof raw === 'string' ? Object.fromEntries(raw.split(';').map(p => p.split(':').map(x => x.trim()))) : raw || {};
  const size = style.fontSize ?? style['font-size'];
  const classes = String(attrs.class || attrs.className || '').split(/\s+/);
  const exactSize = classes.map(c => c.match(/^text-\[(\d+(?:\.\d+)?)px\]$/)).find(Boolean);
  const numeric = typeof size === 'string' && /^\d+(\.\d+)?px$/.test(size) ? parseFloat(size) : undefined;
  const unknownInline = attrs.__styleUnknown || ('style' in attrs && raw === undefined) ||
    (('fontSize' in style || 'font-size' in style) && numeric === undefined && !Number.isFinite(size));
  return { id, parent, location: `${view.file}:${line}`, tag, view: attrs['data-dc-view'] !== undefined ? id : view.scope,
    roles: String(attrs['data-dc-role'] || '').split(/\s+/).filter(Boolean),
    fontSize: numeric ?? (Number.isFinite(size) ? size : !unknownInline && exactSize ? Number(exactSize[1]) : undefined),
    ellipsis: style.textOverflow === 'ellipsis' || style['text-overflow'] === 'ellipsis' || classes.includes('truncate'),
    hidden: attrs.hidden === true || attrs.hidden === '',
    disabled: attrs.disabled === true || attrs.disabled === '',
    ignore: String(attrs['data-dc-ignore'] || '').split(/\s+/), ignoreReason: attrs['data-dc-ignore-reason'] };
}

export function parseSource(text, file) {
  const records = [];
  if (/\.(jsx|tsx)$/.test(file)) {
    const ast = parse(text, { sourceType: 'unambiguous', plugins: ['jsx', ...(file.endsWith('.tsx') ? ['typescript'] : [])] });
    const walk = (node, parent, scope) => {
      if (!node || typeof node !== 'object') return;
      if (node.type === 'JSXElement') {
        const attributes = node.openingElement.attributes;
        const lastSpread = attributes.findLastIndex(a => a.type === 'JSXSpreadAttribute');
        const attrs = Object.fromEntries(attributes.slice(lastSpread + 1).filter(a => a.type === 'JSXAttribute')
          .map(a => [a.name.name, a.value ? literal(a.value) : true]));
        attrs.__styleUnknown = lastSpread >= 0 && !('style' in attrs);
        const id = `${file}:${node.start}`;
        const n = record(attrs, id, parent, node.loc.start.line, { file, scope }, node.openingElement.name.name);
        records.push(n);
        for (const child of node.children) walk(child, id, n.view);
        return;
      }
      for (const [key, value] of Object.entries(node)) {
        if (['loc', 'start', 'end', 'extra', 'comments', 'tokens'].includes(key)) continue;
        if (Array.isArray(value)) for (const v of value) walk(v, parent, scope);
        else if (value && typeof value === 'object') walk(value, parent, scope);
      }
    };
    walk(ast, null, null);
  } else if (file.endsWith('.html')) {
    const walk = (node, parent, scope) => {
      let id = parent;
      if (node.tagName) {
        id = `${file}:${records.length}`;
        const attrs = Object.fromEntries((node.attrs || []).map(a => [a.name, a.value]));
        if ('hidden' in attrs) attrs.hidden = true;
        if ('disabled' in attrs) attrs.disabled = true;
        const n = record(attrs, id, parent, node.sourceCodeLocation?.startLine || 1, { file, scope }, node.tagName);
        records.push(n); scope = n.view;
      }
      for (const child of node.childNodes || []) walk(child, id, scope);
    };
    walk(parseHtml(text, { sourceCodeLocationInfo: true }), null, null);
  } else throw new Error(`不支持的源码类型：${file}；请使用平台测试或已支持的适配器。`);
  return records;
}
