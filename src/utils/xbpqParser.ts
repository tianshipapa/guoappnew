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
 * e.g. https://github.com/user/repo/blob/main/path/file.json -> https://raw.githubusercontent.com/user/repo/main/path/file.json
 */
export function normalizeGitHubUrl(url: string): string {
  if (!url) return '';
  const trimmed = url.trim();
  try {
    const parsed = new URL(trimmed);
    if (parsed.hostname === 'github.com' && parsed.pathname.includes('/blob/')) {
      const parts = parsed.pathname.split('/');
      // /user/repo/blob/main/path/file.json -> ['', user, repo, 'blob', branch, ...path]
      if (parts.length >= 5 && parts[3] === 'blob') {
        parts[3] = ''; // remove blob
        const rawPath = parts.filter(Boolean).join('/');
        return `https://raw.githubusercontent.com/${rawPath}`;
      }
    }
  } catch (e) {}
  return trimmed;
}

/**
 * Parse JSONPath or dot notation: e.g. "data.list" or "title"
 */
function extractByJsonPath(obj: any, path: string): any {
  if (!obj || !path) return '';
  const clean = path.replace(/^json:/, '').replace(/^\$\./, '').trim();
  const parts = clean.split('.');
  let curr = obj;
  for (const part of parts) {
    if (curr == null) return '';
    curr = curr[part];
  }
  return curr != null ? String(curr) : '';
}

/**
 * Core XBPQ token extractor with support for:
 * 1. || (fallback alternatives)
 * 2. $$ (boundary substring: start$$end)
 * 3. && (chaining: selector&&sub-selector&&attr)
 * 4. @ (attribute syntax: img@src, a@href)
 * 5. regex: (regex pattern)
 * 6. json: (json path)
 */
export function extractByXbpqRule(
  context: Element | Document | any,
  ruleStr: string,
  baseUrl: string = ''
): string {
  if (!context || !ruleStr) return '';
  const cleanRule = ruleStr.trim();

  // Support || (fallback alternatives): e.g. "img&&data-original||img&&src"
  if (cleanRule.includes('||')) {
    const branches = cleanRule.split('||');
    for (const branch of branches) {
      const val = extractByXbpqRule(context, branch.trim(), baseUrl);
      if (val) return val;
    }
    return '';
  }

  // JSON mode
  if (cleanRule.startsWith('json:') || cleanRule.startsWith('$.')) {
    return extractByJsonPath(context, cleanRule);
  }

  // Regex mode: regex:pattern
  if (cleanRule.startsWith('regex:')) {
    const pattern = cleanRule.replace(/^regex:/, '').trim();
    const text = context instanceof Element ? context.outerHTML : String(context);
    const m = new RegExp(pattern).exec(text);
    return m ? m[1] || m[0] : '';
  }

  // $$ delimiter mode: start$$end
  if (cleanRule.includes('$$')) {
    const [start, end] = cleanRule.split('$$');
    const text = context instanceof Element
      ? context.outerHTML
      : (context as Document)?.body?.innerHTML || String(context);
    const sIdx = text.indexOf(start);
    if (sIdx !== -1) {
      const sub = text.substring(sIdx + start.length);
      const eIdx = sub.indexOf(end);
      return eIdx !== -1 ? sub.substring(0, eIdx).trim() : sub.trim();
    }
    return '';
  }

  // Convert @ syntax to &&: e.g. "img@data-src" -> "img&&data-src"
  let ruleNorm = cleanRule;
  if (ruleNorm.includes('@') && !ruleNorm.includes('&&')) {
    const [sel, attr] = ruleNorm.split('@');
    ruleNorm = `${sel.trim()}&&${attr.trim()}`;
  }

  // && syntax: selector&&attribute/Text
  if (ruleNorm.includes('&&')) {
    const parts = ruleNorm.split('&&');
    const attr = parts[parts.length - 1].trim();
    const selector = parts.slice(0, parts.length - 1).join('&&').trim();

    const targetElement: Element | null = selector
      ? context.querySelector(selector)
      : context instanceof Element
      ? context
      : (context as Document).documentElement;

    if (!targetElement) return '';

    let val = '';
    const attrLower = attr.toLowerCase();
    if (attrLower === 'text') {
      val = targetElement.textContent || '';
    } else if (attrLower === 'html') {
      val = targetElement.innerHTML || '';
    } else {
      val = targetElement.getAttribute(attr) || '';
      // Fallback for image lazy loading
      if (!val && (attr === 'data-original' || attr === 'src')) {
        val =
          targetElement.getAttribute('data-src') ||
          targetElement.getAttribute('data-original') ||
          targetElement.getAttribute('data-lazy-src') ||
          targetElement.getAttribute('src') ||
          '';
      }
    }

    val = val.trim();
    // Resolve relative URL
    if ((attr === 'href' || attr.includes('src') || attr.includes('url')) && val && baseUrl) {
      try {
        val = new URL(val, baseUrl).href;
      } catch (e) {}
    }
    return val;
  }

  // Pure selector text
  if (context.querySelector) {
    const el = context.querySelector(cleanRule);
    return el ? (el.textContent || '').trim() : '';
  }

  return '';
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
  let template = rule.fenye || `${rule.url}/show/{cateId}--------{catePg}---.html`;
  template = template
    .replace(/\{cateId\}|\[cateId\]|fyclass/g, cateId || '1')
    .replace(/\{catePg\}|\[catePg\]|fypage/g, String(page));

  if (!template.startsWith('http')) {
    try {
      template = new URL(template, rule.url).href;
    } catch (e) {}
  }
  return template;
}

/**
 * Format search URL
 * Supports: {wd}, [wd], **, {pg}, [pg], fypage
 */
export function formatXbpqSearchUrl(
  rule: XbpqRule,
  keyword: string,
  page: number = 1
): string {
  let template = rule.search_url || `${rule.url}/index.php/vod/search.html?wd={wd}&page={pg}`;
  template = template
    .replace(/\{wd\}|\[wd\]|\*\*/g, encodeURIComponent(keyword))
    .replace(/\{pg\}|\[pg\]|fypage/g, String(page));

  if (!template.startsWith('http')) {
    try {
      template = new URL(template, rule.url).href;
    } catch (e) {}
  }
  return template;
}

/**
 * Parse Category list from XBPQ rule
 */
export function parseXbpqCategories(rule: XbpqRule, html?: string): ParsedCategory[] {
  const result: ParsedCategory[] = [{ id: '', name: '全部' }];

  // 1. Direct class_name & class_url definition
  if (rule.class_name && rule.class_url) {
    const names = rule.class_name.split('&');
    const urls = rule.class_url.split('&');
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

  // 2. Dynamic class_parse from HTML: e.g. "ul.nav li;a&&Text;a&&href;.*/(.*?).html"
  if (rule.class_parse && html) {
    try {
      const parts = rule.class_parse.split(';');
      const itemSel = parts[0]?.trim();
      const nameRule = parts[1]?.trim() || 'a&&Text';
      const urlRule = parts[2]?.trim() || 'a&&href';
      const regPattern = parts[3]?.trim();

      const parser = new DOMParser();
      const doc = parser.parseFromString(html, 'text/html');
      const items = doc.querySelectorAll(itemSel);

      items.forEach((item) => {
        const name = extractByXbpqRule(item, nameRule, rule.url);
        let url = extractByXbpqRule(item, urlRule, rule.url);
        if (regPattern && url) {
          const m = new RegExp(regPattern).exec(url);
          if (m && m[1]) url = m[1];
        }
        if (name && url) {
          result.push({ id: url, name });
        }
      });
    } catch (e) {}
  }

  return result;
}

/**
 * Parse Drama Catalog from HTML using XBPQ rule
 */
export function parseXbpqList(html: string, rule: XbpqRule): ParsedItem[] {
  if (!html) return [];
  const items: ParsedItem[] = [];

  // Check if response is JSON API
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

  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');

    const listSelector = rule.list || 'div.module-item, .stui-vodlist__item, .vod-item';
    const elements = doc.querySelectorAll(listSelector);

    elements.forEach((el, index) => {
      const title =
        extractByXbpqRule(el, rule.title || 'h4&&Text||a&&title||.title&&Text', rule.url) ||
        `短剧 ${index + 1}`;

      const cover =
        extractByXbpqRule(
          el,
          rule.pic || 'img&&data-original||img&&data-src||img&&src',
          rule.url
        ) || '';

      const desc =
        extractByXbpqRule(
          el,
          rule.desc || 'div.module-item-text&&Text||span.remarks&&Text||span&&Text',
          rule.url
        ) || '';

      const link =
        extractByXbpqRule(el, rule.link || 'a&&href', rule.url) || '';

      const id = link ? link.replace(/[^a-zA-Z0-9_-]/g, '_') : `xbpq_${index + 1}`;

      items.push({
        id,
        title,
        cover,
        desc,
        link,
        source: rule.name,
      });
    });
  } catch (err) {
    console.warn('XBPQ List Parse Error:', err);
  }

  return items;
}

/**
 * Parse Drama Details & Episode List from HTML using XBPQ rule
 */
export function parseXbpqDetail(html: string, rule: XbpqRule): ParsedDetail {
  const result: ParsedDetail = {
    title: '',
    cover: '',
    desc: '',
    tabs: ['默认线路'],
    episodes: [],
    routes: ['线路 1'],
  };

  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');

    result.title =
      extractByXbpqRule(doc, rule.title || 'h1&&Text||.page-title&&Text||.detail-title&&Text', rule.url) ||
      '短剧详情';

    result.cover =
      extractByXbpqRule(
        doc,
        rule.pic || '.detail-pic img&&src||img&&data-original||img&&src',
        rule.url
      ) || '';

    result.desc =
      extractByXbpqRule(
        doc,
        rule.content || '.desc&&Text||.show-desc&&Text||meta[name="description"]&&content',
        rule.url
      ) || '暂无剧情简介';

    // Tabs
    if (rule.tabs) {
      const tabElements = doc.querySelectorAll(rule.tabs);
      if (tabElements.length > 0) {
        result.tabs = Array.from(tabElements).map(
          (t, i) => (t.textContent || '').trim() || `线路 ${i + 1}`
        );
      }
    }

    // Episodes
    const playlistContainer = rule.lists
      ? doc.querySelector(rule.lists)
      : doc.querySelector('.module-play-list-content, .stui-content__playlist, .playlist') || doc;

    const dtUrlRule = rule.dt_url || 'a&&href';
    const dtTitleRule = rule.dt_title || 'a&&Text||span&&Text';

    if (playlistContainer) {
      const epElements = playlistContainer.querySelectorAll('a');
      epElements.forEach((epEl, idx) => {
        const epTitle = extractByXbpqRule(epEl, dtTitleRule, rule.url) || `第${idx + 1}集`;
        const epUrl = extractByXbpqRule(epEl, dtUrlRule, rule.url) || '';

        if (epUrl || epTitle) {
          result.episodes.push({
            number: idx + 1,
            title: epTitle,
            url: epUrl,
          });
        }
      });
    }

    // Fallback if no episodes extracted
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
 * Parse Search Results from HTML using XBPQ rule
 */
export function parseXbpqSearch(html: string, rule: XbpqRule): ParsedItem[] {
  if (!html) return [];
  const searchList = rule.search_list || rule.list || 'div.module-item, .stui-vodlist__item';
  const searchTitle = rule.search_title || rule.title || 'h4&&Text||a&&title';
  const searchPic = rule.search_pic || rule.pic || 'img&&data-original||img&&src';
  const searchLink = rule.search_link || rule.link || 'a&&href';
  const searchDesc = rule.search_sub || rule.desc || 'div.module-item-text&&Text||span&&Text';

  return parseXbpqList(html, {
    ...rule,
    list: searchList,
    title: searchTitle,
    pic: searchPic,
    link: searchLink,
    desc: searchDesc,
  });
}

/**
 * Universal XBPQ Templates for standard TVBox / CatVod compatibility
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
    content: 'div.show-desc&&Text',
    tabs: 'div.module-tab-item',
    lists: 'div.module-play-list-content',
    dt_url: 'a&&href',
    dt_title: 'span&&Text',
    search_url: 'https://www.duanjutv.cc/search?wd={wd}&page={pg}',
    search_list: 'div.module-item',
    search_title: 'div.module-item-title&&Text',
    search_pic: 'img&&data-src||img&&src',
    play_parse: '1',
  },
  {
    name: '星辰短剧库 (XBPQ)',
    url: 'https://xingchen.tv',
    headers: {
      'User-Agent':
        'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15',
    },
    class_name: '现代言情&玄幻修仙&赘婿逆袭&神医高手&重生复仇',
    class_url: '1&2&3&4&5',
    fenye: 'https://xingchen.tv/vod/show/id/{cateId}/page/{catePg}.html',
    list: 'div.vod-item',
    title: 'h3.title&&Text',
    pic: 'img&&src',
    desc: 'span.remarks&&Text',
    link: 'a&&href',
    tabs: '.nav-tabs li',
    lists: '.playlist-content',
    dt_url: 'a&&href',
    dt_title: 'a&&Text',
    search_url: 'https://xingchen.tv/vod/search/page/{pg}/wd/{wd}.html',
    play_parse: '0',
  },
  {
    name: '快看短剧 (XBPQ)',
    url: 'https://www.kuaikandj.com',
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    },
    class_name: '热门推荐&男频战神&女频甜宠&穿越重生&商战风云',
    class_url: 'hot&nanpin&nvpin&chuanyue&shangzhan',
    fenye: 'https://www.kuaikandj.com/list/{cateId}-{catePg}.html',
    list: '.stui-vodlist__item',
    title: '.stui-vodlist__thumb&&title',
    pic: '.stui-vodlist__thumb&&data-original',
    desc: '.stui-vodlist__thumb .pic-text&&Text',
    link: '.stui-vodlist__thumb&&href',
    tabs: '.nav-tabs li',
    lists: '.stui-content__playlist',
    dt_url: 'a&&href',
    dt_title: 'a&&Text',
    search_url: 'https://www.kuaikandj.com/search.php?searchword={wd}',
    play_parse: '1',
  },
];

/**
 * Normalize guoappxp Chinese rule keys to standard XbpqRule format
 */
export function normalizeGuoappxpRule(raw: any): XbpqRule {
  if (!raw) return {} as XbpqRule;
  const rule = { ...raw };

  if (rule['主页url'] && !rule.url) rule.url = rule['主页url'];
  if (rule['分类'] && !rule.class_name) {
    const fenlei = rule['分类'];
    if (typeof fenlei === 'string' && fenlei.includes('#') && fenlei.includes('$')) {
      const parts = fenlei.split('#');
      rule.class_name = parts.map((p: string) => p.split('$')[0]).join('&');
      rule.class_url = parts.map((p: string) => p.split('$')[1] || p.split('$')[0]).join('&');
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
