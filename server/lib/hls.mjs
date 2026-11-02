// m3u8 清单重写：把分片/密钥/子清单地址全部改走本地代理。
//
// 浏览器直连 CDN 会同时踩两个坑：跨域被拒，以及上游要求特定 Referer/UA
// （多数采集站只认自己站点）。改写后统一由 /api/media 带原始请求头转发。

const URI_ATTR = /URI="([^"]*)"/gi;

function toAbsolute(reference, base) {
  const value = String(reference || '').trim();
  if (!value) return '';
  if (/^https?:\/\//i.test(value)) return value;
  if (value.startsWith('//')) return 'https:' + value;
  try {
    return new URL(value, base).toString();
  } catch {
    return '';
  }
}

function encodeHeaders(headers) {
  const entries = Object.entries(headers || {}).filter(([, value]) => value);
  if (!entries.length) return '';
  try {
    return Buffer.from(JSON.stringify(Object.fromEntries(entries)), 'utf-8').toString('base64url');
  } catch {
    return '';
  }
}

/** 生成代理地址（供服务端与前端拼同一种格式）。 */
export function proxyURL(origin, kind, { url, referer = '', headers = {} }) {
  const params = new URLSearchParams();
  params.set('u', url);
  if (referer) params.set('r', referer);
  const encoded = encodeHeaders(headers);
  if (encoded) params.set('h', encoded);
  return `${origin}/api/${kind}?${params.toString()}`;
}

export function decodeHeaders(token) {
  if (!token) return {};
  try {
    return JSON.parse(Buffer.from(String(token), 'base64url').toString('utf-8')) || {};
  } catch {
    return {};
  }
}

/**
 * 重写清单：注释行里的 URI="…"（EXT-X-KEY / EXT-X-MAP / EXT-X-MEDIA）与裸 URI 行。
 * @returns {string}
 */
export function rewriteManifest(text, baseURL, origin, options = {}) {
  const { referer = '', headers = {} } = options;
  // 子清单（多码率 m3u8）也走 /api/hls：那边会校验 #EXTM3U、失败重试，
  // 直接把错误页当清单转发会让播放器整条线路挂掉。
  const kindOf = (address) => (/\.m3u8(\?|#|$)/i.test(address) ? 'hls' : 'media');
  const segment = (address) =>
    proxyURL(origin, kindOf(address), { url: address, referer, headers });
  const lines = String(text || '').replace(/\r\n/g, '\n').split('\n');

  return lines
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed) return line;
      if (trimmed.startsWith('#')) {
        return line.replace(URI_ATTR, (match, value) => {
          const absolute = toAbsolute(value, baseURL);
          if (!absolute) return match;
          return `URI="${segment(absolute)}"`;
        });
      }
      const absolute = toAbsolute(trimmed, baseURL);
      if (!absolute) return line;
      return segment(absolute);
    })
    .join('\n');
}
