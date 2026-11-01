// 爱看机器人（ikanbot）原生站源：移植 provider_ikanbot.go
//
//   GET /hot/index-{kind}-{分类}.html       分类第 1 页
//   GET /hot/index-{kind}-{分类}-p-{n}.html 分类翻页
//   GET /search?q={关键词}                  搜索（不分页）
//   GET /play/{id}                          详情/播放页（含 current_id / e_token / mtype）
//   GET /api/getResN?videoId=&mtype=&token= 线路列表（JSON，token 需签名）
//
// 线路接口返回 data.list，每项 resData 是 JSON 字符串：
//   [{"flag":"线路名","url":"第01集$https://…/index.m3u8#第02集$…"}]

import { fetchText, isMediaURL } from '../http.mjs';
import { cleanText } from '../html.mjs';

export const IKB_BASE = 'https://www1.ikanbot.com';
const IKB_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const PAGE_SIZE = 36;
const MAX_LINES = 40;
const LINE_TTL = 10 * 60 * 1000;

export const IKB_CATEGORIES = [
  { id: 'movie-热门', name: '热门电影' },
  { id: 'tv-热门', name: '热门剧集' },
  { id: 'tv-国产剧', name: '国产剧' },
  { id: 'tv-日剧', name: '日剧' },
  { id: 'tv-韩剧', name: '韩剧' },
  { id: 'tv-美剧', name: '美剧' },
  { id: 'tv-英剧', name: '英剧' },
  { id: 'tv-港剧', name: '港剧' },
  { id: 'tv-日本动画', name: '日本动画' },
  { id: 'tv-综艺', name: '综艺' },
  { id: 'tv-纪录片', name: '纪录片' },
];

const CARD_LINK = /<a class="item" href="\/play\/(\d+)"/gi;
const IMG_DATA = /<img[^>]*data-src="([^"]+)"/i;
const IMG_ALT = /<img[^>]*alt="([^"]*)"/i;
const CARD_TEXT = /<p>([\s\S]*?)<\/p>/i;
const PAGE_MAX = /-p-(\d+)\.html/gi;

const MEDIA_BLOCK = /<div class="media">([\s\S]*?)<\/div>\s*<\/div>/gi;
const MEDIA_HREF = /href="\/play\/(\d+)"/i;
const TITLE_TEXT = /<a href="\/play\/\d+" class="title-text">([\s\S]*?)<\/a>/i;
const LINE_LABEL = /<span class="label"[^>]*>\[([^\]]*)\]<\/span>/i;
const SMALL_TEXT = /<span class="small"[^>]*>([\s\S]*?)<\/span>/gi;

const CURRENT_ID = /<input type="hidden" id="current_id" value="([^"]*)"\/>/i;
const TOKEN = /<input type="hidden" id="e_token" value="([^"]*)"\/>/i;
const MTYPE = /<input type="hidden" id="mtype" value="([^"]*)"\/>/i;
const VIDEO_TITLE = /<h1 id="video_title"[^>]*>([\s\S]*?)<\/h1>/i;
const COVER_IMG = /<img id="\d+"[^>]*class="cover lazy"[^>]*data-src="([^"]+)"/i;
const META_TEXT = /<h3 class="meta">([\s\S]*?)<\/h3>/gi;
const TAG_NAME = /<[^>]+>/g;
const EPISODE_NO = /(\d+)/;
const FLAG_RES = /(2160|1440|1080|720|480)/;

const lineCache = new Map();
const linePending = new Map();

function clean(text) {
  if (!text) return '';
  return cleanText(String(text).replace(TAG_NAME, '')).replace(/\u3000/g, ' ').trim();
}

function numericID(value) {
  return /^\d{1,12}$/.test(String(value || '').trim());
}

function validCategory(category) {
  if (!category) return true;
  return IKB_CATEGORIES.some((entry) => entry.id === category);
}

function kindName(category) {
  return String(category || '').startsWith('movie-') ? '电影' : '剧集';
}

function fixURL(raw) {
  let value = String(raw || '').trim();
  if (!value) return '';
  if (value.startsWith('//')) value = 'https:' + value;
  else if (value.startsWith('/')) value = IKB_BASE + value;
  if (!/^https?:\/\//i.test(value)) return '';
  return value;
}

/**
 * 复刻页面 get_tks：取影片 ID 末 4 位，每位数字 n 得步长 k=n%3+1，
 * 从令牌串当前位置截 8 字符并推进 k+8 位。
 */
export function ikanbotSign(currentId, eToken) {
  const id = String(currentId || '');
  const token = String(eToken || '');
  if (id.length < 4 || token.length < 16) return '';
  const tail = id.slice(-4);
  let rest = token;
  let out = '';
  for (const char of tail) {
    if (!/\d/.test(char)) return '';
    const start = (Number.parseInt(char, 10) % 3) + 1;
    if (start + 8 > rest.length) return '';
    out += rest.slice(start, start + 8);
    rest = rest.slice(start + 8);
  }
  return out;
}

async function ikbGet(path, base) {
  const site = base || IKB_BASE;
  const address = /^https?/i.test(path) ? path : site + path;
  const { text } = await fetchText(address, { ua: IKB_UA, referer: site + '/', timeout: 20000 });
  return text;
}

export function parseIkanbotCards(body, categoryName) {
  const items = [];
  const seen = new Set();
  CARD_LINK.lastIndex = 0;
  let match;
  while ((match = CARD_LINK.exec(body))) {
    const id = match[1];
    if (!numericID(id) || seen.has(id)) continue;
    const start = match.index + match[0].length;
    const chunk = body.slice(start, start + 900);
    let title = '';
    const alt = IMG_ALT.exec(chunk);
    if (alt) title = clean(alt[1]);
    if (!title) {
      const text = CARD_TEXT.exec(chunk);
      if (text) title = clean(text[1]);
    }
    if (!title) continue;
    let cover = '';
    const image = IMG_DATA.exec(chunk);
    if (image) cover = fixURL(image[1]);
    seen.add(id);
    items.push({
      id: `ikanbot:${id}`,
      sourceId: id,
      source: 'ikanbot',
      title: title.slice(0, 200),
      cover,
      remark: '',
      category: kindName(categoryName),
      episodes: 0,
      tags: [],
      releaseStatus: 'unknown',
      description: '',
    });
    if (items.length > 500) break;
  }
  return items;
}

export function parseIkanbotSearchCards(body) {
  const items = [];
  const seen = new Set();
  MEDIA_BLOCK.lastIndex = 0;
  let block;
  while ((block = MEDIA_BLOCK.exec(body))) {
    const chunk = block[1].slice(0, 2000);
    const href = MEDIA_HREF.exec(chunk);
    if (!href) continue;
    const id = href[1];
    if (!numericID(id) || seen.has(id)) continue;
    let title = '';
    const text = TITLE_TEXT.exec(chunk);
    if (text) title = clean(text[1]);
    if (!title) {
      const alt = IMG_ALT.exec(chunk);
      if (alt) title = clean(alt[1]);
    }
    if (!title) continue;
    let cover = '';
    const image = IMG_DATA.exec(chunk);
    if (image) cover = fixURL(image[1]);
    let remark = '';
    const label = LINE_LABEL.exec(chunk);
    if (label) remark = clean(label[1]);
    let note = '';
    SMALL_TEXT.lastIndex = 0;
    let small;
    while ((small = SMALL_TEXT.exec(chunk))) {
      const value = clean(small[1]);
      if (value) {
        note = value.slice(0, 96);
        break;
      }
    }
    seen.add(id);
    items.push({
      id: `ikanbot:${id}`,
      sourceId: id,
      source: 'ikanbot',
      title: title.slice(0, 200),
      cover,
      remark: remark.slice(0, 64),
      category: '剧集',
      episodes: 0,
      tags: [],
      releaseStatus: 'unknown',
      description: note,
    });
    if (items.length > 100) break;
  }
  return items;
}

function pageCount(body, page, count) {
  let maxPage = page;
  PAGE_MAX.lastIndex = 0;
  let match;
  while ((match = PAGE_MAX.exec(body))) {
    const value = Number.parseInt(match[1], 10);
    if (Number.isFinite(value) && value > maxPage && value < 100000) maxPage = value;
  }
  if (maxPage > page) return maxPage;
  return count >= PAGE_SIZE ? page + 1 : page;
}

export async function ikanbotCatalog({ base, category = '', page = 1 }) {
  if (!validCategory(category)) throw new Error('爱看机器人内容分类无效');
  if (!category) category = IKB_CATEGORIES[0].id;
  const path =
    page > 1 ? `/hot/index-${category}-p-${page}.html` : `/hot/index-${category}.html`;
  const body = await ikbGet(path, base);
  const items = parseIkanbotCards(body, category);
  return { items, hasMore: page < pageCount(body, page, items.length), total: items.length };
}

export async function ikanbotSearch({ base, query, page = 1 }) {
  const keyword = String(query || '').trim();
  if (!keyword) throw new Error('爱看机器人搜索关键词无效');
  if (page > 1) return { items: [], hasMore: false, total: 0 };
  const body = await ikbGet('/search?' + new URLSearchParams({ q: keyword }).toString(), base);
  const items = parseIkanbotSearchCards(body);
  return { items, hasMore: false, total: items.length };
}

/** 把 "第01集$url#第02集$url" 拆成名称/地址对。 */
export function splitEpisodes(raw) {
  const pairs = [];
  for (const part of String(raw || '').split('#')) {
    const item = part.trim();
    if (!item) continue;
    const cut = item.indexOf('$');
    if (cut < 0) continue;
    const name = item.slice(0, cut).trim();
    let address = item.slice(cut + 1).trim();
    // 少数线路在地址后再挂 "$线路名" 标记，带着尾巴请求会 500
    const tail = address.indexOf('$');
    if (tail >= 0) address = address.slice(0, tail).trim();
    if (!address) continue;
    pairs.push([name, address]);
  }
  return pairs;
}

function fixMediaURL(raw) {
  let value = String(raw || '').trim();
  if (!value) return '';
  if (value.startsWith('//')) value = 'https:' + value;
  if (!/^https?:\/\//i.test(value)) return '';
  return isMediaURL(value) ? value : '';
}

/** 线路接口返回结构 → 按分集数降序的线路列表（同源去重）。 */
export function parseLines(payload) {
  const lines = [];
  const seen = new Set();
  for (const item of payload?.data?.list || []) {
    let entries;
    try {
      entries = JSON.parse(item.resData);
    } catch {
      continue;
    }
    if (!Array.isArray(entries)) continue;
    for (const entry of entries) {
      const episodes = [];
      const orders = new Set();
      let signature = '';
      const pairs = splitEpisodes(entry.url);
      pairs.forEach((pair, index) => {
        const address = fixMediaURL(pair[1]);
        if (!address) return;
        const name = clean(pair[0]);
        let order = index + 1;
        const number = EPISODE_NO.exec(name);
        if (number) {
          const parsed = Number.parseInt(number[1], 10);
          if (parsed > 0 && parsed <= 100000) order = parsed;
        }
        if (orders.has(order)) return;
        orders.add(order);
        episodes.push({ name, url: address, order });
        signature += address + '\n';
      });
      if (episodes.length === 0 || seen.has(signature)) continue;
      seen.add(signature);
      lines.push({ flag: String(entry.flag || '').trim(), episodes });
    }
  }
  lines.sort((left, right) => right.episodes.length - left.episodes.length);
  return lines.slice(0, MAX_LINES);
}

export function parsePlayPage(body, sourceId) {
  const meta = { currentId: sourceId, mtype: '1', token: '', title: '', cover: '', desc: '' };
  const title = VIDEO_TITLE.exec(body);
  if (title) meta.title = clean(title[1]);
  if (!meta.title) throw new Error('爱看机器人详情缺少视频名称');
  const cover = COVER_IMG.exec(body);
  if (cover) meta.cover = fixURL(cover[1]);
  if (!meta.cover) {
    const image = IMG_DATA.exec(body);
    if (image) meta.cover = fixURL(image[1]);
  }
  const currentId = CURRENT_ID.exec(body);
  if (currentId && currentId[1].trim()) meta.currentId = currentId[1].trim();
  const token = TOKEN.exec(body);
  if (token) meta.token = token[1].trim();
  const mtype = MTYPE.exec(body);
  if (mtype && mtype[1].trim()) meta.mtype = mtype[1].trim();
  if (!meta.currentId || !meta.token) throw new Error('爱看机器人缺少播放令牌，请刷新页面重试');

  const texts = [];
  META_TEXT.lastIndex = 0;
  let match;
  while ((match = META_TEXT.exec(body))) {
    const value = clean(match[1]);
    if (value) texts.push(value);
  }
  meta.desc = texts.join(' · ');
  return meta;
}

async function fetchLines(base, sourceId, meta) {
  const site = base || IKB_BASE;
  let currentId = sourceId;
  let token = '';
  let mtype = '1';
  if (meta) {
    currentId = meta.currentId || sourceId;
    token = meta.token || '';
    mtype = meta.mtype || '1';
  }
  if (!token) {
    const body = await ikbGet('/play/' + sourceId, site);
    const page = parsePlayPage(body, sourceId);
    currentId = page.currentId;
    token = page.token;
    mtype = page.mtype || '1';
  }
  const sign = ikanbotSign(currentId, token);
  if (!sign) throw new Error('爱看机器人播放令牌无效，请刷新详情');
  const address =
    `${site.replace(/\/+$/, '')}/api/getResN?videoId=${encodeURIComponent(currentId)}` +
    `&mtype=${encodeURIComponent(mtype || '1')}&token=${encodeURIComponent(sign)}`;
  const { text } = await fetchText(address, {
    ua: IKB_UA,
    referer: `${site.replace(/\/+$/, '')}/play/${sourceId}`,
    timeout: 20000,
  });
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new Error('爱看机器人线路返回无法解析');
  }
  if (payload.state !== 1) {
    throw new Error('爱看机器人线路获取失败：' + (String(payload.message || '').trim() || 'unauthorized'));
  }
  const lines = parseLines(payload);
  if (lines.length === 0) throw new Error('爱看机器人暂无可播放线路');
  return lines;
}

/** 带短缓存与单飞的线路入口（详情与播放共用）。 */
async function lines(sourceId, base, meta) {
  const key = `${base || IKB_BASE}|${sourceId}`;
  const cached = lineCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.lines;
  const pending = linePending.get(key);
  if (pending) return pending;
  const task = fetchLines(base, sourceId, meta)
    .then((lines) => {
      lineCache.set(key, { lines, expiresAt: Date.now() + LINE_TTL });
      if (lineCache.size > 64) {
        for (const staleKey of lineCache.keys()) {
          if (lineCache.size <= 32) break;
          lineCache.delete(staleKey);
        }
      }
      return lines;
    })
    .finally(() => linePending.delete(key));
  linePending.set(key, task);
  return task;
}

function lineEpisode(line, order) {
  for (const episode of line.episodes) {
    if (episode.order === order) return episode;
  }
  if (line.episodes.length === 1 && order === 1) return line.episodes[0];
  return null;
}

function lineQuality(flag) {
  const match = FLAG_RES.exec(String(flag || '').toLowerCase());
  if (!match) return 0;
  const value = Number.parseInt(match[1], 10);
  return value >= 480 && value <= 2160 ? value : 0;
}

export async function ikanbotDetail({ base, sourceId }) {
  if (!numericID(sourceId)) throw new Error('爱看机器人视频 ID 无效');
  const site = (base || IKB_BASE).replace(/\/+$/, '');
  const body = await ikbGet('/play/' + sourceId, base);
  const page = parsePlayPage(body, sourceId);
  const allLines = await lines(sourceId, base, page);
  const primary = allLines[0];

  const chapters = primary.episodes.map((episode, index) => {
    const order = episode.order >= 1 ? episode.order : index + 1;
    return {
      index: order,
      title: (episode.name || `第 ${order} 集`).slice(0, 128),
      pageUrl: `${site}/play/${sourceId}`,
      videoUrl: episode.url,
      referer: site + '/',
      routes: [],
      order,
    };
  });
  chapters.sort((left, right) => left.order - right.order);
  if (chapters.length === 0) throw new Error('爱看机器人暂无可播放分集');

  const drama = {
    id: `ikanbot:${sourceId}`,
    sourceId,
    source: 'ikanbot',
    title: page.title.slice(0, 200),
    cover: page.cover,
    remark: '',
    category: '影视',
    episodes: chapters.length,
    totalEpisode: chapters.length,
    description: page.desc.slice(0, 4000),
    tags: [],
    releaseStatus: 'unknown',
  };
  return { drama, episodes: chapters };
}

export async function ikanbotResolve({ base, chapter }) {
  const payload = String(chapter.chapterKey ?? chapter.index ?? '').trim();
  const referer = chapter.referer || (base || IKB_BASE) + '/';
  const order = Number.parseInt(payload, 10);
  const options = [];
  const seen = new Set();

  if (Number.isFinite(order) && order > 0) {
    const sourceId = String(chapter.sourceId || '').replace(/^ikanbot:/, '');
    const allLines = await lines(sourceId, base, null);
    for (const line of allLines) {
      const episode = lineEpisode(line, order);
      if (!episode || seen.has(episode.url)) continue;
      seen.add(episode.url);
      options.push({ url: episode.url, referer, quality: lineQuality(line.flag) });
    }
  }
  if (options.length === 0) {
    const direct = fixMediaURL(payload) || fixMediaURL(chapter.videoUrl);
    if (direct) options.push({ url: direct, referer });
  }
  if (options.length === 0) throw new Error('爱看机器人该集没有可用线路，请刷新详情');
  return { ...options[0], variants: options };
}

export function ikanbotCategories() {
  return [...IKB_CATEGORIES];
}

export function clearIkanbotCache() {
  lineCache.clear();
}
