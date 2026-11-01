// 直播服务客户端：把内置 + 自定义直播源统一交给 server/lib/live 处理。
//
// 服务端不落盘，自定义源的 endpoints/headers 每次随请求带上（来源是 localStorage）。

import { LiveChannel, LivePlatform, LiveSourceSite } from '../types';
import { nativeCore } from './nativeCore';
import { loadLiveSources } from '../utils/storage';

export interface LivePlayback {
  playUrl: string;
  rawUrl: string;
  urls: string[];
  headers: Record<string, string>;
}

function customPayload(): LiveSourceSite[] {
  return loadLiveSources();
}

export const liveService = {
  async listSources(): Promise<LiveSourceSite[]> {
    const response = await nativeCore.post<any>('/api/live/sources', {});
    return (response.sources || []) as LiveSourceSite[];
  },

  /** 直播源列表 = 服务端内置 + 本地自定义（服务端只负责回内置，这里合并）。 */
  async allSources(): Promise<LiveSourceSite[]> {
    const custom = customPayload();
    try {
      const response = await nativeCore.post<any>('/api/live/sources', { custom });
      return (response.sources || []) as LiveSourceSite[];
    } catch {
      return custom.map((item) => ({
        id: item.id,
        name: item.name,
        description: item.description || '',
        protocol: item.protocol || 'list',
        endpoints: item.endpoints,
        group: item.group,
        builtin: false,
      }));
    }
  },

  async platforms(sourceId: string): Promise<LivePlatform[]> {
    const response = await nativeCore.post<any>('/api/live/platforms', {
      sources: customPayload(),
      source: sourceId,
    });
    return (response.platforms || []) as LivePlatform[];
  },

  async channels(sourceId: string, platform: LivePlatform | string): Promise<LiveChannel[]> {
    const response = await nativeCore.post<any>('/api/live/channels', {
      sources: customPayload(),
      source: sourceId,
      platform,
    });
    return (response.channels || []) as LiveChannel[];
  },

  /** 取流并转成可播地址（HLS 走 /api/hls，带原始请求头）。 */
  async play(sourceId: string, channel: LiveChannel, adBlock = true): Promise<LivePlayback> {
    const response = await nativeCore.post<any>('/api/live/play', {
      sources: customPayload(),
      source: sourceId,
      channel,
    });
    const headers: Record<string, string> = response.headers || {};
    const rawUrl = String(response.url || '');
    if (!rawUrl) throw new Error('该频道没有可用线路');
    return {
      playUrl: nativeCore.playURL(rawUrl, { headers, referer: rawUrl, adBlock }),
      rawUrl,
      urls: response.urls || [rawUrl],
      headers,
    };
  },
};
