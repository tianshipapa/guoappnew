// 直播仓库：移植 lib/live/live_repository.dart + live_sources.dart
//
// 两种协议：
//   list    —— 直接给 m3u / txt 直播源地址（最常见，用户可自行添加）
//   pingtai —— API 面板：{endpoint}/json.txt 给分类，{endpoint}/{分类} 给频道
//
// 绿色模式（默认开启）对 pingtai 面板只放行公开电视类分类，避免秀场内容混入。

import { fetchText, mergeHeaders } from '../http.mjs';
import { parseLive, isPlayableLiveUrl, UNSORTED } from './parse.mjs';

/** 内置直播源（公开 IPTV 列表，均可自行增删）。 */
export const BUILTIN_LIVE_SOURCES = [
  {
    // 秀果：移植 guoappxp 的 pingtai 面板源（主播直播房间）。
    // 面板接口约定：{endpoint}/json.txt 返回分类，{endpoint}/{分类} 返回频道。
    // adult 标记与 App 端一致，绿色模式下整源隐藏。
    id: 'xiuguo',
    name: '秀果',
    description: '主播直播 · 实时开播',
    protocol: 'pingtai',
    endpoints: ['http://api.vipmisss.com:81/xcdsw', 'http://api.hclyz.com:81/mf'],
    group: '秀果',
    adult: true,
    builtin: true,
  },
  {
    id: 'iptv-org-cn',
    name: '国内频道 (iptv-org)',
    description: 'CCTV / 卫视 / 地方台，全球公开 IPTV 索引',
    protocol: 'list',
    endpoints: ['https://iptv-org.github.io/iptv/countries/cn.m3u'],
    group: 'iptv-org',
    adult: false,
    builtin: true,
  },
  {
    id: 'iptv-org-hk',
    name: '港澳台频道 (iptv-org)',
    description: '港台地区公开直播频道',
    protocol: 'list',
    endpoints: ['https://iptv-org.github.io/iptv/countries/hk.m3u'],
    group: 'iptv-org',
    adult: false,
    builtin: true,
  },
  {
    id: 'iptv-org-news',
    name: '全球新闻频道',
    description: '各国新闻台公开流',
    protocol: 'list',
    endpoints: ['https://iptv-org.github.io/iptv/categories/news.m3u'],
    group: 'news',
    adult: false,
    builtin: true,
  },
];

// 绿色模式放行的分类名（白名单：面板分类多为花名，黑名单列不全）
const GREEN_CATEGORY = /(卫视|央视|CCTV|CGTN|电视直播|广播|新闻|体育|财经|少儿|纪录|地方台|剧场|电影|电视剧)/i;
const RETIRED_CATEGORIES = ['weishizhibo'];
const CACHE_TTL = 5 * 60 * 1000;
const MAX_LIVE_BYTES = 8 << 20;

const cache = new Map();

function cached(key, factory) {
  const entry = cache.get(key);
  if (entry && entry.expiresAt > Date.now()) return entry.value;
  const value = factory();
  cache.set(key, { value, expiresAt: Date.now() + CACHE_TTL });
  if (cache.size > 200) {
    for (const staleKey of cache.keys()) {
      if (cache.size <= 100) break;
      cache.delete(staleKey);
    }
  }
  return value;
}

function sourceOf(sources, id) {
  const found = (sources || []).concat(BUILTIN_LIVE_SOURCES).find((item) => item.id === id);
  if (!found) throw new Error('直播源不存在或已删除');
  return found;
}

async function fetchSourceText(address, headers = {}, referer = '') {
  const { text } = await fetchText(address, {
    headers,
    referer,
    timeout: 25000,
  });
  if (text.length > MAX_LIVE_BYTES) throw new Error('直播源内容过大');
  return text;
}

/** 分类列表。greenMode 为 true 时，成人面板源只放行公开电视类分类（与 App 端一致，默认关闭）。 */
export async function livePlatforms(sources, sourceId, { greenMode = false } = {}) {
  const source = sourceOf(sources, sourceId);
  if (source.protocol === 'pingtai') {
    return cached(`platforms:${source.id}:${greenMode ? 'green' : 'full'}`, () =>
      pingtaiPlatforms(source, greenMode)
    );
  }
  return [{ id: 'all', name: source.group || '全部频道', count: 0 }];
}

async function pingtaiPlatforms(source, greenMode = false) {
  const byId = new Map();
  const failures = [];
  for (const endpoint of source.endpoints || []) {
    let rows;
    try {
      const text = await fetchSourceText(`${endpoint}/json.txt`, source.headers, endpoint + '/');
      const decoded = JSON.parse(text);
      rows = Array.isArray(decoded) ? decoded : decoded.pingtai;
    } catch (error) {
      failures.push(error.message);
      continue;
    }
    if (!Array.isArray(rows)) continue;
    for (const row of rows) {
      if (!row || typeof row !== 'object') continue;
      const id = String(row.address ?? '').trim();
      const name = String(row.title ?? '').trim();
      if (!id || !name) continue;
      if (RETIRED_CATEGORIES.some((item) => id.includes(item))) continue;
      const count = Number.parseInt(String(row.Number ?? '0'), 10) || 0;
      const previous = byId.get(id);
      if (!previous || count > previous.count) {
        byId.set(id, {
          id,
          name,
          logo: String(row.xinimg ?? '').trim(),
          count,
          endpoint,
        });
      }
    }
  }
  if (byId.size === 0) {
    throw new Error(failures.length ? `该直播源暂时不可用：${failures[0]}` : '该直播源没有可用分类');
  }
  let all = [...byId.values()];
  if (greenMode && source.adult) {
    all = all.filter((item) => GREEN_CATEGORY.test(item.name));
  }
  const withContent = all.filter((item) => item.count > 0);
  return withContent.length ? withContent : all;
}

/** 频道列表。 */
export async function liveChannels(sources, sourceId, platform) {
  const source = sourceOf(sources, sourceId);
  const platformId = typeof platform === 'string' ? platform : platform?.id || 'all';
  if (source.protocol === 'pingtai') {
    return cached(`channels:${source.id}:${platformId}`, () =>
      pingtaiChannels(source, platformId, typeof platform === 'object' ? platform?.endpoint : '')
    );
  }
  return cached(`channels:${source.id}:all`, () => listChannels(source));
}

async function pingtaiChannels(source, platformId, platformEndpoint = '') {
  const candidates = [platformEndpoint, ...(source.endpoints || [])].filter(Boolean);

  let text = null;
  let lastError = null;
  for (const endpoint of candidates) {
    try {
      text = await fetchSourceText(`${endpoint}/${platformId}`, source.headers, endpoint + '/');
      break;
    } catch (error) {
      lastError = error;
    }
  }
  if (text == null) throw new Error(lastError?.message || '该分类暂时没有频道');

  let rows;
  try {
    const decoded = JSON.parse(text);
    rows = Array.isArray(decoded) ? decoded : decoded.zhubo || decoded.list || decoded.data;
  } catch {
    throw new Error('直播分类返回无法解析');
  }
  if (!Array.isArray(rows)) throw new Error('该分类暂时没有频道');

  const reliable = [];
  const fallback = [];
  const seen = new Set();
  let number = 0;
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const name = String(row.title ?? '').trim();
    const url = String(row.address ?? '').trim();
    if (!name || !isPlayableLiveUrl(url) || seen.has(name)) continue;
    if (/^(cctv|央视|中央电视台)/i.test(name)) continue;
    seen.add(name);
    number++;
    const channel = {
      key: `${source.id}\u0000${platformId}\u0000${name}`,
      name,
      urls: [url],
      number: String(number).padStart(3, '0'),
      headers: source.headers || {},
      logo: String(row.img ?? '').trim(),
      group: platformId,
      source: source.id,
    };
    (url.startsWith('rtmp') ? fallback : reliable).push(channel);
  }
  return [...reliable, ...fallback];
}

async function listChannels(source) {
  const endpoint = (source.endpoints || [])[0];
  if (!endpoint) throw new Error('直播源地址为空');
  const text = await fetchSourceText(endpoint, source.headers, endpoint + '/');
  const parsed = parseLive(text, {
    source: source.id,
    defaultGroup: source.group || UNSORTED,
  });
  const channels = parsed.groups.flatMap((group) => group.channels);
  if (!channels.length) throw new Error('该直播源没有可用频道');
  return channels;
}

/** 播放地址（带原始请求头）。 */
export async function livePlayback(sources, sourceId, channel) {
  const source = sourceOf(sources, sourceId);
  const urls = (channel?.urls || []).filter(isPlayableLiveUrl);
  if (!urls.length) throw new Error('该频道没有可用线路');
  return {
    url: urls[0],
    urls,
    headers: mergeHeaders(source.headers, channel?.headers),
  };
}

export function liveSourceCatalog(customSources = []) {
  return [...BUILTIN_LIVE_SOURCES, ...customSources].map((source) => ({
    id: source.id,
    name: source.name,
    description: source.description || '',
    protocol: source.protocol || 'list',
    builtin: Boolean(source.builtin),
    group: source.group || '',
    adult: Boolean(source.adult),
  }));
}
