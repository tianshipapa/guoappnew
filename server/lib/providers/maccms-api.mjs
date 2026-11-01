// 自定义 MacCMS 接口源（kind: json / xml）：移植 provider_duanju_maccms.go 的接口链路。
//
//   GET {base}?ac=list&t={分类}&pg={页}   目录（也接受 ac=videolist / ac=detail）
//   GET {base}?ac=detail&ids={id}        详情（vod_play_url / vod_play_from）
//   GET {base}?ac=detail&wd={关键词}      搜索
//
// base 通常形如 https://site.com/api.php/provide/vod/ —— 缺省时自动补全。

import { fetchText } from '../http.mjs';
import { cleanText } from '../html.mjs';
import { maccmsPlayerURL, normalizePlaybackURL } from '../maccms.mjs';

function apiURL(base, params) {
  let root = String(base || '').trim();
  if (!root) return '';
  if (!/^https?/i.test(root)) root = 'https://' + root;
  if (!/\?/.test(root)) {
    if (!/\/provide\/vod\/?$/.test(root) && !/api\.php/.test(root)) {
      root = root.replace(/\/+$/, '') + '/api.php/provide/vod/';
    }
  }
  const url = new URL(root);
  for (const [key, value] of Object.entries(params)) {
    if (value == null || value === '') continue;
    url.searchParams.set(key, String(value));
  }
  return url.toString();
}

async function getJSON(base, params) {
  const address = apiURL(base, params);
  if (!address) throw new Error('自定义源接口地址为空');
  const { text } = await fetchText(address, { timeout: 20000 });
  const trimmed = text.trim();
  if (!trimmed) throw new Error('接口返回空内容');
  try {
    return JSON.parse(trimmed);
  } catch {
    // 部分接口在 JSON 外套一层 JSONP / XML
    const start = trimmed.search(/[[{]/);
    if (start > 0) {
      try {
        return JSON.parse(trimmed.slice(start));
      } catch {
        /* 落到下面报错 */
      }
    }
    const xml = parseXMLList(trimmed);
    if (xml) return xml;
    throw new Error('接口返回无法解析（非 JSON/XML）');
  }
}

function pickText(node, keys) {
  for (const key of keys) {
    const value = node?.[key];
    if (value != null && String(value).trim() !== '') return String(value).trim();
  }
  return '';
}

function normalizeRow(row) {
  return {
    id: pickText(row, ['vod_id', 'id', 'vid']),
    name: pickText(row, ['vod_name', 'name', 'title']),
    pic: pickText(row, ['vod_pic', 'pic', 'vod_pic_thumb', 'cover']),
    remark: pickText(row, ['vod_remarks', 'remarks', 'note', 'vod_duration']),
    typeName: pickText(row, ['type_name', 'typeName', 'class']),
    content: pickText(row, ['vod_content', 'content', 'vod_blurb', 'blurb']),
    year: pickText(row, ['vod_year', 'year']),
    playFrom: pickText(row, ['vod_play_from']),
    playURL: pickText(row, ['vod_play_url']),
    episodes: pickText(row, ['vod_total', 'vod_serial', 'total']),
  };
}

function rowsOf(payload) {
  if (Array.isArray(payload)) return payload;
  for (const key of ['list', 'data', 'result', 'rows']) {
    if (Array.isArray(payload?.[key])) return payload[key];
  }
  if (payload?.data && typeof payload.data === 'object') return rowsOf(payload.data);
  return [];
}

/** 极简 XML 解析：MacCMS 的 XML 接口层级很浅，取 <video> 字段即可。 */
function parseXMLList(text) {
  const videos = [...text.matchAll(/<video>([\s\S]*?)<\/video>/gi)];
  if (!videos.length) return null;
  const list = videos.map((entry) => {
    const fields = {};
    for (const match of entry[1].matchAll(/<(\w+)>([\s\S]*?)<\/\1>/g)) {
      fields[match[1]] = match[2]
        .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
        .trim();
    }
    return fields;
  });
  const pageCount = /<pagecount>(\d+)<\/pagecount>/i.exec(text);
  return { list, pagecount: pageCount ? Number.parseInt(pageCount[1], 10) : 1, xml: true };
}

function remarkToCount(remark) {
  if (!remark) return 0;
  const match = /(\d{1,4})\s*[集话期]|更新至\s*(\d{1,4})|全\s*(\d{1,4})\s*集/.exec(remark);
  if (!match) return 0;
  const value = Number.parseInt(match[1] || match[2] || match[3], 10);
  return Number.isFinite(value) ? value : 0;
}

function toDrama(source, row, categoryName) {
  return {
    id: `${source}:${row.id}`,
    sourceId: row.id,
    source,
    title: row.name.slice(0, 200),
    cover: /^https?:\/\//i.test(row.pic) || row.pic.startsWith('//') ? (row.pic.startsWith('//') ? 'https:' + row.pic : row.pic) : row.pic,
    remark: row.remark.slice(0, 64),
    category: categoryName || row.typeName,
    episodes: remarkToCount(row.remark) || Number.parseInt(row.episodes, 10) || 0,
    description: cleanText(row.content).slice(0, 2000),
    tags: [],
    releaseStatus: 'unknown',
  };
}

export async function maccmsCatalog({ base, source, category = '', page = 1 }) {
  const payload = await getJSON(base, { ac: 'list', t: category, pg: page });
  const rows = rowsOf(payload);
  if (!rows.length) {
    // 有些接口只认 videolist
    const second = await getJSON(base, { ac: 'videolist', t: category, pg: page });
    const more = rowsOf(second);
    if (more.length) {
      return finishCatalog(source, more, second, category, page);
    }
    return { items: [], hasMore: false, total: 0 };
  }
  return finishCatalog(source, rows, payload, category, page);
}

function finishCatalog(source, rows, payload, categoryName, page) {
  const items = rows
    .map((row) => normalizeRow(row))
    .filter((row) => row.id && row.name)
    .map((row) => toDrama(source, row, categoryName));
  const pageCount = Number.parseInt(payload?.pagecount ?? payload?.page ?? 0, 10);
  return {
    items,
    hasMore: pageCount > page || items.length >= 20,
    total: Number.parseInt(payload?.total ?? 0, 10) || items.length,
  };
}

export async function maccmsSearch({ base, source, query, page = 1 }) {
  const payload = await getJSON(base, { ac: 'detail', wd: query, pg: page });
  let rows = rowsOf(payload);
  if (!rows.length) {
    const second = await getJSON(base, { ac: 'videolist', wd: query, pg: page });
    rows = rowsOf(second);
    if (rows.length) return finishCatalog(source, rows, second, '搜索', page);
  }
  return finishCatalog(source, rows, payload, '搜索', page);
}

export async function maccmsCategories({ base }) {
  try {
    const payload = await getJSON(base, { ac: 'list' });
    const classes = payload?.class || [];
    if (Array.isArray(classes) && classes.length) {
      return classes
        .map((entry) => ({
          id: String(entry.type_id ?? entry.id ?? ''),
          name: String(entry.type_name ?? entry.name ?? ''),
        }))
        .filter((entry) => entry.id && entry.name);
    }
  } catch {
    /* 分类拿不到时返回空，前端用默认分类 */
  }
  return [];
}

/** 解析 vod_play_url（`第1集$url#第2集$url$$$线路2…`）+ vod_play_from。 */
export function parsePlayGroups(playURL, playFrom) {
  const froms = String(playFrom || '')
    .split('$$$')
    .map((item) => item.trim())
    .filter(Boolean);
  const groups = [];
  String(playURL || '')
    .split('$$$')
    .forEach((group, groupIndex) => {
      const episodes = [];
      for (const rawItem of group.split('#')) {
        const item = rawItem.trim();
        if (!item) continue;
        const cut = item.indexOf('$');
        const name = cut >= 0 ? item.slice(0, cut).trim() : item;
        const address = cut >= 0 ? item.slice(cut + 1).trim() : '';
        if (!address) continue;
        episodes.push({ title: cleanText(name) || `第${episodes.length + 1}集`, url: address });
      }
      if (episodes.length) {
        groups.push({ name: froms[groupIndex] || `线路${groupIndex + 1}`, episodes });
      }
    });
  return groups;
}

export async function maccmsDetail({ base, source, sourceId }) {
  const payload = await getJSON(base, { ac: 'detail', ids: sourceId });
  const rows = rowsOf(payload).map(normalizeRow).filter((row) => row.id);
  const row = rows[0];
  if (!row) throw new Error('接口未返回该影片详情');

  const groups = parsePlayGroups(row.playURL, row.playFrom);
  if (!groups.length) throw new Error('接口未返回可播放分集');

  const episodes = [];
  const main = groups[0];
  main.episodes.forEach((entry, index) => {
    episodes.push({
      index: index + 1,
      title: entry.title.slice(0, 128),
      pageUrl: '',
      videoUrl: normalizePlaybackURL(entry.url),
      referer: base + '/',
      routes: groups.slice(1).map((group) => group.episodes[index]?.url).filter(Boolean),
    });
  });

  const drama = toDrama(source, row, row.typeName);
  drama.episodes = episodes.length;
  drama.totalEpisode = episodes.length;
  return { drama, episodes };
}

export async function maccmsResolve({ chapter, name = '线路' }) {
  const address = normalizePlaybackURL(chapter.videoUrl);
  if (!address) throw new Error(`${name}播放地址为空`);
  const variants = [
    { url: address, referer: chapter.referer || '' },
    ...(chapter.routes || [])
      .map((route) => normalizePlaybackURL(route))
      .filter((route) => route && route !== address)
      .map((route) => ({ url: route, referer: chapter.referer || '' })),
  ];
  return { ...variants[0], variants };
}

export { maccmsPlayerURL };
