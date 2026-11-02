// 抓取层：移植 guoappxp native/core 里的 duanjuDo / fetchProviderText 语义。
//
// - 自定义 UA / Referer / 附加头部（头部集合、播放请求头）
// - GBK / GB2312 页面转 UTF-8（对齐 xbpqDecodeBody）
// - POST（`url;post;body` 形态由 xbpq 层拆好后传进来）
// - 二进制流（播放转发）保留 Range 语义

export const DEFAULT_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

// ---------------------------------------------------------------- 代理
// Node 22.15+ / 24 在 NODE_USE_ENV_PROXY=1 或 --use-env-proxy 下会读取 HTTP_PROXY，
// 而采集站基本都在公网。用户机器上常见的科学上网代理（如 127.0.0.1:3240）一旦
// 没开就会让所有抓取报 "upstream connect failed ... os error 10061"，表现为整站瘫痪。
// 因此默认直连；确实需要走代理时显式设置 GUOAPP_USE_ENV_PROXY=1。
const PROXY_ENV_KEYS = [
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'ALL_PROXY',
  'http_proxy',
  'https_proxy',
  'all_proxy',
];

if (process.env.GUOAPP_USE_ENV_PROXY !== '1') {
  for (const key of PROXY_ENV_KEYS) {
    if (process.env[key]) delete process.env[key];
  }
  process.env.NO_PROXY = '*';
  process.env.no_proxy = '*';
}

// ---------------------------------------------------------------- 强制直连
// 上面的删环境代理只对「Node 之后才读的变量」有效；undici 的全局 fetch 在进程
// 启动时就可能已锁定环境代理（用户机器上的科学上网代理一关，所有抓取报
// "upstream connect failed ... os error 10061"，整站瘫痪）。
// 解法：Node 侧用一个「不带 proxy 的 undici Agent」作为 fetch 的 dispatcher，
// 强制直连、彻底忽略 HTTP_PROXY/HTTPS_PROXY/NODE_USE_ENV_PROXY。
// 边缘运行时（Cloudflare/Vercel）没有 undici，直接走平台 fetch（本就无此问题）。
let directDispatcher;
let directDispatcherResolved = false;

async function getDirectDispatcher() {
  if (directDispatcherResolved) return directDispatcher;
  directDispatcherResolved = true;
  try {
    const undici = await import('undici');
    // 不设 proxy 参数 = 纯直连；默认 Agent 不读任何环境代理变量。
    directDispatcher = new undici.Agent();
  } catch {
    directDispatcher = null;
  }
  return directDispatcher;
}

function withDispatcher(options, dispatcher) {
  return dispatcher ? { ...options, dispatcher } : options;
}

const MAX_TEXT_BYTES = 12 << 20; // 单页 12MB 上限，防止异常站点打爆内存
const DEFAULT_TIMEOUT = 20000;

/** 合并多组头部，后者覆盖前者；全空返回空对象。 */
export function mergeHeaders(...groups) {
  const merged = {};
  for (const group of groups) {
    if (!group) continue;
    for (const [name, value] of Object.entries(group)) {
      if (value == null || value === '') continue;
      merged[name] = String(value);
    }
  }
  return merged;
}

function canonicalHeaders(extra = {}) {
  const out = {};
  for (const [name, value] of Object.entries(extra)) {
    if (!name || value == null) continue;
    out[name] = String(value);
  }
  return out;
}

const CHARSET_PATTERN = /charset\s*=\s*["' ]?(gbk|gb2312|gb18030)/i;

function decodeBody(buffer, contentType = '') {
  const probe = Buffer.from(buffer).subarray(0, 8192).toString('latin1');
  const gbk =
    CHARSET_PATTERN.test(probe) || /charset\s*=\s*["' ]?(gbk|gb2312|gb18030)/i.test(contentType);
  try {
    return new TextDecoder(gbk ? 'gbk' : 'utf-8').decode(buffer);
  } catch {
    return Buffer.from(buffer).toString('utf-8');
  }
}

/**
 * 抓取文本。返回最终地址，供相对链接补全使用。
 * @returns {Promise<{text: string, url: string, status: number}>}
 */
export async function fetchText(address, options = {}) {
  const {
    headers = {},
    referer = '',
    ua = '',
    method = 'GET',
    body = '',
    timeout = DEFAULT_TIMEOUT,
    redirect = 'follow',
  } = options;

  const requestHeaders = canonicalHeaders(headers);
  if (!Object.keys(requestHeaders).some((k) => k.toLowerCase() === 'user-agent')) {
    requestHeaders['User-Agent'] = ua || DEFAULT_UA;
  }
  if (referer) requestHeaders['Referer'] = referer;
  if (!Object.keys(requestHeaders).some((k) => k.toLowerCase() === 'accept')) {
    requestHeaders['Accept'] =
      'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8';
  }
  if (method === 'POST' && !Object.keys(requestHeaders).some((k) => k.toLowerCase() === 'content-type')) {
    requestHeaders['Content-Type'] = 'application/x-www-form-urlencoded';
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const dispatcher = await getDirectDispatcher();
    const fetchOptions = withDispatcher(
      {
        method,
        headers: requestHeaders,
        body: method === 'GET' || method === 'HEAD' ? undefined : body,
        redirect,
        signal: controller.signal,
      },
      dispatcher
    );
    const response = await fetch(address, fetchOptions);
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > MAX_TEXT_BYTES) {
      throw new Error(`页面过大（${(buffer.length / 1048576).toFixed(1)}MB）`);
    }
    return {
      text: decodeBody(buffer, response.headers.get('content-type') || ''),
      url: response.url || address,
      status: response.status,
      // 部分站点（含韩小圈）靠 session cookie 串起「列表 → 详情 → 播放页」，
      // 调用方需要能读到 set-cookie，所以把响应头一并带出（不影响旧调用方）。
      headers: response.headers,
    };
  } catch (error) {
    if (error?.name === 'AbortError') throw new Error('请求超时');
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

/** 抓取二进制（播放器转发、探测清单）。 */
export async function fetchBinary(address, options = {}) {
  const { headers = {}, referer = '', ua = '', range = '', timeout = 30000, method = 'GET' } = options;
  const requestHeaders = canonicalHeaders(headers);
  if (!Object.keys(requestHeaders).some((k) => k.toLowerCase() === 'user-agent')) {
    requestHeaders['User-Agent'] = ua || DEFAULT_UA;
  }
  if (referer) requestHeaders['Referer'] = referer;
  if (range) requestHeaders['Range'] = range;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const dispatcher = await getDirectDispatcher();
    const response = await fetch(address, withDispatcher({ method, headers: requestHeaders, signal: controller.signal }, dispatcher));
    return {
      status: response.status,
      headers: response.headers,
      body: response.body,
      url: response.url || address,
    };
  } catch (error) {
    if (error?.name === 'AbortError') throw new Error('请求超时');
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

/** 相对地址转绝对（对齐 duanjuAbsolute）。 */
export function absoluteURL(base, raw) {
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

/** 取 scheme://host。 */
export function hostOrigin(address) {
  const index = String(address || '').indexOf('://');
  if (index < 0) return '';
  const rest = address.slice(index + 3);
  const cut = rest.search(/[/?#]/);
  return address.slice(0, index + 3) + (cut >= 0 ? rest.slice(0, cut) : rest);
}

/** 判断是否 http(s) 媒体直链（m3u8 / mp4 / flv / ts）。 */
export function isMediaURL(address) {
  const value = String(address || '').trim();
  if (!/^https?:\/\//i.test(value)) return false;
  const lower = value.split('#')[0].toLowerCase();
  return /\.(m3u8|mp4|flv|mkv|ts|mov)(\?|$)/.test(lower) || lower.includes('.m3u8?');
}

/** 判断是否 m3u8。 */
export function isHlsURL(address) {
  return /\.m3u8(\?|#|$)/i.test(String(address || '').trim());
}
