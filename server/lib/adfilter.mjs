// m3u8 广告分片过滤：移植 app_adfilter.go
//
// 只处理媒体分片清单（含 #EXTINF）；master 多码率清单原样放行。
//   1. 收集所有媒体分片（注释行 + 紧随的 URI 行）
//   2. 每个分片算「来源指纹」= 片段绝对地址的 host+目录
//   3. 主指纹占比 < 40% → 结构不可信，放弃清洗
//   4. 丢弃指纹 ≠ 主指纹的分片及其前置分片级标签
//
// 纯前置贴片（整段同来源）无法与正片区分，不猜删。

const MASTER_VARIANT_TAG = /^#EXT-X-(STREAM-INF|MEDIA:|I-FRAME-STREAM-INF|IMAGE-STREAM-INF)/i;
const SEGMENT_TAG = /^#EXTINF:/i;
// 删除广告分片时只回收这四种分片级标签；播放列表级头部注释必须保留
const AD_TAG_LINE = /^#EXT(INF:|-X-(BYTERANGE|KEY|DISCONTINUITY))/i;

function hostDir(parsed) {
  if (!parsed || !parsed.host) return '';
  let dir = decodeURIComponent(parsed.pathname || '');
  const slash = dir.lastIndexOf('/');
  dir = slash >= 0 ? dir.slice(0, slash) : '';
  return `${parsed.host.toLowerCase()}|${dir.toLowerCase()}`;
}

function lineFingerprint(reference, baseURL, baseFingerprint) {
  const value = String(reference || '').trim();
  if (!value || value.startsWith('data:')) return '';
  try {
    const parsed = new URL(value, baseURL);
    if (!parsed.host) return '';
    return hostDir(parsed) || baseFingerprint;
  } catch {
    return '';
  }
}

/**
 * 清洗 m3u8 媒体清单。
 * @returns {{text: string, removed: number}}
 */
export function filterAdSegments(text, baseURL) {
  const lines = String(text || '').replace(/\r\n/g, '\n').split('\n');
  if (!lines.length || (lines[0] || '').trim() !== '#EXTM3U') return { text, removed: 0 };

  let baseFingerprint = '-';
  try {
    const fingerprint = hostDir(new URL(baseURL));
    if (fingerprint) baseFingerprint = fingerprint;
  } catch {
    /* base 非法时用占位指纹 */
  }

  const segments = [];
  let pending = [];
  let sawExtinf = false;
  let isMaster = false;

  for (let index = 0; index < lines.length; index++) {
    const trimmed = lines[index].trim();
    if (trimmed === '') continue;
    if (trimmed.startsWith('#')) {
      if (MASTER_VARIANT_TAG.test(trimmed)) isMaster = true;
      if (SEGMENT_TAG.test(trimmed)) sawExtinf = true;
      pending.push(index);
      if (isMaster) return { text, removed: 0 };
      continue;
    }
    if (isMaster || !sawExtinf) return { text, removed: 0 };
    let fingerprint = lineFingerprint(trimmed, baseURL, baseFingerprint);
    if (!fingerprint) fingerprint = baseFingerprint;
    segments.push({ comment: pending, uri: index, fp: fingerprint });
    pending = [];
  }

  if (segments.length < 2) return { text, removed: 0 };

  const counts = new Map();
  for (const segment of segments) counts.set(segment.fp, (counts.get(segment.fp) || 0) + 1);
  let dominant = '';
  let dominantCount = 0;
  for (const [fingerprint, count] of counts) {
    if (count > dominantCount) {
      dominant = fingerprint;
      dominantCount = count;
    }
  }
  if (!dominant || dominantCount / segments.length < 0.4) return { text, removed: 0 };

  const remove = new Set();
  let removed = 0;
  for (const segment of segments) {
    if (segment.fp === dominant) continue;
    removed++;
    remove.add(segment.uri);
    for (let index = segment.comment.length - 1; index >= 0; index--) {
      const line = lines[segment.comment[index]].trim();
      if (AD_TAG_LINE.test(line)) {
        remove.add(segment.comment[index]);
        continue;
      }
      if (line.startsWith('#') && !line.startsWith('#EXT')) continue;
      break;
    }
  }

  if (removed === 0 || removed >= segments.length) return { text, removed: 0 };

  const output = lines.filter((_line, index) => !remove.has(index));
  const cleaned = output.join('\n');
  // 清洗后若再无 #EXTINF，宁可不删也不黑屏
  if (!cleaned.includes('#EXTINF')) return { text, removed: 0 };
  return { text: cleaned, removed };
}

/** 按开关决定是否清洗。 */
export function adCleaned(text, baseURL, enabled) {
  if (!enabled) return text;
  const result = filterAdSegments(text, baseURL);
  return result.removed > 0 ? result.text : text;
}
