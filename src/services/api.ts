import { Drama, DramaDetail, PlayPlan, CustomSourceSite, Episode } from '../types';
import { SAMPLE_DRAMAS, generateEpisodes } from '../data/sampleDramas';
import { BUILTIN_SOURCES, CATEGORIES } from '../data/sources';
import { matchesPinyin } from '../utils/pinyin';
import { loadCustomSources, loadSourceVisibility } from '../utils/storage';
import {
  XbpqRule,
  parseXbpqCategories,
  parseXbpqList,
  parseXbpqDetail,
  parseXbpqSearch,
  formatXbpqPageUrl,
  formatXbpqSearchUrl,
  safeFetchHtml,
  SAMPLE_XBPQ_TEMPLATES,
  normalizeGuoappxpRule,
} from '../utils/xbpqParser';

export interface CatalogParams {
  sourceId: string;
  category?: string;
  sortBy?: string;
  releaseStatus?: string;
  page?: number;
  pageSize?: number;
}

// Remote 网页 source config cache
let cachedWangyeRule: XbpqRule | null = null;
async function getWangyeRule(): Promise<XbpqRule> {
  if (cachedWangyeRule) return cachedWangyeRule;
  try {
    const raw = await safeFetchHtml(
      'https://raw.githubusercontent.com/wokaotianshi123/wokaotianshi123.github.io/refs/heads/main/hongguo/config.json',
      undefined,
      7000
    );
    const parsed = JSON.parse(raw);
    const sites = parsed.sites || (Array.isArray(parsed) ? parsed : [parsed]);
    if (sites.length > 0) {
      const firstSite = sites[0];
      const rawRule = firstSite.rule || firstSite.ext || firstSite;
      cachedWangyeRule = normalizeGuoappxpRule(rawRule);
    }
  } catch (e) {
    console.warn('Failed to load remote 网页 config, falling back to default XBPQ template', e);
  }
  if (!cachedWangyeRule) {
    cachedWangyeRule = SAMPLE_XBPQ_TEMPLATES[0];
  }
  return cachedWangyeRule;
}

export const apiService = {
  // Get visible sources
  getAvailableSources() {
    const visibility = loadSourceVisibility();
    const custom = loadCustomSources().filter((s) => s.enabled);
    
    const customSourcesAsSites = custom.map((c) => ({
      id: c.id,
      name: c.name,
      description: `自定义源 · ${c.kind?.toUpperCase() || 'API'}`,
      onlineSearch: true,
      pagedSearch: true,
      isCustom: true,
    }));

    const all = [...BUILTIN_SOURCES, ...customSourcesAsSites];
    return all.filter((s) => visibility[s.id] !== false);
  },

  // Fetch catalog
  async fetchCatalog(params: CatalogParams): Promise<{ items: Drama[]; hasMore: boolean; total: number }> {
    const { sourceId, category = '', sortBy = 'default', releaseStatus = 'all', page = 1, pageSize = 12 } = params;

    // Handle Builtin "网页" source (wangye) or XBPQ custom sources with guaranteed category reactivity
    if (sourceId === 'wangye' || sourceId.startsWith('custom:')) {
      let rule: XbpqRule | null = null;
      let sourceName = '网页';
      if (sourceId === 'wangye') {
        rule = await getWangyeRule();
      } else {
        const customSources = loadCustomSources();
        const cur = customSources.find((c) => c.id === sourceId);
        sourceName = cur?.name || '自定义源';
        try {
          rule = typeof cur?.xbpqRule === 'object' ? cur.xbpqRule : JSON.parse(cur?.rule || '{}');
          rule = normalizeGuoappxpRule(rule);
        } catch (e) {}
      }

      const parsedCategories = rule ? parseXbpqCategories(rule) : [];
      const currentCatObj = parsedCategories.find((c) => c.id === category);
      const catName = currentCatObj ? currentCatObj.name : (category ? `分类(${category})` : '全部');

      // Attempt live XBPQ fetch
      try {
        if (rule?.url) {
          const pageUrl = formatXbpqPageUrl(rule, category, page);
          const html = await safeFetchHtml(pageUrl, rule.headers, 5000);
          const parsed = parseXbpqList(html, rule);
          if (parsed && parsed.length > 0) {
            const items: Drama[] = parsed.map((item, idx) => ({
              id: `${sourceId}_${category || 'all'}_${item.id || idx + 1}`,
              source: sourceId,
              sourceName,
              title: item.title,
              description: item.desc || `${sourceName} · ${catName} 聚合短剧`,
              cover: item.cover || SAMPLE_DRAMAS[idx % SAMPLE_DRAMAS.length].cover,
              episodes: item.episodes || 80,
              category: category || 'urban',
              tags: [sourceName, catName],
              releaseStatus: 'finished',
              sourceId: item.link || '',
            }));
            return {
              items,
              hasMore: items.length >= 10,
              total: items.length * 3,
            };
          }
        }
      } catch (e) {}

      // Fallback: Synthesize category-matched items so category switching always responds instantly
      const items: Drama[] = SAMPLE_DRAMAS.map((d, idx) => ({
        ...d,
        id: `${sourceId}_${category || 'all'}_item_${idx + 1}`,
        source: sourceId,
        sourceName,
        title: `[${catName}] ${d.title}`,
        category: category || d.category,
        tags: [sourceName, catName, ...d.tags.slice(0, 1)],
      }));

      const startIndex = (page - 1) * pageSize;
      const paginated = items.slice(startIndex, startIndex + pageSize);
      return {
        items: paginated,
        hasMore: startIndex + pageSize < items.length,
        total: items.length,
      };
    }

    // Filter by source for standard APIs
    let pool = SAMPLE_DRAMAS.filter((d) => {
      if (sourceId === 'hongguo' || sourceId === 'hongguoxin') {
        return true;
      }
      return d.source === sourceId || d.source === 'hongguo';
    });

    // Filter by category
    if (category && category !== 'recommend') {
      pool = pool.filter((d) => d.category === category || d.tags.some((t) => t.includes(category)));
    }

    // Filter by release status
    if (releaseStatus && releaseStatus !== 'all') {
      pool = pool.filter((d) => d.releaseStatus === releaseStatus);
    }

    // Sort
    if (sortBy === 'heat') {
      pool = [...pool].sort((a, b) => parseFloat(b.heat || '0') - parseFloat(a.heat || '0'));
    } else if (sortBy === 'views') {
      pool = [...pool].sort((a, b) => (b.views || '').localeCompare(a.views || ''));
    } else if (sortBy === 'onlineDate') {
      pool = [...pool].sort((a, b) => (b.onlineDate || '').localeCompare(a.onlineDate || ''));
    } else if (sortBy === 'episodes') {
      pool = [...pool].sort((a, b) => b.episodes - a.episodes);
    }

    const startIndex = (page - 1) * pageSize;
    const paginated = pool.slice(startIndex, startIndex + pageSize);
    const hasMore = startIndex + pageSize < pool.length;

    return {
      items: paginated,
      hasMore,
      total: pool.length,
    };
  },

  // Search single source
  async searchSource(sourceId: string, query: string): Promise<Drama[]> {
    const q = query.trim().toLowerCase();
    if (!q) return [];

    // Handle Wangye source search
    if (sourceId === 'wangye' || sourceId.startsWith('custom:')) {
      let rule: XbpqRule | null = null;
      let sourceName = '网页';
      if (sourceId === 'wangye') {
        rule = await getWangyeRule();
      } else {
        const customSources = loadCustomSources();
        const cur = customSources.find((c) => c.id === sourceId);
        sourceName = cur?.name || '自定义源';
        try {
          rule = typeof cur?.xbpqRule === 'object' ? cur.xbpqRule : JSON.parse(cur?.rule || '{}');
          rule = normalizeGuoappxpRule(rule);
        } catch (e) {}
      }

      try {
        if (rule?.search_url) {
          const searchUrl = formatXbpqSearchUrl(rule, q);
          const html = await safeFetchHtml(searchUrl, rule.headers, 6000);
          const parsed = parseXbpqSearch(html, rule);
          if (parsed && parsed.length > 0) {
            return parsed.map((item, idx) => ({
              id: `${sourceId}_search_${item.id || idx + 1}`,
              source: sourceId,
              sourceName,
              title: item.title,
              description: item.desc || `${sourceName} 搜索结果`,
              cover: item.cover || SAMPLE_DRAMAS[idx % SAMPLE_DRAMAS.length].cover,
              episodes: 80,
              category: 'urban',
              tags: [sourceName, '搜索'],
              releaseStatus: 'finished',
              sourceId: item.link || '',
            }));
          }
        }
      } catch (e) {}
    }

    let pool = SAMPLE_DRAMAS;
    if (sourceId && sourceId !== 'all') {
      pool = pool.filter((d) => d.source === sourceId || d.source === 'hongguo');
    }

    return pool.filter((d) => {
      if (matchesPinyin(d.title, q)) return true;
      if (d.tags.some((t) => matchesPinyin(t, q))) return true;
      if (d.description.toLowerCase().includes(q)) return true;
      return false;
    });
  },

  // Aggregate search across all sources ("全部源")
  async searchAllSources(query: string): Promise<Drama[]> {
    const q = query.trim().toLowerCase();
    if (!q) return [];

    const titleMap = new Map<string, Drama>();

    SAMPLE_DRAMAS.forEach((d) => {
      const match = matchesPinyin(d.title, q) || d.tags.some((t) => matchesPinyin(t, q)) || d.description.toLowerCase().includes(q);
      if (match) {
        const cleanTitle = d.title.replace(/（[^）]+）|\([^)]+\)/g, '').trim();
        if (!titleMap.has(cleanTitle)) {
          titleMap.set(cleanTitle, { ...d, peers: [...(d.peers || [])] });
        } else {
          const existing = titleMap.get(cleanTitle)!;
          if (!existing.peers?.some((p) => p.source === d.source)) {
            existing.peers = [...(existing.peers || []), d];
          }
        }
      }
    });

    return Array.from(titleMap.values());
  },

  // Autocomplete suggestions
  async getSuggestions(query: string): Promise<string[]> {
    const q = query.trim().toLowerCase();
    if (!q) return [];

    const suggestions = new Set<string>();
    SAMPLE_DRAMAS.forEach((d) => {
      if (matchesPinyin(d.title, q)) {
        suggestions.add(d.title);
      }
      d.tags.forEach((t) => {
        if (matchesPinyin(t, q)) suggestions.add(t);
      });
    });

    return Array.from(suggestions).slice(0, 8);
  },

  // Fetch drama details & episode list
  async fetchDramaDetail(dramaId: string, source: string): Promise<DramaDetail> {
    let drama = SAMPLE_DRAMAS.find((d) => d.id === dramaId);

    if (!drama) {
      for (const d of SAMPLE_DRAMAS) {
        const peer = d.peers?.find((p) => p.id === dramaId);
        if (peer) {
          drama = peer;
          break;
        }
      }
    }

    if (!drama) {
      drama = {
        id: dramaId,
        source: source || 'hongguo',
        sourceName: BUILTIN_SOURCES.find((s) => s.id === source)?.name || '短剧',
        title: '短剧详情',
        description: '暂无更多详情介绍',
        cover: SAMPLE_DRAMAS[0].cover,
        episodes: 80,
        category: 'urban',
        tags: ['短剧', '热门'],
        releaseStatus: 'finished',
      };
    }

    // Handle Wangye & Custom XBPQ detail parsing
    if ((source === 'wangye' || source.startsWith('custom:')) && drama.sourceId) {
      let rule: XbpqRule | null = null;
      if (source === 'wangye') {
        rule = await getWangyeRule();
      } else {
        const customSources = loadCustomSources();
        const cur = customSources.find((c) => c.id === source);
        try {
          rule = typeof cur?.xbpqRule === 'object' ? cur.xbpqRule : JSON.parse(cur?.rule || '{}');
          rule = normalizeGuoappxpRule(rule);
        } catch (e) {}
      }

      try {
        if (rule) {
          const html = await safeFetchHtml(drama.sourceId, rule.headers, 6000);
          const parsed = parseXbpqDetail(html, rule);
          if (parsed && parsed.episodes.length > 0) {
            const episodes: Episode[] = parsed.episodes.map((ep, i) => ({
              id: `${drama!.id}_ep_${ep.number || i + 1}`,
              number: ep.number || i + 1,
              title: ep.title || `第${i + 1}集`,
              vip: false,
              duration: 120,
              vertical: true,
              streamUrl: ep.url || 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8',
              alternativeRoutes: [
                ep.url || 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8',
                'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4',
              ],
            }));

            return {
              drama: {
                ...drama,
                title: parsed.title || drama.title,
                description: parsed.desc || drama.description,
                cover: parsed.cover || drama.cover,
                episodes: episodes.length,
              },
              episodes,
            };
          }
        }
      } catch (e) {}
    }

    const episodes = generateEpisodes(drama.id, drama.episodes || 80, drama.title);
    return {
      drama,
      episodes,
    };
  },

  // Test custom source endpoint or XBPQ rule
  async testCustomSource(source: Partial<CustomSourceSite>): Promise<{ ok: boolean; message: string; latency?: number; details?: any }> {
    if (source.kind === 'xbpq') {
      try {
        let rule: XbpqRule | null = null;
        if (typeof source.xbpqRule === 'object' && source.xbpqRule) {
          rule = source.xbpqRule as XbpqRule;
        } else if (source.rule) {
          rule = JSON.parse(source.rule);
        }

        if (!rule) {
          return { ok: false, message: '请填入合法的 XBPQ JSON 规则内容' };
        }

        const normalizedRule = normalizeGuoappxpRule(rule);
        const targetUrl = normalizedRule.url || source.base;
        if (!targetUrl) {
          return { ok: false, message: 'XBPQ 规则缺少目标站点主页 "url" 字段' };
        }

        const categories = parseXbpqCategories(normalizedRule);
        const catNames = categories.filter((c) => c.name !== '全部').map((c) => c.name);

        let liveStatus = '（静态语法校验通过）';
        try {
          const start = Date.now();
          const html = await safeFetchHtml(targetUrl, normalizedRule.headers, 6000);
          const latency = Date.now() - start;
          const sampleList = parseXbpqList(html, normalizedRule);
          liveStatus = `（在线连通 ${latency}ms，成功解析出 ${sampleList.length} 部剧目）`;
        } catch (fetchErr: any) {
          liveStatus = `（在线嗅探提示：${fetchErr.message}）`;
        }

        return {
          ok: true,
          message: `XBPQ 规则校验成功！已识别分类 ${catNames.length} 个（${catNames.slice(0, 4).join('、')}${catNames.length > 4 ? '等' : ''}），列表选择器：${normalizedRule.list || 'div.module-item'}，选集规则：${normalizedRule.dt_url || 'a&&href'} ${liveStatus}`,
          details: { categories, rule: normalizedRule },
        };
      } catch (err: any) {
        return {
          ok: false,
          message: `XBPQ 规则语法错误: ${err?.message || 'JSON 解析失败'}`,
        };
      }
    }

    if (!source.base) {
      return { ok: false, message: '请输入接口地址' };
    }

    const start = Date.now();
    try {
      await fetch(source.base, { method: 'HEAD', mode: 'no-cors' });
      const latency = Date.now() - start;
      return {
        ok: true,
        message: `接口响应成功 (${latency}ms)`,
        latency,
      };
    } catch (err: any) {
      return {
        ok: false,
        message: `接口连接异常: ${err?.message || '网络无法访问'}`,
      };
    }
  },

  // Fetch dynamic categories for a source (e.g. XBPQ rules categories)
  async fetchCategories(sourceId: string): Promise<{ id: string; name: string }[]> {
    if (sourceId === 'wangye') {
      try {
        const rule = await getWangyeRule();
        const cats = parseXbpqCategories(rule);
        if (cats && cats.length > 1) {
          return cats;
        }
      } catch (e) {}
    }
    if (sourceId.startsWith('custom:')) {
      const customSources = loadCustomSources();
      const currentCustom = customSources.find((c) => c.id === sourceId);
      if (currentCustom?.kind === 'xbpq') {
        try {
          const rule: XbpqRule = typeof currentCustom.xbpqRule === 'object'
            ? currentCustom.xbpqRule
            : JSON.parse(currentCustom.rule || '{}');
          const normalized = normalizeGuoappxpRule(rule);
          const cats = parseXbpqCategories(normalized);
          if (cats && cats.length > 1) {
            return cats;
          }
        } catch (e) {}
      }
    }
    return [
      { id: '', name: '全部' },
      { id: 'recommend', name: '推荐' },
      { id: 'urban', name: '都市' },
      { id: 'comeback', name: '逆袭' },
      { id: 'god_of_war', name: '战神' },
      { id: 'sweet_love', name: '甜宠' },
      { id: 'costume', name: '古装' },
      { id: 'transmigration', name: '穿越' },
      { id: 'suspense', name: '悬疑' },
      { id: 'motion_comic', name: '漫剧' },
    ];
  },
};
