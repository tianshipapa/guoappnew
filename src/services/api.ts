import {
  Drama,
  DramaDetail,
  Episode,
  CustomSourceSite,
  SourceSite,
  AggregateSearchSnapshot,
  StreamVariant,
} from '../types';
import { SAMPLE_DRAMAS, generateEpisodes } from '../data/sampleDramas';
import { BUILTIN_SOURCES } from '../data/sources';
import { matchesPinyin } from '../utils/pinyin';
import { loadCustomSources, loadSourceVisibility } from '../utils/storage';
import { nativeCore, NativeCoreError } from './nativeCore';

export interface CatalogParams {
  sourceId: string;
  category?: string;
  sortBy?: string;
  releaseStatus?: string;
  page?: number;
  pageSize?: number;
}

/** 服务端返回的已解析媒体。 */
export interface ResolvedSource {
  playUrl: string;
  rawUrl: string;
  referer: string;
  streamType: 'hls' | 'mp4';
  variants: Array<{
    playUrl: string;
    rawUrl: string;
    referer?: string;
    quality?: number;
    label?: string;
  }>;
}

/** 有原生实现的站源（其余走示例数据兜底，避免整站空白）。 */
const NATIVE_SOURCES = new Set(['a123', 'ikanbot', 'guipian', 'hanxiaoquan']);

/** 统一取请求体：自定义源读本地存储，其余原生源直接取规则。 */
async function payloadFor(sourceId: string) {
  return sourcePayload(sourceId);
}

function isNativeSource(sourceId: string): boolean {
  if (!sourceId) return false;
  if (NATIVE_SOURCES.has(sourceId)) return true;
  return sourceId.startsWith('custom:');
}

/** 取自定义源的规则与地址（XBPQ / MacCMS 接口都需要随请求带上）。 */
function customSourceOf(sourceId: string): CustomSourceSite | undefined {
  return loadCustomSources().find((item) => item.id === sourceId);
}

function sourcePayload(sourceId: string) {
  if (sourceId.startsWith('custom:')) {
    const source = customSourceOf(sourceId);
    return {
      source: sourceId,
      base: source?.base || '',
      kind: source?.kind || 'xbpq',
      rule: source?.rule || '',
    };
  }
  return { source: sourceId };
}

function sourceNameOf(sourceId: string): string {
  const builtin = BUILTIN_SOURCES.find((item) => item.id === sourceId);
  if (builtin) return builtin.name;
  const custom = customSourceOf(sourceId);
  return custom?.name || sourceId;
}

function toDrama(item: any, sourceId: string): Drama {
  const sourceName = sourceNameOf(sourceId);
  const category = item.category || '影视';
  return {
    id: String(item.id || `${sourceId}:${item.sourceId}`),
    source: sourceId,
    sourceName,
    sourceId: String(item.sourceId ?? ''),
    title: String(item.title || '未命名'),
    description: String(item.description || item.remark || `${sourceName} · ${category}`),
    cover: String(item.cover || ''),
    episodes: Number(item.episodes) || 0,
    category,
    tags: Array.isArray(item.tags) && item.tags.length ? item.tags : [sourceName, category].filter(Boolean),
    releaseStatus: item.releaseStatus || 'unknown',
    onlineDate: item.onlineDate || '',
    remark: item.remark || '',
  };
}

function toEpisodes(raw: any[], drama: Drama): Episode[] {
  return (raw || []).map((entry, index) => {
    const chapterKey = entry.chapterKey ?? entry.order ?? entry.index ?? index + 1;
    return {
      id: `${drama.id}_ep_${index + 1}`,
      number: index + 1,
      title: String(entry.title || `第${index + 1}集`),
      vip: false,
      duration: 0,
      vertical: true,
      streamUrl: entry.videoUrl || entry.pageUrl || '',
      pageUrl: entry.pageUrl || '',
      videoUrl: entry.videoUrl || '',
      referer: entry.referer || '',
      routes: Array.isArray(entry.routes) ? entry.routes : [],
      chapterKey: String(chapterKey),
      alternativeRoutes: [entry.videoUrl, ...(Array.isArray(entry.routes) ? entry.routes : [])].filter(Boolean),
    };
  });
}

/** 解析结果缓存：同一集反复播放 / 切换线路不必重新抓页。 */
const resolveCache = new Map<string, { value: ResolvedSource; expiresAt: number }>();
const RESOLVE_TTL = 5 * 60 * 1000;

function mediaTypeOf(url: string): 'hls' | 'mp4' {
  return /\.m3u8(\?|#|$)/i.test(url) ? 'hls' : 'mp4';
}

export const apiService = {
  /** 可用站源（内置 + 已启用的自定义源，再按可见性过滤）。 */
  getAvailableSources(): SourceSite[] {
    const visibility = loadSourceVisibility();
    const custom = loadCustomSources().filter((s) => s.enabled);
    const customSites: SourceSite[] = custom.map((c) => ({
      id: c.id,
      name: c.name,
      description: `自定义源 · ${(c.kind || 'xbpq').toUpperCase()}`,
      onlineSearch: true,
      pagedSearch: true,
      isCustom: true,
      native: true,
    }));
    const all = [...BUILTIN_SOURCES, ...customSites];
    return all.filter((s) => visibility[s.id] !== false);
  },

  /** 目录（分类 / 翻页）。原生站源失败时回落到示例数据，保证界面不空白。 */
  async fetchCatalog(params: CatalogParams): Promise<{ items: Drama[]; hasMore: boolean; total: number }> {
    const { sourceId, category = '', page = 1, pageSize = 15, sortBy = 'default', releaseStatus = 'all' } = params;

    if (isNativeSource(sourceId)) {
      try {
        const response = await nativeCore.post<any>('/api/catalog', {
          ...(await payloadFor(sourceId)),
          category,
          page,
        });
        const items: Drama[] = (response.items || []).map((item: any) => toDrama(item, sourceId));
        return {
          items,
          hasMore: Boolean(response.hasMore),
          total: Number(response.total) || items.length,
        };
      } catch (error) {
        console.warn(`[catalog] ${sourceId} 抓取失败：`, (error as Error).message);
      }
    }

    // 兜底：示例数据（本机服务不可达时保证界面不空白）
    let pool = SAMPLE_DRAMAS;
    if (category && category !== 'recommend') {
      pool = pool.filter((d) => d.category === category || d.tags.some((t) => t.includes(category)));
    }
    if (releaseStatus && releaseStatus !== 'all') {
      pool = pool.filter((d) => d.releaseStatus === releaseStatus);
    }
    if (sortBy === 'heat') pool = [...pool].sort((a, b) => parseFloat(b.heat || '0') - parseFloat(a.heat || '0'));
    else if (sortBy === 'episodes') pool = [...pool].sort((a, b) => b.episodes - a.episodes);

    const start = (page - 1) * pageSize;
    return {
      items: pool.slice(start, start + pageSize).map((d) => ({ ...d, source: sourceId, sourceName: sourceNameOf(sourceId) })),
      hasMore: start + pageSize < pool.length,
      total: pool.length,
    };
  },

  /** 分类列表（XBPQ 规则的 分类 字段 / A123 内置分类 / MacCMS 接口 class）。 */
  async fetchCategories(sourceId: string): Promise<{ id: string; name: string }[]> {
    if (isNativeSource(sourceId)) {
      try {
        const response = await nativeCore.post<any>('/api/categories', await payloadFor(sourceId));
        const categories = (response.categories || []).map((item: any) => ({
          id: String(item.id),
          name: String(item.name),
        }));
        if (categories.length) return [{ id: '', name: '全部' }, ...categories];
      } catch (error) {
        console.warn('[categories]', (error as Error).message);
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

  /** 单源搜索。 */
  async searchSource(sourceId: string, query: string): Promise<Drama[]> {
    const q = query.trim();
    if (!q) return [];

    if (isNativeSource(sourceId)) {
      try {
        const response = await nativeCore.post<any>('/api/search', {
          ...(await payloadFor(sourceId)),
          query: q,
          page: 1,
        });
        return (response.items || []).map((item: any) => toDrama(item, sourceId));
      } catch (error) {
        console.warn(`[search] ${sourceId} 失败：`, (error as Error).message);
      }
    }

    const lower = q.toLowerCase();
    let pool = SAMPLE_DRAMAS;
    if (sourceId && sourceId !== 'all') {
      pool = pool.filter((d) => d.source === sourceId);
    }
    return pool.filter(
      (d) =>
        matchesPinyin(d.title, lower) ||
        d.tags.some((t) => matchesPinyin(t, lower)) ||
        d.description.toLowerCase().includes(lower)
    );
  },

  /**
   * 跨源聚合搜索（流式）：服务端分批返回，每来一批就回调一次。
   * 返回取消函数，切关键词 / 关弹窗时调用。
   */
  startAggregateSearch(
    sourceIds: string[],
    query: string,
    onUpdate: (snapshot: AggregateSearchSnapshot) => void
  ): () => void {
    let cancelled = false;
    let sessionId = '';
    let timer: any = null;

    const nativeIds = sourceIds.filter((id) => isNativeSource(id));
    let sources: any[] = [];

    const poll = async () => {
      if (cancelled || !sessionId) return;
      try {
        const snapshot = await nativeCore.post<AggregateSearchSnapshot>('/api/search/poll', {
          search: sessionId,
        });
        if (cancelled) return;
        onUpdate({
          ...snapshot,
          items: (snapshot.items || []).map((item: any) => toDrama(item, item.source)),
        });
        if (snapshot.finished) return;
      } catch (error) {
        console.warn('[search] 轮询失败：', (error as Error).message);
        return;
      }
      timer = setTimeout(poll, 400);
    };

    (async () => {
      // 服务端按 entry.id 认源，这里统一把 payload 的 source 补成 id
      sources = await Promise.all(
        nativeIds.map(async (id) => {
          const payload = await payloadFor(id);
          return { ...payload, id };
        })
      );
      if (!sources.length) {
        onUpdate({
          search: '',
          query,
          items: [],
          sources: [],
          pending: [],
          total: 0,
          done: 0,
          finished: true,
          warning: '暂无支持在线搜索的站源',
        });
        return;
      }
      try {
        const snapshot = await nativeCore.post<AggregateSearchSnapshot>('/api/search/start', {
          sources,
          query,
          page: 1,
        });
        if (cancelled) return;
        sessionId = snapshot.search;
        onUpdate({
          ...snapshot,
          items: (snapshot.items || []).map((item: any) => toDrama(item, item.source)),
        });
        if (!snapshot.finished) timer = setTimeout(poll, 300);
      } catch (error) {
        if (cancelled) return;
        onUpdate({
          search: '',
          query,
          items: [],
          sources: [],
          pending: [],
          total: 0,
          done: 0,
          finished: true,
          warning: (error as Error).message,
        });
      }
    })();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      if (sessionId) {
        nativeCore.post('/api/search/cancel', { search: sessionId }).catch(() => undefined);
      }
    };
  },

  /** 一次性聚合搜索（等全部返回）。 */
  async searchAllSources(query: string): Promise<Drama[]> {
    return new Promise((resolve) => {
      let latest: Drama[] = [];
      const cancel = this.startAggregateSearch(
        this.getAvailableSources().map((source) => source.id),
        query,
        (snapshot) => {
          latest = snapshot.items;
          if (snapshot.finished) {
            cancel();
            resolve(latest);
          }
        }
      );
      setTimeout(() => {
        cancel();
        resolve(latest);
      }, 30000);
    });
  },

  /** 详情 + 分集。 */
  async fetchDramaDetail(dramaId: string, source: string): Promise<DramaDetail> {
    const fallbackDrama: Drama =
      SAMPLE_DRAMAS.find((d) => d.id === dramaId) ||
      SAMPLE_DRAMAS.flatMap((d) => d.peers || []).find((p) => p.id === dramaId) || {
        id: dramaId,
        source: source || 'demo',
        sourceName: sourceNameOf(source),
        title: '影片详情',
        description: '暂无更多详情介绍',
        cover: SAMPLE_DRAMAS[0].cover,
        episodes: 0,
        category: '影视',
        tags: ['影视'],
        releaseStatus: 'unknown',
      };

    if (isNativeSource(source)) {
      const sourceId = String(fallbackDrama.sourceId || dramaId.replace(/^[^:]+:/, ''));
      try {
        const response = await nativeCore.post<any>('/api/detail', {
          ...(await payloadFor(source)),
          sourceId,
        });
        const resultDrama = toDrama({ ...response.drama, id: response.drama?.id || dramaId }, source);
        const episodes = toEpisodes(response.episodes, resultDrama);
        return {
          drama: { ...fallbackDrama, ...resultDrama, cover: resultDrama.cover || fallbackDrama.cover },
          episodes,
          warning: episodes.length === 0 ? '该站源未解析到可播放分集' : undefined,
        };
      } catch (error) {
        return {
          drama: fallbackDrama,
          episodes: [],
          warning: (error as Error).message,
        };
      }
    }

    return { drama: fallbackDrama, episodes: generateEpisodes(fallbackDrama.id, fallbackDrama.episodes || 80, fallbackDrama.title) };
  },

  /**
   * 取播放直链（含多线路备选），返回已代理好的可播地址。
   * HLS 一律走 /api/hls（去广告 + 分片改写），mp4 走 /api/media。
   */
  async resolveStream(
    drama: Drama,
    episode: Episode,
    options: { adBlock?: boolean; force?: boolean } = {}
  ): Promise<ResolvedSource> {
    const cacheKey = `${drama.id}|${episode.id}|${options.adBlock ? 'ad' : 'noad'}`;
    const cached = resolveCache.get(cacheKey);
    if (!options.force && cached && cached.expiresAt > Date.now()) return cached.value;

    const build = (rawUrl: string, referer: string, headers: Record<string, string>): ResolvedSource => {
      const proxy = (url: string, ref: string) =>
        nativeCore.playURL(url, { referer: ref, headers, adBlock: options.adBlock });
      return {
        playUrl: proxy(rawUrl, referer),
        rawUrl,
        referer,
        streamType: mediaTypeOf(rawUrl),
        variants: [],
      };
    };

    if (!isNativeSource(drama.source)) {
      const url = episode.streamUrl || (episode.alternativeRoutes || [])[0] || '';
      if (!url) throw new NativeCoreError('该分集没有播放地址');
      const headers = {};
      const resolved = build(url, episode.referer || '', headers);
      resolved.variants = (episode.alternativeRoutes || [url]).map((raw, index) => ({
        playUrl: nativeCore.playURL(raw, { headers, adBlock: options.adBlock }),
        rawUrl: raw,
        label: `线路 ${index + 1}`,
      }));
      return resolved;
    }

    const sourceId = String(drama.sourceId || drama.id.replace(/^[^:]+:/, ''));
    const response = await nativeCore.post<any>('/api/resolve', {
      ...(await payloadFor(drama.source)),
      sourceId,
      name: `《${drama.title}》${episode.title}`,
      chapter: {
        pageUrl: episode.pageUrl || '',
        videoUrl: episode.videoUrl || episode.streamUrl || '',
        referer: episode.referer || '',
        routes: episode.routes || [],
        index: episode.number,
        chapterKey: episode.chapterKey,
        sourceId,
      },
    });

    const headers: Record<string, string> = response.headers || {};
    const referer = response.referer || episode.referer || '';
    const rawUrl = String(response.url || '');
    if (!rawUrl) throw new NativeCoreError('未取到播放地址');

    const variants: ResolvedSource['variants'] = [];
    const pushVariant = (url: string, ref: string, quality?: number, label?: string) => {
      if (!url) return;
      if (variants.some((item) => item.rawUrl === url)) return;
      variants.push({
        playUrl: nativeCore.playURL(url, { referer: ref || referer, headers, adBlock: options.adBlock }),
        rawUrl: url,
        referer: ref || referer,
        quality,
        label,
      });
    };
    pushVariant(rawUrl, referer, undefined, '主线路');
    for (const variant of response.variants || []) {
      pushVariant(
        String(variant.url || ''),
        String(variant.referer || referer),
        Number(variant.quality) || undefined
      );
    }

    const resolved: ResolvedSource = {
      playUrl: variants[0].playUrl,
      rawUrl,
      referer,
      streamType: mediaTypeOf(rawUrl),
      variants,
    };
    resolveCache.set(cacheKey, { value: resolved, expiresAt: Date.now() + RESOLVE_TTL });
    return resolved;
  },

  /** 规则 / 接口连通性测试。 */
  async testCustomSource(
    source: Partial<CustomSourceSite>
  ): Promise<{ ok: boolean; message: string; details?: any }> {
    try {
      const response = await nativeCore.post<any>('/api/source/test', {
        base: (source.base || '').trim(),
        kind: source.kind || 'xbpq',
        rule: typeof source.xbpqRule === 'object' ? JSON.stringify(source.xbpqRule) : source.rule || '',
      });
      return { ok: true, message: response.message, details: response };
    } catch (error) {
      return { ok: false, message: (error as Error).message };
    }
  },

  /** 订阅 / JSON 文本导入 → 站源草稿。 */
  async importSources(content: string): Promise<CustomSourceSite[]> {
    const response = await nativeCore.post<any>('/api/source/import', { content });
    return (response.drafts || []) as CustomSourceSite[];
  },

  /** 远程订阅地址导入：抓取 + 解析都在本机服务里一次完成（无需前端直连站点）。 */
  async subscribeSources(url: string): Promise<{
    drafts: CustomSourceSite[];
    finalURL?: string;
    preview?: string;
  }> {
    const response = await nativeCore.subscribe(url);
    return {
      drafts: (response.drafts || []) as CustomSourceSite[],
      finalURL: response.finalURL,
      preview: (response as any).preview,
    };
  },

  /** 搜索联想（本地拼音匹配示例库 + 最近目录）。 */
  async getSuggestions(query: string): Promise<string[]> {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const suggestions = new Set<string>();
    SAMPLE_DRAMAS.forEach((d) => {
      if (matchesPinyin(d.title, q)) suggestions.add(d.title);
      d.tags.forEach((t) => {
        if (matchesPinyin(t, q)) suggestions.add(t);
      });
    });
    return [...suggestions].slice(0, 8);
  },

  clearResolveCache() {
    resolveCache.clear();
  },
};

export type { StreamVariant };
