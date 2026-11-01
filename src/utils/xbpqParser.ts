// Complete XBPQ (小白爬虫 / TVBox csp_xBPQ) Rule Engine & Parser
// Ported from guoappxp / TVBox XBPQ specifications for universal web compatibility

export interface XbpqRule {
  name: string;
  url: string;
  headers?: Record<string, string>;
  class_name?: string;
  class_url?: string;
  class_parse?: string;
  cate_exclude?: string;
  shouye?: string | number;
  fenye?: string;
  list?: string;
  title?: string;
  pic?: string;
  desc?: string;
  link?: string;
  content?: string;
  tabs?: string;
  lists?: string;
  dt_url?: string;
  dt_title?: string;
  search_url?: string;
  search_list?: string;
  search_title?: string;
  search_pic?: string;
  search_link?: string;
  play_parse?: string | number | boolean;
  play_json?: string | number | boolean;
  [key: string]: any;
}

export interface ParsedItem {
  id: string;
  title: string;
  cover: string;
  desc: string;
  link: string;
  episodes?: number;
  source?: string;
  vip?: boolean;
}

export interface ParsedCategory {
  id: string;
  name: string;
}

export interface ParsedEpisode {
  number: number;
  title: string;
  url: string;
}

export interface ParsedDetail {
  title: string;
  cover: string;
  desc: string;
  releaseStatus?: string;
  tabs: string[];
  episodes: ParsedEpisode[];
  routes?: string[];
}

// Public CORS Proxies to bypass browser origin limits when scraping remote XBPQ sites
const CORS_PROXIES = [
  (url: string) => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
  (url: string) => `https://corsproxy.io/?${encodeURIComponent(url)}`,
];

/**
 * Universal safe fetch for XBPQ: Tries direct fetch first, then CORS proxies
 */
export async function safeFetchHtml(
  targetUrl: string,
  headers?: Record<string, string>,
  timeoutMs: number = 8000
): Promise<string> {
  const reqHeaders: Record<string, string> = {
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    ...(headers || {}),
  };

  // Try direct fetch first
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const resp = await fetch(targetUrl, {
      method: 'GET',
      headers: reqHeaders,
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (resp.ok) {
      return await resp.text();
    }
  } catch (directErr) {
    // CORS or network failure, proceed to proxy
  }

  // Fallback to CORS proxies
  for (const proxyGen of CORS_PROXIES) {
    try {
      const proxyUrl = proxyGen(targetUrl);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      const resp = await fetch(proxyUrl, {
        method: 'GET',
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (resp.ok) {
        return await resp.text();
      }
    } catch (proxyErr) {
      // Try next proxy
    }
  }

  throw new Error(`无法获取目标网页内容（可能受源站防盗链或 CORS 限制）：${targetUrl}`);
}

/**
 * Automatically convert GitHub blob URLs to raw GitHubusercontent URLs
 */
export function normalizeGitHubUrl(url: string): string {
  if (!url) return '';
  const trimmed = url.trim();
  try {
    const parsed = new URL(trimmed);
    if (parsed.hostname === 'github.com' && parsed.pathname.includes('/blob/')) {
      const parts = parsed.pathname.split('/');
      if (parts.length >= 5 && parts[3] === 'blob') {
        parts[3] = '';
        const rawPath = parts.filter(Boolean).join('/');
        return `https://raw.githubusercontent.com/${rawPath}`;
      }
    }
  } catch (e) {}
  return trimmed;
}

/**
 * TVBox xBPQ Substring Extractor: extracts text between left and right markers
 */
export function extractByXbpqSubstring(
  html: string,
  ruleStr: string,
  baseUrl: string = ''
): string {
  if (!html || !ruleStr) return '';
  const clean = ruleStr.trim();

  let left = '';
  let right = '';

  if (clean.includes('&&')) {
    const parts = clean.split('&&');
    left = parts[0];
    right = parts[1] || '';
  } else {
    left = clean;
  }

  let sIdx = 0;
  if (left) {
    sIdx = html.indexOf(left);
    if (sIdx === -1) return '';
    sIdx += left.length;
  }

  let eIdx = html.length;
  if (right) {
    eIdx = html.indexOf(right, sIdx);
    if (eIdx === -1) {
      if (right === '"' || right === "'") {
        eIdx = html.indexOf('"', sIdx);
        if (eIdx === -1) eIdx = html.indexOf("'", sIdx);
      }
      if (eIdx === -1) eIdx = html.length;
    }
  } else {
    const nextSpace = html.indexOf(' ', sIdx);
    const nextQuote = html.indexOf('"', sIdx);
    const nextTag = html.indexOf('<', sIdx);
    const candidates = [nextSpace, nextQuote, nextTag].filter((n) => n !== -1);
    if (candidates.length > 0) {
      eIdx = Math.min(...candidates);
    }
  }

  let val = html.substring(sIdx, eIdx).trim();
  val = val.replace(/<[^>]+>/g, '').trim();
  val = val
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');

  if (
    clean.includes('data-original') ||
    clean.includes('src') ||
    clean.includes('href') ||
    clean.includes('http') ||
    val.startsWith('//') ||
    val.startsWith('/')
  ) {
    if (val.startsWith('//')) {
      val = 'https:' + val;
    } else if (val.startsWith('/') && baseUrl) {
      try {
        val = new URL(val, baseUrl).href;
      } catch (e) {}
    }
  }

  return val;
}

/**
 * Format pagination URL replacing template placeholders
 * Supports: {cateId}, [cateId], fyclass, {catePg}, [catePg], fypage
 */
export function formatXbpqPageUrl(
  rule: XbpqRule,
  cateId: string,
  page: number
): string {
  let template = rule.fenye || rule['分类url'] || `${rule.url}/show/{cateId}--------{catePg}---.html`;
  template = template
    .replace(/\{cateId\}|\[cateId\]|fyclass/g, cateId || '1')
    .replace(/\{catePg\}|\[catePg\]|fypage/g, String(page));

  if (!template.startsWith('http') && rule.url) {
    try {
      template = new URL(template, rule.url).href;
    } catch (e) {}
  }
  return template;
}

/**
 * Format search URL
 */
export function formatXbpqSearchUrl(
  rule: XbpqRule,
  keyword: string,
  page: number = 1
): string {
  let template = rule.search_url || rule['搜索url'] || `${rule.url}/index.php/vod/search.html?wd={wd}&page={pg}`;
  template = template
    .replace(/\{wd\}|\[wd\]|\*\*/g, encodeURIComponent(keyword))
    .replace(/\{pg\}|\[pg\]|fypage/g, String(page));

  if (!template.startsWith('http') && rule.url) {
    try {
      template = new URL(template, rule.url).href;
    } catch (e) {}
  }
  return template;
}

/**
 * Parse Category list from XBPQ rule (supports guoappxp Chinese keys)
 */
export function parseXbpqCategories(rule: XbpqRule, html?: string): ParsedCategory[] {
  const result: ParsedCategory[] = [{ id: '', name: '全部' }];

  const rawFenlei = rule.class_name || rule['分类'];
  const rawFenleiUrl = rule.fenye || rule['分类url'] || rule.class_url;

  if (rawFenlei) {
    // Format 1: "电影$1#电视剧$2#综艺$3"
    if (typeof rawFenlei === 'string' && rawFenlei.includes('#') && rawFenlei.includes('$')) {
      const pairs = rawFenlei.split('#');
      for (const pair of pairs) {
        const [name, id] = pair.split('$');
        if (name && id) {
          result.push({ id: id.trim(), name: name.trim() });
        }
      }
      return result;
    }

    // Format 2: "都市&战神&甜宠"
    const names = rawFenlei.split('&');
    const urls = rawFenleiUrl ? String(rawFenleiUrl).split('&') : [];
    const excludes = (rule.cate_exclude || '').split('&');

    for (let i = 0; i < names.length; i++) {
      const name = names[i].trim();
      const id = (urls[i] || `${i + 1}`).trim();
      if (name && !excludes.includes(name)) {
        result.push({ id, name });
      }
    }
    return result;
  }

  return result;
}

/**
 * Parse Drama Catalog from HTML using TVBox xBPQ substring extraction
 */
export function parseXbpqList(html: string, rule: XbpqRule): ParsedItem[] {
  if (!html) return [];
  const items: ParsedItem[] = [];

  // Check if JSON API
  if (html.trim().startsWith('{') || html.trim().startsWith('[')) {
    try {
      const json = JSON.parse(html);
      const list = json.list || json.data || json;
      if (Array.isArray(list)) {
        return list.map((item, idx) => ({
          id: String(item.vod_id || item.id || idx + 1),
          title: item.vod_name || item.title || `短剧 ${idx + 1}`,
          cover: item.vod_pic || item.pic || item.cover || '',
          desc: item.vod_remarks || item.desc || item.note || '',
          link: item.link || '',
          episodes: item.episodes || 80,
          source: rule.name,
        }));
      }
    } catch (e) {}
  }

  const listRule = rule.数组 || rule.list || '';
  if (!listRule) return [];

  let left = '';
  let right = '';
  if (listRule.includes('&&')) {
    const parts = listRule.split('&&');
    left = parts[0];
    right = parts[1] || '';
  } else {
    left = listRule;
  }

  if (!left) return [];

  let pos = 0;
  let count = 0;
  while (pos < html.length && count < 150) {
    const sIdx = html.indexOf(left, pos);
    if (sIdx === -1) break;
    const contentStart = sIdx + left.length;

    let eIdx = html.length;
    if (right) {
      eIdx = html.indexOf(right, contentStart);
      if (eIdx === -1) eIdx = html.length;
    } else {
      eIdx = contentStart + 1000;
    }

    const itemHtml = html.substring(contentStart, eIdx);
    pos = eIdx;
    count++;

    const titleRule = rule.标题 || rule.title || 'title="&&"';
    const picRule = rule.列表图片 || rule.图片 || rule.pic || 'data-original="&&"';
    const linkRule = rule.链接 || rule.link || 'href="&&"';
    const descRule = rule.简介 || rule.副标题 || rule.desc || '';

    const title = extractByXbpqSubstring(itemHtml, titleRule, rule.url) || `短剧 ${count}`;
    const cover = extractByXbpqSubstring(itemHtml, picRule, rule.url) || '';
    const link = extractByXbpqSubstring(itemHtml, linkRule, rule.url) || '';
    const desc = descRule ? extractByXbpqSubstring(itemHtml, descRule, rule.url) : '';

    if (title || link) {
      const id = link ? link.replace(/[^a-zA-Z0-9_-]/g, '_') : `xbpq_${count}`;
      items.push({
        id,
        title,
        cover,
        desc,
        link,
        source: rule.name,
      });
    }
  }

  return items;
}

/**
 * Parse Drama Details & Episode List from HTML using xBPQ rules
 */
export function parseXbpqDetail(html: string, rule: XbpqRule): ParsedDetail {
  const result: ParsedDetail = {
    title: '',
    cover: '',
    desc: '',
    tabs: ['线路 1'],
    episodes: [],
    routes: ['线路 1'],
  };

  try {
    const titleRule = rule.标题 || rule.title || '<h1>&&</h1>';
    const picRule = rule.列表图片 || rule.图片 || rule.pic || 'img src="&&"';
    const contentRule = rule.简介 || rule.内容 || rule.desc || 'content="&&"';

    result.title = extractByXbpqSubstring(html, titleRule, rule.url) || '短剧详情';
    result.cover = extractByXbpqSubstring(html, picRule, rule.url) || '';
    result.desc = extractByXbpqSubstring(html, contentRule, rule.url) || '暂无剧情简介';

    // Parse playlist episodes using 播放数组 / 播放列表 / 播放链接 / 播放标题
    const playlistRule = rule.播放数组 || rule.播放列表 || rule.lists || '<ul class="stui-content__playlist&&</ul>';
    let playlistHtml = html;
    if (playlistRule.includes('&&')) {
      playlistHtml = extractByXbpqSubstring(html, playlistRule, rule.url) || html;
    }

    const itemRule = rule.播放链接 || rule.dt_url || 'href="&&"';
    const titleItemRule = rule.播放标题 || rule.dt_title || '>&&</a>';

    // Extract all playlist episode links and titles
    let pos = 0;
    let count = 0;
    while (pos < playlistHtml.length && count < 200) {
      // Find href or link pattern
      const link = extractByXbpqSubstring(playlistHtml.substring(pos), itemRule, rule.url);
      const epTitle = extractByXbpqSubstring(playlistHtml.substring(pos), titleItemRule, rule.url) || `第${count + 1}集`;

      if (link) {
        result.episodes.push({
          number: count + 1,
          title: epTitle,
          url: link,
        });
        count++;
        pos += Math.max(10, playlistHtml.substring(pos).indexOf(link) + link.length);
      } else {
        break;
      }
    }

    if (result.episodes.length === 0) {
      for (let i = 1; i <= 60; i++) {
        result.episodes.push({
          number: i,
          title: `第${i}集`,
          url: '',
        });
      }
    }
  } catch (err) {
    console.warn('XBPQ Detail Parse Error:', err);
  }

  return result;
}

/**
 * Parse Search Results using xBPQ rules
 */
export function parseXbpqSearch(html: string, rule: XbpqRule): ParsedItem[] {
  if (!html) return [];
  const searchListRule = rule.搜索数组 || rule.search_list || rule.数组 || rule.list || '';
  return parseXbpqList(html, {
    ...rule,
    数组: searchListRule,
    list: searchListRule,
  });
}

/**
 * Normalize guoappxp Chinese rule keys to standard XbpqRule format
 */
export function normalizeGuoappxpRule(raw: any): XbpqRule {
  if (!raw) return {} as XbpqRule;
  const rule = { ...raw };

  if (rule['主页url'] && !rule.url) rule.url = rule['主页url'];
  if (rule['分类'] && !rule.class_name) {
    const fenlei = rule['分类'];
    if (typeof fenlei === 'string' && (fenlei.includes('#') || fenlei.includes('$'))) {
      rule.class_name = fenlei;
    } else {
      rule.class_name = fenlei;
    }
  }
  if (rule['分类url'] && !rule.fenye) rule.fenye = rule['分类url'];
  if (rule['数组'] && !rule.list) rule.list = rule['数组'];
  if (rule['标题'] && !rule.title) rule.title = rule['标题'];
  if (rule['图片'] && !rule.pic) rule.pic = rule['图片'];
  if (rule['列表图片'] && !rule.pic) rule.pic = rule['列表图片'];
  if (rule['简介'] && !rule.desc) rule.desc = rule['简介'];
  if (rule['副标题'] && !rule.desc) rule.desc = rule['副标题'];
  if (rule['链接'] && !rule.link) rule.link = rule['链接'];
  if (rule['搜索url'] && !rule.search_url) rule.search_url = rule['搜索url'];
  if (rule['搜索数组'] && !rule.search_list) rule.search_list = rule['搜索数组'];
  if (rule['播放数组'] && !rule.lists) rule.lists = rule['播放数组'];
  if (rule['播放列表'] && !rule.lists) rule.lists = rule['播放列表'];
  if (rule['播放标题'] && !rule.dt_title) rule.dt_title = rule['播放标题'];
  if (rule['播放链接'] && !rule.dt_url) rule.dt_url = rule['播放链接'];

  return rule;
}

/**
 * Universal XBPQ Templates
 */
export const SAMPLE_XBPQ_TEMPLATES: XbpqRule[] = [
  {
    name: '短剧天堂 (XBPQ)',
    url: 'https://www.duanjutv.cc',
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    },
    class_name: '都市热播&战神逆袭&豪门甜宠&穿越古装&悬疑灵异',
    class_url: 'dushi&zhanshen&haomen&chuanyue&xuanyi',
    fenye: 'https://www.duanjutv.cc/show/{cateId}--------{catePg}---.html',
    list: 'div.module-item',
    title: 'div.module-item-title&&Text',
    pic: 'img.lazyloaded&&data-src||img&&src',
    desc: 'div.module-item-note&&Text',
    link: 'a&&href',
    search_url: 'https://www.duanjutv.cc/search?wd={wd}&page={pg}',
    play_parse: '1',
  },
];
