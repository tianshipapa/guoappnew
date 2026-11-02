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

/**
 * 出口 dispatcher（仅 Node 运行时可用，CF/Vercel Edge 没有 undici）。
 *
 * 默认是「不带 proxy 的 Agent」——纯直连、无视环境里的 HTTP_PROXY（用户机器上的
 * 科学上网代理一关，全局代理会让所有抓取报 10061，整站瘫痪）。
 *
 * 例外：配置了 GUOAPP_FETCH_PROXY（例如买的国内隧道代理 `http://user:pass@host:port`）
 * 时改用 ProxyAgent，让出口落到国内 IP——这是「不想自己维护中继机器」时的另一条路，
 * 只对 Vercel / 本地生效，Cloudflare 部署请用 relay/。
 */
async function getDirectDispatcher() {
  if (directDispatcherResolved) return directDispatcher;
  directDispatcherResolved = true;
  try {
    const undici = await import('undici');
    const proxy = envValue('GUOAPP_FETCH_PROXY');
    if (/^https?:\/\/\S+$/i.test(proxy)) {
      directDispatcher = new undici.ProxyAgent(proxy);
      console.log('[fetch] 已启用抓取代理出口（GUOAPP_FETCH_PROXY）');
    } else {
      // 不设 proxy 参数 = 纯直连；默认 Agent 不读任何环境代理变量。
      directDispatcher = new undici.Agent();
    }
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
 * 可选抓取中继。部署在境外（Cloudflare Pages / Vercel / 任意海外机房）时，
 * 大量采集站只放行中国大陆 IP：直连不是 403 就是连接被重置。这不是规则问题，
 * 唯一的解就是换出口——把请求交给一个「中国大陆可达」的转发点：
 *   GUOAPP_FETCH_RELAY=https://relay.example.com/?url=
 *   GUOAPP_FETCH_RELAY=https://a.example.com/?url=,https://b.example.com/?url=   # 多中继按序故障切换
 *   GUOAPP_FETCH_RELAY=https://relay.example.com/fetch?target={url}              # 占位符形态
 *   GUOAPP_FETCH_RELAY_TOKEN=xxx        # 中继要求鉴权时带 x-guopp-token
 *   GUOAPP_FETCH_RELAY_FORCE=1          # 所有抓取都先走中继（站源全被拦时省掉必然失败的直连）
 * 中继实现见仓库 relay/ 目录（零依赖单文件，国内小机器 / 云函数都能跑）。
 *
 * 注意：Cloudflare Pages 的环境变量在 context.env 里，process.env 读不到，
 * 所以边缘入口要调用 configureFetch() 显式注入（见 functions/api/[[path]].js）。
 */
let relayState = null;

function envValue(key) {
  if (typeof process === 'undefined' || !process.env) return '';
  return String(process.env[key] || '').trim();
}

const TRUTHY = /^(1|true|yes|on)$/i;

function buildRelayState(source = {}) {
  const raw = String(source.relay ?? envValue('GUOAPP_FETCH_RELAY'));
  const token = String(source.token ?? envValue('GUOAPP_FETCH_RELAY_TOKEN')).trim();
  const force = TRUTHY.test(String(source.force ?? envValue('GUOAPP_FETCH_RELAY_FORCE')).trim());
  const list = raw
    .split(/[,\n;]+/)
    .map((item) => item.trim())
    .filter((item) => /^https?:\/\/\S+$/i.test(item));
  return { list, token, force, signature: `${list.join('\u0001')}#${token}#${force ? 1 : 0}` };
}

/**
 * 注入抓取出口配置（入口层调用一次即可）。
 * 同一份配置重复调用直接返回，避免每个请求都重解析一遍列表。
 * @param {{relay?: string, token?: string, force?: string|boolean}} options
 */
export function configureFetch(options = {}) {
  const next = buildRelayState(options);
  if (relayState && relayState.signature === next.signature) return relayState;
  relayState = next;
  if (next.list.length) {
    console.log(`[fetch] 抓取中继已启用：${next.list.length} 个出口${next.force ? '（强制）' : ''}`);
  }
  return relayState;
}

function relaySetting() {
  return relayState || configureFetch();
}

// 某个域名一旦确认「直连必被拦」，短时间内直接走中继：
// 否则每次列表/详情/取流都要先等一次必然失败的直连（海外机房常见 10s 超时）。
const RELAY_HOST_TTL = 10 * 60 * 1000;
const relayHosts = new Map();

/** 仅供测试：清掉中继配置与「该 host 需要中继」的记忆。 */
export function resetFetchRelay() {
  relayState = null;
  relayHosts.clear();
}

/** 当前抓取出口状态（/api/health 与排障用：一眼看出中继到底生效没）。 */
export function relayStatus() {
  const setting = relaySetting();
  return {
    enabled: setting.list.length > 0,
    exits: setting.list.length,
    force: setting.force,
    media: TRUTHY.test(envValue('GUOAPP_FETCH_RELAY_MEDIA')),
    // 只对 Node 运行时有效（Cloudflare 没有 undici，配了也不生效）
    proxy: /^https?:\/\/\S+$/i.test(envValue('GUOAPP_FETCH_PROXY')),
    // 已被判定「直连必被拦、走中继」的域名
    relayedHosts: [...relayHosts.keys()],
  };
}

function hostOf(address) {
  try {
    return new URL(address).host;
  } catch {
    return '';
  }
}

function relayKnowsHost(host) {
  if (!host) return false;
  const expireAt = relayHosts.get(host);
  if (!expireAt) return false;
  if (expireAt < Date.now()) {
    relayHosts.delete(host);
    return false;
  }
  return true;
}

function relayRememberHost(host) {
  if (!host) return;
  // 记忆表不需要精确：超过 500 条就整体清空，避免长期运行的 Node 进程里无限增长
  if (relayHosts.size > 500) relayHosts.clear();
  relayHosts.set(host, Date.now() + RELAY_HOST_TTL);
}

function relayTarget(prefix, address) {
  const encoded = encodeURIComponent(address);
  if (prefix.includes('{url_raw}')) return prefix.split('{url_raw}').join(address);
  if (prefix.includes('{url}')) return prefix.split('{url}').join(encoded);
  return prefix + encoded;
}

/**
 * 走中继抓一次。多个中继按顺序试，前一个挂了自动换下一个。
 * 中继只要把上游状态码与正文原样透传即可（见 relay/relay.mjs）。
 * @returns {Promise<{text:string,url:string,status:number,headers:Headers,relayed:true}|null>}
 */
async function fetchViaRelay(address, headers, timeout, request = {}) {
  const setting = relaySetting();
  if (!setting.list.length) return null;

  const host = hostOf(address);
  const method = String(request.method || 'GET').toUpperCase();
  const referer = headers?.Referer || headers?.referer || '';
  const ua = headers?.['User-Agent'] || headers?.['user-agent'] || DEFAULT_UA;
  const body = method === 'GET' || method === 'HEAD' ? undefined : request.body;

  for (const prefix of setting.list) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.min(timeout, 20000));
    try {
      const relayHeaders = {
        'User-Agent': ua,
        Accept: headers?.Accept || 'text/html,application/xhtml+xml,*/*;q=0.8',
        // 自建中继可以直接读这些头拼上游请求，省掉自己解析查询串
        'x-guopp-target': address,
        'x-guopp-method': method,
        'x-guopp-referer': referer,
      };
      if (headers?.['Accept-Language']) relayHeaders['x-guopp-accept-language'] = headers['Accept-Language'];
      if (headers?.Cookie) relayHeaders['x-guopp-cookie'] = headers.Cookie;
      if (method !== 'GET' && method !== 'HEAD') {
        relayHeaders['Content-Type'] = headers?.['Content-Type'] || 'application/x-www-form-urlencoded';
      }
      if (setting.token) relayHeaders['x-guopp-token'] = setting.token;

      const response = await fetch(relayTarget(prefix, address), {
        method,
        headers: relayHeaders,
        body,
        signal: controller.signal,
        redirect: 'follow',
      });
      const buffer = Buffer.from(await response.arrayBuffer());
      // 中继自己挂了（502/504 且没带 x-guopp-relayed）→ 换下一个中继
      const viaRelay = response.headers.get('x-guopp-relayed') === '1';
      if (!viaRelay && !response.ok) continue;
      if (buffer.length === 0 && response.status >= 400) continue;
      // 中继把上游状态码透了回来：403 就是上游 403，不再是「中继成功但内容为空」
      const status = Number(response.headers.get('x-guopp-status') || response.status) || 200;
      if (status >= 200 && status < 400) relayRememberHost(host);
      return {
        text: decodeBody(buffer, response.headers.get('content-type') || ''),
        // 中继拿不到上游的重定向结果，相对链接按原地址补全
        url: response.headers.get('x-guopp-url') || address,
        status,
        headers: response.headers,
        relayed: true,
      };
    } catch {
      /* 换下一个中继 */
    } finally {
      clearTimeout(timer);
    }
  }
  return null;
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

  const setting = relaySetting();
  const host = hostOf(address);
  let relayTried = false;

  // 已知「直连必被拦」的域名 / 强制模式：先走中继，省掉一次注定失败的直连等待
  if (setting.list.length && (setting.force || relayKnowsHost(host))) {
    relayTried = true;
    const early = await fetchViaRelay(address, requestHeaders, timeout, { method, body });
    if (early && early.status < 400) return early;
    // 中继这次也没成：清掉记忆，继续直连碰运气
    relayHosts.delete(host);
  }

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
      if ((result.status === 403 || result.status === 451) && setting.list.length) {
        // 403 多为「只放行中国大陆 IP」：直接出口被拦，交给中继再试一次
        relayTried = true;
        const relayed = await fetchViaRelay(address, requestHeaders, timeout, { method, body });
        if (relayed && relayed.status < 400) return relayed;
        if (relayed) return relayed; // 中继也拿到 403：如实把上游状态码交出去
      } else if (result.status >= 200 && result.status < 400) {
        relayHosts.delete(host); // 直连能通，清掉「该域名必须走中继」的记忆
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
  // 直连彻底失败（海外机房连不上只放行中国大陆的采集站）时，走可选中继再试一次。
  // 前面已经试过中继就不再重复，避免一次失败请求把等待时间翻倍。
  if (setting.list.length && !relayTried) {
    const relayed = await fetchViaRelay(address, requestHeaders, timeout, { method, body });
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

/**
 * 中继转发二进制（m3u8 清单 / 视频分片）。
 * 实测多数视频 CDN（hd.kuktxu.com 等）全球可达，只有站点页做了地域限制，
 * 所以默认关闭；某些源连 CDN 也只放行部分地区时，配 GUOAPP_FETCH_RELAY_MEDIA=1 打开。
 * 走流式转发，不整段缓冲，避免大分片占用内存。
 */
async function fetchBinaryViaRelay(address, headers, timeout, { method = 'GET' } = {}) {
  const setting = relaySetting();
  if (!setting.list.length) return null;
  if (!TRUTHY.test(envValue('GUOAPP_FETCH_RELAY_MEDIA'))) return null;

  for (const prefix of setting.list) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.min(timeout, 25000));
    try {
      const relayHeaders = {
        'User-Agent': headers?.['User-Agent'] || DEFAULT_UA,
        'x-guopp-target': address,
        'x-guopp-method': 'GET',
        'x-guopp-referer': headers?.Referer || '',
      };
      if (headers?.Range) relayHeaders['x-guopp-range'] = headers.Range;
      if (setting.token) relayHeaders['x-guopp-token'] = setting.token;

      const response = await fetch(relayTarget(prefix, address), {
        method: 'GET',
        headers: relayHeaders,
        signal: controller.signal,
      });
      if (response.status >= 500 && response.headers.get('x-guopp-relayed') !== '1') {
        clearTimeout(timer);
        continue;
      }
      clearTimeout(timer); // 流已交给调用方，不能再 abort
      return {
        status: Number(response.headers.get('x-guopp-status') || response.status) || 200,
        headers: response.headers,
        body: response.body,
        url: response.headers.get('x-guopp-url') || address,
        relayed: true,
      };
    } catch {
      clearTimeout(timer);
    }
  }
  return null;
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
    const relayed = await fetchBinaryViaRelay(address, requestHeaders, timeout, { method }).catch(() => null);
    if (relayed) return relayed;
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
