// XBPQ 规则源管道：移植 provider_xbpq.go 的分类 / 列表 / 搜索 / 详情 / 分集 / 取流。
//
// 数据流：规则字段（数组/标题/链接/…）→ 抓页 → 截取 → 统一条目结构。
// 前端只拿到归一化后的 JSON，全部跨域抓取都在服务端完成。

import { fetchText, absoluteURL, isMediaURL, hostOrigin } from '../http.mjs';
import { parseHTML, renderHTML, cleanText, descendants, textContent } from '../html.mjs';
import {
  maccmsPlayerURL,
  normalizePlaybackURL,
  maccmsSourceIDFromURL,
  maccmsDetailTitle,
  maccmsDetailIntro,
  maccmsDetailCover,
  maccmsDetailCategory,
  decryptPlayerURL,
} from '../maccms.mjs';
import { cleanEmptySegments } from './template.mjs';
import { cutOnce, list, parseSteps, applyStepScan, unescapeText } from './cut.mjs';
import { selectorNodes, parseSelector, selectorWithin, selectorFirstString } from './selector.mjs';
import { jsonArrayItems, jsonPathRaw, jsonStringValue, isValidJSON, isJSONPattern, anyToString } from './json.mjs';
import { refreshXBPQToken, ruleHasTokenConfig } from './token.mjs';

/** `url;post;body` / `url;get` 形态拆解。 */
export function splitSpec(raw) {
  const value = String(raw || '').trim();
  if (!value) return { address: '', method: '', body: '' };
  const parts = value.split(';');
  const address = parts[0].trim();
  if (parts.length > 1 && parts[1].trim().toLowerCase() === 'post') {
    return { address, method: 'POST', body: parts.slice(2).join(';') };
  }
  return { address, method: '', body: '' };
}

async function fetchRulePage(rule, raw, referer) {
  const { address, method, body } = splitSpec(raw);
  if (!address) throw new Error('规则地址为空');
  const result = await fetchText(address, {
    headers: rule.headerSet,
    referer,
    ua: rule.userAgent,
    method: method || 'GET',
    body,
    timeout: 20000,
  });
  return result.text;
}

/** 填占位符 + 相对转绝对；域名不一致时按站源当前地址重写 host。 */
export function renderURL(template, base, values) {
  let value = String(template || '').trim();
  const cut = value.indexOf(';;');
  if (cut >= 0) value = value.slice(0, cut);
  for (const [key, replacement] of Object.entries(values || {})) {
    value = value.split(`{${key}}`).join(replacement == null ? '' : String(replacement));
  }
  value = value.replace(/[\t\r\n]/g, '').trim();
  if (!value) return '';
  if (!/^http/i.test(value) && !value.startsWith('//')) {
    if (!value.startsWith('/')) value = '/' + value;
    value = base + value;
  }
  if (value.startsWith('//')) value = 'https:' + value;
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    return '';
  }
  try {
    const baseParsed = new URL(base);
    if (baseParsed.host && parsed.host !== baseParsed.host) {
      parsed.protocol = baseParsed.protocol;
      parsed.host = baseParsed.host;
    }
  } catch {
    /* base 非法则保持原样 */
  }
  return parsed.toString();
}

/** 多线链接风格：字面量用引号包裹，其余段丢弃。 */
export function joinLink(pageURL, raw) {
  let value = String(raw || '').trim();
  if (!value || value.startsWith('$')) return '';
  if (value.toLowerCase().startsWith('href=')) value = value.slice(5);
  if (value.includes('+')) {
    let built = '';
    for (const segment of value.split('+')) {
      if (segment.length >= 2 && segment.startsWith('"') && segment.endsWith('"')) {
        built += segment.slice(1, -1);
      }
    }
    value = built;
  }
  if (!value) return '';
  return absoluteURL(pageURL, value);
}

function idFromLink(link, numeric) {
  if (numeric) {
    const id = maccmsSourceIDFromURL(link);
    if (id) return id;
  }
  return 'u' + encodeURIComponent(link);
}

function linkFromID(base, id) {
  if (String(id).startsWith('u')) {
    try {
      const decoded = decodeURIComponent(String(id).slice(1));
      if (/^https?/i.test(decoded)) return decoded;
    } catch {
      return '';
    }
  }
  return '';
}

/** 数组截取：json / 选择器 / 截取串三路，失败再走通用容器兜底。 */
async function extractItems(rule, base, pageURL, prefix) {
  // 二次截取会把页面缩到子区域，后续所有提取都基于子区域，所以这里必须可变
  let body = await fetchRulePage(rule, pageURL, base + '/');
  if (!body.trim()) throw new Error('站点返回空页面');

  const arrayPattern = rule.field(`${prefix}数组`, '数组');

  if (arrayPattern && arrayPattern.startsWith('j:')) {
    let source = body;
    const region = rule.field(`${prefix}二次截取`, '二次截取');
    if (region && region.startsWith('j:')) {
      const scoped = jsonPathRaw(body, region);
      if (scoped) source = scoped;
    }
    const items = jsonArrayItems(source, arrayPattern).map((text) => ({ text, node: null, doc: null }));
    if (items.length) return items;
  }

  if (!arrayPattern) {
    const jsonItems = fallbackJSONList(body);
    if (jsonItems.length) return jsonItems;
    return [];
  }

  let document = parseHTML(body);

  if (arrayPattern.startsWith('p:') || arrayPattern.startsWith('jsoup:')) {
    const selector = parseSelector(arrayPattern);
    if (!selector) return [];
    return selectorNodes(document, selector).map((node) => ({
      text: renderHTML(node),
      node,
      doc: document,
    }));
  }

  const region = rule.field(`${prefix}二次截取`, '二次截取');
  if (region) {
    const cut = cutOnce(body, region);
    if (cut) {
      document = parseHTML(cut);
      body = cut;
    }
  }

  let items = list(body, arrayPattern).map((text) => ({ text, node: null, doc: document }));

  if (items.length === 0) {
    // 通用兜底：主 数组 截不到时试常见容器，提升对未覆盖站点结构的适应性
    for (const fallback of [
      '<li&&</li>',
      '<a &&</a>',
      '<article&&</article>',
      'class="item"&&</div>',
      'class="card"&&</div>',
    ]) {
      const extra = list(body, fallback);
      if (extra.length) {
        items = extra.map((text) => ({ text, node: null, doc: document }));
        break;
      }
    }
  }

  if (items.length === 0) {
    const jsonItems = fallbackJSONList(body);
    if (jsonItems.length) return jsonItems;
  }
  return items;
}

/** 页面里嵌 MacCMS 风格 JSON（vod_name/vod_id…）时直接解析。 */
function fallbackJSONList(body) {
  const start = body.indexOf('[{');
  if (start < 0) return [];
  let payload;
  try {
    payload = JSON.parse(body.slice(start));
  } catch {
    return [];
  }
  let rows = [];
  if (Array.isArray(payload)) rows = payload;
  else if (payload && typeof payload === 'object') {
    for (const key of ['list', 'data', 'result', 'rows']) {
      if (Array.isArray(payload[key])) {
        rows = payload[key];
        break;
      }
    }
  }
  return rows
    .filter((row) => row && typeof row === 'object' && !Array.isArray(row))
    .map((row) => ({ text: JSON.stringify(row), node: null, doc: null }));
}

function jsonField(itemJSON, pattern) {
  let node;
  try {
    node = JSON.parse(itemJSON);
  } catch {
    return '';
  }
  let key = cutOnce(pattern, '"&&"');
  if (!key) key = pattern.replace(/["+:&]/g, '').trim();
  for (const [name, value] of Object.entries(node)) {
    if (name.trim().toLowerCase() === key.toLowerCase()) return anyToString(value);
  }
  return '';
}

/** 条目内取字段：p: / JSON 字段 / 截取串。 */
export function itemField(item, pattern) {
  if (!pattern || !item.text) return '';
  if (pattern.startsWith('p:') || pattern.startsWith('jsoup:')) {
    if (item.node) return selectorWithin(item.node, item.doc, pattern);
    return selectorFirstString(item.text, pattern);
  }
  if (pattern.includes('"') && item.text.includes('{') && isValidJSON(item.text)) {
    const value = jsonField(item.text, pattern);
    if (value) return value;
  }
  return cutOnce(item.text, pattern);
}

function categoryURL(rule, base, categoryId, page) {
  let template = rule.field('分类url', '分类Url');
  if (!template) return '';
  const values = {
    cateId: categoryId,
    catePg: String(page),
    handurl: base + '/',
    limit: '20',
    area: '',
    class: '',
    lang: '',
    year: '',
    letter: '',
    by: '',
  };
  if (template.includes('#') && template.includes('二级')) {
    template = template.split('#')[0];
  }
  return cleanEmptySegments(renderURL(template, base, values));
}

function arrayMismatchHint(rule, prefix) {
  let pattern = (rule.field(`${prefix}数组`, '数组') || '').trim();
  if (!pattern) return `规则没有「${prefix}数组」字段`;
  pattern = cleanText(pattern);
  if (pattern.length > 80) pattern = pattern.slice(0, 80) + '…';
  return `数组「${pattern}」没有匹配到站点结构`;
}

function episodeNumber(remark) {
  if (!remark) return 0;
  const match = /(\d{1,4})\s*[集话期]|更新至\s*(\d{1,4})|全\s*(\d{1,4})\s*集/.exec(remark);
  if (!match) return 0;
  const value = Number.parseInt(match[1] || match[2] || match[3], 10);
  return Number.isFinite(value) ? value : 0;
}

function toDrama({ source, id, title, cover, remark, category, extra }) {
  const drama = {
    id: `${source}:${id}`,
    sourceId: id,
    source,
    title,
    cover: cover || '',
    remark: remark || '',
    episodes: episodeNumber(remark),
    category: category || '',
    description: remark || '',
    tags: [],
    releaseStatus: 'unknown',
  };
  return extra ? { ...drama, ...extra } : drama;
}

/** 分类目录。 */
export async function xbpqCatalog({ rule, base, source, category = '', page = 1 }) {
  let categoryId = String(category || '').trim();
  const numeric = /^\/?(\d{1,6})(?:\.html)?$/.exec(categoryId.replace(/^\//, ''));
  if (numeric) categoryId = numeric[1];
  if (!categoryId) {
    const categories = rule.categories;
    if (categories.length) categoryId = categories[0].id;
  }
  const pageURL = categoryURL(rule, base, categoryId, page);
  if (!pageURL) throw new Error('规则缺少分类url');
  const prefix = categoryId ? '列表' : '';

  const items = await extractItems(rule, base, pageURL, prefix);
  if (items.length === 0) {
    throw new Error(`规则未抽取到列表条目（${arrayMismatchHint(rule, prefix)}）`);
  }

  const titlePattern = rule.field('标题', `${prefix}标题`);
  const linkPattern = rule.field('链接', `${prefix}链接`);
  const picturePattern = rule.field(`${prefix}图片`, '图片', '主图', '封面图');
  const remarkPattern = rule.field('副标题', `${prefix}副标题`, '备注');
  const numericID = Boolean(rule.field('详情url', '详情页url'));

  const dramas = [];
  for (const item of items) {
    const title = cleanText(itemField(item, titlePattern));
    const link = joinLink(pageURL, itemField(item, linkPattern));
    if (!title || !link || !/^http/i.test(link)) continue;
    const cover = joinLink(pageURL, itemField(item, picturePattern));
    const remark = cleanText(itemField(item, remarkPattern));
    dramas.push(
      toDrama({
        source,
        id: idFromLink(link, numericID),
        title,
        cover,
        remark,
      })
    );
  }
  if (dramas.length === 0) throw new Error('规则抽取的条目缺少标题或链接');
  return { items: dramas, hasMore: dramas.length >= 10, total: dramas.length };
}

/** 规则搜索（支持 POST 形态 url;post;body）。 */
export async function xbpqSearch({ rule, base, source, query, page = 1 }) {
  const template = rule.field('搜索url', '搜索Url');
  if (!template) throw new Error('规则缺少搜索url');
  const encoded = encodeURIComponent(query);
  const pathEscaped = encodeURIComponent(query).replace(/%2F/g, '%252F');
  const candidates = [template.split('{wd}').join(encoded), template.split('{wd}').join(pathEscaped)];

  let lastError = null;
  for (const candidate of candidates) {
    const { address, method, body } = splitSpec(candidate);
    if (!address || address.includes('{wd}')) continue;
    const pageURL = renderURL(address, base, { wd: encoded });
    let payload = body;
    if (method && payload.includes('{wd}')) payload = payload.split('{wd}').join(query);
    const spec = method ? `${pageURL};${method};${payload}` : pageURL;

    let items = [];
    let fetchError = null;
    try {
      items = await extractItems(rule, base, spec, '搜索');
      if (items.length === 0) items = await extractItems(rule, base, spec, '');
    } catch (error) {
      fetchError = error;
    }
    if (items.length === 0) {
      lastError = fetchError
        ? new Error(`搜索页抓取失败：${fetchError.message}`)
        : new Error(`搜索页未抽取到结果（${arrayMismatchHint(rule, '搜索')}）`);
      continue;
    }

    const titlePattern = rule.field('搜索标题', '标题');
    const linkPattern = rule.field('搜索链接', '链接');
    const picturePattern = rule.field('搜索图片', '图片', '主图', '封面图');
    const remarkPattern = rule.field('搜索副标题', '副标题');
    const numericID = Boolean(rule.field('详情url', '详情页url'));

    const dramas = [];
    for (const item of items) {
      const title = cleanText(itemField(item, titlePattern));
      const link = joinLink(pageURL, itemField(item, linkPattern));
      if (!title || !link || !/^http/i.test(link)) continue;
      dramas.push(
        toDrama({
          source,
          id: idFromLink(link, numericID),
          title,
          cover: joinLink(pageURL, itemField(item, picturePattern)),
          remark: cleanText(itemField(item, remarkPattern)),
        })
      );
    }
    if (dramas.length) return { items: dramas, hasMore: page === 1, total: dramas.length };
    lastError = new Error('搜索结果缺少标题或链接');
  }
  throw lastError || new Error('搜索规则不可用');
}

/** 解析播放串：播放数组 → 线路数组 → $$$ 分线路 → # 分集 → 标题$链接。 */
export function parseEpisodes(body, pageURL, rule) {
  const arrayPattern = rule.field('播放数组');
  if (!arrayPattern) return { best: [], routes: [] };

  let raw = '';
  const routeArray = rule.field('线路数组');
  if (routeArray) {
    const segments = list(body, routeArray);
    if (segments.length) raw = segments.join('$$$');
  }
  if (!raw) raw = cutOnce(body, arrayPattern);
  if (!raw) return { best: [], routes: [] };

  raw = raw.replace(/\r\n/g, '#').split('\\/').join('/');
  let listSplit = rule.field('播放列表') || '#';
  if (listSplit === '&&') listSplit = '#';
  const titlePattern = rule.field('播放标题');
  const linkPattern = rule.field('播放链接');

  const rawGroups = raw.split('$$$');
  let best = [];
  const routes = [];

  const parseItems = (group, separator) => {
    const entries = [];
    for (const rawItem of group.split(separator)) {
      const item = rawItem.trim();
      if (!item) continue;
      let name = item;
      let address = '';
      const cut = item.indexOf('$');
      if (cut >= 0) {
        name = item.slice(0, cut);
        address = item.slice(cut + 1);
      }
      if (titlePattern) {
        const value = cutOnce(item, titlePattern);
        if (value) name = value;
      }
      if (linkPattern) {
        const value = cutOnce(item, linkPattern);
        if (value) address = value;
      }
      if (address.startsWith('$')) continue;
      address = normalizePlaybackURL(address.trim());
      name = cleanText(name);
      if (!name && address.includes('://')) name = `第${entries.length + 1}集`;
      if (!name || !address) continue;
      entries.push({ title: name, url: address });
    }
    return entries;
  };

  for (const rawGroup of rawGroups) {
    const group = rawGroup.trim();
    if (!group) continue;
    let entries = parseItems(group, listSplit);
    // 分隔符自适应：只切出 ≤1 段但段内有 ≥2 个 href 时，改按 <a 切
    if (entries.length <= 1 && (group.match(/href=/g) || []).length >= 2) {
      const alternate = parseItems(group, '<a');
      if (alternate.length > entries.length) entries = alternate;
    }
    if (entries.length > best.length) best = entries;
    if (entries.length) routes.push(entries);
  }

  const absolutize = (entry) => {
    let link = entry.url;
    if (!link.includes('://') && !link.startsWith('/')) return null;
    if (!/^http/i.test(link)) link = absoluteURL(pageURL, link);
    if (!link || !/^https?/i.test(link)) return null;
    return { title: entry.title, url: link };
  };

  const fixedBest = best.map(absolutize).filter(Boolean);
  const fixedRoutes = routes.map((group) => group.map(absolutize).filter(Boolean)).filter((group) => group.length);
  return { best: fixedBest, routes: fixedRoutes };
}

/** 同一集在其它线路上的播放页地址（供播放时切换线路）。 */
function alternateRoutes(groups, index, mainCount, main, mainLink, pageURL) {
  if (groups.length < 2) return [];
  const out = [];
  const seen = new Set([mainLink]);
  for (const group of groups) {
    if (index >= group.length) continue;
    const entry = group[index];
    if (group.length !== mainCount && entry.title && main.title && entry.title !== main.title) continue;
    const link = joinLink(pageURL, entry.url);
    if (!link || seen.has(link)) continue;
    seen.add(link);
    out.push(link);
  }
  return out;
}

/** 详情 + 分集。 */
export async function xbpqDetail({ rule, base, source, sourceId }) {
  let pageURL = linkFromID(base, sourceId);
  if (!pageURL) pageURL = renderURL(rule.field('详情url', '详情页url'), base, { id: sourceId });
  if (!pageURL) {
    // 常见 MacCMS 详情页候选
    for (const candidate of [
      `${base}/index.php/vod/detail/id/${sourceId}.html`,
      `${base}/voddetail/${sourceId}.html`,
      `${base}/detail/${sourceId}.html`,
      `${base}/vod/${sourceId}.html`,
    ]) {
      pageURL = candidate;
      break;
    }
  }
  if (!pageURL) throw new Error('无法定位详情页地址');

  const body = await fetchRulePage(rule, pageURL, base + '/');
  const document = parseHTML(body);
  const item = { text: body, node: null, doc: document };

  const pick = (...patterns) => {
    for (const pattern of patterns) {
      if (!pattern) continue;
      const value = itemField(item, pattern);
      if (value) return cleanText(value);
    }
    return '';
  };

  let title = pick(rule.field('影片名称'), rule.field('name'));
  if (!title) title = maccmsDetailTitle(document);
  if (!title) {
    const heading = descendants(document).find((node) => node.tag === 'h1' || node.tag === 'h2');
    if (heading) {
      const value = cleanText(textContent(heading));
      if (value.length >= 2 && value.length <= 60) title = value;
    }
  }

  const intro = pick(rule.field('简介'), maccmsDetailIntro(document));
  let cover = '';
  const coverPattern = rule.field('封面', '图片');
  if (coverPattern) cover = joinLink(pageURL, itemField(item, coverPattern));
  if (!cover) cover = maccmsDetailCover(document, pageURL);
  const category = pick(rule.field('类型'), maccmsDetailCategory(document));

  const drama = toDrama({
    source,
    id: sourceId,
    title,
    cover,
    remark: pick(rule.field('状态', '影片状态')),
    category,
    extra: { description: intro, intro },
  });
  const tags = [];
  const director = pick(rule.field('导演'));
  if (director) tags.push(`导演:${director}`);
  const actor = pick(rule.field('主演'));
  if (actor) tags.push(`主演:${actor}`);
  drama.tags = tags;

  const { best, routes } = parseEpisodes(body, pageURL, rule);
  if (best.length === 0) throw new Error('规则未解析到分集');

  const episodes = [];
  best.forEach((entry, index) => {
    const link = joinLink(pageURL, entry.url);
    if (!link) return;
    episodes.push({
      index: episodes.length + 1,
      title: entry.title,
      pageUrl: link,
      videoUrl: link,
      referer: base + '/',
      routes: alternateRoutes(routes, index, best.length, entry, link, pageURL),
    });
  });
  if (episodes.length === 0) throw new Error('规则未解析到可播放分集');
  drama.episodes = episodes.length;
  drama.totalEpisode = episodes.length;
  return { drama, episodes };
}

function jumpValue(body, jump) {
  let value = cutOnce(body, jump);
  if (!value) return '';
  const cut = value.search(/[\r\n]/);
  if (cut >= 0) value = value.slice(0, cut);
  return value.trim();
}

function jumpCandidates(body, jump) {
  const out = [];
  const value = jumpValue(body, jump);
  if (value) out.push(value);
  for (const part of jump.split('||')) {
    const steps = parseSteps(part);
    if (!steps.length) continue;
    const scanned = applyStepScan(body, steps[0]);
    if (scanned.ok && !scanned.value.includes('\n') && !scanned.value.includes(' ')) {
      out.push(scanned.value);
    }
  }
  return [...new Set(out.filter(Boolean))];
}

/** 单个播放页取直链：跳转模板 → 标准 player_data → MacCMS 嗅探。 */
async function resolveOne(pageURL, referer, rule) {
  const playHeaders = rule.playHeaderSet;
  const body = await fetchRulePage(rule, pageURL, referer);
  const mediaReferer = rule.playReferer || pageURL;

  const jump = rule.field('跳转播放链接');
  if (jump) {
    for (let candidate of jumpCandidates(body, jump)) {
      candidate = normalizePlaybackURL(joinLink(pageURL, candidate));
      if (candidate && isMediaURL(candidate)) {
        return { url: candidate, referer: mediaReferer, headers: playHeaders };
      }
      if (/^https?/i.test(candidate) && !isMediaURL(candidate)) {
        // 跳转到二级播放页：再取一次
        try {
          const second = await fetchRulePage(rule, candidate, pageURL);
          const direct = normalizePlaybackURL(jumpValue(second, jump));
          if (direct && isMediaURL(direct)) {
            return { url: direct, referer: candidate, headers: playHeaders };
          }
          const sniffed = normalizePlaybackURL(maccmsPlayerURL(second));
          if (sniffed && isMediaURL(sniffed)) {
            return { url: sniffed, referer: candidate, headers: playHeaders };
          }
        } catch {
          /* 继续下一个候选 */
        }
      }
    }
  }

  const media = normalizePlaybackURL(maccmsPlayerURL(body));
  if (media && isMediaURL(media)) {
    return { url: media, referer: mediaReferer, headers: playHeaders };
  }
  throw new Error('未解析到播放地址');
}

/** 并发解析其它线路（上限 4），失败的线路自动剔除。 */
async function resolveRoutes(routes, rule, name) {
  const targets = (routes || []).map((item) => String(item || '').trim()).filter(Boolean);
  if (!targets.length) return [];
  const results = new Array(targets.length);
  const limit = 4;
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, targets.length) }, async () => {
    for (;;) {
      const slot = cursor++;
      if (slot >= targets.length) return;
      try {
        const media = await resolveOne(targets[slot], rule.playReferer || '', rule);
        if (media?.url) results[slot] = media;
      } catch {
        /* 单条线路失败忽略 */
      }
    }
  });
  await Promise.all(workers);
  return results.filter(Boolean);
}

/** 取直链：主线路失败时依次尝试其它线路。 */
export async function xbpqResolve({ rule, base, chapter, name = '线路', source = '' }) {
  const pageURL = String(chapter.pageUrl || '').trim();
  const address = String(chapter.videoUrl || '').trim();
  const referer = chapter.referer || rule.playReferer || base + '/';

  if (isMediaURL(address)) {
    const variants = await resolveRoutes(chapter.routes, rule, name);
    return { url: address, referer: referer || base + '/', headers: rule.playHeaderSet, variants };
  }

  const target = pageURL || address;
  if (!target) throw new Error(`${name}播放页地址为空`);

  let primary = null;
  let lastError = null;
  let usedRule = rule;
  try {
    primary = await resolveOne(target, referer, rule);
  } catch (error) {
    lastError = error;
  }

  // 令牌自动续期：取流失败且规则配了刷新令牌时，换一套新令牌后重试一次
  // （对齐 guoappxp 的 xbpqRefreshAccessToken：refresh token 轮换，旧值立即作废）。
  if (!primary && ruleHasTokenConfig(rule)) {
    try {
      const refreshed = await refreshXBPQToken(rule, base, source);
      if (refreshed) {
        usedRule = refreshed;
        try {
          primary = await resolveOne(target, referer, refreshed);
          lastError = null;
        } catch (error) {
          lastError = error;
        }
      }
    } catch {
      /* 续期异常忽略，沿用上次错误 */
    }
  }

  if (primary) {
    const variants = await resolveRoutes(chapter.routes, usedRule, name);
    return { ...primary, url: primary.url, variants, tokenRefreshed: usedRule !== rule };
  }
  for (const route of chapter.routes || []) {
    if (!route || route === target) continue;
    try {
      const alt = await resolveOne(route, referer, usedRule);
      const rest = (chapter.routes || []).filter((item) => item !== route);
      const variants = await resolveRoutes(rest, usedRule, name);
      return { ...alt, variants, tokenRefreshed: usedRule !== rule };
    } catch {
      /* 试下一条 */
    }
  }
  throw lastError || new Error(`${name}未解析到播放地址`);
}

export function xbpqCategories(rule) {
  return rule.categories;
}
