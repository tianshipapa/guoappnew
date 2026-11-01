// XBPQ 截取引擎：移植 provider_xbpq.go 的「&&/||/+/Base64/[修饰符]」语义。
//
// 这是整套规则体系的中心：数组拆分、字段截取、跳转链接嗅探全部走这里。

import {
  jsonLikely,
  isJSONPattern,
  jsonStringValue,
  jsonArrayItems,
  decodeBase64Segment,
  base64Wrapper,
} from './json.mjs';
import { selectorFirstString } from './selector.mjs';

const MODIFIER_KEYWORD = /^(包含|不包含|替换|序号|含序号|截右|右截|排序)$/;
const anchorCache = new Map();

/** 按分隔符切分，跳过被 \ 转义的分隔符。 */
export function splitUnescaped(source, separator) {
  const text = String(source || '');
  if (!separator) return [text];
  const out = [];
  let current = '';
  let index = 0;
  while (index < text.length) {
    if (text[index] === '\\' && index + 1 < text.length) {
      current += text[index] + text[index + 1];
      index += 2;
      continue;
    }
    if (text.startsWith(separator, index)) {
      out.push(current);
      current = '';
      index += separator.length;
      continue;
    }
    current += text[index];
    index++;
  }
  out.push(current);
  return out;
}

/** 去转义：\$ \# \& \* \[ \] \\ → 原字符。 */
export function unescapeText(source) {
  const text = String(source || '');
  if (!text.includes('\\')) return text;
  let out = '';
  for (let index = 0; index < text.length; index++) {
    if (text[index] === '\\' && index + 1 < text.length) {
      const next = text[index + 1];
      if ('$#&*[]\\'.includes(next)) {
        out += next;
        index++;
        continue;
      }
    }
    out += text[index];
  }
  return out;
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** 把锚点（含 * 通配与 \ 转义）编译成惰性正则；无通配走字面快路径。 */
export function compileAnchor(pattern) {
  const cached = anchorCache.get(pattern);
  if (cached) return cached;
  let anchor;
  if (!/[*\\]/.test(pattern)) {
    anchor = { literal: pattern };
  } else {
    let body = '';
    for (let index = 0; index < pattern.length; ) {
      const char = pattern[index];
      if (char === '\\' && index + 1 < pattern.length) {
        body += escapeRegExp(pattern[index + 1]);
        index += 2;
        continue;
      }
      if (char === '*') {
        body += '.*?';
        index++;
        continue;
      }
      body += escapeRegExp(char);
      index++;
    }
    try {
      anchor = { re: new RegExp(body, 's') };
    } catch {
      anchor = { literal: unescapeText(pattern) };
    }
  }
  if (anchorCache.size > 4096) anchorCache.clear();
  anchorCache.set(pattern, anchor);
  return anchor;
}

/** 返回锚点匹配的 [起点, 结束处]。 */
export function matchStartFrom(anchor, source, offset = 0) {
  if (offset > source.length) return [-1, -1];
  const sub = source.slice(offset);
  if (anchor.literal != null && !anchor.re) {
    const index = sub.indexOf(anchor.literal);
    if (index < 0) return [-1, -1];
    return [offset + index, offset + index + anchor.literal.length];
  }
  const match = anchor.re.exec(sub);
  if (!match) return [-1, -1];
  return [offset + match.index, offset + match.index + match[0].length];
}

export function matchStart(anchor, source) {
  return matchStartFrom(anchor, source, 0)[1];
}

export function matchEnd(anchor, source) {
  if (anchor.literal != null && !anchor.re) return source.indexOf(anchor.literal);
  const match = anchor.re.exec(source);
  if (!match) return -1;
  return match.index;
}

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

function newStep() {
  return { start: '', end: '', contains: [], notContains: [], replaces: [], order: [], index: 0 };
}

/** 从 token 尾部剥出 [修饰符] 列表。 */
export function trimModifier(token) {
  const mods = [];
  let work = String(token || '');
  for (;;) {
    if (!work.endsWith(']')) break;
    let open = matchBracket(work);
    if (open < 0) break;
    const body = work.slice(open + 1, -1);
    const colon = body.search(/[:：]/);
    let word = body;
    let payload = '';
    if (colon >= 0) {
      word = body.slice(0, colon);
      payload = body.slice(colon + 1);
    }
    word = word.trim();
    if (!MODIFIER_KEYWORD.test(word)) break;
    const mod = mods.length > 0 ? mods[0] : newStep();
    switch (word) {
      case '包含':
        mod.contains.push(...splitList(payload));
        break;
      case '不包含':
        mod.notContains.push(...splitList(payload));
        break;
      case '替换':
        for (const pair of String(payload).split('#')) {
          const cut = pair.indexOf('>>');
          if (cut >= 0) mod.replaces.push([pair.slice(0, cut), pair.slice(cut + 2)]);
        }
        break;
      case '序号':
      case '含序号': {
        const number = Number.parseInt(String(payload).trim(), 10);
        if (Number.isFinite(number) && number >= 1) mod.index = number;
        break;
      }
      case '排序':
        for (const item of splitUnescaped(payload, '>')) {
          const value = item.trim();
          if (value) mod.order.push(value);
        }
        break;
      default:
        mod.index = -1;
        open = -1;
        break;
    }
    if (open < 0) break;
    work = work.slice(0, open).trim();
    mods.unshift(mod);
  }
  return { work, mods };
}

/** 把 pattern 拆成截取步骤链：A&&B&&C&&D → [(A,B),(C,D)]。 */
export function parseSteps(pattern) {
  const parts = splitUnescaped(pattern, '&&');
  if (parts.length === 1) return [];
  const steps = [];
  for (let index = 0; index < parts.length; index++) {
    const startParsed = trimModifier(parts[index].trim());
    let end = '';
    let endMods = [];
    if (index + 1 < parts.length) {
      const parsed = trimModifier(parts[index + 1].trim());
      end = parsed.work;
      endMods = parsed.mods;
    }
    let step = newStep();
    step.start = unescapeText(startParsed.work);
    step.end = unescapeText(end);
    if (startParsed.mods.length > 0) {
      step = { ...startParsed.mods[0] };
      step.start = unescapeText(startParsed.work);
      step.end = unescapeText(end);
      if (endMods.length > 0) {
        const extra = endMods[0];
        step.contains = [...step.contains, ...extra.contains];
        step.notContains = [...step.notContains, ...extra.notContains];
        step.replaces = [...step.replaces, ...extra.replaces];
        step.order = [...step.order, ...extra.order];
        if (extra.index !== 0 && step.index === 0) step.index = extra.index;
      }
    } else if (endMods.length > 0) {
      step = { ...endMods[0] };
      step.start = unescapeText(startParsed.work);
      step.end = unescapeText(end);
    }
    steps.push(step);
    index++;
  }
  return steps;
}

/** 按顶层 + 切分（跳过 [修饰符] 内与被转义的 +）；无顶层 + 返回 null。 */
export function splitTopLevelPlus(pattern) {
  const out = [];
  let current = '';
  let depth = 0;
  let hasPlus = false;
  for (let index = 0; index < pattern.length; ) {
    if (pattern[index] === '\\' && index + 1 < pattern.length) {
      current += pattern[index] + pattern[index + 1];
      index += 2;
      continue;
    }
    const char = pattern[index];
    if (char === '[') depth++;
    else if (char === ']') {
      if (depth > 0) depth--;
    } else if (char === '+' && depth === 0) {
      out.push(current);
      current = '';
      hasPlus = true;
      index++;
      continue;
    }
    current += char;
    index++;
  }
  if (!hasPlus) return null;
  out.push(current);
  return out;
}

function splitNumbered(segment) {
  return segment.split(/[\n\t]/).filter((item) => item !== '');
}

export function finishSegment(segment, step) {
  let value = segment;
  if (step.index > 0) {
    const parts = splitNumbered(value);
    if (step.index <= parts.length) value = parts[step.index - 1];
  }
  for (const word of step.contains) {
    if (!value.includes(word)) return '';
  }
  for (const word of step.notContains) {
    if (value.includes(word)) return '';
  }
  for (const [before, after] of step.replaces) {
    value = value.split(before).join(after);
  }
  return value.trim();
}

export function applyStepOnce(source, step) {
  if (!step.start && !step.end) return { value: source, ok: true };
  let rest = source;
  if (step.start) {
    const position = matchStart(compileAnchor(step.start), rest);
    if (position < 0) return { value: '', ok: false };
    rest = rest.slice(position);
  }
  if (step.end) {
    const index = matchEnd(compileAnchor(step.end), rest);
    if (index < 0) return { value: '', ok: false };
    rest = rest.slice(0, index);
  }
  return { value: finishSegment(rest, step), ok: true };
}

/** 找第一个 start&&end 段；start 截不出内容时跳到下一个 start 继续。 */
export function applyStepScan(source, step) {
  if (!step.start) return { value: '', consumed: 0, ok: false };
  const startAnchor = compileAnchor(step.start);
  const endAnchor = step.end ? compileAnchor(step.end) : null;
  let offset = 0;
  while (offset <= source.length) {
    const [contentStart, matchEndOffset] = matchStartFrom(startAnchor, source, offset);
    if (matchEndOffset < 0) return { value: '', consumed: 0, ok: false };
    let body = source.slice(matchEndOffset);
    let stop = source.length;
    if (step.end) {
      const endIndex = matchEnd(endAnchor, body);
      if (endIndex < 0) {
        offset = contentStart + 1;
        continue;
      }
      body = body.slice(0, endIndex);
      stop = matchEndOffset + endIndex;
    }
    const segment = finishSegment(body, step);
    if (segment === '') {
      offset = contentStart + 1;
      continue;
    }
    return { value: segment, consumed: stop, ok: true };
  }
  return { value: '', consumed: 0, ok: false };
}

/** 处理 + 拼接：含 && 的段是截取指令，其余段是字面量，顺序拼接。 */
export function concatCut(source, pattern) {
  if (!pattern.includes('+')) return { value: '', ok: false };
  const segments = splitTopLevelPlus(pattern);
  if (!segments || segments.length < 2) return { value: '', ok: false };
  const fromJSON = jsonLikely(source);
  let hasCut = false;
  for (const segment of segments) {
    if (segment.includes('&&') || (fromJSON && isJSONPattern(segment.trim()))) hasCut = true;
  }
  if (!hasCut) return { value: '', ok: false };
  let out = '';
  for (const raw of segments) {
    const segment = raw.trim();
    if (!segment) continue;
    if (segment.length >= 2 && segment.startsWith("'") && segment.endsWith("'")) {
      out += segment.slice(1, -1);
      continue;
    }
    if (segment.includes('&&')) {
      out += cutOnce(source, segment);
    } else if (fromJSON && isJSONPattern(segment)) {
      out += jsonStringValue(source, segment);
    } else {
      out += unescapeText(segment);
    }
  }
  return { value: out, ok: true };
}

/**
 * 按 pattern 在 source 上截取第一段；多组用 || 分隔时依次尝试。
 * 注意：这是规则体系的通用入口，字段值、数组、播放串都经过它。
 */
export function cutOnce(source, pattern) {
  if (!source || !pattern) return '';
  if (pattern.startsWith('p:') || pattern.startsWith('jsoup:')) {
    return selectorFirstString(source, pattern);
  }
  if (pattern.trim().toLowerCase() === 'base64') return decodeBase64Segment(source);

  const wrapper = base64Wrapper(pattern);
  if (wrapper != null) return decodeBase64Segment(cutOnce(source, wrapper));

  const concat = concatCut(source, pattern);
  if (concat.ok && concat.value.trim() !== '') return concat.value;

  if (isJSONPattern(pattern) && jsonLikely(source)) return jsonStringValue(source, pattern);

  // 不使用 && 的字段值是「指定字符串」（固定标题/线路标题等）
  if (!isJSONPattern(pattern)) {
    const parts = splitUnescaped(pattern, '&&');
    const pipes = pattern.split('\\||').join('').split('||').length - 1;
    if (parts.length === 1 && pipes === 0) return unescapeText(pattern.trim());
  }

  for (const part of splitUnescaped(pattern, '||')) {
    const steps = parseSteps(part);
    if (steps.length === 0) continue;
    let segment = source;
    let ok = true;
    for (const step of steps) {
      const result = applyStepOnce(segment, step);
      segment = result.value;
      ok = result.ok;
      if (!ok) break;
    }
    if (ok && segment.trim() !== '') return segment;
  }
  return '';
}

/** 按数组 pattern 迭代抽取全部条目。 */
export function list(source, pattern) {
  if (!source || !pattern) return [];
  if (pattern.startsWith('j:') && jsonLikely(source)) {
    return jsonArrayItems(source, pattern);
  }
  let items = [];
  for (const part of splitUnescaped(pattern, '||')) {
    const steps = parseSteps(part);
    if (steps.length === 0) continue;
    const first = steps[0];
    let rest = source;
    for (;;) {
      const scanned = applyStepScan(rest, first);
      if (!scanned.ok) break;
      let segment = scanned.value;
      if (steps.length > 1) {
        for (const step of steps.slice(1)) {
          const result = applyStepOnce(segment, step);
          segment = result.value;
          if (!result.ok) {
            segment = '';
            break;
          }
        }
      }
      if (segment !== '') items.push(segment);
      if (scanned.consumed >= rest.length) break;
      rest = rest.slice(scanned.consumed);
    }
    if (items.length > 0) {
      if (first.order.length > 0) items = orderItems(items, first.order);
      break;
    }
  }
  return items;
}

/** 按 [排序:a>b>c] 的关键词优先级重排条目（线路数组常用）。 */
export function orderItems(items, order) {
  const rank = (item) => {
    for (let index = 0; index < order.length; index++) {
      if (item.includes(order[index])) return index;
    }
    return order.length;
  };
  const out = [...items];
  for (let i = 1; i < out.length; i++) {
    for (let j = i; j > 0 && rank(out[j]) < rank(out[j - 1]); j--) {
      [out[j], out[j - 1]] = [out[j - 1], out[j]];
    }
  }
  return out;
}
