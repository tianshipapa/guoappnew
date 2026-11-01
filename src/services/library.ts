// 收藏夹 / 播放记录服务端同步：对应 guoappxp native/server/library.go
//
// 设计：
// - 本机抓取服务（npm run serve / dev 中间件）是「共享库」，数据写在
//   server/data/library.json，换浏览器、换设备访问同一台机器都能看到；
// - localStorage 保留一份镜像：服务没起来时照常可用，起来后自动对齐；
// - 所有写操作先本地立刻生效（乐观更新），再异步同步到服务端，失败只记日志，
//   不打断播放。

import { FavoriteItem, HistoryItem } from '../types';
import { nativeCore } from './nativeCore';
import {
  loadFavorites,
  loadHistory,
  saveFavoritesRaw,
  saveHistoryRaw,
} from '../utils/storage';

export type LibraryList = 'favorites' | 'history';
export type LibraryOp = 'put' | 'remove' | 'clear' | 'toggle';

export interface LibrarySnapshot {
  favorites: FavoriteItem[];
  history: HistoryItem[];
}

/** 服务端连接状态，用于界面上提示「已同步到本机」。 */
export let libraryOnline = false;

function normalize(snapshot: Partial<LibrarySnapshot> | undefined): LibrarySnapshot {
  return {
    favorites: Array.isArray(snapshot?.favorites) ? snapshot.favorites : [],
    history: Array.isArray(snapshot?.history) ? snapshot.history : [],
  };
}

function toFavorite(entry: any): FavoriteItem {
  return {
    id: String(entry?.id || ''),
    source: String(entry?.source || ''),
    sourceName: String(entry?.sourceName || entry?.source || ''),
    title: String(entry?.title || '未命名'),
    cover: String(entry?.cover || ''),
    episodes: entry?.episodes ?? 0,
    status: (entry?.status || 'watching') as FavoriteItem['status'],
    updatedAt: Number(entry?.updatedAt) || Date.now(),
  };
}

function toHistory(entry: any): HistoryItem {
  return {
    id: String(entry?.id || ''),
    source: String(entry?.source || ''),
    sourceName: String(entry?.sourceName || entry?.source || ''),
    title: String(entry?.title || '未命名'),
    cover: String(entry?.cover || ''),
    episodes: entry?.episodes ?? 0,
    index: Number(entry?.index) || 0,
    episodeTitle: String(entry?.episodeTitle || ''),
    position: Number(entry?.position) || 0,
    duration: Number(entry?.duration) || 0,
    updatedAt: Number(entry?.updatedAt) || Date.now(),
  };
}

function decode(payload: any): LibrarySnapshot {
  const data = payload?.data || {};
  return {
    favorites: (Array.isArray(data.favorites) ? data.favorites : []).map(toFavorite),
    history: (Array.isArray(data.history) ? data.history : []).map(toHistory),
  };
}

/** 把服务端快照写入 localStorage 镜像。 */
function mirror(snapshot: LibrarySnapshot) {
  saveFavoritesRaw(snapshot.favorites);
  saveHistoryRaw(snapshot.history);
}

export const libraryService = {
  /** 读取共享库；服务不可用时回落到 localStorage。 */
  async load(): Promise<LibrarySnapshot> {
    try {
      const payload = await nativeCore.get<any>('/api/library');
      const snapshot = decode(payload);
      libraryOnline = true;
      mirror(snapshot);
      return snapshot;
    } catch {
      libraryOnline = false;
      return { favorites: loadFavorites(), history: loadHistory() };
    }
  },

  /** 应用一次写操作；返回最新快照（失败返回 null，调用方保留本地状态）。 */
  async apply(
    list: LibraryList,
    op: LibraryOp,
    options: { item?: any; keys?: string[] } = {}
  ): Promise<LibrarySnapshot | null> {
    try {
      const payload = await nativeCore.post<any>('/api/library', {
        list,
        op,
        item: options.item,
        keys: options.keys,
      });
      const snapshot = decode(payload);
      libraryOnline = true;
      mirror(snapshot);
      return snapshot;
    } catch (error) {
      libraryOnline = false;
      console.warn('[library] 同步到本机服务失败，已保留本地记录：', (error as Error).message);
      return null;
    }
  },

  /** 收藏 / 取消收藏（服务端按 source|id 去重并置顶）。 */
  toggleFavorite(item: FavoriteItem) {
    return this.apply('favorites', 'toggle', { item });
  },

  /** 上报播放进度（同时作为播放记录，用于续播）。 */
  putHistory(item: HistoryItem) {
    return this.apply('history', 'put', { item });
  },

  /** 改收藏状态（想看 / 在看 / 已看）。 */
  async updateFavoriteStatus(item: FavoriteItem, status: FavoriteItem['status']) {
    return this.apply('favorites', 'put', { item: { ...item, status, updatedAt: Date.now() } });
  },

  remove(list: LibraryList, keys: string[]) {
    return this.apply(list, 'remove', { keys });
  },

  clear(list: LibraryList) {
    return this.apply(list, 'clear', {});
  },
};
