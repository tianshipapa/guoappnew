import { SourceSite } from '../types';

export const BUILTIN_SOURCES: SourceSite[] = [
  {
    id: 'a123',
    name: 'A123',
    description: '电影 · 连续剧 · 综艺 · 动漫 · 多线路',
    onlineSearch: true,
    pagedSearch: true,
    native: true,
  },
  {
    id: 'ikanbot',
    name: '爱看机器人',
    description: '电影 · 剧集 · 多线路搜索',
    onlineSearch: true,
    pagedSearch: true,
    native: true,
  },
  {
    id: 'hanxiaoquan',
    name: '韩小圈',
    description: '韩剧 · 韩国电影 · 综艺动漫',
    onlineSearch: true,
    pagedSearch: true,
    native: true,
  },
  {
    id: 'guipian',
    name: '鬼片',
    description: '恐怖片 · 鬼片 · 电视剧 · 动漫',
    onlineSearch: true,
    pagedSearch: true,
    native: true,
  },
];

export const CATEGORIES = [
  { id: '', name: '全部' },
  { id: 'recommend', name: '推荐' },
  { id: 'urban', name: '都市' },
  { id: 'comeback', name: '逆袭' },
  { id: 'god_of_war', name: '战神' },
  { id: 'billionaire', name: '战神神豪' },
  { id: 'sweet_love', name: '甜宠' },
  { id: 'costume', name: '古装' },
  { id: 'transmigration', name: '穿越' },
  { id: 'rebirth', name: '重生' },
  { id: 'suspense', name: '悬疑' },
  { id: 'motion_comic', name: '漫剧' },
  { id: 'ai_drama', name: 'AI 剧' },
  { id: 'family', name: '现代亲情' },
  { id: 'workplace', name: '商战职场' },
];

export const SORT_OPTIONS = [
  { id: 'default', label: '默认排序' },
  { id: 'heat', label: '热度最高' },
  { id: 'views', label: '播放量最多' },
  { id: 'onlineDate', label: '最新上线' },
  { id: 'episodes', label: '集数最多' },
];

export const RELEASE_STATUS_OPTIONS = [
  { id: 'all', label: '全部状态' },
  { id: 'ongoing', label: '连载中' },
  { id: 'finished', label: '已完结' },
];
