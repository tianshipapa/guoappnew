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

// 抓取层重试（对齐 provider_huangguo.go 的 fetchProviderText：默认 3 次机会）。
// 只有「可能自己好起来」的失败才重试：网络层错误 + 网关/限流状态码。
// 4xx（除 408/425/429）是规则或权限问题，重试只会浪费时间。
const RETRY_STATUS = new Set([408, 425, 429, 500, 502, 503, 504, 520, 521, 522, 523, 524, 525, 526, 527, 530]);
const DEFAULT_RETRIES = 2; // 首次 + 2 次重试
const RETRY_BUDGET = 26000; // 全部重试的总预算，别让边缘函数的 30s 上限把请求切开
const RETRY_TIMEOUT_CAP = 10000; // 重试时单次超时压到 10s：首轮已经耗掉大部分等待

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * 把 undici / 边缘运行时抛出的 "fetch failed" 变成能定位的说法。
 * 原始错误只有一句 fetch failed，用户和日志都看不出是 DNS、连接重置还是证书问题。
 */
export function describeFetchError(address, error) {
  let host = '';
  try {
    host = new URL(address).host;
  } catch {
    host = String(address || '');
  }
  const cause = error?.cause;
  const code = String(cause?.code || cause?.errno || '').trim();
  const detail = String(cause?.message || error?.message || '未知错误').trim();
  // workerd（Cloudflare Pages 本地/dev）把连接失败写成 "upstream connect failed ... os error 10061"
  if (/upstream connect failed|os error 1006[01]|os error 1005[0-9]/i.test(detail)) {
    return new Error(
      `无法建立连接（${code || 'ECONNREFUSED'}${host ? ` · ${host}` : ''}）：目标只放行中国大陆网络，或本机/服务器代理不可用`
    );
  }
  if (error?.name === 'AbortError' || /aborted|timeout/i.test(detail)) {
    return new Error(`请求超时${host ? `（${host}）` : ''}`);
  }
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') {
    return new Error(`域名解析失败（${code}${host ? ` · ${host}` : ''}）`);
  }
  if (code === 'ECONNRESET' || code === 'ECONNREFUSED' || code === 'EPIPE') {
    return new Error(
      `连接被站点中断（${code}${host ? ` · ${host}` : ''}）——这类采集站多数只允许中国大陆网络访问，海外机房部署会直接连不上`
    );
  }
  if (code === 'ETIMEDOUT' || code === 'UND_ERR_CONNECT_TIMEOUT' || code === 'UND_ERR_HEADERS_TIMEOUT') {
    return new Error(`连接超时（${code}${host ? ` · ${host}` : ''}）`);
  }
  if (/certificate|self.signed|SSL|TLS/i.test(`${code} ${detail}`)) {
    return new Error(`HTTPS 证书校验失败（${code || detail}${host ? ` · ${host}` : ''}）`);
  }
  const lowered = detail.toLowerCase();
  if (lowered === 'fetch failed' || lowered === 'failed to fetch' || lowered === 'network connection lost') {
    return new Error(`网络请求失败：站点不可达（${host || address}）`);
  }
  return new Error(`网络请求失败：${detail}${host ? `（${host}）` : ''}`);
}

/** 上游状态码 → 人话。让 403/522 这类不再伪装成「规则写错了」。 */
export function describeStatus(status, address = '') {
  let host = '';
  try {
    host = new URL(address).host;
  } catch {
    host = String(address || '');
  }
  const suffix = host ? ` · ${host}` : '';
  if (status === 401) return `上游要求登录或鉴权（HTTP 401${suffix}）`;
  if (status === 403) {
    return `上游拒绝访问（HTTP 403${suffix}）：多数采集站只放行中国大陆 IP，海外机房部署会被拦；请在本地运行或换源`;
  }
  if (status === 404) return `页面不存在（HTTP 404${suffix}）`;
  if (status === 429) return `上游限流（HTTP 429${suffix}）`;
  if (status >= 500) return `上游站点或 CDN 异常（HTTP ${status}${suffix}）`;
  return `上游返回 HTTP ${status}${suffix}`;
}

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
 * 可选抓取中继。部署在境外（Cloudflare Pages / Vercel）时，大量采集站只放行
 * 中国大陆 IP，直连必然 403 或连接被拒——这不是规则问题，本地跑就好。
 * 想在这种情况下也能用，就配一个「中国大陆可访问」的中继：
 *   GUOAPP_FETCH_RELAY=https://relay.example.com/?url=
 * 或支持占位符的形态：https://relay.example.com/fetch?target={url}
 * 中继只要把目标页面正文原样返回即可（国内小机器上一个反向代理就够）。
 */
function relayEndpoint() {
  if (typeof process === 'undefined' || !process.env) return '';
  return String(process.env.GUOAPP_FETCH_RELAY || '').trim();
}

async function fetchViaRelay(address, headers, timeout) {
  const relay = relayEndpoint();
  if (!relay) return null;
  const encoded = encodeURIComponent(address);
  const target = relay.includes('{url}') ? relay.split('{url}').join(encoded) : relay + encoded;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.min(timeout, 15000));
  try {
    const response = await fetch(target, {
      headers: {
        'User-Agent': DEFAULT_UA,
        Accept: 'text/html,application/xhtml+xml,*/*;q=0.8',
        // 自建中继可以直接读这个头转发，省掉自己解析查询串
        'x-guopp-target': address,
        'x-guopp-referer': headers?.Referer || '',
      },
      signal: controller.signal,
    });
    const buffer = Buffer.from(await response.arrayBuffer());
    if (!response.ok || buffer.length === 0) return null;
    return {
      text: decodeBody(buffer, response.headers.get('content-type') || ''),
      // 中继拿不到上游的重定向结果，相对链接按原地址补全
      url: address,
      status: 200,
      headers: response.headers,
      relayed: true,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 抓取文本。返回最终地址，供相对链接补全使用。
 * @returns {Promise<{text: string, url: string, status: number, headers: Headers}>}
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
    retries = DEFAULT_RETRIES,
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
  // 采集站的 WAF 会把「没有 Accept-Language 的请求」当脚本拦掉，缺失时补一个中文头。
  if (!Object.keys(requestHeaders).some((k) => k.toLowerCase() === 'accept-language')) {
    requestHeaders['Accept-Language'] = 'zh-CN,zh;q=0.9,en;q=0.6';
  }
  if (method === 'POST' && !Object.keys(requestHeaders).some((k) => k.toLowerCase() === 'content-type')) {
    requestHeaders['Content-Type'] = 'application/x-www-form-urlencoded';
  }

  const attempts = Math.max(0, Number.parseInt(retries, 10) || 0) + 1;
  const startedAt = Date.now();
  let lastError = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    if (attempt > 1) {
      const remaining = RETRY_BUDGET - (Date.now() - startedAt);
      if (remaining <= 500) break;
      // 退避 300ms / 600ms（对齐 guoappxp 的 attempt*秒 退避，但整体更快）
      await sleep(300 * (attempt - 1));
    }
    const remaining = RETRY_BUDGET - (Date.now() - startedAt);
    if (remaining <= 500) break;
    const attemptTimeout = Math.min(attempt === 1 ? timeout : Math.min(timeout, RETRY_TIMEOUT_CAP), remaining);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), attemptTimeout);
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
      const result = {
        text: decodeBody(buffer, response.headers.get('content-type') || ''),
        url: response.url || address,
        status: response.status,
        // 部分站点（含韩小圈）靠 session cookie 串起「列表 → 详情 → 播放页」，
        // 调用方需要能读到 set-cookie，所以把响应头一并带出（不影响旧调用方）。
        headers: response.headers,
      };
      if (RETRY_STATUS.has(result.status) && attempt < attempts) {
        lastError = new Error(describeStatus(result.status, address));
        continue;
      }
      if ((result.status === 403 || result.status === 451) && relayEndpoint()) {
        // 403 多为「只放行中国大陆 IP」：直接出口被拦，交给中继再试一次
        const relayed = await fetchViaRelay(address, requestHeaders, timeout);
        if (relayed) return relayed;
      }
      return result;
    } catch (error) {
      lastError = error?.name === 'AbortError' || /aborted/i.test(String(error?.message))
        ? new Error('请求超时')
        : error;
      // 域名解析失败 / 证书错误重试无意义
      const code = String(error?.cause?.code || '');
      if (code === 'ENOTFOUND' || /certificate|self.signed/i.test(code)) break;
    } finally {
      clearTimeout(timer);
    }
  }

  const failure = lastError || new Error(`抓取失败（${address}）`);
  // 直连彻底失败（海外机房连不上只放行中国大陆的采集站）时，走可选中继再试一次
  if (relayEndpoint()) {
    const relayed = await fetchViaRelay(address, requestHeaders, timeout);
    if (relayed) return relayed;
  }
  // 原始 "fetch failed" / workerd 的 "upstream connect failed" 对排查没有任何信息量，
  // 统一换成带原因的说法（网络类错误才换，业务错误原样抛出）
  if (
    failure?.name === 'TypeError' ||
    /fetch failed|failed to fetch|upstream connect failed|os error 100[0-9]{2}/i.test(failure?.message || '')
  ) {
    throw describeFetchError(address, failure);
  }
  throw failure;
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
    if (error?.name === 'AbortError' || /aborted/i.test(String(error?.message))) {
      throw new Error('请求超时');
    }
    if (
      error?.name === 'TypeError' ||
      /fetch failed|failed to fetch|upstream connect failed|os error 100[0-9]{2}/i.test(error?.message || '')
    ) {
      throw describeFetchError(address, error);
    }
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
