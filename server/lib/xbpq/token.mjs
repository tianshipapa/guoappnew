// XBPQ 令牌自动续期：移植 provider_xbpq_token.go。
//
// 针对「需要登录令牌」的 XBPQ 源（如青空次元类站点）：规则字段可配置刷新地址 /
// 刷新令牌，播放直链解析失败时自动用 refresh token 换一套新 access token，改写
// 「头部集合」里的 Authorization 后重试一次。同一 endpoint 的刷新结果在缓存窗口内
// 复用（默认 10 分钟），避免连续播放多集时并发刷新互相顶掉（refresh token 轮换后
// 旧值立即作废）。
//
// 与 guoappxp 的差异：guoappxp 把轮换结果落盘到自定义源存储；本服务是无状态的边缘
// 函数，无法跨请求写回浏览器 localStorage，因此只在「内存缓存」里复用，并把更新后的
// 规则通过 resolve 响应带回前端（见 provider.mjs 的 xbpqResolve），由前端负责持久化。

import { normalizeKey, parseHeaderSet } from './rule.mjs';
import { jsonStringValue } from './json.mjs';
import { fetchText } from '../http.mjs';

const DEFAULT_ACCESS_PATH = 'data.token';
const DEFAULT_REFRESH_PATH = 'data.refreshToken';
const TOKEN_CACHE_TTL = 10 * 60 * 1000;

const tokenCache = new Map();

/** 刷新接口地址；未配置或非法时返回空。 */
export function tokenRefreshEndpoint(rule, base) {
  const raw = String(rule.field('刷新地址', '令牌刷新地址', '刷新url', '刷新接口') || '').trim();
  if (!raw) return '';
  if (raw.startsWith('/')) {
    const origin = String(rule.homeURL || base || '').replace(/\/$/, '');
    if (!/^https?:\/\//i.test(origin)) return '';
    return origin + raw;
  }
  if (!/^https?:\/\//i.test(raw)) return '';
  return raw;
}

/** 规则里配置的 refresh token。 */
export function tokenRefreshValue(rule) {
  return String(rule.field('刷新令牌', 'refreshToken', '刷新token', '令牌刷新值') || '').trim();
}

function tokenAccessPath(rule) {
  const value = String(rule.field('令牌路径', '新令牌路径', '访问令牌路径') || '').trim();
  return value || DEFAULT_ACCESS_PATH;
}

function tokenRefreshPath(rule) {
  const value = String(rule.field('刷新令牌路径', '新刷新令牌路径') || '').trim();
  return value || DEFAULT_REFRESH_PATH;
}

/** 把头部表还原成 `名$值#名$值` 规则写法（与解析侧对称）。 */
function formatHeaderSet(headers) {
  const names = Object.keys(headers).sort((a, b) => a.localeCompare(b));
  return names.map((name) => `${name}$${headers[name]}`).join('#');
}

/** 把头部集合里的 Authorization 换成新令牌，其余头保持不动。 */
function headerSetWithToken(raw, access) {
  const headers = parseHeaderSet(raw) || {};
  headers['Authorization'] = 'Bearer ' + access;
  return formatHeaderSet(headers);
}

/** 返回替换了新令牌的规则（原地修改其 fields，调用方在单次请求内使用）。 */
export function ruleWithToken(rule, access, refresh) {
  const raw = rule.field('头部集合', '头部集合');
  rule.fields.set(normalizeKey('头部集合'), headerSetWithToken(raw, access));
  if (refresh) rule.fields.set(normalizeKey('刷新令牌'), refresh);
  return rule;
}

/** 规则是否配置了令牌刷新（用于判断是否值得在取流失败时重试）。 */
export function ruleHasTokenConfig(rule) {
  return Boolean(tokenRefreshEndpoint(rule, rule.homeURL) && tokenRefreshValue(rule));
}

/**
 * 用 refresh token 换一套新令牌。
 * @param {import('./rule.mjs').XbpqRule} rule
 * @param {string} base 站点根地址
 * @param {string} source 源标识（用于缓存键隔离）
 * @param {(address:string, options?:object)=>Promise<{text:string}>} [fetcher] 可注入，默认 fetchText
 * @returns {Promise<import('./rule.mjs').XbpqRule|null>} 替换了新令牌的规则，未配置/刷新失败返回 null
 */
export async function refreshXBPQToken(rule, base, source = '', fetcher) {
  const doFetch = fetcher || fetchText;
  const refresh = tokenRefreshValue(rule);
  const endpoint = tokenRefreshEndpoint(rule, base);
  if (!refresh || !endpoint) return null;

  const cacheKey = endpoint + '|' + source;
  const now = Date.now();
  const cached = tokenCache.get(cacheKey);
  if (cached && now - cached.at < TOKEN_CACHE_TTL) {
    return ruleWithToken(rule, cached.access, cached.refresh);
  }

  let body = '';
  try {
    const result = await doFetch(endpoint, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + refresh, Accept: 'application/json' },
      body: '',
      referer: String(rule.homeURL || base || '') + '/',
      timeout: 15000,
    });
    body = result?.text || '';
  } catch {
    return null;
  }

  const access = String(jsonStringValue(body, tokenAccessPath(rule)) || '').trim();
  if (!access || access === refresh) return null; // 取不到新令牌多半是 refresh token 已失效
  let nextRefresh = String(jsonStringValue(body, tokenRefreshPath(rule)) || '').trim();
  if (!nextRefresh) nextRefresh = refresh;

  tokenCache.set(cacheKey, { access, refresh: nextRefresh, at: now });
  return ruleWithToken(rule, access, nextRefresh);
}
