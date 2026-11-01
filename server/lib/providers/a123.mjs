// A123（a123tv.com）原生站源：移植 provider_a123.go
//
//   GET /                     首页推荐（w4-item 卡片，作为「全部」第 1 页）
//   GET /t/{id}.html          分类第 1 页；/t/{id}/p{n}.html 翻页
//   GET /s/{关键词}.html      搜索（服务端渲染）
//   GET /v/{slug}.html        详情页（w4-player 默认线路首集直链、选集列表）
//   GET /v/{slug}/{code}.html 播放页（var pp = {"no":slug,"ld":线路码,"la":[[码,线路名,集数,?,m3u8],…]}）

import { fetchText, isMediaURL, absoluteURL } from '../http.mjs';
import { cleanText } from '../html.mjs';
import { normalizePlaybackURL } from '../maccms.mjs';

export const A123_BASE = 'https://a123tv.com';
const A123_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

export const A123_CATEGORIES = [
  { id: '10', name: '电影' },
  { id: '11', name: '连续剧' },
  { id: '12', name: '综艺' },
  { id: '13', name: '动漫' },
  { id: '15', name: '福利' },
];

const CARD = /<a[^>]*class="w4-item"[^>]*href="\/v\/([^"/]+)\.html"[^>]*>([\s\S]*?)<\/a>/gi;
const ATTR_SRC = /(?:data-src|src)="([^"]+)"/i;
const ATTR_ALT = /alt="([^"]*)"/i;
const ATTR_TITLE = /title="([^"]*)"/i;
const INFO_TITLE = /<div class="t" title="([^"]*)"[^>]*>([^<]*)<\/div>/i;
const INFO_META = /<div class="i"[^>]*>([\s\S]*?)<\/div>/i;
const PLAYER_SRC = /<div[^>]*class="w4-player"[^>]*data-src="([^"]+)"/i;
const PLAYER_POSTER = /<div[^>]*class="w4-player"[^>]*data-poster="([^"]+)"/i;
const PLAYER_TITLE = /<div[^>]*class="w4-player"[^>]*data-title="([^"]*)"/i;
const DETAIL_TITLE = /<h1[^>]*>([^<]+)<\/h1>/i;
const EPISODE_BLOCK = /<div[^>]*class="w4-episode-list[^"]*"[^>]*>([\s\S]*?)(?:<h2|<\/div>\s*<\/div>\s*<\/div>|$)/i;
const EPISODE_LINK = /<a[^>]*href="(\/v\/[^"/]+\/[^"]+\.html)"[^>]*>/gi;
const PP_BLOCK = /var\s+pp\s*=\s*(\{[\s\S]*?\})\s*;/i;

function fixURL(raw) {
  const value = String(raw || '').trim();
  if (!value) return '';
  if (value.startsWith('//')) return 'https:' + value;
  if (value.startsWith('/')) return A123_BASE + value;
  return value;
}

function validSlug(slug) {
  return Boolean(slug) && slug.length <= 128 && /^[A-Za-z0-9_-]+$/.test(slug);
}

function validCategory(category) {
  if (!category) return true;
  return A123_CATEGORIES.some((entry) => entry.id === category);
}

async function a123Get(path, base) {
  const site = base || A123_BASE;
  const address = /^https?/i.test(path) ? path : site + path;
  const { text } = await fetchText(address, { ua: A123_UA, referer: site + '/', timeout: 20000 });
  return text;
}

function unescapeHTML(value) {
  return String(value || '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

/** w4-item 卡片解析（目录页与搜索页共用）。 */
export function parseA123Cards(body, categoryName = '') {
  const items = [];
  const seen = new Set();
  CARD.lastIndex = 0;
  let match;
  while ((match = CARD.exec(body))) {
    const slug = match[1].trim();
    if (!validSlug(slug) || seen.has(slug)) continue;
    const block = match[2];
    let title = '';
    const named = INFO_TITLE.exec(block);
    if (named) {
      title = unescapeHTML((named[1] || '').trim()) || unescapeHTML((named[2] || '').trim());
    }
    if (!title) {
      const alt = ATTR_ALT.exec(block);
      if (alt) title = unescapeHTML(alt[1].trim());
    }
    if (!title) continue;
    if (title.includes('VIP') && title.length < 3) continue;
    seen.add(slug);
    let cover = '';
    const src = ATTR_SRC.exec(block);
    if (src) cover = fixURL(src[1]);
    let remark = '';
    const meta = INFO_META.exec(block);
    if (meta) remark = cleanText(meta[1]);
    items.push({
      id: `a123:${slug}`,
      sourceId: slug,
      source: 'a123',
      title: title.slice(0, 200),
      cover,
      remark: remark.slice(0, 64),
      category: categoryName,
      episodes: 0,
      tags: [],
      releaseStatus: 'unknown',
      description: remark,
    });
  }
  return items;
}

function pageSuffix(page) {
  return page <= 1 ? '' : `/p${page}`;
}

/** 从播放页提取 var pp（全线路 × 当集 m3u8 直链表）。 */
export function parseA123PP(body) {
  const match = PP_BLOCK.exec(body);
  if (!match) return { routes: [], current: '' };
  let payload;
  try {
    payload = JSON.parse(match[1]);
  } catch {
    return { routes: [], current: '' };
  }
  const routes = [];
  for (const row of payload.la || []) {
    if (!Array.isArray(row) || row.length < 5) continue;
    const code = typeof row[0] === 'string' ? row[0] : '';
    const name = typeof row[1] === 'string' ? row[1].trim() : '';
    const count = typeof row[2] === 'number' ? row[2] : 0;
    const address = typeof row[4] === 'string' ? row[4] : '';
    if (!code || !/^https?/i.test(address)) continue;
    routes.push({ code, name, count, address });
  }
  return { routes, current: payload.ld || '' };
}

function episodeOrderFromTitle(title, fallback) {
  const match = /第\s*(\d{1,6})\s*[集期话部]/.exec(String(title || ''));
  if (match) {
    const number = Number.parseInt(match[1], 10);
    if (number > 0 && number <= 100000) return number;
  }
  return fallback;
}

export async function a123Catalog({ base, category = '', page = 1 }) {
  if (!validCategory(category)) throw new Error('A123 内容分类无效');
  const site = base || A123_BASE;
  let path = '';
  let categoryName = '';
  if (!category && page === 1) {
    path = '/';
  } else if (!category) {
    path = `/t/10${pageSuffix(page)}.html`;
    categoryName = '电影';
  } else {
    path = `/t/${category}${pageSuffix(page)}.html`;
    categoryName = A123_CATEGORIES.find((entry) => entry.id === category)?.name || '';
  }
  const body = await a123Get(path, site);
  const items = parseA123Cards(body, categoryName);
  return { items, hasMore: items.length >= 24, total: items.length };
}

export async function a123Search({ base, query, page = 1 }) {
  if (!query.trim()) throw new Error('A123 搜索关键词无效');
  if (page > 1) return { items: [], hasMore: false, total: 0 };
  const body = await a123Get('/s/' + encodeURIComponent(query.trim()) + '.html', base);
  const items = parseA123Cards(body, '搜索');
  return { items, hasMore: false, total: items.length };
}

export async function a123Detail({ base, sourceId }) {
  if (!validSlug(sourceId)) throw new Error('A123 影片标识无效');
  const site = base || A123_BASE;
  const body = await a123Get(`/v/${sourceId}.html`, site);

  let title = '';
  const head = DETAIL_TITLE.exec(body);
  if (head) title = unescapeHTML(head[1].trim());
  let playerTitleRaw = '';
  const playerTitle = PLAYER_TITLE.exec(body);
  if (playerTitle) playerTitleRaw = unescapeHTML(playerTitle[1]);
  if (!title && playerTitleRaw) title = playerTitleRaw.split(' - ')[0].trim();
  if (!title) throw new Error('A123 详情缺少影片名称');

  let cover = '';
  const poster = PLAYER_POSTER.exec(body);
  if (poster) cover = fixURL(poster[1]);

  let remark = '';
  if (playerTitleRaw) {
    const parts = playerTitleRaw.split(' - ');
    if (parts.length >= 2) remark = parts[1].trim();
  }

  const block = EPISODE_BLOCK.exec(body)?.[1] || body;
  const episodes = [];
  const seen = new Set();
  EPISODE_LINK.lastIndex = 0;
  let anchor;
  while ((anchor = EPISODE_LINK.exec(block))) {
    const link = anchor[1].trim();
    if (!link.startsWith(`/v/${sourceId}/`) || seen.has(link)) continue;
    seen.add(link);
    let name = '';
    const named = ATTR_TITLE.exec(anchor[0]);
    if (named) name = unescapeHTML(named[1].trim());
    if (!name) {
      const gt = anchor[0].lastIndexOf('>');
      name = cleanText(anchor[0].slice(gt + 1));
    }
    episodes.push({ path: link, title: name });
  }
  if (episodes.length === 0) throw new Error('A123 详情缺少选集列表');

  const referer = site + '/';
  const chapters = episodes.map((entry, index) => {
    const order = episodeOrderFromTitle(entry.title, index + 1);
    return {
      index: order,
      title: (entry.title || `第 ${order} 集`).slice(0, 128),
      pageUrl: site + entry.path,
      videoUrl: 'a123-play://' + entry.path,
      referer,
      routes: [],
    };
  });
  chapters.sort((left, right) => left.index - right.index);

  const drama = {
    id: `a123:${sourceId}`,
    sourceId,
    source: 'a123',
    title: title.slice(0, 200),
    cover,
    remark: remark.slice(0, 64),
    category: '影视',
    episodes: chapters.length,
    totalEpisode: chapters.length,
    description: remark,
    tags: [],
    releaseStatus: 'unknown',
  };
  return { drama, episodes: chapters };
}

export async function a123Resolve({ base, chapter, sourceId }) {
  const site = base || A123_BASE;
  let pageURL = String(chapter.pageUrl || '').trim();
  // 详情把分集存成 a123-play:// 协议前缀，直接传 pageUrl 也要能认
  if (pageURL.startsWith('a123-play://')) {
    pageURL = site + pageURL.slice('a123-play://'.length);
  }
  if (!pageURL && String(chapter.videoUrl || '').startsWith('a123-play://')) {
    pageURL = site + String(chapter.videoUrl).slice('a123-play://'.length);
  }
  if (!pageURL || !/^https?/i.test(pageURL) || !pageURL.includes(`/v/${sourceId}/`)) {
    throw new Error('A123 播放分集信息无效，请刷新详情');
  }

  const body = await a123Get(pageURL, site);
  const options = [];
  const seen = new Set();
  const add = (address) => {
    const value = String(address || '').trim();
    if (!value || !isMediaURL(value) || seen.has(value)) return;
    seen.add(value);
    options.push({ url: value, referer: pageURL });
  };

  const player = PLAYER_SRC.exec(body);
  if (player) add(fixURL(player[1]));

  const { routes, current } = parseA123PP(body);
  for (const route of routes) if (route.code === current) add(route.address);
  for (const route of routes) if (route.code !== current) add(route.address);

  if (options.length === 0) throw new Error('A123 该集暂无可用播放地址，请换线路或稍后重试');
  return { ...options[0], variants: options };
}

export function a123Categories() {
  return [...A123_CATEGORIES];
}
