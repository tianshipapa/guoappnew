// 抓取路由核心：运行时无关（Node / Cloudflare Workers 共用）。
//
// 为什么必须有服务端：站点抓取、m3u8 去广告、跨源聚合都受浏览器同源策略限制，
// 且多数采集站只认自己站点的 Referer/UA，只能在服务端完成。
//
// 本文件不 import 任何 Node 内置模块的 fs / http / path，
// 只通过 `handleRequest(req, res, url)` 与「类 Node 的 req/res」交互：
//   req 需要 method / url / headers / 可异步迭代的 body
//   res 需要 setHeader / writeHead / write / end / once('drain')
// Node 外壳见 index.mjs，边缘外壳见 functions/api/[[path]].js。
//
// 路由一览（全部同源，前端直连）：
//   GET  /api/health
//   POST /api/catalog            目录（站源 / 分类 / 翻页）
//   POST /api/categories         分类列表
//   POST /api/search             单源搜索
//   POST /api/search/start       跨源聚合搜索（立即返回会话号）
//   POST /api/search/poll        轮询聚合快照
//   POST /api/search/cancel      结束会话
//   POST /api/detail             详情 + 分集
//   POST /api/resolve            取播放直链（多线路备选）
//   POST /api/source/test        规则校验（带在线连通性探测）
//   POST /api/source/import      订阅 / JSON 文本导入 → 站点草稿列表
//   GET  /api/live/sources       直播源列表
//   POST /api/live/platforms     直播分类
//   POST /api/live/channels      直播频道
//   POST /api/live/play          直播取流
//   GET  /api/proxy              原始抓取（调试 / 规则测试）
//   GET  /api/hls                m3u8 改写 + 去广告
//   GET  /api/media              分片 / 直链转发（保留 Range）

import { createHash } from 'node:crypto';

import { fetchText, fetchBinary, mergeHeaders, DEFAULT_UA, relayStatus } from './lib/http.mjs';
import { resolveCover, coverCacheStats } from './lib/covers.mjs';
import { parseRule, normalizeKey } from './lib/xbpq/rule.mjs';
import { detectFamilies } from './lib/xbpq/template.mjs';
import {
  xbpqCatalog,
  xbpqSearch,
  xbpqDetail,
  xbpqResolve,
  splitSpec,
} from './lib/xbpq/provider.mjs';
import {
  a123Catalog,
  a123Search,
  a123Detail,
  a123Resolve,
  a123Categories,
  A123_BASE,
} from './lib/providers/a123.mjs';
import {
  ikanbotCatalog,
  ikanbotSearch,
  ikanbotDetail,
  ikanbotResolve,
  ikanbotCategories,
  IKB_BASE,
} from './lib/providers/ikanbot.mjs';
import {
  guipianCatalog,
  guipianSearch,
  guipianDetail,
  guipianResolve,
  guipianCategories,
  GUIPIAN_BASE,
} from './lib/providers/guipian.mjs';
import {
  hanxiaoquanCatalog,
  hanxiaoquanSearch,
  hanxiaoquanDetail,
  hanxiaoquanResolve,
  hanxiaoquanCategories,
  HANXIAOQUAN_BASE,
} from './lib/providers/hanxiaoquan.mjs';
import {
  maccmsCatalog,
  maccmsSearch,
  maccmsDetail,
  maccmsResolve,
  maccmsCategories,
} from './lib/providers/maccms-api.mjs';
import { adCleaned } from './lib/adfilter.mjs';
import { readLibrary, applyLibrary, libraryBackend } from './lib/library.mjs';
import { rewriteManifest, decodeHeaders } from './lib/hls.mjs';
import {
  livePlatforms,
  liveChannels,
  livePlayback,
  liveSourceCatalog,
  isLivePortRestricted,
} from './lib/live/index.mjs';

const BODY_LIMIT = 4 << 20;
const SEARCH_SESSION_TTL = 5 * 60 * 1000;

/**
 * 运行时标识。
 * - 'node'：本地服务 / Vite 中间件，进程常驻，聚合搜索可以「立即返回 + 轮询」
 * - 'edge'：Cloudflare Pages Functions，实例可能在两次请求之间被回收，
 *   所有依赖进程内状态的功能都要改成一次性完成
 */
let runtime = 'node';

export function setRuntime(name) {
  runtime = name === 'edge' ? 'edge' : 'node';
}

export function currentRuntime() {
  return runtime;
}
const SEARCH_SOURCE_TIMEOUT = 25000;
/** 封面抓取失败时返回的 1x1 透明 PNG（避免列表出现破图图标）。 */
const BLANK_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64'
);

// ---------------------------------------------------------------- 站源调度

const NATIVE_SOURCES = new Set(['a123', 'ikanbot', 'guipian', 'hanxiaoquan']);

function ruleOfPayload(payload) {
  const raw = payload?.rule;
  if (!raw) return null;
  if (typeof raw === 'object') return parseRule(JSON.stringify(raw));
  return parseRule(String(raw));
}

function baseOf(payload, rule, fallback) {
  const explicit = String(payload?.base || '').trim();
  if (explicit && /^https?/i.test(explicit)) return explicit.replace(/\/+$/, '');
  if (rule) {
    const home = rule.homeURL;
    if (home) return home;
    for (const key of ['分类url', '分类Url', '搜索url']) {
      const value = rule.field(key);
      if (value.startsWith('http')) {
        try {
          const parsed = new URL(value);
          return `${parsed.protocol}//${parsed.host}`;
        } catch {
          /* 继续 */
        }
      }
    }
  }
  return fallback;
}

/**
 * 「规则型」站源：仅自定义源（XBPQ / MacCMS 接口）。
 * 必须随请求带上 rule/base，服务端不做内置绑定。
 */
function isRuleSource(source) {
  return String(source || '').startsWith('custom:');
}

/** 站源是否有原生实现（否则前端走示例数据，避免整站空白）。 */
function supportsNative(source) {
  if (!source) return false;
  if (NATIVE_SOURCES.has(source)) return true;
  return isRuleSource(source);
}

function isMaccmsKind(kind, base) {
  const value = String(kind || '').toLowerCase();
  if (value === 'json' || value === 'xml') return true;
  return /api\.php\/provide\/vod|provide\/vod/i.test(String(base || ''));
}

async function dispatchCatalog(payload) {
  const source = String(payload?.source || '');
  const page = Math.max(1, Number.parseInt(payload?.page, 10) || 1);
  const category = String(payload?.category || '');

  if (source === 'a123') {
    return a123Catalog({ base: baseOf(payload, null, A123_BASE), category, page });
  }
  if (source === 'ikanbot') {
    return ikanbotCatalog({ base: baseOf(payload, null, IKB_BASE), category, page });
  }
  if (source === 'guipian') {
    return guipianCatalog({ base: baseOf(payload, null, GUIPIAN_BASE), category, page });
  }
  if (source === 'hanxiaoquan') {
    return hanxiaoquanCatalog({ base: baseOf(payload, null, HANXIAOQUAN_BASE), category, page });
  }
  if (isRuleSource(source)) {
    const rule = ruleOfPayload(payload);
    const kind = payload?.kind;
    if (!rule) {
      if (isMaccmsKind(kind, payload?.base)) {
        return maccmsCatalog({ base: payload?.base, source, category, page });
      }
      throw new Error('该自定义源没有可用的 XBPQ 规则');
    }
    const base = baseOf(payload, rule, '');
    if (!base) throw new Error('规则缺少站点地址');
    return xbpqCatalog({ rule, base, source, category, page });
  }
  throw new Error(`站源 ${source || '(空)'} 暂无服务端实现`);
}

async function dispatchSearch(payload) {
  const source = String(payload?.source || '');
  const query = String(payload?.query || '').trim();
  const page = Math.max(1, Number.parseInt(payload?.page, 10) || 1);
  if (!query) throw new Error('请输入搜索内容');

  if (source === 'a123') {
    return a123Search({ base: baseOf(payload, null, A123_BASE), query, page });
  }
  if (source === 'ikanbot') {
    return ikanbotSearch({ base: baseOf(payload, null, IKB_BASE), query, page });
  }
  if (source === 'guipian') {
    return guipianSearch({ base: baseOf(payload, null, GUIPIAN_BASE), query, page });
  }
  if (source === 'hanxiaoquan') {
    return hanxiaoquanSearch({ base: baseOf(payload, null, HANXIAOQUAN_BASE), query, page });
  }
  if (isRuleSource(source)) {
    const rule = ruleOfPayload(payload);
    if (!rule) {
      if (isMaccmsKind(payload?.kind, payload?.base)) {
        return maccmsSearch({ base: payload?.base, source, query, page });
      }
      throw new Error('该自定义源不支持在线搜索');
    }
    const base = baseOf(payload, rule, '');
    if (!base) throw new Error('规则缺少站点地址');
    return xbpqSearch({ rule, base, source, query, page });
  }
  throw new Error(`站源 ${source || '(空)'} 暂无搜索接口`);
}

async function dispatchCategories(payload) {
  const source = String(payload?.source || '');
  if (source === 'a123') return a123Categories();
  if (source === 'ikanbot') return ikanbotCategories();
  if (source === 'guipian') return guipianCategories();
  if (source === 'hanxiaoquan') return hanxiaoquanCategories();
  if (isRuleSource(source)) {
    const rule = ruleOfPayload(payload);
    if (rule) {
      const categories = rule.categories;
      if (categories.length) return categories;
    }
    if (isMaccmsKind(payload?.kind, payload?.base)) {
      return maccmsCategories({ base: payload?.base });
    }
    return [];
  }
  return [];
}

async function dispatchDetail(payload) {
  const source = String(payload?.source || '');
  const sourceId = String(payload?.sourceId || payload?.id || '').replace(/^[^:]+:/, '');

  if (source === 'a123') {
    return a123Detail({ base: baseOf(payload, null, A123_BASE), sourceId });
  }
  if (source === 'ikanbot') {
    return ikanbotDetail({ base: baseOf(payload, null, IKB_BASE), sourceId });
  }
  if (source === 'guipian') {
    return guipianDetail({ base: baseOf(payload, null, GUIPIAN_BASE), sourceId });
  }
  if (source === 'hanxiaoquan') {
    return hanxiaoquanDetail({ base: baseOf(payload, null, HANXIAOQUAN_BASE), sourceId });
  }
  if (isRuleSource(source)) {
    const rule = ruleOfPayload(payload);
    if (!rule) {
      if (isMaccmsKind(payload?.kind, payload?.base)) {
        return maccmsDetail({ base: payload?.base, source, sourceId });
      }
      throw new Error('该自定义源没有可用的 XBPQ 规则');
    }
    const base = baseOf(payload, rule, '');
    if (!base) throw new Error('规则缺少站点地址');
    return xbpqDetail({ rule, base, source, sourceId });
  }
  throw new Error(`站源 ${source || '(空)'} 暂无详情接口`);
}

async function dispatchResolve(payload) {
  const source = String(payload?.source || '');
  const chapter = payload?.chapter || {};
  const name = String(payload?.name || '线路');

  if (source === 'a123') {
    return a123Resolve({
      base: baseOf(payload, null, A123_BASE),
      chapter,
      sourceId: String(payload?.sourceId || '').replace(/^a123:/, ''),
    });
  }
  if (source === 'ikanbot') {
    return ikanbotResolve({ base: baseOf(payload, null, IKB_BASE), chapter });
  }
  if (source === 'guipian') {
    return guipianResolve({ base: baseOf(payload, null, GUIPIAN_BASE), chapter });
  }
  if (source === 'hanxiaoquan') {
    return hanxiaoquanResolve({ base: baseOf(payload, null, HANXIAOQUAN_BASE), chapter });
  }
  if (isRuleSource(source)) {
    const rule = ruleOfPayload(payload);
    if (!rule) return maccmsResolve({ chapter, name });
    const base = baseOf(payload, rule, '');
    if (!base) throw new Error('规则缺少站点地址');
    return xbpqResolve({ rule, base, chapter, name, source });
  }
  throw new Error(`站源 ${source || '(空)'} 暂无取流接口`);
}

// ---------------------------------------------------------------- 跨源搜索

const sessions = new Map();

function searchText(title) {
  return String(title || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s\u3000]+/g, '')
    .replace(/[·・.。,，:：;；!！?？'"“”‘’()（）[\]【】《》<>_\-—|/\\]/g, '');
}

function searchYear(drama) {
  const date = String(drama?.onlineDate || drama?.remark || '');
  const match = /(?:19|20)\d{2}/.exec(date);
  return match ? match[0] : '';
}

function searchKey(drama) {
  return `${searchText(drama.title)}|${searchYear(drama)}`;
}

function canMerge(base, other) {
  const left = Number(base.episodes) || 0;
  const right = Number(other.episodes) || 0;
  if (!left || !right || left === right) return true;
  const diff = Math.abs(left - right);
  return diff * 4 <= Math.max(left, right);
}

function scoreOf(drama) {
  let score = 0;
  if (drama.cover) score += 4;
  if (drama.episodes) score += 2;
  if (drama.description) score += 1;
  if (drama.onlineDate) score += 1;
  if (drama.category) score += 1;
  return score;
}

function mergeResults(items, sorted) {
  const groups = new Map();
  const order = [];
  for (const item of items) {
    if (!item?.id || !item?.title) continue;
    const key = searchKey(item);
    if (!groups.has(key)) {
      groups.set(key, []);
      order.push(key);
    }
    const bucket = groups.get(key);
    let target = bucket.find((entry) => canMerge(entry.primary, item));
    if (!target) {
      target = { primary: item, peers: [], score: scoreOf(item) };
      bucket.push(target);
      continue;
    }
    const score = scoreOf(item);
    if (score > target.score) {
      target.peers.push(target.primary);
      target.primary = item;
      target.score = score;
    } else {
      target.peers.push(item);
    }
  }

  const merged = [];
  for (const key of order) {
    for (const entry of groups.get(key)) {
      const seenId = new Set([entry.primary.id]);
      const seenSource = new Set([entry.primary.source]);
      const peers = [];
      for (const peer of entry.peers) {
        if (seenId.has(peer.id) || seenSource.has(peer.source)) continue;
        seenId.add(peer.id);
        seenSource.add(peer.source);
        peers.push(peer);
      }
      peers.sort((left, right) =>
        left.source === right.source
          ? left.title.localeCompare(right.title)
          : left.source.localeCompare(right.source)
      );
      merged.push({ ...entry.primary, peers });
    }
  }
  if (sorted) {
    merged.sort((left, right) => {
      const diff = scoreOf(right) - scoreOf(left);
      if (diff !== 0) return diff;
      const episodes = (right.episodes || 0) - (left.episodes || 0);
      if (episodes !== 0) return episodes;
      return left.title.localeCompare(right.title);
    });
  }
  return merged;
}

function newSearchSession(query, sources) {
  const id = `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  const session = {
    id,
    query,
    order: sources,
    items: new Map(),
    done: new Set(),
    failures: new Map(),
    started: Date.now(),
    merged: null,
    mergeDone: -1,
  };
  sessions.set(id, session);
  return session;
}

function pruneSessions() {
  const cutoff = Date.now() - SEARCH_SESSION_TTL;
  for (const [id, session] of sessions) {
    if (session.started < cutoff) sessions.delete(id);
  }
}

function snapshot(session) {
  const succeeded = [];
  const pending = [];
  let done = 0;
  for (const source of session.order) {
    if (!session.done.has(source.id)) {
      pending.push(source.id);
      continue;
    }
    done++;
    if (session.failures.has(source.id)) continue;
    succeeded.push(source.id);
  }
  const finished = done === session.order.length;
  if (!session.merged || session.mergeDone !== done) {
    const all = [];
    for (const source of session.order) all.push(...(session.items.get(source.id) || []));
    session.merged = mergeResults(all, finished);
    session.mergeDone = done;
  }
  const failures = {};
  for (const [source, reason] of session.failures) failures[source] = reason;
  const warning =
    session.failures.size === 0
      ? ''
      : session.failures.size === 1
        ? `${[...session.failures.keys()][0]}：${[...session.failures.values()][0]}`
        : `${[...session.failures.keys()][0]} 等 ${session.failures.size} 个站源未返回结果`;
  return {
    search: session.id,
    query: session.query,
    items: session.merged,
    sources: succeeded,
    pending,
    failures,
    warning,
    total: session.order.length,
    done,
    finished,
  };
}

async function runSourceSearch(entry, query, page) {
  const timeout = new Promise((_, reject) =>
    setTimeout(() => reject(new Error('搜索超时')), SEARCH_SOURCE_TIMEOUT)
  );
  return Promise.race([
    dispatchSearch({ source: entry.id, rule: entry.rule, base: entry.base, kind: entry.kind, query, page }),
    timeout,
  ]);
}

// ---------------------------------------------------------------- HTTP 工具

function sendJSON(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
  });
  res.end(body);
}

/**
 * 全量 CORS。
 *
 * 前端可能部署在 Cloudflare Pages（https://xxx.pages.dev），而抓取服务跑在
 * 用户本机（http://127.0.0.1:8788），属于跨源调用；同时 Chrome 会把
 * 「公网页面 → 本地地址」判定为 Private Network Access，需要额外回一个
 * Access-Control-Allow-Private-Network，否则预检就失败。
 */
function applyCORS(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'Content-Type, Range, Accept, Accept-Language, X-Requested-With, Authorization'
  );
  res.setHeader(
    'Access-Control-Expose-Headers',
    'X-Final-URL, Content-Length, Content-Range, Accept-Ranges, ETag, Last-Modified'
  );
  res.setHeader('Access-Control-Allow-Private-Network', 'true');
  res.setHeader('Access-Control-Max-Age', '86400');
  res.setHeader('Timing-Allow-Origin', '*');
}

function sendError(res, error) {
  const message = error?.message || String(error || '未知错误');
  sendJSON(res, 200, { ok: false, error: message });
}

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > BODY_LIMIT) throw new Error('请求体过大');
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  const text = Buffer.concat(chunks).toString('utf-8');
  try {
    return JSON.parse(text);
  } catch {
    throw new Error('请求体不是合法 JSON');
  }
}

function originOf(req) {
  const host = req.headers['x-forwarded-host'] || req.headers.host || '127.0.0.1';
  // 协议要多留几手：Cloudflare Pages / workers.dev 这类边缘宿主常常只给 cf-visitor，
  // 不给 x-forwarded-proto。一旦漏判成 http，m3u8 里改写出的分片地址就全是 http，
  // HTTPS 页面加载时会被浏览器按混合内容拦掉——表现正是「网络流加载失败」。
  let proto = String(req.headers['x-forwarded-proto'] || '')
    .split(',')[0]
    .trim()
    .toLowerCase();
  if (proto !== 'http' && proto !== 'https') {
    const visitor = String(req.headers['cf-visitor'] || '');
    if (/"scheme"\s*:\s*"https"/i.test(visitor)) proto = 'https';
    else if (String(req.headers['x-forwarded-ssl'] || '').toLowerCase() === 'on') proto = 'https';
    else if (/:443$/.test(host)) proto = 'https';
    else if (/:\d+$/.test(host)) proto = 'http'; // 带自定义端口：本地调试 / 自建服务
    else proto = 'https'; // 公网裸域名
  }
  return `${proto}://${host}`;
}

// ---------------------------------------------------------------- 路由

export async function handleRequest(req, res, url) {
  const path = url.pathname;
  const query = url.searchParams;

  applyCORS(req, res);

  // 预检：Cloudflare Pages 等静态托管上不存在后端，跨源调用全靠这里放行。
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }

  if (path === '/api/health') {
    return sendJSON(res, 200, {
      ok: true,
      service: 'guoappnew-native-core',
      runtime,
      library: libraryBackend(),
      // 抓取出口：海外部署时靠中继绕开「只放行中国大陆 IP」的站源限制
      relay: relayStatus(),
      time: Date.now(),
      providers: ['xbpq', 'a123', 'ikanbot', 'guipian', 'hanxiaoquan', 'maccms-api', 'live', 'library'],
    });
  }

  if (path === '/api/proxy') {
    const target = query.get('u') || query.get('url');
    if (!target) return sendJSON(res, 400, { ok: false, error: '缺少 u 参数' });
    const referer = query.get('r') || '';
    const headers = decodeHeaders(query.get('h'));
    const { text, url: finalURL } = await fetchText(target, { referer, headers });
    res.writeHead(200, {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Final-URL': finalURL,
      'Access-Control-Allow-Origin': '*',
    });
    return res.end(text);
  }

  if (path === '/api/hls') {
    const target = query.get('u');
    if (!target) return sendJSON(res, 400, { ok: false, error: '缺少 u 参数' });
    const referer = query.get('r') || target;
    const headers = decodeHeaders(query.get('h'));
    const adblock = query.get('ad') !== '0';

    // 采集站 CDN 抖动很常见。清单拿不到（超时 / 5xx / 返回错误页）就重试，
    // 千万别把错误页当 m3u8 塞给播放器——那会直接变成「网络流加载中断」。
    // 单次 10s、最多 2 次，总耗时控制在播放器 30s 超时以内。
    let manifest = '';
    let finalURL = target;
    let lastError = '';
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const result = await fetchText(target, {
          referer,
          headers,
          timeout: 10000,
        });
        const text = String(result.text || '');
        if (Number(result.status) >= 400) {
          lastError = `上游返回 ${result.status}`;
        } else if (!text.includes('#EXTM3U')) {
          lastError = '上游返回的不是 m3u8 清单';
        } else {
          manifest = text;
          finalURL = result.url || target;
          lastError = '';
          break;
        }
      } catch (error) {
        lastError = error?.message || '播放清单抓取失败';
      }
      if (attempt < 1) await new Promise((resolve) => setTimeout(resolve, 350));
    }

    if (!manifest) {
      return sendJSON(res, 502, { ok: false, error: lastError || '播放清单加载失败' });
    }

    const cleaned = adCleaned(manifest.replace(/\r\n/g, '\n'), finalURL, adblock);
    const rewritten = rewriteManifest(cleaned, finalURL, originOf(req), { referer, headers });
    res.writeHead(200, {
      'Content-Type': 'application/vnd.apple.mpegurl; charset=utf-8',
      'Cache-Control': 'no-store',
      'Access-Control-Allow-Origin': '*',
    });
    return res.end(rewritten);
  }

  if (path === '/api/media') {
    const target = query.get('u');
    if (!target) return sendJSON(res, 400, { ok: false, error: '缺少 u 参数' });
    const referer = query.get('r') || '';
    const headers = decodeHeaders(query.get('h'));
    const range = req.headers.range || '';

    // 分片同样重试：5xx / 连接被重置时先重取响应头，还没开始传输所以代价很低。
    // 每次 15s、最多 2 次，避免超过播放器的分片超时。
    let upstream = null;
    let lastError = '';
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const result = await fetchBinary(target, { referer, headers, range, timeout: 15000 });
        if (Number(result.status) >= 500) {
          lastError = `上游返回 ${result.status}`;
          if (result.body) {
            try {
              await result.body.cancel();
            } catch {
              /* 忽略取消失败 */
            }
          }
        } else {
          upstream = result;
          break;
        }
      } catch (error) {
        lastError = error?.message || '分片抓取失败';
      }
      if (attempt < 1) await new Promise((resolve) => setTimeout(resolve, 300));
    }

    if (!upstream) {
      res.writeHead(502, {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-store',
        'Access-Control-Allow-Origin': '*',
      });
      return res.end(lastError || '分片加载失败');
    }

    const outHeaders = {
      'Content-Type': upstream.headers.get('content-type') || 'application/octet-stream',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-store',
    };
    for (const key of ['content-length', 'content-range', 'accept-ranges', 'etag', 'last-modified']) {
      const value = upstream.headers.get(key);
      if (value) outHeaders[key] = value;
    }
    res.writeHead(upstream.status, outHeaders);
    if (!upstream.body) return res.end();
    const reader = upstream.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!res.write(Buffer.from(value))) {
        await new Promise((resolve) => res.once('drain', resolve));
      }
    }
    return res.end();
  }

  if (path === '/api/cover') {
    // 封面代理：豆瓣图床按 Referer 防盗链（无 Referer 直接 418），
    // 浏览器直连拿不到图，统一由这里补 Referer + 本地缓存后回传。
    const target = query.get('u') || query.get('url');
    if (!target) return sendJSON(res, 400, { ok: false, error: '缺少 u 参数' });
    const referer = query.get('r') || '';
    const source = query.get('s') || '';
    const force = query.get('force') === '1';
    let cover;
    try {
      cover = await resolveCover(target, { referer, source, force });
    } catch (error) {
      // 抓不到就回一张 1x1 透明 PNG，避免列表页出现破图图标
      res.writeHead(200, {
        'Content-Type': 'image/png',
        'Cache-Control': 'no-store',
        'Access-Control-Allow-Origin': '*',
        'X-Cover-Error': encodeURIComponent(error?.message || '封面获取失败'),
      });
      return res.end(BLANK_PNG);
    }
    const etag = `"${createHash('sha1').update(cover.data).digest('hex')}"`;
    if (req.headers['if-none-match'] === etag) {
      res.writeHead(304, {
        ETag: etag,
        'Cache-Control': 'public, max-age=2592000, immutable',
        'Access-Control-Allow-Origin': '*',
      });
      return res.end();
    }
    res.writeHead(200, {
      'Content-Type': cover.type,
      'Content-Length': cover.data.length,
      'Cache-Control': 'public, max-age=2592000, immutable',
      ETag: etag,
      'Access-Control-Allow-Origin': '*',
      'X-Cover-Cache': cover.cached ? 'hit' : 'miss',
    });
    return res.end(cover.data);
  }

  if (path === '/api/cover/stats') {
    return sendJSON(res, 200, { ok: true, ...coverCacheStats() });
  }

  if (path === '/api/live/sources') {
    // 兼容两种传参：GET 用 ?custom=JSON，POST 用请求体 { custom: [...] }
    let parsed = [];
    if (req.method === 'POST') {
      const body = await readBody(req);
      const list = body?.custom ?? body?.sources ?? [];
      if (Array.isArray(list)) parsed = list;
    } else {
      const custom = query.get('custom');
      if (custom) {
        try {
          parsed = JSON.parse(custom);
        } catch {
          parsed = [];
        }
      }
    }
    return sendJSON(res, 200, { ok: true, sources: liveSourceCatalog(parsed) });
  }

  if (path === '/api/library') {
    // GET 读；POST 写。GET + ?payload=<base64url JSON> 也能写（某些托管拦 POST）。
    let body = null;
    if (req.method === 'POST') {
      body = await readBody(req);
    } else {
      const token = query.get('payload');
      if (token) {
        try {
          body = JSON.parse(Buffer.from(token, 'base64url').toString('utf-8'));
        } catch {
          body = null;
        }
      }
    }
    if (!body) return sendJSON(res, 200, { ok: true, backend: libraryBackend(), data: await readLibrary() });
    // 参数不合法（比如 list 不是 history/favorites）属于请求问题，回 400；
    // 不接住就会冒到外层兜底变成 502，看起来像服务挂了。
    try {
      const data = await applyLibrary(body);
      return sendJSON(res, 200, { ok: true, data });
    } catch (error) {
      return sendJSON(res, 400, { ok: false, error: error?.message || '收藏夹写入失败' });
    }
  }

  // GET 回退：某些静态托管 / 反代会拦掉 POST（Cloudflare Pages 对静态资源
  // 的非 GET 请求直接返回 405），此时前端改用 ?payload=<base64url JSON>。
  let queryPayload = null;
  const payloadToken = query.get('payload');
  if (payloadToken) {
    try {
      queryPayload = JSON.parse(Buffer.from(payloadToken, 'base64url').toString('utf-8'));
    } catch {
      queryPayload = null;
    }
  }

  if (req.method !== 'POST' && !queryPayload) {
    return sendJSON(res, 404, { ok: false, error: '未知接口' });
  }

  const payload = req.method === 'POST' ? await readBody(req) : queryPayload || {};

  switch (path) {
    case '/api/catalog': {
      const result = await dispatchCatalog(payload);
      return sendJSON(res, 200, { ok: true, ...result });
    }
    case '/api/categories': {
      const categories = await dispatchCategories(payload);
      return sendJSON(res, 200, { ok: true, categories });
    }
    case '/api/search': {
      const result = await dispatchSearch(payload);
      return sendJSON(res, 200, { ok: true, ...result });
    }
    case '/api/detail': {
      const result = await dispatchDetail(payload);
      return sendJSON(res, 200, { ok: true, ...result });
    }
    case '/api/resolve': {
      const result = await dispatchResolve(payload);
      return sendJSON(res, 200, { ok: true, ...result });
    }
    case '/api/source/test': {
      const rule = ruleOfPayload(payload);
      if (!rule) throw new Error('请填入合法的 XBPQ JSON 规则内容');
      const base = baseOf(payload, rule, '');
      if (!base) throw new Error('规则缺少站点地址（主页url / 分类url）');
      const categories = rule.categories;
      const families = detectFamilies(rule.field('分类url', '分类Url'));
      let online = '';
      let sample = 0;
      try {
        const started = Date.now();
        const result = await xbpqCatalog({
          rule,
          base,
          source: 'custom:probe',
          category: categories[0]?.id || '',
          page: 1,
        });
        sample = result.items.length;
        online = `在线连通 ${Date.now() - started}ms，解析出 ${sample} 部`;
      } catch (error) {
        online = `在线嗅探失败：${error.message}`;
      }
      return sendJSON(res, 200, {
        ok: true,
        message:
          `规则校验通过。模板家族：${families.join(' → ') || '未识别'}；` +
          `分类 ${categories.length} 个；${online}`,
        categories,
        families,
        sample,
      });
    }
    case '/api/source/import': {
      const text = String(payload?.content || '');
      if (!text.trim()) throw new Error('导入内容为空');
      const drafts = parseImport(text);
      return sendJSON(res, 200, { ok: true, drafts, count: drafts.length });
    }
    case '/api/source/subscribe': {
      // 「拉订阅 + 解析」合成一次请求：前端只需要发一个短小的地址参数，
      // 抓取、GitHub 链接转换、规则拆分都在本地服务里完成。
      const raw = String(payload?.url || payload?.address || '').trim();
      if (!raw) throw new Error('请填写订阅地址');
      const candidates = subscribeCandidates(raw);
      let text = '';
      let finalURL = candidates[0];
      let lastError = '';
      for (const candidate of candidates) {
        try {
          const result = await fetchText(candidate, {
            referer: payload?.referer || '',
            timeout: 15000,
          });
          if (result.text && result.text.trim()) {
            text = result.text;
            finalURL = result.url;
            break;
          }
          lastError = '返回内容为空';
        } catch (error) {
          lastError = error.message;
        }
      }
      if (!text.trim()) {
        throw new Error(`订阅地址不可达（${lastError || '网络超时'}）`);
      }
      const trimmed = text.trim();
      // 拿到的是网页而不是配置（常见于 GitHub blob / 网盘页），提前说清楚
      if (/^<!doctype html/i.test(trimmed) || /^<html/i.test(trimmed)) {
        throw new Error('该地址返回的是网页而不是配置文本，请改用 raw 直链');
      }
      const drafts = parseImport(trimmed);
      return sendJSON(res, 200, {
        ok: true,
        drafts,
        count: drafts.length,
        finalURL,
        preview: trimmed.slice(0, 160),
      });
    }
    case '/api/search/start': {
      const query = String(payload?.query || '').trim();
      if (!query) throw new Error('请输入搜索内容');
      const entries = (payload?.sources || [])
        // 同时接受 { id } 与 { source } 两种形态，避免调用方拼错字段就整单失败
        .map((entry) => ({ ...entry, id: String(entry?.id || entry?.source || '') }))
        .filter((entry) => entry.id && supportsNative(entry.id))
        .map((entry) => ({
          id: String(entry.id),
          rule: entry.rule || '',
          base: entry.base || '',
          kind: entry.kind || '',
        }));
      if (!entries.length) throw new Error('没有可搜索的站源');
      pruneSessions();
      const session = newSearchSession(query, entries);
      const page = Math.max(1, Number.parseInt(payload?.page, 10) || 1);

      const tasks = [];
      for (const entry of entries) {
        tasks.push(
          runSourceSearch(entry, query, page)
            .then((result) => {
              session.items.set(entry.id, result.items || []);
              session.done.add(entry.id);
            })
            .catch((error) => {
              session.failures.set(entry.id, error?.message || '搜索失败');
              session.done.add(entry.id);
            })
        );
      }
      // 无服务器运行时无法保证「轮询」落到同一个实例（进程内会话会丢），
      // 所以直接把所有站源跑完再返回 finished 快照，前端见到 finished 就不再轮询。
      if (runtime === 'edge') await Promise.all(tasks);
      return sendJSON(res, 200, { ok: true, ...snapshot(session) });
    }
    case '/api/search/poll': {
      const id = String(payload?.search || '');
      const session = sessions.get(id);
      if (!session) throw new Error('搜索会话已结束，请重新搜索');
      return sendJSON(res, 200, { ok: true, ...snapshot(session) });
    }
    case '/api/search/cancel': {
      const id = String(payload?.search || '');
      if (id) sessions.delete(id);
      return sendJSON(res, 200, { ok: true });
    }
    case '/api/live/platforms': {
    const platforms = await livePlatforms(payload?.sources || [], payload?.source, {
      greenMode: payload?.greenMode === true,
      portRestricted: isLivePortRestricted(),
    });
      return sendJSON(res, 200, { ok: true, platforms });
    }
    case '/api/live/channels': {
      const channels = await liveChannels(payload?.sources || [], payload?.source, payload?.platform);
      return sendJSON(res, 200, { ok: true, channels });
    }
    case '/api/live/play': {
      const result = await livePlayback(payload?.sources || [], payload?.source, payload?.channel);
      return sendJSON(res, 200, { ok: true, ...result });
    }
    default:
      return sendJSON(res, 404, { ok: false, error: '未知接口' });
  }
}

// ---------------------------------------------------------------- 导入解析

function siteAddress(candidate) {
  const value = String(candidate || '').trim();
  if (!value) return '';
  if (/^https?:\/\//i.test(value)) return value;
  if (/^[\w.-]+\.[a-z]{2,}(\/|$)/i.test(value)) return 'https://' + value;
  return '';
}

/**
 * 归一订阅地址：
 * - 补协议头（`raw.githubusercontent.com/...`）
 * - GitHub 网页链接（blob/raw 页）转 raw 直链
 * - 「加速链接+网址」拼接形态（https://加速域名/https://真实网址）原样保留
 */
function normalizeSubscribeURL(raw) {
  let value = String(raw || '').trim();
  if (!value) return '';
  if (!/^https?:\/\//i.test(value)) {
    if (/^[\w.-]+\.[a-z]{2,}(\/|$)/i.test(value)) value = 'https://' + value;
    else return value;
  }
  const github = value.match(
    /^https?:\/\/(?:www\.)?github\.com\/([^/]+)\/([^/]+)\/(?:blob|raw)\/([^?#]+)/i
  );
  if (github) {
    const [, user, repo, path] = github;
    return `https://raw.githubusercontent.com/${user}/${repo.replace(/\.git$/i, '')}/${path}`;
  }
  return value;
}

/**
 * 订阅地址候选列表：直链不通时自动换公共镜像。
 * GitHub raw 在国内网络经常超时，jsDelivr 通常可达且内容一致。
 */
function subscribeCandidates(raw) {
  const primary = normalizeSubscribeURL(raw);
  const list = [primary];
  const github = primary.match(
    /^https?:\/\/raw\.githubusercontent\.com\/([^/]+)\/([^/]+)\/([^/]+)\/(.+)$/i
  );
  if (github) {
    const [, user, repo, branch, path] = github;
    list.push(`https://cdn.jsdelivr.net/gh/${user}/${repo}@${branch}/${path}`);
  }
  return list;
}

function ruleFromEntry(entry) {
  const candidates = [entry.rule, entry.ext, entry.config, entry.xbpq];
  for (const candidate of candidates) {
    if (!candidate) continue;
    if (typeof candidate === 'object') return JSON.stringify(candidate);
    const text = String(candidate).trim();
    if (text.startsWith('{') || text.startsWith('[')) return text;
  }
  return '';
}

function looksLikeRule(node) {
  if (!node || typeof node !== 'object') return false;
  return ['主页url', '分类url', '分类Url', '请求', '搜索url', '数组'].some((key) => key in node);
}

/** 把订阅 / 站点 JSON 拆成站源草稿。 */
export function parseImport(text) {
  const drafts = [];
  const push = (entry, index) => {
    const rawRule = ruleFromEntry(entry);
    const parsedRule = rawRule ? parseRule(rawRule) : looksLikeRule(entry) ? parseRule(JSON.stringify(entry)) : null;
    const base =
      siteAddress(entry.url) ||
      siteAddress(entry.api) ||
      siteAddress(entry.base) ||
      (parsedRule ? parsedRule.homeURL : '');
    const name = String(entry.name || entry.title || parsedRule?.field('name') || '').trim();
    if (!parsedRule && !base) return;
    drafts.push({
      id: `custom:${Date.now().toString(36)}_${index}`,
      name: name || (base ? new URL(base).host : `导入源 ${index + 1}`),
      base: base || '',
      kind: parsedRule ? 'xbpq' : entry.type === 1 ? 'json' : 'json',
      rule: rawRule || (parsedRule ? JSON.stringify(Object.fromEntries(parsedRule.fields), null, 2) : ''),
      enabled: true,
      createdAt: Date.now(),
    });
  };

  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    // 纯 URL 列表：每行一个 m3u/txt 也当作站源地址
    String(text)
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .forEach((line, index) => {
        const base = siteAddress(line);
        if (base) push({ url: base, name: '' }, index);
      });
    return drafts;
  }

  const sites = payload.sites || payload.lives || (Array.isArray(payload) ? payload : [payload]);
  if (!Array.isArray(sites)) return drafts;
  sites.forEach((entry, index) => {
    if (!entry) return;
    if (typeof entry === 'string') {
      const base = siteAddress(entry);
      if (base) push({ url: base }, index);
      return;
    }
    if (typeof entry !== 'object') return;
    push(entry, index);
  });
  return drafts;
}

// ---------------------------------------------------------------- 导出

export { DEFAULT_UA, mergeHeaders, splitSpec, normalizeKey };
