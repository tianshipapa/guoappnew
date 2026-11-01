export interface SourceSite {
  id: string;
  name: string;
  description: string;
  onlineSearch?: boolean;
  pagedSearch?: boolean;
  isCustom?: boolean;
  visible?: boolean;
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
}

export interface Episode {
  id: string;
  number: number;
  title: string;
  vip?: boolean;
  duration?: number;
  vertical?: boolean;
  streamUrl?: string;
  alternativeRoutes?: string[];
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
}

export interface LiveGroup {
  name: string;
  channels: LiveChannel[];
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
