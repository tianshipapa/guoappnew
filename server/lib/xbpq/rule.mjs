// XBPQ 规则对象：移植 provider_xbpq.go 的规则归一化与字段访问部分。
//
// 规则是 TVBox csp_XBPQ 爬虫 JSON，字段名全角方括号归一、值两端留白清理，
// 再按 分类url 形态套用内置模板（见 template.mjs）。

import { cleanText } from '../html.mjs';
import { applyTemplate } from './template.mjs';
import { hostOrigin } from '../http.mjs';

const MAX_RULE_BYTES = 2 << 20;
const TRAILING_COMMA = /,\s*([}\]])/g;
const LONG_TEXT = /@long-text:\s*"((?:[^"\\]|\\.)*)"\s*;?\s*$/s;

/** 归一化字段名：全角方括号转半角、去空白。 */
export function normalizeKey(key) {
  return String(key || '')
    .trim()
    .replace(/〔/g, '[')
    .replace(/〕/g, ']')
    .replace(/[\s\u3000]+/g, '');
}

export function normalizeValue(value) {
  return String(value || '')
    .replace(/〔/g, '[')
    .replace(/〕/g, ']')
    .trim();
}

function trimTrailingComma(text) {
  let current = text;
  for (;;) {
    const cleaned = current.replace(TRAILING_COMMA, '$1');
    if (cleaned === current) return current;
    current = cleaned;
  }
}

function extractLongText(tail) {
  const match = LONG_TEXT.exec(String(tail).trim());
  if (!match) return '';
  try {
    return JSON.parse(`"${match[1]}"`);
  } catch {
    return '';
  }
}

function mergeLongText(head, embedded) {
  let headNode;
  try {
    headNode = JSON.parse(head);
  } catch {
    return '';
  }
  let embeddedNode;
  try {
    embeddedNode = JSON.parse(embedded);
  } catch {
    return head;
  }
  if (!headNode || typeof headNode !== 'object' || Array.isArray(headNode)) return head;
  if (!embeddedNode || typeof embeddedNode !== 'object' || Array.isArray(embeddedNode)) return head;
  for (const [key, value] of Object.entries(embeddedNode)) {
    if (!(key in headNode)) headNode[key] = value;
  }
  return JSON.stringify(headNode);
}

function valueToString(value) {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

/** 规则对象：字段表 + 原始键顺序。 */
export class XbpqRule {
  constructor(fields, order) {
    this.fields = fields;
    this.order = order || [];
  }

  /** 依次尝试多个字段名。 */
  field(...names) {
    for (const name of names) {
      const value = this.fields.get(normalizeKey(name));
      if (value) return value;
    }
    return '';
  }

  raw(key) {
    return this.fields.get(normalizeKey(key)) || '';
  }

  has(key) {
    return Boolean(this.field(key));
  }

  /** 主页：缺失时从 分类url / 搜索url 的站点根推导（实测 61% 的源不写主页url）。 */
  get homeURL() {
    let value = this.field('主页url', '首页url', '请求');
    if (!value) {
      for (const alt of ['分类url', '分类Url', '搜索url']) {
        const candidate = this.field(alt);
        if (candidate.startsWith('http')) {
          value = hostOrigin(candidate);
          break;
        }
      }
    }
    if (!value) return '';
    if (!value.includes('://')) value = 'https://' + value;
    try {
      const parsed = new URL(value);
      parsed.pathname = parsed.pathname.replace(/\/+$/, '');
      parsed.search = '';
      parsed.hash = '';
      return parsed.toString().replace(/\/$/, '');
    } catch {
      return '';
    }
  }

  /** 自定义 UA（支持把 "User-Agent: xxx" 整串写进 请求头 字段）。 */
  get userAgent() {
    let value = this.field('请求头', 'User-Agent', 'UA');
    if (!value) return '';
    const lower = value.toLowerCase();
    const index = lower.indexOf('user-agent');
    if (index >= 0) {
      value = value.slice(index + 'user-agent'.length).trim();
      value = value.replace(/^[\s$:：=]+/, '');
      const parts = value.split(/\s+/).filter(Boolean);
      if (parts.length === 1) value = parts[0];
    }
    if (!value || value.length > 240 || /[\r\n\u0000]/.test(value)) return '';
    return value;
  }

  /** 站点级附加头（头部集合 / 请求头集合 / Headers）。 */
  get headerSet() {
    return parseHeaderSet(this.field('头部集合', '请求头集合', 'Headers'));
  }

  /** 播放阶段附加头：头部集合 + 播放请求头，后者优先。 */
  get playHeaderSet() {
    const site = this.headerSet;
    const play = parseHeaderSet(this.field('播放请求头', '播放头部集合'));
    if (Object.keys(site).length === 0 && Object.keys(play).length === 0) return {};
    return { ...site, ...play };
  }

  /** 规则里的推荐 Referer（播放阶段）。 */
  get playReferer() {
    return headerValue(this.playHeaderSet, 'Referer');
  }

  /** 分类列表：name$id#name$id，支持 `主分类--子分类$id` 变体。 */
  get categories() {
    const raw = this.field('分类');
    if (!raw) return [];
    const categories = [];
    const seen = new Set();
    const add = (id, name) => {
      if (!id || !name || seen.has(id)) return;
      seen.add(id);
      categories.push({ id, name });
    };
    const subs = [];
    for (const line of raw.split('||')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed === '空') continue;
      for (const entry of trimmed.split('#')) {
        const cut = entry.indexOf('$');
        if (cut < 0) continue;
        let name = cleanText(entry.slice(0, cut));
        const id = entry.slice(cut + 1).trim();
        const mainCut = name.indexOf('--');
        if (mainCut >= 0) {
          const main = name.slice(0, mainCut);
          const subName = name.slice(mainCut + 2);
          if (CATEGORY_ID_PATTERN.test(main)) {
            if (subName) subs.push({ main, id, name: subName });
            continue;
          }
        }
        if (CATEGORY_ID_PATTERN.test(id) && name) add(id, name);
      }
    }
    for (const sub of subs) {
      if (seen.has(sub.id)) continue;
      seen.add(sub.id);
      categories.push({ id: sub.id, name: sub.name });
    }
    return categories;
  }
}

const CATEGORY_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_/-]{0,79}$/;

export function parseRule(text) {
  let source = String(text || '').trim();
  if (!source || Buffer.byteLength(source) > MAX_RULE_BYTES) return null;

  if (source.includes('@long-text:')) {
    const index = source.indexOf('@long-text:');
    const head = trimTrailingComma(source.slice(0, index));
    const tail = source.slice(index);
    try {
      JSON.parse(head);
      const embedded = extractLongText(tail);
      if (embedded) {
        const merged = mergeLongText(head, embedded);
        if (merged) source = merged;
      }
    } catch {
      /* 头部不是合法 JSON 时忽略 long-text */
    }
  }

  let decoded;
  try {
    decoded = JSON.parse(source);
  } catch {
    try {
      decoded = JSON.parse(trimTrailingComma(source));
    } catch {
      return null;
    }
  }

  const fields = new Map();
  const order = [];
  const collect = (node) => {
    for (const [key, value] of Object.entries(node)) {
      const normalized = normalizeKey(key);
      if (!normalized) continue;
      if (!fields.has(normalized)) order.push(normalized);
      fields.set(normalized, normalizeValue(valueToString(value)));
    }
  };

  if (Array.isArray(decoded)) {
    for (const entry of decoded) {
      if (entry && typeof entry === 'object' && !Array.isArray(entry)) collect(entry);
    }
  } else if (decoded && typeof decoded === 'object') {
    collect(decoded);
  } else {
    return null;
  }

  const rule = new XbpqRule(fields, order);
  if (
    !rule.field('主页url', '首页url', '请求', '分类url', '分类Url')
  ) {
    return null; // 不是 XBPQ 爬虫 JSON
  }
  applyTemplate(rule);
  return rule;
}

function validHeaderName(name) {
  if (!name || name.length > 64) return false;
  return /^[A-Za-z0-9_-]+$/.test(name);
}

/** 解析 `Key$Value#Key$Value`（分隔符兼容 # / 换行 / ||，键值兼容 $ : = ）。 */
export function parseHeaderSet(raw) {
  const value = String(raw || '').trim();
  if (!value) return {};
  const headers = {};
  const normalized = value.replace(/\r\n/g, '#').replace(/\n/g, '#').split('||').join('#');
  for (const entry of normalized.split('#')) {
    const item = entry.trim();
    if (!item) continue;
    let found = false;
    for (const separator of ['$', '：', ':', '=']) {
      const cut = item.indexOf(separator);
      if (cut < 0) continue;
      const head = item.slice(0, cut).trim();
      if (!validHeaderName(head)) continue;
      const tail = item.slice(cut + 1).trim();
      if (!tail || tail.length > 2048 || /[\r\n\u0000]/.test(tail)) break;
      headers[canonicalHeaderName(head)] = tail;
      found = true;
      break;
    }
    if (!found) continue;
  }
  return headers;
}

function canonicalHeaderName(name) {
  return name
    .toLowerCase()
    .split('-')
    .map((part) => (part ? part[0].toUpperCase() + part.slice(1) : part))
    .join('-');
}

export function headerValue(headers, name) {
  const lower = name.toLowerCase();
  for (const [key, value] of Object.entries(headers || {})) {
    if (key.toLowerCase() === lower) return value;
  }
  return '';
}
