// MacCMS 通用页面解析：移植 provider_duanju_maccms.go 里的播放数据嗅探与地址归一化。
// XBPQ 规则源与自定义 MacCMS 源共用这部分。

import { parseHTML, textContent, getAttr, descendants, cleanText } from './html.mjs';

const PLAYER_DATA = /(?:var\s+player_[A-Za-z0-9_]+\s*=\s*)?(\{[\s\S]{0,4000}?"url"\s*:\s*"[\s\S]{0,1200}?\})/;
const PLAYER_URL_FIELD = /"url"\s*:\s*"([^"]+)"/i;
const ENCRYPT_FIELD = /"encrypt"\s*:\s*"?([0-9])"?/i;
const IFRAME_BASE64 = /<iframe[^>]*?[?&]url=([A-Za-z0-9+/]{20,}={0,2})/;
const JS_UNICODE = /%u([0-9a-f]{4})/gi;
const UNICODE_ESCAPE = /\\?u([0-9a-fA-F]{4})/g;

function unescapeJS(value) {
  let text = String(value || '');
  if (!text.includes('%')) return text;
  if (/%u/i.test(text)) {
    text = text.replace(JS_UNICODE, (_match, hex) =>
      String.fromCharCode(Number.parseInt(hex, 16))
    );
  }
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

function decodeUnicode(value) {
  return String(value || '').replace(UNICODE_ESCAPE, (match, hex) => {
    const code = Number.parseInt(hex, 16);
    return Number.isFinite(code) ? String.fromCharCode(code) : match;
  });
}

function playerFields(body) {
  const fields = {};
  const match = PLAYER_DATA.exec(body);
  if (!match) return fields;
  const blob = match[1].split('\\/').join('/');
  try {
    const payload = JSON.parse(blob);
    for (const key of ['url', 'encrypt', 'from']) {
      const value = payload[key];
      if (typeof value === 'string') fields[key] = value.trim();
      else if (typeof value === 'number') fields[key] = String(value);
    }
  } catch {
    /* 非严格 JSON：退回单字段正则 */
  }
  if (!fields.url) {
    const inner = PLAYER_URL_FIELD.exec(match[1]);
    if (inner) fields.url = inner[1].split('\\/').join('/');
  }
  if (!fields.encrypt) {
    const inner = ENCRYPT_FIELD.exec(match[1]);
    if (inner) fields.encrypt = inner[1];
  }
  return fields;
}

/** encrypt 0/1/2 → 原样 / escape 编码 / base64（可能外套一层 urlencode）。 */
export function decryptPlayerURL(raw, encrypt) {
  const value = String(raw || '');
  if (encrypt === '1') return unescapeJS(value);
  if (encrypt === '2') {
    const tryDecode = (candidate) => {
      try {
        const decoded = Buffer.from(candidate, 'base64').toString('utf-8');
        return decoded && !decoded.includes('\u0000') ? decoded : '';
      } catch {
        return '';
      }
    };
    const direct = tryDecode(value);
    if (direct) return unescapeJS(direct);
    if (value.includes('%')) {
      try {
        const unescaped = decodeURIComponent(value);
        if (unescaped !== value) {
          const second = tryDecode(unescaped);
          if (second) return unescapeJS(second);
        }
      } catch {
        /* 忽略 */
      }
    }
    return value;
  }
  return value;
}

function iframeBase64URL(body) {
  const match = IFRAME_BASE64.exec(body);
  if (!match) return '';
  let candidate = match[1];
  let decoded = '';
  try {
    decoded = Buffer.from(candidate, 'base64').toString('utf-8');
  } catch {
    decoded = '';
  }
  if (!decoded) {
    const padded = candidate + '='.repeat((4 - (candidate.length % 4)) % 4);
    try {
      decoded = Buffer.from(padded, 'base64').toString('utf-8');
    } catch {
      return '';
    }
  }
  // 解码结果可能是「源1,源2」或 JSON，取第一个 http 形态
  const httpMatch = /https?:\/\/[^\s,'"}\]]+/.exec(decoded);
  return httpMatch ? httpMatch[0] : '';
}

/** 从播放页提取直链：player_data → url 字段 → 常见内联形态 → iframe base64。 */
export function maccmsPlayerURL(body) {
  if (!body) return '';
  const fields = playerFields(body);
  if (fields.url) {
    const decrypted = decryptPlayerURL(fields.url, fields.encrypt);
    if (/^https?/i.test(decrypted)) return decrypted;
  }
  const patterns = [
    /\$\.url\s*=\s*"([^"]+)"/i,
    /"url"\s*:\s*"([^"]+\.(?:m3u8|mp4)[^"]*)"/i,
    /(https?:\/\/[^\s"'<>]+\.(?:m3u8|mp4)[^\s"'<>]*)/i,
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(body);
    if (match) return match[1].split('\\/').join('/');
  }
  if (fields.url) return decryptPlayerURL(fields.url, fields.encrypt);
  return iframeBase64URL(body);
}

/** 播放地址归一化：去尾噪、\u 转义目录还原。 */
export function normalizePlaybackURL(raw) {
  let value = String(raw || '').trim().split('\\/').join('/');
  value = value.replace(/^[,\\。，;；\s]+|[,\\。，;；\s]+$/g, '');
  if (!value) return '';
  if (value.includes('p.') || value.includes('c1.')) {
    const parts = value.split('/');
    if (parts.length >= 3) {
      const base = parts.slice(0, -2).join('/');
      const folder = parts[parts.length - 2];
      const decoded = decodeUnicode(folder);
      if (decoded !== folder) {
        return `${base}/${encodeURIComponent(decoded)}/index.m3u8`;
      }
    }
  }
  return value;
}

/** 从详情链接取数字 ID（XBPQ 规则写了 详情url 模板时用）。 */
export function maccmsSourceIDFromURL(link) {
  let path = '';
  try {
    path = new URL(link).pathname;
  } catch {
    return '';
  }
  path = path.replace(/\.html$/, '');
  const patterns = [
    /\/detail\/id\/(\d+)\/?$/i,
    /\/vod\/detail\/id\/(\d+)\/?$/i,
    /\/voddetail\/(\d+)\/?$/i,
    /\/index\.php\/vod\/detail\/id\/(\d+)\/?$/i,
    /\/vod\/(\d+)\/?$/i,
    /\/v\/([A-Za-z0-9_-]+)\/?$/,
    /\/(\d{1,10})\/?(?:\?.*)?$/,
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(path + '/');
    if (match) return match[1];
  }
  const parts = path.replace(/^\/+|\/+$/g, '').split('/');
  for (let index = parts.length - 1; index >= 0; index--) {
    const candidate = parts[index].replace(/\.html$/, '');
    if (/^\d{1,10}$/.test(candidate)) return candidate;
    const dash = candidate.lastIndexOf('-');
    if (dash >= 0 && /^\d{1,10}$/.test(candidate.slice(dash + 1))) {
      return candidate.slice(dash + 1);
    }
  }
  return '';
}

function firstBySelectors(document, selectors) {
  for (const selector of selectors) {
    for (const node of descendants(document)) {
      if (node.tag === selector.tag && (!selector.className || (getAttr(node, 'class') || '').includes(selector.className))) {
        const text = cleanText(textContent(node));
        if (text) return text;
      }
    }
  }
  return '';
}

/** 详情标题兜底：h1 → og:title → MacCMS 常见 class。 */
export function maccmsDetailTitle(document) {
  const meta = descendants(document).find((node) => getAttr(node, 'property') === 'og:title');
  if (meta) {
    const value = cleanText(getAttr(meta, 'content'));
    if (value) return value;
  }
  const heading = descendants(document).find((node) => node.tag === 'h1');
  if (heading) {
    const value = cleanText(textContent(heading));
    if (value && value.length <= 80) return value;
  }
  return firstBySelectors(document, [
    { tag: 'h2' },
    { tag: 'div', className: 'video-info-title' },
    { tag: 'div', className: 'detail-title' },
  ]);
}

/** 详情简介兜底。 */
export function maccmsDetailIntro(document) {
  for (const node of descendants(document)) {
    const className = getAttr(node, 'class');
    if (!className) continue;
    if (/detail-content|video-info-content|module-info-intro|detail-intro|video-intro/.test(className)) {
      const value = cleanText(textContent(node));
      if (value.length > 8) return value;
    }
  }
  return '';
}

/** 详情封面兜底。 */
export function maccmsDetailCover(document, pageURL) {
  for (const node of descendants(document)) {
    const className = getAttr(node, 'class') || '';
    if (/module-item-pic|detail-pic|video-cover|pic/.test(className)) {
      const image = descendants(node).find((item) => item.tag === 'img');
      if (image) {
        const source = getAttr(image, 'data-original') || getAttr(image, 'data-src') || getAttr(image, 'src');
        if (source) return absolutize(pageURL, source);
      }
    }
  }
  const meta = descendants(document).find((node) => getAttr(node, 'property') === 'og:image');
  if (meta) return absolutize(pageURL, getAttr(meta, 'content'));
  const image = descendants(document).find((node) => node.tag === 'img');
  if (image) {
    const source = getAttr(image, 'data-original') || getAttr(image, 'data-src') || getAttr(image, 'src');
    if (source) return absolutize(pageURL, source);
  }
  return '';
}

/** 详情分类兜底。 */
export function maccmsDetailCategory(document) {
  for (const node of descendants(document)) {
    const className = getAttr(node, 'class') || '';
    if (/video-info-link|detail-cate|module-info-tag-link/.test(className)) {
      const value = cleanText(textContent(node));
      if (value) return value;
    }
  }
  return '';
}

function absolutize(base, raw) {
  const value = String(raw || '').trim();
  if (!value) return '';
  if (/^https?:\/\//i.test(value)) return value;
  if (value.startsWith('//')) return 'https:' + value;
  try {
    return new URL(value, base).toString();
  } catch {
    return '';
  }
}

/** 解析 HTML（供 provider 复用）。 */
export function parseDocument(body) {
  return parseHTML(body);
}
