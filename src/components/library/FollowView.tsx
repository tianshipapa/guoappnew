import React, { useState, useMemo } from 'react';
import { Bookmark, Search, Trash2, CheckSquare, Square, Play, RotateCcw } from 'lucide-react';
import { FavoriteItem, HistoryItem, Drama, FollowStatus } from '../../types';
import { matchesPinyin } from '../../utils/pinyin';
import { SAMPLE_DRAMAS } from '../../data/sampleDramas';

interface FollowViewProps {
  favorites: FavoriteItem[];
  /** 播放记录：用来给收藏项算「看到第几集 / 进度」并支持续播。 */
  history?: HistoryItem[];
  onSelectDrama: (drama: Drama, resumeIndex?: number, resumePos?: number) => void;
  onDeleteItems: (keys: { id: string; source: string }[]) => void;
  onUpdateStatus: (id: string, source: string, status: FollowStatus) => void;
}

export const FollowView: React.FC<FollowViewProps> = ({
  favorites,
  history = [],
  onSelectDrama,
  onDeleteItems,
  onUpdateStatus,
}) => {
  const [activeTab, setActiveTab] = useState<'all' | FollowStatus>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [isEditing, setIsEditing] = useState(false);
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());

  const filteredList = useMemo(() => {
    let list = favorites;
    if (activeTab !== 'all') {
      list = list.filter((x) => x.status === activeTab);
    }
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      list = list.filter((x) => matchesPinyin(x.title, q));
    }
    return list;
  }, [favorites, activeTab, searchQuery]);

  const toggleSelectKey = (key: string) => {
    const next = new Set(selectedKeys);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setSelectedKeys(next);
  };

  const handleSelectAll = () => {
    if (selectedKeys.size === filteredList.length) {
      setSelectedKeys(new Set());
    } else {
      setSelectedKeys(new Set(filteredList.map((item) => `${item.source}|${item.id}`)));
    }
  };

  const handleDeleteSelected = () => {
    const keys = Array.from(selectedKeys).map((k) => {
      const [source, id] = k.split('|');
      return { source, id };
    });
    onDeleteItems(keys);
    setSelectedKeys(new Set());
    setIsEditing(false);
  };

  // 播放记录按 source|id 建索引，用于「看到第几集」与续播
  const historyMap = useMemo(() => {
    const map = new Map<string, HistoryItem>();
    history.forEach((item) => map.set(`${item.source}|${item.id}`, item));
    return map;
  }, [history]);

  const buildDrama = (item: FavoriteItem): Drama => {
    const found = SAMPLE_DRAMAS.find((d) => d.id === item.id) || {
      id: item.id,
      source: item.source,
      sourceName: item.sourceName,
      title: item.title,
      description: '',
      cover: item.cover,
      // 不再兜底 80 集：假集数会被写回播放记录，真实的集数由详情页回填
      episodes: Number(item.episodes) || 0,
      category: item.category || 'urban',
      tags: item.tags || ['我的追剧'],
      releaseStatus: 'ongoing',
    };
    // 收藏 / 记录里存的是完整 id（如 a123:slug），列表页可能带不到 sourceId
    return { ...found, sourceId: found.sourceId || item.id.replace(/^[^:]+:/, '') } as Drama;
  };

  /** 点卡片：有播放记录就续播，没有就从第一集开始。 */
  const handleCardClick = (item: FavoriteItem) => {
    const record = historyMap.get(`${item.source}|${item.id}`);
    onSelectDrama(buildDrama(item), record?.index, record?.position);
  };

  const statusLabels: Record<FollowStatus, { label: string; color: string }> = {
    want: { label: '想看', color: 'bg-amber-500/20 text-amber-400 border-amber-500/30' },
    watching: { label: '在看', color: 'bg-rose-500/20 text-rose-400 border-rose-500/30' },
    done: { label: '已看', color: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30' },
  };

  return (
    <div className="max-w-5xl mx-auto px-3 md:px-6 py-4">
      {/* Top Controls */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-slate-800">
        <div className="flex items-center gap-2">
          <Bookmark className="w-5 h-5 text-rose-500 fill-rose-500" />
          <h2 className="text-base sm:text-lg font-bold text-slate-100">我的收藏夹</h2>
          <span className="text-xs text-slate-500">（共 {favorites.length} 部）</span>
        </div>

        {/* Right tools */}
        <div className="flex items-center gap-2">
          {/* Search inside favorites */}
          <div className="relative flex-1 sm:w-60">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="搜追剧 / 拼音首字母..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-slate-900 border border-slate-700/80 rounded-lg pl-8 pr-3 py-1.5 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-rose-500"
            />
          </div>

          {favorites.length > 0 && (
            <button
              onClick={() => {
                setIsEditing(!isEditing);
                setSelectedKeys(new Set());
              }}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                isEditing
                  ? 'bg-rose-500/20 text-rose-400 border-rose-500/40'
                  : 'bg-slate-800 text-slate-300 border-slate-700 hover:text-white'
              }`}
            >
              {isEditing ? '完成' : '批量管理'}
            </button>
          )}

          {isEditing && (
            <button
              onClick={handleSelectAll}
              className="px-2.5 py-1.5 rounded-lg text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700"
            >
              {selectedKeys.size === filteredList.length ? '取消全选' : '全选'}
            </button>
          )}

          {isEditing && selectedKeys.size > 0 && (
            <button
              onClick={handleDeleteSelected}
              className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-rose-600 hover:bg-rose-500 text-white flex items-center gap-1 shadow-md shadow-rose-950/40"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>删除 ({selectedKeys.size})</span>
            </button>
          )}
        </div>
      </div>

      {/* Status Filter Tabs */}
      <div className="flex items-center gap-1.5 my-3">
        {[
          { id: 'all', label: '全部' },
          { id: 'watching', label: '在看' },
          { id: 'want', label: '想看' },
          { id: 'done', label: '已看' },
        ].map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id as any)}
            className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors ${
              activeTab === tab.id
                ? 'bg-rose-600 text-white shadow-sm font-semibold'
                : 'bg-slate-900 text-slate-400 hover:text-slate-200 border border-slate-800'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Grid List */}
      {filteredList.length === 0 ? (
        <div className="py-20 text-center text-slate-400">
          <Bookmark className="w-12 h-12 text-slate-600 mx-auto mb-3" />
          <p className="text-sm font-semibold text-slate-300">收藏夹还是空的</p>
          <p className="text-xs text-slate-500 mt-1">
            浏览时点「收藏」即可加入，看过之后直接从这里续播
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3 sm:gap-4 mt-2">
          {filteredList.map((item) => {
            const key = `${item.source}|${item.id}`;
            const isSelected = selectedKeys.has(key);
            const statusConfig = statusLabels[item.status || 'watching'];

            return (
              <div
                key={key}
                onClick={() => {
                  if (isEditing) toggleSelectKey(key);
                  else handleCardClick(item);
                }}
                className={`group relative bg-slate-900/60 rounded-xl overflow-hidden border transition-all duration-300 cursor-pointer flex flex-col ${
                  isSelected
                    ? 'border-rose-500 ring-2 ring-rose-500/50'
                    : 'border-slate-800/80 hover:border-rose-500/60'
                }`}
              >
                {/* Poster Container */}
                <div className="relative aspect-[3/4] w-full bg-slate-950 overflow-hidden">
                  <img
                    src={item.cover}
                    alt={item.title}
                    loading="lazy"
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                    onError={(e) => ((e.target as HTMLElement).style.display = 'none')}
                  />

                  {/* Gradient Overlay */}
                  <div className="absolute inset-0 bg-gradient-to-t from-[#0e121d] via-transparent to-black/30 opacity-70" />

                  {/* Checkbox badge if editing */}
                  {isEditing && (
                    <div className="absolute top-2 left-2 z-10">
                      {isSelected ? (
                        <CheckSquare className="w-5 h-5 text-rose-500 fill-white" />
                      ) : (
                        <Square className="w-5 h-5 text-white/80" />
                      )}
                    </div>
                  )}

                  {/* Source Badge */}
                  <div className="absolute top-2 right-2 px-1.5 py-0.5 rounded bg-black/60 text-[10px] text-slate-200 backdrop-blur">
                    {item.sourceName || item.source}
                  </div>

                  {/* Play hover button */}
                  {!isEditing && (
                    <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                      <div className="w-10 h-10 rounded-full bg-rose-600 text-white flex items-center justify-center shadow-lg">
                        <Play className="w-5 h-5 fill-white ml-0.5" />
                      </div>
                    </div>
                  )}

                  {/* Bottom Episodes / 续播进度 */}
                  <div className="absolute bottom-2 left-2 right-2 flex items-end justify-between gap-2">
                    <span className="text-[11px] text-slate-300 font-medium drop-shadow">
                      {item.episodes ? `${item.episodes}集` : ''}
                    </span>
                    {(() => {
                      const record = historyMap.get(`${item.source}|${item.id}`);
                      if (!record) return null;
                      return (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-black/70 text-amber-300 backdrop-blur shrink-0">
                          看到第 {record.index + 1} 集
                        </span>
                      );
                    })()}
                  </div>

                  {/* 卡片底部进度条 */}
                  {(() => {
                    const record = historyMap.get(`${item.source}|${item.id}`);
                    const percent =
                      record && record.duration > 0
                        ? Math.min(100, Math.round((record.position / record.duration) * 100))
                        : 0;
                    if (!record) return null;
                    return (
                      <div className="absolute bottom-0 left-0 right-0 h-1 bg-black/50">
                        <div
                          className="h-full bg-rose-500"
                          style={{ width: `${Math.max(2, percent)}%` }}
                        />
                      </div>
                    );
                  })()}
                </div>

                {/* Info Container */}
                <div className="p-2.5 flex-1 flex flex-col justify-between">
                  <h3 className="text-xs sm:text-sm font-bold text-slate-100 group-hover:text-rose-400 transition-colors line-clamp-1">
                    {item.title}
                  </h3>

                  {/* 续播 / 从头看 */}
                  {!isEditing && (
                    <div className="mt-1.5 flex items-center gap-1.5">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleCardClick(item);
                        }}
                        className="flex-1 px-2 py-1 rounded-md bg-rose-600 hover:bg-rose-500 text-white text-[10px] font-bold flex items-center justify-center gap-1 transition-colors"
                      >
                        <Play className="w-2.5 h-2.5 fill-white" />
                        <span>
                          {historyMap.get(`${item.source}|${item.id}`) ? '继续播放' : '开始播放'}
                        </span>
                      </button>
                      {historyMap.get(`${item.source}|${item.id}`) && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            onSelectDrama(buildDrama(item), 0, 0);
                          }}
                          className="px-1.5 py-1 rounded-md bg-slate-800 hover:bg-slate-700 text-slate-300 text-[10px] font-medium flex items-center gap-1 border border-slate-700"
                          title="从第一集重新播放"
                        >
                          <RotateCcw className="w-2.5 h-2.5" />
                        </button>
                      )}
                    </div>
                  )}

                  {/* Status switcher dropdown or tag */}
                  <div className="mt-2 flex items-center justify-between gap-1 pt-1 border-t border-slate-800/60">
                    <select
                      value={item.status || 'watching'}
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => {
                        e.stopPropagation();
                        onUpdateStatus(item.id, item.source, e.target.value as FollowStatus);
                      }}
                      className="bg-slate-800 text-[10px] font-semibold text-slate-200 border border-slate-700 rounded px-1.5 py-0.5 appearance-none cursor-pointer focus:outline-none"
                    >
                      <option value="watching">在看</option>
                      <option value="want">想看</option>
                      <option value="done">已看</option>
                    </select>

                    <span className="text-[10px] text-slate-500">
                      {historyMap.get(`${item.source}|${item.id}`)
                        ? `${Math.min(
                            100,
                            Math.round(
                              (historyMap.get(`${item.source}|${item.id}`)!.position /
                                Math.max(
                                  1,
                                  historyMap.get(`${item.source}|${item.id}`)!.duration
                                )) *
                                100
                            )
                          )}%`
                        : '未开始'}
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
