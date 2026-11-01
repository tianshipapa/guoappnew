// 韩小圈（jennyhow.com）原生站源：移植 provider_hanxiaoquan.go
//
//   GET /hxq/{分类}.html            分类第 1 页；/hxq/{分类}-{n}.html 翻页
//   GET /hanxiaoquan/{id}.html      详情（playlist tab 多线路）
//   GET /play/{id}-{sid}-{eid}.html 播放页（var now = "m3u8 直链"）
//   GET /search.php?searchword=     站内搜索（单页）
//
// 站点本身偏慢（本机实测首字节可到 10s+），所以超时放到 30s。

import { fetchText, isMediaURL } from '../http.mjs';
import { cleanText } from '../html.mjs';

export const HANXIAOQUAN_BASE = 'https://www.jennyhow.com';
const HXQ_UA =
  'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36';
const PAGE_SIZE = 24;

export const HXQ_CATEGORIES = [
  { id: '1', name: '最新韩剧' },
  { id: '2', name: '韩国电影' },
  { id: '3', name: '韩国综艺' },
  { id: '4', name: '韩国动漫' },
];

const CARD_PIC = /<a href="\/hanxiaoquan\/(\d+)\.html"[^>]*title="([^"]*)"[^>]*class="module-item-pic"/gi;
const CARD_IMG = /<img[^>]*data-src="([^"]+)"/i;
const CARD_TITLE = /<a href="\/hanxiaoquan\/\d+\.html"[^>]*class="module-item-title"[^>]*>([^<]*)<\/a>/i;
const CARD_NOTE = /class="module-item-text"[^>]*>([^<]*)</i;
const AD_TEXT = /@[^@]{1,60}@/g;
const DETAIL_TITLE = /<h1 class="page-title"[^>]*>([\s\S]*?)<\/h1>/i;
const OG_IMAGE = /property="og:image"\s+content="([^"]+)"/i;
const COVER_SRC = /<div class="video-cover">[\s\S]*?<img[^>]*data-src="([^"]+)"/i;
const INFO_ITEM =
  /<span class="video-info-itemtitle">([^<]*)<\/span>\s*<div class="video-info-item[^"]*">([\s\S]*?)<\/div>/gi;
const LINE_TAB = /href="#playlist(\d+)"[^>]*>\s*<i[^>]*><\/i>\s*([^<]+)/gi;
const EPISODE = /<a title="([^"]*)" href="(\/play\/\d+-\d+-\d+\.html)"/gi;
const NOW_VAR = /var\s+now\s*=\s*["']([^"']+)["']/i;
const MEDIA_ANY = /https?:\/\/[^"'\s<>\\]+\.(?:m3u8|mp4)(?:\?[^"'\s<>\\]*)?/i;
// 搜索页有轻量反爬：先回一个「请稍候」页，要求写 cookie 再带 _idc_pass 重试。
const CHALLENGE = /document\.cookie="(idc_search_browser=[0-9a-zA-Z]+)/;

function validCategory(category) {
  if (!category) return true;
  if (category.length > 8 || /[|/\\\x00\r\n]/.test(category)) return false;
  return HXQ_CATEGORIES.some((entry) => entry.id === category);
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
  else if (value.startsWith('/')) value = HANXIAOQUAN_BASE + value;
  if (!/^https?:\/\//i.test(value)) return '';
  return value;
}

async function hxqGet(site, path, headers = {}) {
  const address = /^https?/i.test(path) ? path : site + path;
  const { text } = await fetchText(address, {
    ua: HXQ_UA,
    referer: site + '/',
    headers,
    timeout: 30000,
  });
  return text;
}

/** 过「请稍候」校验：拿 cookie 值后带 _idc_pass 再请求一次。 */
async function hxqGetWithChallenge(site, path) {
  const body = await hxqGet(site, path);
  const challenge = CHALLENGE.exec(body);
  if (!challenge) return body;
  const address = /^https?/i.test(path) ? path : site + path;
  const url = new URL(address);
  url.searchParams.set('_idc_pass', Date.now().toString(36) + Math.random().toString(36).slice(2, 8));
  return hxqGet(site, url.toString(), { Cookie: challenge[1] });
}

/** 目录 / 搜索卡片。 */
export function parseHanxiaoquanCards(body) {
  const items = [];
  const seen = new Set();
  CARD_PIC.lastIndex = 0;
  const matches = [];
  let match;
  while ((match = CARD_PIC.exec(body))) matches.push(match);

  for (const entry of matches) {
    const id = entry[1];
    let title = clean(entry[2]);
    if (!numericID(id) || seen.has(id)) continue;
    const chunk = body.slice(entry.index + entry[0].length, entry.index + entry[0].length + 600);
    const coverMatch = CARD_IMG.exec(chunk);
    const noteMatch = CARD_NOTE.exec(chunk);
    if (!title) {
      const titleMatch = CARD_TITLE.exec(chunk);
      if (titleMatch) title = clean(titleMatch[1]);
    }
    if (!title) continue;
    seen.add(id);
    items.push({
      id: `hanxiaoquan:${id}`,
      sourceId: id,
      source: 'hanxiaoquan',
      title: title.slice(0, 200),
      cover: coverMatch ? fixURL(coverMatch[1]) : '',
      remark: noteMatch ? clean(noteMatch[1]).slice(0, 64) : '',
      category: '韩剧',
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
  const pattern = new RegExp(
    `/hxq/${category.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}-(\\d+)\\.html`,
    'gi'
  );
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

function infoFields(body) {
  const fields = {};
  INFO_ITEM.lastIndex = 0;
  let match;
  while ((match = INFO_ITEM.exec(body))) {
    const label = String(match[1] || '').trim().replace(/：$/, '');
    const value = clean(match[2]);
    if (label && value && !fields[label]) fields[label] = value;
  }
  return fields;
}

function playLink(href) {
  let value = String(href || '').trim();
  if (!value) return '';
  if (!/^https?/i.test(value)) value = HANXIAOQUAN_BASE + '/' + value.replace(/^\/+/, '');
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    return '';
  }
  if (parsed.username || parsed.password) return '';
  if (!['jennyhow.com', 'www.jennyhow.com'].includes(parsed.hostname.toLowerCase())) return '';
  const path = parsed.pathname.toLowerCase();
  if (!path.endsWith('.html') || !parsed.pathname.includes('/play/')) return '';
  return parsed.toString();
}

function episodesFromSegment(segment) {
  const chapters = [];
  const seen = new Set();
  EPISODE.lastIndex = 0;
  let match;
  while ((match = EPISODE.exec(segment))) {
    const title = clean(match[1]);
    const playURL = playLink(match[2]);
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
      videoUrl: 'hanxiaoquan-play://' + playURL,
      referer: HANXIAOQUAN_BASE + '/',
      routes: [],
    });
  }
  return chapters;
}

/** 详情页选线路（取分集最多的一路）。 */
export function pickHanxiaoquanPlaylist(body) {
  const lineNames = new Map();
  LINE_TAB.lastIndex = 0;
  let tab;
  while ((tab = LINE_TAB.exec(body))) lineNames.set(tab[1], clean(tab[2]));
  const lineIDs = [...lineNames.keys()].sort();
  if (!lineIDs.length) lineIDs.push('');

  let best = [];
  let bestName = '';
  for (const lineID of lineIDs) {
    let segment = body;
    if (lineID) {
      const marker = `id="playlist${lineID}"`;
      const start = body.indexOf(marker);
      if (start < 0) continue;
      segment = body.slice(start + marker.length);
      const nextLine = segment.indexOf('id="playlist');
      if (nextLine >= 0) segment = segment.slice(0, nextLine);
      else {
        const footer = segment.indexOf('class="module-footer"');
        if (footer >= 0) segment = segment.slice(0, footer);
      }
    }
    const chapters = episodesFromSegment(segment);
    if (chapters.length > best.length) {
      best = chapters;
      bestName = lineNames.get(lineID) || '';
    }
  }
  if (!best.length) throw new Error('韩小圈暂无可播放分集');
  best.sort((left, right) => left.index - right.index);
  return { lineName: bestName, chapters: best };
}

export async function hanxiaoquanCatalog({ base, category = '', page = 1 }) {
  const site = base || HANXIAOQUAN_BASE;
  if (page < 1 || page > 100000) throw new Error('韩小圈目录页码无效');
  if (!validCategory(category)) throw new Error('韩小圈内容分类无效');
  const cate = category || HXQ_CATEGORIES[0].id;
  const path = page > 1 ? `/hxq/${cate}-${page}.html` : `/hxq/${cate}.html`;
  const body = await hxqGet(site, path);
  const items = parseHanxiaoquanCards(body);
  if (!items.length) return { items: [], hasMore: false, total: 0 };
  const name = HXQ_CATEGORIES.find((entry) => entry.id === cate)?.name || '韩剧';
  for (const item of items) item.category = name;
  return { items, hasMore: page < pageCount(body, cate, page, items.length), total: items.length };
}

export async function hanxiaoquanSearch({ base, query, page = 1 }) {
  const site = base || HANXIAOQUAN_BASE;
  const keyword = String(query || '').trim();
  if (!keyword || keyword.length > 256) throw new Error('韩小圈搜索关键词无效');
  if (page > 1) return { items: [], hasMore: false, total: 0 };
  const body = await hxqGetWithChallenge(site, '/search.php?searchword=' + encodeURIComponent(keyword));
  const items = parseHanxiaoquanCards(body);
  for (const item of items) item.category = '搜索';
  return { items, hasMore: false, total: items.length };
}

export async function hanxiaoquanDetail({ base, sourceId }) {
  const site = base || HANXIAOQUAN_BASE;
  if (!numericID(sourceId)) throw new Error('韩小圈视频 ID 无效');
  const body = await hxqGet(site, `/hanxiaoquan/${sourceId}.html`);

  const head = DETAIL_TITLE.exec(body);
  const title = head ? clean(head[1]) : '';
  if (!title) throw new Error('韩小圈详情缺少视频名称');

  let cover = '';
  const og = OG_IMAGE.exec(body) || COVER_SRC.exec(body);
  if (og) cover = fixURL(og[1]);

  const fields = infoFields(body);
  const description = String(fields['剧情'] || fields['简介'] || '').replace(AD_TEXT, '').trim();

  const tags = [];
  const seenTag = new Set();
  const addTag = (value) => {
    const text = String(value || '').trim();
    if (!text || seenTag.has(text) || [...text].length > 48 || tags.length >= 16) return;
    seenTag.add(text);
    tags.push(text);
  };
  if (fields['上映']) addTag(`${fields['上映']}年`);
  if (fields['导演']) addTag('导演 ' + fields['导演'].slice(0, 32));
  if (fields['主演']) addTag('主演 ' + fields['主演'].slice(0, 48));

  const { chapters } = pickHanxiaoquanPlaylist(body);

  const drama = {
    id: `hanxiaoquan:${sourceId}`,
    sourceId,
    source: 'hanxiaoquan',
    title: title.slice(0, 200),
    cover,
    remark: String(fields['更新'] || fields['状态'] || '').slice(0, 64),
    category: '韩剧',
    episodes: chapters.length,
    totalEpisode: chapters.length,
    description: description.slice(0, 12000),
    tags,
    onlineDate: String(fields['更新'] || '').slice(0, 32),
    releaseStatus: 'unknown',
  };
  return { drama, episodes: chapters };
}

export async function hanxiaoquanResolve({ base, chapter }) {
  const site = base || HANXIAOQUAN_BASE;
  let playURL = String(chapter?.pageUrl || '').trim();
  if (playURL.startsWith('hanxiaoquan-play://')) {
    playURL = playURL.slice('hanxiaoquan-play://'.length);
  }
  if (!playURL && String(chapter?.videoUrl || '').startsWith('hanxiaoquan-play://')) {
    playURL = String(chapter.videoUrl).slice('hanxiaoquan-play://'.length);
  }
  if (playLink(playURL) === '') throw new Error('韩小圈播放页地址无效');

  const body = await hxqGet(site, playURL);
  let address = '';
  const now = NOW_VAR.exec(body);
  if (now) address = String(now[1]).trim();
  if (!address) {
    const any = MEDIA_ANY.exec(body);
    if (any) address = any[0];
  }
  if (!address) throw new Error('韩小圈该集暂无可用播放地址');
  if (address.startsWith('//')) address = 'https:' + address;
  if (!isMediaURL(address)) throw new Error('韩小圈播放地址无效');

  const referer = HANXIAOQUAN_BASE + '/';
  return { url: address, referer, variants: [{ url: address, referer }] };
}

export function hanxiaoquanCategories() {
  return [...HXQ_CATEGORIES];
}
