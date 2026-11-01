// 直播源解析：移植 lib/live/live_parser.dart
//
// 支持三种形态：
//   1. M3U/TVBox 列表（#EXTM3U + #EXTINF tvg-* + 群组）
//   2. TXT 直播源（`#genre#分组` + `频道名,地址`，支持 #EXTVLCOPT / #EXTHTTP 指令）
//   3. JSON 面板（pingtai 接口：{"pingtai":[…]} / {"zhubo":[…]}）

const UNSORTED = '其他';
const DIRECTIVE = /^(ua|parse|click|header|format|origin|referer|forceKey|#EXTHTTP:|#EXTVLCOPT:|#KODIPROP:)/i;
const GENRE = /#genre#/i;
const M3U_HEADER = /#EXTM3U/i;
const META_PREFIXES = ['更新时间', '更新日期', 'update time', 'update date', 'last update'];

export function isPlayableLiveUrl(url) {
  const value = String(url || '').trim();
  if (!value) return false;
  return /^(https?|rtmp|rtsp|p3p|rtp|udp|mms):\/\//i.test(value) || value.startsWith('//');
}

function attribute(line, key) {
  const match = new RegExp(`${key}="(.*?)"`, 'i').exec(line);
  return match ? match[1].trim() : '';
}

function afterComma(line) {
  const index = line.lastIndexOf(',');
  return index < 0 ? '' : line.slice(index + 1).trim();
}

function isMetaChannel(name) {
  const text = String(name || '').trim().toLowerCase();
  if (!text) return false;
  return META_PREFIXES.some((prefix) => text.startsWith(prefix));
}

class GroupBuilder {
  constructor(name) {
    this.name = name;
    this.channels = new Map();
  }

  channel(name) {
    if (!this.channels.has(name)) {
      this.channels.set(name, { name, group: this.name, urls: [], headers: {}, logo: '', number: '' });
    }
    return this.channels.get(name);
  }

  get isEmpty() {
    return this.channels.size === 0;
  }
}

function finalize(groups, source) {
  return groups
    .filter((group) => !group.isEmpty)
    .map((group) => {
      const channels = [...group.channels.values()].map((channel, index) => ({
        key: `${source}\u0000${group.name}\u0000${channel.name}`,
        name: channel.name,
        urls: [...new Set(channel.urls.filter(isPlayableLiveUrl))],
        number: channel.number || String(index + 1).padStart(3, '0'),
        headers: channel.headers,
        logo: channel.logo,
        group: group.name,
        source,
      })).filter((channel) => channel.urls.length > 0);
      return { name: group.name, channels };
    })
    .filter((group) => group.channels.length > 0);
}

function parseText(text, source, defaultGroup) {
  const groups = [];
  const byName = new Map();
  let current = null;
  let headers = {};
  const groupFor = (name) => {
    const key = name || defaultGroup;
    if (!byName.has(key)) {
      const builder = new GroupBuilder(key);
      byName.set(key, builder);
      groups.push(builder);
    }
    return byName.get(key);
  };

  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line) continue;

    if (DIRECTIVE.test(line)) {
      const http = /#EXTHTTP:(.+)$/i.exec(line);
      if (http) {
        try {
          headers = { ...headers, ...JSON.parse(http[1].trim()) };
        } catch {
          /* 忽略非法头 */
        }
      }
      const ua = /^(?:ua|#EXTVLCOPT:http-user-agent)\s*[=:]\s*(.+)$/i.exec(line);
      if (ua) headers = { ...headers, 'User-Agent': ua[1].trim() };
      const referer = /^(?:referer|#EXTVLCOPT:http-referrer)\s*[=:]\s*(.+)$/i.exec(line);
      if (referer) headers = { ...headers, Referer: referer[1].trim() };
      continue;
    }

    if (GENRE.test(line)) {
      const name = line.replace(GENRE, '').replace(/^[,\s]+/, '').trim();
      current = groupFor(name);
      headers = {};
      continue;
    }

    let name = '';
    let address = '';
    if (line.includes(',')) {
      const index = line.indexOf(',');
      name = line.slice(0, index).trim();
      address = line.slice(index + 1).trim();
    } else if (isPlayableLiveUrl(line)) {
      name = afterComma(line) || line;
      address = line;
    }
    if (!name || !address || !isPlayableLiveUrl(address)) continue;
    if (isMetaChannel(name)) continue;
    if (!current) current = groupFor(defaultGroup);
    const channel = current.channel(name);
    channel.urls.push(address);
    if (Object.keys(headers).length) channel.headers = { ...channel.headers, ...headers };
  }
  return finalize(groups, source);
}

function parseM3U(text, source, defaultGroup) {
  const groups = [];
  const byName = new Map();
  const groupFor = (name) => {
    const key = name || defaultGroup;
    if (!byName.has(key)) {
      byName.set(key, new GroupBuilder(key));
      groups.push(byName.get(key));
    }
    return byName.get(key);
  };

  let info = null;
  let pendingHeaders = {};
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    if (/^#EXTINF/i.test(line)) {
      info = {
        name: afterComma(line) || line,
        group: attribute(line, 'group-title') || attribute(line, 'tvg-group') || defaultGroup,
        logo: attribute(line, 'tvg-logo'),
        tvgId: attribute(line, 'tvg-id'),
      };
      continue;
    }
    if (/^#EXTGRP:/i.test(line)) {
      if (info) info.group = line.slice('#EXTGRP:'.length).trim() || info.group;
      continue;
    }
    if (/^#EXTHTTP:/i.test(line)) {
      try {
        pendingHeaders = { ...pendingHeaders, ...JSON.parse(line.slice('#EXTHTTP:'.length).trim()) };
      } catch {
        /* 忽略 */
      }
      continue;
    }
    if (/^#EXTVLCOPT:/i.test(line)) {
      const ua = /http-user-agent=(.+)$/i.exec(line);
      if (ua) pendingHeaders = { ...pendingHeaders, 'User-Agent': ua[1].trim() };
      const referer = /http-referrer=(.+)$/i.exec(line);
      if (referer) pendingHeaders = { ...pendingHeaders, Referer: referer[1].trim() };
      continue;
    }
    if (line.startsWith('#')) continue;
    if (!info || !isPlayableLiveUrl(line)) {
      info = null;
      continue;
    }
    if (isMetaChannel(info.name)) {
      info = null;
      pendingHeaders = {};
      continue;
    }
    const channel = groupFor(info.group).channel(info.name);
    channel.urls.push(line);
    if (info.logo) channel.logo = info.logo;
    if (Object.keys(pendingHeaders).length) {
      channel.headers = { ...channel.headers, ...pendingHeaders };
    }
    info = null;
    pendingHeaders = {};
  }
  return finalize(groups, source);
}

function parseJSON(text, source, defaultGroup) {
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    return null;
  }
  const rows = Array.isArray(payload)
    ? payload
    : payload.channels || payload.list || payload.data || payload.zhubo;
  if (!Array.isArray(rows)) return null;

  const groups = [];
  const byName = new Map();
  const groupFor = (name) => {
    const key = name || defaultGroup;
    if (!byName.has(key)) {
      byName.set(key, new GroupBuilder(key));
      groups.push(byName.get(key));
    }
    return byName.get(key);
  };

  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const name = String(row.name || row.title || '').trim();
    const group = String(row.group || row.group_title || row.category || defaultGroup).trim();
    const urls = []
      .concat(Array.isArray(row.urls) ? row.urls : [])
      .concat([row.url, row.address, row.playUrl])
      .map((item) => String(item || '').trim())
      .filter(isPlayableLiveUrl);
    if (!name || !urls.length) continue;
    const channel = groupFor(group).channel(name);
    channel.urls.push(...urls);
    const logo = String(row.logo || row.img || row.icon || '').trim();
    if (logo) channel.logo = logo;
  }
  return finalize(groups, source);
}

/**
 * 解析直播源文本。
 * @returns {{groups: Array, format: string, count: number}}
 */
export function parseLive(text, { source = 'live', defaultGroup = UNSORTED } = {}) {
  const raw = String(text || '');
  if (!raw.trim()) return { groups: [], format: 'text', count: 0 };
  const normalized = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const head = normalized.trimStart();

  if (head.startsWith('[') || head.startsWith('{')) {
    const json = parseJSON(normalized, source, defaultGroup);
    if (json && json.length) {
      return { groups: json, format: 'json', count: countChannels(json) };
    }
  }
  if (!GENRE.test(normalized) && M3U_HEADER.test(normalized)) {
    const groups = parseM3U(normalized, source, defaultGroup);
    return { groups, format: 'm3u', count: countChannels(groups) };
  }
  const groups = parseText(normalized, source, defaultGroup);
  return { groups, format: 'text', count: countChannels(groups) };
}

function countChannels(groups) {
  return groups.reduce((total, group) => total + group.channels.length, 0);
}

export { UNSORTED };
