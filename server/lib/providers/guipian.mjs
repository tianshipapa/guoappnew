// 鬼片网（guipianwu.com）原生站源：移植 provider_guipian.go
//
//   GET /list/{分类}.html           分类第 1 页；/list/{分类}_{n}.html 翻页
//   GET /nv/{id}.html               详情（swiper tab 多线路 + 选集）
//   GET /play/{...}.html            播放页（var now = "m3u8 直链"）
//   GET /xml/rss.xml                全站 RSS，搜索在本地按标题过滤

import { fetchText, isMediaURL } from '../http.mjs';
import { cleanText } from '../html.mjs';

export const GUIPIAN_BASE = 'https://guipianwu.com';
const GUIPIAN_UA =
  'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36';
const PAGE_SIZE = 24;

export const GUIPIAN_CATEGORIES = [
  { id: '3', name: '恐怖片' },
  { id: '6', name: '大陆鬼片' },
  { id: '7', name: '日韩鬼片' },
  { id: '8', name: '林正英鬼片' },
  { id: '9', name: '港台鬼片' },
  { id: '10', name: '泰国鬼片' },
  { id: '11', name: '欧美鬼片' },
  { id: '31', name: '剧情片' },
  { id: '12', name: '国产剧' },
  { id: '13', name: '美剧' },
  { id: '14', name: '韩剧' },
  { id: '15', name: '日剧' },
  { id: '16', name: '泰剧' },
  { id: '17', name: '港台剧' },
  { id: '18', name: '其他剧' },
  { id: '23', name: '日韩动漫' },
  { id: '24', name: '国产动漫' },
  { id: '25', name: '欧美动漫' },
  { id: '26', name: '港台动漫' },
];

const MAIN_LIST = /<ul class="row video-list video-film-list[^"]*">([\s\S]*?)<\/ul>/i;
const CARD = /<a class="video-link" href="\/nv\/(\d+)\.html"[^>]*title="([^"]*)"([\s\S]*?)<\/a>/gi;
const COVER = /data-(?:original|background)="([^"]+)"/i;
const REMARK = /<div class="video-duration">([\s\S]*?)<\/div>/i;
const DETAIL_TITLE = /<h1 class="media-title[^"]*">([\s\S]*?)<\/h1>/i;
const TITLE_TAG = /<title>([\s\S]*?)<\/title>/i;
const DETAIL_PIC = /<div class="detail-img"><img[^>]+src="([^"]+)"/i;
const DETAIL_PIC2 = /<div class="detail-cover[^"]*"[^>]*data-original="([^"]+)"/i;
const CONTENT = /简介：([\s\S]*?)<\/li>/i;
const YEAR = /年份：<span>([\s\S]*?)<\/span>/i;
const DIRECTOR = /导演：([\s\S]*?)<\/span>/i;
const ACTOR = /主演：([\s\S]*?)<\/span>/i;
const ANCHOR = /<a[^>]*>([^<]+)<\/a>/gi;
const AREA = /地区：<span><a[^>]*>([\s\S]*?)<\/a>/i;
const STATUS = /状态：([\s\S]*?)<\/span>/i;
const TAB = /<li class="swiper-slide ewave-tab[^"]*" data-target="#(ewave-playlist-\d+)">([^<]+)<\/li>/gi;
const EPISODE = /<li><a title='([^']*)' href='([^']+)'/gi;
const NOW_VAR = /var\s+now\s*=\s*["']([^"']+)["']/i;
const MEDIA_ANY = /https?:\/\/[^"'\s<>\\]+\.(?:m3u8|mp4)(?:\?[^"'\s<>\\]*)?/i;
const RSS_ITEM = /<item>([\s\S]*?)<\/item>/gi;
const RSS_TITLE = /<title>\s*(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?\s*<\/title>/i;
const RSS_LINK = /\/nv\/(\d+)\.html/;

function validCategory(category) {
  if (!category) return true;
  if (category.length > 16 || /[|/\\\x00\r\n]/.test(category)) return false;
  return GUIPIAN_CATEGORIES.some((entry) => entry.id === category);
}

function numericID(value) {
  const text = String(value || '').trim();
  if (!text || text.length > 12) return false;
  const number = Number.parseInt(text, 10);
  return Number.isFinite(number) && number > 0;
}

function clean(value) {
  return cleanText(String(value || ''));
}

function fixURL(raw) {
  let value = String(raw || '').trim();
  if (!value) return '';
  if (value.startsWith('//')) value = 'https:' + value;
  else if (value.startsWith('/')) value = GUIPIAN_BASE + value;
  if (!/^https?:\/\//i.test(value)) return '';
  return value;
}

async function guipianGet(site, path) {
  const address = /^https?/i.test(path) ? path : site + path;
  const { text } = await fetchText(address, {
    ua: GUIPIAN_UA,
    referer: site + '/',
    timeout: 25000,
  });
  return text;
}

/** 目录 / 搜索页卡片（鬼片网只有一片 video-list，直接按整段扫）。 */
export function parseGuipianCards(body) {
  const main = MAIN_LIST.exec(body);
  const segment = main ? main[1] : body;
  const items = [];
  const seen = new Set();
  CARD.lastIndex = 0;
  let match;
  while ((match = CARD.exec(segment))) {
    const id = match[1].trim();
    const title = clean(match[2]);
    if (!numericID(id) || seen.has(id) || !title) continue;
    const chunk = match[3];
    seen.add(id);
    const coverMatch = COVER.exec(chunk);
    const remarkMatch = REMARK.exec(chunk);
    items.push({
      id: `guipian:${id}`,
      sourceId: id,
      source: 'guipian',
      title: title.slice(0, 200),
      cover: coverMatch ? fixURL(coverMatch[1]) : '',
      remark: remarkMatch ? clean(remarkMatch[1]).slice(0, 64) : '',
      category: '影视',
      episodes: 0,
      tags: [],
      releaseStatus: 'unknown',
      description: '',
    });
    if (items.length > 500) break;
  }
  return items;
}

function pageCount(body, category, page, count) {
  const pattern = new RegExp(`/list/${category.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}_(\\d+)\\.html`, 'gi');
  let maxPage = page;
  let match;
  while ((match = pattern.exec(body))) {
    const value = Number.parseInt(match[1], 10);
    if (value > maxPage && value < 100000) maxPage = value;
  }
  if (maxPage > page) return maxPage;
  if (count >= PAGE_SIZE) return page + 1;
  return page;
}

function field(body, pattern) {
  const match = pattern.exec(body);
  return match ? clean(match[1]) : '';
}

function actors(body) {
  const match = ACTOR.exec(body);
  if (!match) return '';
  const names = [];
  ANCHOR.lastIndex = 0;
  let anchor;
  while ((anchor = ANCHOR.exec(match[1]))) {
    const name = clean(anchor[1]);
    if (name) names.push(name);
  }
  return names.length ? names.join(' ') : clean(match[1]);
}

function episodesFromSegment(segment) {
  const chapters = [];
  const seen = new Set();
  EPISODE.lastIndex = 0;
  let match;
  while ((match = EPISODE.exec(segment))) {
    const title = clean(match[1]);
    const href = String(match[2] || '').trim();
    if (!href) continue;
    const playURL = playLink(href);
    if (!playURL || seen.has(playURL)) continue;
    seen.add(playURL);
    let order = chapters.length + 1;
    const num = /(\d+)/.exec(title);
    if (num) {
      const parsed = Number.parseInt(num[1], 10);
      if (parsed > 0 && parsed <= 100000) order = parsed;
    }
    chapters.push({
      index: order,
      title: (title || `第 ${order} 集`).slice(0, 128),
      pageUrl: playURL,
      videoUrl: 'guipian-play://' + playURL,
      referer: GUIPIAN_BASE + '/',
      routes: [],
    });
  }
  return chapters;
}

/** 详情页选线路：取分集最多的那条（对齐 Go 的 best 逻辑）。 */
export function pickGuipianPlaylist(body) {
  const tabs = [];
  const seen = new Set();
  TAB.lastIndex = 0;
  let match;
  while ((match = TAB.exec(body))) {
    const anchor = match[1];
    if (!anchor || seen.has(anchor)) continue;
    seen.add(anchor);
    tabs.push({ anchor, name: clean(match[2]) });
  }
  if (!tabs.length) throw new Error('鬼片网未找到可用播放线路');

  let best = [];
  let bestName = '';
  for (const tab of tabs) {
    const marker = `id="${tab.anchor}"`;
    const start = body.indexOf(marker);
    if (start < 0) continue;
    let segment = body.slice(start + marker.length);
    const cutSlide = segment.indexOf('<div class="playlist-slide');
    if (cutSlide >= 0) segment = segment.slice(0, cutSlide);
    else {
      const cutSection = segment.indexOf('</section>');
      if (cutSection >= 0) segment = segment.slice(0, cutSection);
    }
    const chapters = episodesFromSegment(segment);
    if (chapters.length > best.length) {
      best = chapters;
      bestName = tab.name;
    }
  }
  if (!best.length) throw new Error('鬼片网线路暂无可播放分集');
  best.sort((left, right) => left.index - right.index);
  return { lineName: bestName, chapters: best };
}

function playLink(href) {
  let value = String(href || '').trim();
  if (!value) return '';
  if (!/^https?/i.test(value)) value = GUIPIAN_BASE + '/' + value.replace(/^\/+/, '');
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    return '';
  }
  if (parsed.username || parsed.password) return '';
  if (!['guipianwu.com', 'www.guipianwu.com'].includes(parsed.hostname.toLowerCase())) return '';
  const path = parsed.pathname.toLowerCase();
  if (!path.endsWith('.html') || !parsed.pathname.includes('/play/')) return '';
  return parsed.toString();
}

export async function guipianCatalog({ base, category = '', page = 1 }) {
  const site = base || GUIPIAN_BASE;
  if (page < 1 || page > 100000) throw new Error('鬼片网目录页码无效');
  if (!validCategory(category)) throw new Error('鬼片网内容分类无效');
  const cate = category || GUIPIAN_CATEGORIES[0].id;
  const path = page > 1 ? `/list/${cate}_${page}.html` : `/list/${cate}.html`;
  const body = await guipianGet(site, path);
  const items = parseGuipianCards(body);
  if (!items.length) return { items: [], hasMore: false, total: 0 };
  const name = GUIPIAN_CATEGORIES.find((entry) => entry.id === cate)?.name || '影视';
  for (const item of items) item.category = name;
  return { items, hasMore: page < pageCount(body, cate, page, items.length), total: items.length };
}

export async function guipianSearch({ base, query, page = 1 }) {
  const site = base || GUIPIAN_BASE;
  const needle = String(query || '').trim();
  if (!needle || needle.length > 256) throw new Error('鬼片网搜索关键词无效');
  const body = await guipianGet(site, '/xml/rss.xml');
  const lower = needle.toLowerCase();
  const matched = [];
  const seen = new Set();
  RSS_ITEM.lastIndex = 0;
  let item;
  while ((item = RSS_ITEM.exec(body))) {
    const segment = item[1];
    const titleMatch = RSS_TITLE.exec(segment);
    const idMatch = RSS_LINK.exec(segment);
    if (!titleMatch || !idMatch) continue;
    const title = clean(titleMatch[1]);
    const id = idMatch[1];
    if (!title || !numericID(id) || seen.has(id)) continue;
    if (!title.toLowerCase().includes(lower)) continue;
    seen.add(id);
    matched.push({
      id: `guipian:${id}`,
      sourceId: id,
      source: 'guipian',
      title: title.slice(0, 200),
      cover: '',
      remark: '',
      category: '搜索',
      episodes: 0,
      tags: [],
      releaseStatus: 'unknown',
      description: '',
    });
  }
  const start = (page - 1) * PAGE_SIZE;
  if (start >= matched.length) return { items: [], hasMore: false, total: matched.length };
  const slice = matched.slice(start, start + PAGE_SIZE);
  return { items: slice, hasMore: start + PAGE_SIZE < matched.length, total: matched.length };
}

export async function guipianDetail({ base, sourceId }) {
  const site = base || GUIPIAN_BASE;
  if (!numericID(sourceId)) throw new Error('鬼片网视频 ID 无效');
  const body = await guipianGet(site, `/nv/${sourceId}.html`);

  let title = field(body, DETAIL_TITLE);
  if (!title) {
    const tag = TITLE_TAG.exec(body);
    if (tag) {
      const raw = clean(tag[1]);
      if (raw.includes('提示信息') || raw.includes('影片不存在')) throw new Error('鬼片网影片不存在');
      const named = /《(.*?)》/.exec(raw);
      title = named ? named[1].trim() : raw;
    }
  }
  if (!title) throw new Error('鬼片网详情缺少视频名称');

  let cover = '';
  const pic = DETAIL_PIC.exec(body) || DETAIL_PIC2.exec(body);
  if (pic) cover = fixURL(pic[1]);

  const description = field(body, CONTENT);
  const year = field(body, YEAR);
  const director = field(body, DIRECTOR);
  const area = field(body, AREA);
  const status = field(body, STATUS);
  const cast = actors(body);

  const tags = [];
  const seenTag = new Set();
  const addTag = (value) => {
    const text = String(value || '').trim();
    if (!text || seenTag.has(text) || [...text].length > 48 || tags.length >= 16) return;
    seenTag.add(text);
    tags.push(text);
  };
  if (year) addTag(`${year}年`);
  if (area) addTag(area);
  if (director) addTag('导演 ' + director.slice(0, 32));
  if (cast) addTag('主演 ' + cast.slice(0, 48));

  const { chapters } = pickGuipianPlaylist(body);

  const drama = {
    id: `guipian:${sourceId}`,
    sourceId,
    source: 'guipian',
    title: title.slice(0, 200),
    cover,
    remark: status.slice(0, 64),
    category: '影视',
    episodes: chapters.length,
    totalEpisode: chapters.length,
    description: description.slice(0, 12000),
    tags,
    releaseStatus: 'unknown',
  };
  return { drama, episodes: chapters };
}

export async function guipianResolve({ base, chapter }) {
  const site = base || GUIPIAN_BASE;
  let playURL = String(chapter?.pageUrl || '').trim();
  if (playURL.startsWith('guipian-play://')) {
    playURL = playURL.slice('guipian-play://'.length);
  }
  if (!playURL && String(chapter?.videoUrl || '').startsWith('guipian-play://')) {
    playURL = String(chapter.videoUrl).slice('guipian-play://'.length);
  }
  if (playLink(playURL) === '') throw new Error('鬼片网播放页地址无效');

  const body = await guipianGet(site, playURL);
  let address = '';
  const now = NOW_VAR.exec(body);
  if (now) address = String(now[1]).trim();
  if (!address) {
    const any = MEDIA_ANY.exec(body);
    if (any) address = any[0];
  }
  if (!address) throw new Error('鬼片网该集暂无可用播放地址');
  if (address.startsWith('//')) address = 'https:' + address;
  if (!isMediaURL(address)) throw new Error('鬼片网播放地址无效');

  const referer = GUIPIAN_BASE + '/';
  return { url: address, referer, variants: [{ url: address, referer }] };
}

export function guipianCategories() {
  return [...GUIPIAN_CATEGORIES];
}
