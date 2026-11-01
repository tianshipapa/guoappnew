// XBPQ 选择器子集（p: / jsoup: 语法）：移植 provider_xbpq.go 的选择器部分。
//
//   p:div.video-info > h3.title         空格或 > 分隔后代
//   p:a[href]                           末尾 [attr] 形式表示取该属性值
//   p:div.item[data-id=12]              属性等值过滤
//   p:li[包含:高清]                     目标节点文本包含过滤
//   p:div.list [不包含:广告]

import {
  parseHTML,
  getAttr,
  hasAttr,
  hasClass,
  textContent,
  renderHTML,
  cleanText,
  descendants,
} from '../html.mjs';

function matchBracket(token) {
  for (let index = token.length - 2; index >= 0; index--) {
    if (token[index] === ']') return -1;
    if (token[index] === '[') return index;
  }
  return -1;
}

function splitList(payload) {
  return String(payload || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function parsePart(token) {
  const part = { tag: '', classes: [], id: '', attrs: [], attr: '', contains: [], notContains: [] };
  const brackets = [];
  let base = '';
  for (let index = 0; index < token.length; ) {
    if (token[index] === '[') {
      const closing = token.indexOf(']', index);
      if (closing < 0) return null;
      brackets.push(token.slice(index + 1, closing));
      index = closing + 1;
      continue;
    }
    base += token[index];
    index++;
  }
  let name = base;
  const dot = name.indexOf('.');
  if (dot >= 0) {
    for (const className of name.slice(dot + 1).split('.')) {
      if (className) part.classes.push(className);
    }
    name = name.slice(0, dot);
  }
  const hash = name.indexOf('#');
  if (hash >= 0) {
    if (name.length > hash + 1) part.id = name.slice(hash + 1);
    name = name.slice(0, hash);
  }
  if (name) part.tag = name.toLowerCase();

  for (const bracket of brackets) {
    if (!bracket) continue;
    if (bracket.includes('=') || bracket.includes('`')) {
      const cleaned = bracket.replace(/`/g, '');
      const eq = cleaned.indexOf('=');
      const key = cleaned.slice(0, eq).trim().toLowerCase();
      const value = cleaned.slice(eq + 1).trim().replace(/^['"]|['"]$/g, '');
      part.attrs.push([key, value]);
      continue;
    }
    part.attr = bracket.trim();
  }
  return part;
}

/** 解析选择器 pattern；非 p:/jsoup: 前缀返回 null。 */
export function parseSelector(pattern) {
  let body = String(pattern || '');
  if (body.startsWith('p:')) body = body.slice(2);
  else if (body.startsWith('jsoup:')) body = body.slice(6);
  else return null;

  const contains = [];
  const notContains = [];
  for (;;) {
    if (!body.endsWith(']')) break;
    const open = matchBracket(body);
    if (open < 0) break;
    const inner = body.slice(open + 1, -1);
    const colon = inner.indexOf(':');
    const word = (colon >= 0 ? inner.slice(0, colon) : inner).trim();
    const payload = colon >= 0 ? inner.slice(colon + 1) : '';
    if (word === '包含') {
      contains.push(...splitList(payload));
      body = body.slice(0, open).trim();
      continue;
    }
    if (word === '不包含') {
      notContains.push(...splitList(payload));
      body = body.slice(0, open).trim();
      continue;
    }
    break;
  }

  const tokens = body.split(/[\s>]+/).filter(Boolean);
  const parts = [];
  for (const token of tokens) {
    const part = parsePart(token);
    if (!part) return null;
    parts.push(part);
  }
  if (parts.length === 0) return null;

  const target = parts[parts.length - 1];
  target.contains.push(...contains);
  target.notContains.push(...notContains);
  const extract = /\[html\]/i.test(pattern) ? 'html' : 'text';
  return { ancestors: parts.slice(0, -1), target, extract };
}

function partMatches(node, part) {
  if (!node || node.type !== 'element') return false;
  if (part.tag && node.tag !== part.tag) return false;
  if (part.id && getAttr(node, 'id') !== part.id) return false;
  for (const className of part.classes) {
    if (!hasClass(node, className)) return false;
  }
  for (const [key, value] of part.attrs) {
    if (!hasAttr(node, key)) return false;
    if (value && getAttr(node, key) !== value) return false;
  }
  if (part.contains.length || part.notContains.length) {
    const text = textContent(node);
    for (const word of part.contains) if (!text.includes(word)) return false;
    for (const word of part.notContains) if (text.includes(word)) return false;
  }
  return true;
}

function hasAncestorChain(node, ancestors) {
  if (ancestors.length === 0) return true;
  let need = ancestors.length - 1;
  let current = node.parent;
  while (current && need >= 0) {
    if (current.type === 'element' && partMatches(current, ancestors[need])) need--;
    current = current.parent;
  }
  return need < 0;
}

/** 在文档/节点上执行选择器，返回目标节点列表。 */
export function selectorNodes(scope, selector) {
  const found = [];
  for (const node of descendants(scope, false)) {
    if (!partMatches(node, selector.target)) continue;
    if (!hasAncestorChain(node, selector.ancestors)) continue;
    found.push(node);
  }
  return found;
}

function extractValue(node, target, extract) {
  if (target.attr) return getAttr(node, target.attr).trim();
  if (extract === 'html') return renderHTML(node);
  return textContent(node);
}

export function selectorStrings(sourceHTML, pattern) {
  const selector = parseSelector(pattern);
  if (!selector) return [];
  const document = typeof sourceHTML === 'string' ? parseHTML(sourceHTML) : sourceHTML;
  return selectorNodes(document, selector).map((node) =>
    extractValue(node, selector.target, selector.extract)
  );
}

export function selectorFirstString(sourceHTML, pattern) {
  const values = selectorStrings(sourceHTML, pattern);
  return values.length ? values[0] : '';
}

/** node 是否在 scope 之内（含自身）。 */
export function partWithin(node, scope) {
  if (!scope) return true;
  let current = node;
  while (current) {
    if (current === scope) return true;
    current = current.parent;
  }
  return false;
}

/** 供 item 级截取：在条目节点内跑选择器，找不到再回到整页找属于该条目的第一个。 */
export function selectorWithin(node, document, pattern) {
  const selector = parseSelector(pattern);
  if (!selector) return '';
  const scoped = selectorNodes(node, selector).filter((item) => partWithin(item, node));
  if (scoped.length) return cleanText(extractValue(scoped[0], selector.target, selector.extract));
  if (document) {
    for (const item of selectorNodes(document, selector)) {
      if (!partWithin(item, node)) continue;
      return cleanText(extractValue(item, selector.target, selector.extract));
    }
  }
  return '';
}
