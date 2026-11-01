// 轻量 HTML 解析与选择器匹配。
//
// 作用等价于 Go 侧 golang.org/x/net/html + providerHTML* 辅助函数：XBPQ 规则的
// `p:` 选择器语法（标签.类#id[attr=val] 空格/`>` 分隔后代）需要一棵可回溯的
// 元素树，所以这里实现一个够用的容错解析器，而不是用正则硬啃。

const VOID_TAGS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
  'link', 'meta', 'param', 'source', 'track', 'wbr',
]);

const RAW_TEXT_TAGS = new Set(['script', 'style', 'textarea', 'title', 'xmp']);

// 遇到新标签时隐式闭合的旧标签（HTML 常见简写：未闭合的 <li>/<p>/<td>）。
const IMPLICIT_CLOSE = {
  li: new Set(['li']),
  p: new Set(['p']),
  tr: new Set(['tr', 'td', 'th']),
  td: new Set(['td', 'th']),
  th: new Set(['td', 'th']),
  option: new Set(['option']),
  dt: new Set(['dt', 'dd']),
  dd: new Set(['dt', 'dd']),
  thead: new Set(['tbody', 'thead', 'tfoot']),
  tbody: new Set(['tbody', 'thead', 'tfoot']),
};

const ENTITY_MAP = {
  nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'",
  ldquo: '“', rdquo: '”', lsquo: '‘', rsquo: '’', hellip: '…',
  mdash: '—', ndash: '–', middot: '·', copy: '©', reg: '®',
  times: '×', divide: '÷', laquo: '«', raquo: '»', deg: '°',
};

export function decodeEntities(text) {
  if (!text || text.indexOf('&') < 0) return text || '';
  return text.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);?/g, (match, body) => {
    if (body[0] === '#') {
      const hex = body[1] === 'x' || body[1] === 'X';
      const code = Number.parseInt(hex ? body.slice(2) : body.slice(1), hex ? 16 : 10);
      if (Number.isFinite(code) && code > 0 && code <= 0x10ffff) {
        try {
          return String.fromCodePoint(code);
        } catch {
          return match;
        }
      }
      return match;
    }
    const mapped = ENTITY_MAP[body.toLowerCase()];
    return mapped == null ? match : mapped;
  });
}

export function escapeHTML(text) {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function createElement(tag) {
  return {
    type: 'element',
    tag,
    attrs: [],
    children: [],
    parent: null,
  };
}

function attrValue(node, name) {
  const lower = name.toLowerCase();
  for (const [key, value] of node.attrs) {
    if (key.toLowerCase() === lower) return value;
  }
  return null;
}

const ATTR_PATTERN = /([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;

function parseAttrs(source) {
  const attrs = [];
  ATTR_PATTERN.lastIndex = 0;
  let match;
  while ((match = ATTR_PATTERN.exec(source))) {
    const name = match[1];
    if (!name || name === '/' || name === '>') continue;
    const value = match[2] ?? match[3] ?? match[4] ?? '';
    attrs.push([name, decodeEntities(value)]);
  }
  return attrs;
}

/**
 * 解析 HTML 文本，返回文档根节点（type: 'document'）。
 * 容错优先：非法标签当文本，未闭合标签在父级结束时收口。
 */
export function parseHTML(html) {
  const root = { type: 'document', tag: '#document', attrs: [], children: [], parent: null };
  let current = root;
  const stack = [root];
  const source = String(html || '');
  let index = 0;

  const pushText = (text) => {
    if (!text) return;
    const decoded = decodeEntities(text);
    if (!decoded) return;
    const last = current.children[current.children.length - 1];
    if (last && last.type === 'text') {
      last.text += decoded;
      return;
    }
    current.children.push({ type: 'text', text: decoded, parent: current });
  };

  const closeTo = (tag) => {
    for (let i = stack.length - 1; i > 0; i--) {
      if (stack[i].tag === tag) {
        stack.length = i;
        current = stack[stack.length - 1];
        return true;
      }
    }
    return false;
  };

  while (index < source.length) {
    const next = source.indexOf('<', index);
    if (next < 0) {
      pushText(source.slice(index));
      break;
    }
    if (next > index) pushText(source.slice(index, next));

    // 注释 / CDATA / DOCTYPE
    if (source.startsWith('<!--', next)) {
      const end = source.indexOf('-->', next + 4);
      index = end < 0 ? source.length : end + 3;
      continue;
    }
    if (source.startsWith('<![CDATA[', next)) {
      const end = source.indexOf(']]>', next + 9);
      const body = end < 0 ? source.slice(next + 9) : source.slice(next + 9, end);
      pushText(body);
      index = end < 0 ? source.length : end + 3;
      continue;
    }
    if (source[next + 1] === '!' || source[next + 1] === '?') {
      const end = source.indexOf('>', next);
      index = end < 0 ? source.length : end + 1;
      continue;
    }

    const closing = source[next + 1] === '/';
    const nameStart = next + (closing ? 2 : 1);
    const nameMatch = /^[a-zA-Z][a-zA-Z0-9:-]*/.exec(source.slice(nameStart, nameStart + 64));
    if (!nameMatch) {
      pushText('<');
      index = next + 1;
      continue;
    }
    const tag = nameMatch[0].toLowerCase();
    const afterName = nameStart + nameMatch[0].length;

    // 找到标签结束的 '>'（跳过引号内的内容）
    let cursor = afterName;
    let quote = '';
    while (cursor < source.length) {
      const char = source[cursor];
      if (quote) {
        if (char === quote) quote = '';
      } else if (char === '"' || char === "'") {
        quote = char;
      } else if (char === '>') {
        break;
      }
      cursor++;
    }
    const inner = source.slice(afterName, cursor);
    index = cursor + 1;

    if (closing) {
      closeTo(tag);
      continue;
    }

    const implicit = IMPLICIT_CLOSE[tag];
    if (implicit && current.tag && implicit.has(current.tag)) {
      closeTo(current.tag);
    }

    const element = createElement(tag);
    element.attrs = parseAttrs(inner);
    element.parent = current;
    current.children.push(element);

    if (VOID_TAGS.has(tag)) continue;
    if (inner.trimEnd().endsWith('/')) continue;

    stack.push(element);
    current = element;

    if (RAW_TEXT_TAGS.has(tag)) {
      const closeTag = `</${tag}`;
      const end = source.toLowerCase().indexOf(closeTag, index);
      const body = end < 0 ? source.slice(index) : source.slice(index, end);
      if (body) element.children.push({ type: 'text', text: body, parent: element });
      if (end < 0) {
        index = source.length;
      } else {
        const gt = source.indexOf('>', end);
        index = gt < 0 ? source.length : gt + 1;
      }
      stack.pop();
      current = stack[stack.length - 1];
    }
  }

  return root;
}

/** 元素属性读取（大小写不敏感）。 */
export function getAttr(node, name) {
  if (!node || node.type !== 'element') return '';
  const value = attrValue(node, name);
  return value == null ? '' : value;
}

export function hasAttr(node, name) {
  if (!node || node.type !== 'element') return false;
  return attrValue(node, name) != null;
}

export function hasClass(node, className) {
  const value = getAttr(node, 'class');
  if (!value) return false;
  return value.split(/\s+/).includes(className);
}

/** 纯文本（含后代，压缩空白）。 */
export function textContent(node) {
  if (!node) return '';
  if (node.type === 'text') return node.text || '';
  let out = '';
  const walk = (item) => {
    if (!item) return;
    if (item.type === 'text') {
      out += item.text || '';
      return;
    }
    for (const child of item.children || []) walk(child);
  };
  walk(node);
  return out;
}

/** 归一化文本：去标签实体噪音、压缩空白（对齐 xbpqCleanText）。 */
export function cleanText(value) {
  let text = String(value || '').replace(/<[^>]*>/g, '');
  text = decodeEntities(text)
    .replace(/&#13;/g, '')
    .replace(/\t/g, ' ')
    .replace(/\u3000/g, ' ');
  return text.replace(/\s+/g, ' ').trim();
}

/** 序列化节点（对齐 html.Render，供 p: 匹配后 item.text 再用）。 */
export function renderHTML(node) {
  if (!node) return '';
  if (node.type === 'text') return escapeHTML(node.text || '');
  if (node.type === 'document') return node.children.map(renderHTML).join('');
  const attrs = node.attrs
    .map(([key, value]) => (value === '' ? ` ${key}` : ` ${key}="${escapeHTML(value)}"`))
    .join('');
  const open = `<${node.tag}${attrs}>`;
  if (VOID_TAGS.has(node.tag)) return open;
  return `${open}${node.children.map(renderHTML).join('')}</${node.tag}>`;
}

/** 后代元素遍历（含自身）。 */
export function* descendants(node, includeSelf = false) {
  if (includeSelf && node && node.type === 'element') yield node;
  const stack = [...(node.children || [])].reverse();
  while (stack.length) {
    const item = stack.pop();
    if (!item || item.type !== 'element') continue;
    yield item;
    for (let i = item.children.length - 1; i >= 0; i--) stack.push(item.children[i]);
  }
}
