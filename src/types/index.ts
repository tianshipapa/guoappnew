export interface SourceSite {
  id: string;
  name: string;
  description: string;
  onlineSearch?: boolean;
  pagedSearch?: boolean;
  isCustom?: boolean;
  visible?: boolean;
  /** 服务端有原生实现（A123 / 爱看机器人 / XBPQ / MacCMS 接口） */
  native?: boolean;
}

export interface CustomSourceSite {
  id: string;
  name: string;
  base: string;
  rule?: string;
  kind?: 'json' | 'xml' | 'web' | 'xbpq';
  xbpqRule?: any;
  enabled: boolean;
  createdAt: number;
}

export interface Drama {
  id: string;
  source: string;
  sourceName?: string;
  sourceId?: string;
  title: string;
  description: string;
  cover: string;
  episodes: number;
  category: string;
  vip?: boolean;
  heat?: string;
  views?: string;
  onlineDate?: string;
  tags: string[];
  releaseStatus: 'ongoing' | 'finished' | 'completed' | 'unknown' | string;
  peers?: Drama[];
  rating?: string;
  remark?: string;
}

/** 一条可切换线路（同一集在不同线路/码率上的地址）。 */
export interface StreamVariant {
  url: string;
  referer?: string;
  quality?: number;
  label?: string;
}

export interface Episode {
  id: string;
  number: number;
  title: string;
  vip?: boolean;
  duration?: number;
  vertical?: boolean;
  /** 原始播放地址（直链或播放页） */
  streamUrl?: string;
  alternativeRoutes?: string[];
  /** 播放页地址（XBPQ / A123 取流要用） */
  pageUrl?: string;
  videoUrl?: string;
  referer?: string;
  /** 同集在其它线路上的播放页地址 */
  routes?: string[];
  /** 服务端用来定位分集的键（爱看机器人存集号） */
  chapterKey?: string;
  /** 已解析的备选媒体（服务端 resolve 后缓存） */
  variants?: StreamVariant[];
}

export interface DramaDetail {
  drama: Drama;
  episodes: Episode[];
  warning?: string;
}

export interface PlayPlan {
  url: string;
  quality: number;
  qualities: number[];
  routeIndex: number;
  routeCount: number;
  streamType?: 'hls' | 'mp4';
}

export interface HistoryItem {
  id: string;
  source: string;
  sourceName: string;
  title: string;
  cover: string;
  episodes: number | string;
  index: number;
  episodeTitle: string;
  position: number;
  duration: number;
  updatedAt: number;
}

export type FollowStatus = 'want' | 'watching' | 'done';

export interface FavoriteItem {
  id: string;
  source: string;
  sourceName: string;
  title: string;
  cover: string;
  episodes: number | string;
  status: FollowStatus;
  category?: string;
  tags?: string[];
  updatedAt: number;
  lastWatchedIndex?: number;
}

export interface DanmakuItem {
  id: string;
  text: string;
  time: number; // in seconds of video
  color?: string;
  fontSize?: number;
}

export interface LiveChannel {
  key: string;
  name: string;
  number: string;
  group: string;
  urls: string[];
  logo?: string;
  source?: string;
  subtitle?: string;
  epgCurrent?: string;
  headers?: Record<string, string>;
}

export interface LiveGroup {
  name: string;
  channels: LiveChannel[];
}

/** 直播源（列表型 m3u/txt 或 API 面板）。 */
export interface LiveSourceSite {
  id: string;
  name: string;
  description?: string;
  protocol: 'list' | 'pingtai';
  endpoints: string[];
  group?: string;
  headers?: Record<string, string>;
  builtin?: boolean;
}

export interface LivePlatform {
  id: string;
  name: string;
  count?: number;
  logo?: string;
  endpoint?: string;
}

export interface UserSettings {
  autoNext: boolean;
  adBlock: boolean;
  playbackRate: number;
  pictureQuality: {
    mode: 'original' | 'sharpen';
    strength: number; // 0-100
  };
  episodesReversed: boolean;
  allSourcesSearch: boolean;
  tvLetterKeyboard: boolean;
  themeColor: string; // hex or id
  danmakuEnabled: boolean;
}

/** 跨源聚合搜索的快照（服务端流式返回）。 */
export interface AggregateSearchSnapshot {
  search: string;
  query: string;
  items: Drama[];
  sources: string[];
  pending?: string[];
  failures?: Record<string, string>;
  warning?: string;
  total: number;
  done: number;
  finished: boolean;
}
