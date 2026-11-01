// XBPQ json 模式：移植 provider_xbpq_json.go
//
// - 字段值以 j: 前缀（或纯点路径）描述 JSON 取值，如 j:data.list[0].name
// - 下标 0-based；[n] 第 n 个、[] 全部、[a,] 跳前 a 个、[a-b]/[a:b] 区间、负数倒数
// - 二次截取填 "Base64" 表示整段只解码；Base64(a&&b) 对截取结果解码

export function jsonPathValue(source, path) {
  let key = String(path || '').trim();
  key = key.replace(/^\$/, '').replace(/^j:/, '');
  if (!source || !key) return { ok: false };
  let root;
  try {
    root = JSON.parse(source);
  } catch {
    return { ok: false };
  }
  let current = root;
  for (const rawSegment of key.split('.')) {
    const { name, index, hasIndex } = splitSegment(rawSegment);
    if (name) {
      if (current && typeof current === 'object' && !Array.isArray(current)) {
        const found = lookupFold(current, name);
        if (!found.ok) return { ok: false };
        current = found.value;
      } else if (Array.isArray(current)) {
        const picked = [];
        for (const one of current) {
          if (one && typeof one === 'object' && !Array.isArray(one)) {
            const found = lookupFold(one, name);
            if (found.ok) picked.push(found.value);
          }
        }
        if (picked.length === 0) continue;
        current = picked;
      } else {
        return { ok: false };
      }
    }
    if (hasIndex) current = applyIndex(current, index);
  }
  return { ok: true, value: current };
}

function splitSegment(segment) {
  const open = segment.indexOf('[');
  if (open < 0) return { name: segment, index: '', hasIndex: false };
  const close = segment.lastIndexOf(']');
  if (close <= open) return { name: segment, index: '', hasIndex: false };
  return { name: segment.slice(0, open), index: segment.slice(open + 1, close), hasIndex: true };
}

function lookupFold(object, name) {
  if (Object.prototype.hasOwnProperty.call(object, name)) return { ok: true, value: object[name] };
  const lower = name.toLowerCase();
  for (const key of Object.keys(object)) {
    if (key.toLowerCase() === lower) return { ok: true, value: object[key] };
  }
  return { ok: false };
}

function clamp(value, low, high) {
  return Math.min(Math.max(value, low), high);
}

function applyIndex(value, expression) {
  if (!Array.isArray(value)) return value;
  const expr = String(expression || '').trim();
  if (expr === '' || expr === '*') return value;
  if (/^-?\d+$/.test(expr)) {
    let number = Number.parseInt(expr, 10);
    if (number < 0) number += value.length;
    if (number < 0 || number >= value.length) return null;
    return value[number];
  }
  const cut = expr.search(/[-:,]/);
  if (cut >= 0) {
    const left = expr.slice(0, cut).trim();
    const right = expr.slice(cut + 1).trim();
    let start = 0;
    let end = value.length;
    if (left && /^-?\d+$/.test(left)) start = clamp(Number.parseInt(left, 10), 0, value.length);
    if (right && /^-?\d+$/.test(right)) end = clamp(Number.parseInt(right, 10), 0, value.length);
    if (start >= end) return [];
    return value.slice(start, end);
  }
  return value;
}

export function jsonStringValue(source, path) {
  const result = jsonPathValue(source, path);
  if (!result.ok) return '';
  return anyToString(result.value);
}

export function jsonPathRaw(source, path) {
  const result = jsonPathValue(source, path);
  if (!result.ok || result.value == null) return '';
  if (typeof result.value === 'string') return result.value;
  if (typeof result.value === 'object') return JSON.stringify(result.value);
  return anyToString(result.value);
}

export function jsonArrayItems(source, path) {
  const result = jsonPathValue(source, path);
  if (!result.ok) return [];
  if (!Array.isArray(result.value)) return [JSON.stringify(result.value)];
  return result.value.map((one) => JSON.stringify(one));
}

export function anyToString(value) {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

/** source 是否是 JSON 文档（跳过前导空白看首个字符）。 */
export function jsonLikely(source) {
  const text = String(source || '');
  for (const char of text) {
    if (char === ' ' || char === '\n' || char === '\r' || char === '\t') continue;
    return char === '{' || char === '[';
  }
  return false;
}

/** pattern 是否 json 路径模式（j: 前缀或纯点路径）。 */
export function isJSONPattern(pattern) {
  if (!pattern) return false;
  if (pattern.startsWith('j:') || pattern.startsWith('$')) return true;
  if (/[&"' ]/.test(pattern) || pattern.includes('://')) return false;
  if (!pattern.includes('.')) return false;
  for (const char of pattern) {
    if (char === '[' || char === ']') continue;
    if (!/[_.a-zA-Z0-9]/.test(char)) return false;
  }
  return true;
}

/** Base64 解码（失败返回原串，对齐 xbpqDecodeBase64Segment）。 */
export function decodeBase64Segment(text) {
  const value = String(text || '').trim();
  if (!value) return value;
  for (const candidate of [value, value.replace(/=+$/, '')]) {
    try {
      const decoded = Buffer.from(candidate, 'base64').toString('utf-8');
      if (decoded && !decoded.includes('\u0000') && /^[\s\S]*$/.test(decoded)) {
        // 严格校验：重新编码后与原文一致才算合法 base64
        const reencoded = Buffer.from(decoded, 'utf-8').toString('base64').replace(/=+$/, '');
        if (reencoded === candidate.replace(/=+$/, '')) return decoded;
      }
    } catch {
      /* 继续尝试下一种 */
    }
  }
  return value;
}

/** 识别 "Base64(inner)" 形态。 */
export function base64Wrapper(pattern) {
  const value = String(pattern || '').trim();
  if (!/^base64\(/i.test(value) || !value.endsWith(')')) return null;
  return value.slice('Base64('.length, -1);
}

export function isValidJSON(text) {
  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
}
