import React, { useState, useMemo } from 'react';
import { Play, Trash2, Search, CheckSquare, Square, History } from 'lucide-react';
import { HistoryItem, Drama } from '../../types';
import { matchesPinyin } from '../../utils/pinyin';
import { SAMPLE_DRAMAS } from '../../data/sampleDramas';

interface HistoryViewProps {
  history: HistoryItem[];
  onSelectDrama: (drama: Drama, resumeIndex?: number, resumePos?: number) => void;
  onDeleteItems: (keys: { id: string; source: string }[]) => void;
  onClearAll: () => void;
}

export const HistoryView: React.FC<HistoryViewProps> = ({
  history,
  onSelectDrama,
  onDeleteItems,
  onClearAll,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [isEditing, setIsEditing] = useState(false);
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());

  // Filter history
  const filteredHistory = useMemo(() => {
    if (!searchQuery.trim()) return history;
    const q = searchQuery.trim().toLowerCase();
    return history.filter(
      (item) => matchesPinyin(item.title, q) || matchesPinyin(item.episodeTitle, q)
    );
  }, [history, searchQuery]);

  const toggleSelectKey = (key: string) => {
    const next = new Set(selectedKeys);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setSelectedKeys(next);
  };

  const handleSelectAll = () => {
    if (selectedKeys.size === filteredHistory.length) {
      setSelectedKeys(new Set());
    } else {
      setSelectedKeys(new Set(filteredHistory.map((item) => `${item.source}|${item.id}`)));
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

  const formatTime = (seconds: number) => {
    const total = Math.max(0, Math.floor(seconds || 0));
    const m = Math.floor(total / 60);
    const s = total % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  const formatDate = (timestamp: number) => {
    const date = new Date(timestamp);
    return `${date.getMonth() + 1}月${date.getDate()}日 ${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;
  };

  const handleResumeClick = (item: HistoryItem) => {
    // Find or reconstruct drama
    const found = SAMPLE_DRAMAS.find((d) => d.id === item.id) || {
      id: item.id,
      source: item.source,
      sourceName: item.sourceName,
      title: item.title,
      description: '',
      cover: item.cover,
      episodes: Number(item.episodes) || 80,
      category: 'urban',
      tags: ['观看记录'],
      releaseStatus: 'finished',
    };

    onSelectDrama(found, item.index, item.position);
  };

  return (
    <div className="max-w-5xl mx-auto px-3 md:px-6 py-4">
      {/* Top Controls */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-slate-800">
        <div className="flex items-center gap-2">
          <History className="w-5 h-5 text-rose-500" />
          <h2 className="text-base sm:text-lg font-bold text-slate-100">观看记录</h2>
          <span className="text-xs text-slate-500">（共 {history.length} 条）</span>
        </div>

        <div className="flex items-center gap-2">
          {/* Search bar inside history */}
          <div className="relative flex-1 sm:w-60">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="搜记录 / 支持拼音首字母..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-slate-900 border border-slate-700/80 rounded-lg pl-8 pr-3 py-1.5 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-rose-500"
            />
          </div>

          {/* Edit mode toggle */}
          {history.length > 0 && (
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
              {selectedKeys.size === filteredHistory.length ? '取消全选' : '全选'}
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

          {!isEditing && history.length > 0 && (
            <button
              onClick={onClearAll}
              className="px-2.5 py-1.5 rounded-lg text-xs text-slate-500 hover:text-rose-400 transition-colors"
            >
              清空全部
            </button>
          )}
        </div>
      </div>

      {/* History List */}
      {filteredHistory.length === 0 ? (
        <div className="py-20 text-center text-slate-400">
          <History className="w-12 h-12 text-slate-600 mx-auto mb-3" />
          <p className="text-sm font-semibold text-slate-300">暂无观看记录</p>
          <p className="text-xs text-slate-500 mt-1">
            {searchQuery ? '没有找到匹配的记录' : '快去发现页面挑选精彩短剧播放吧'}
          </p>
        </div>
      ) : (
        <div className="divide-y divide-slate-800/60 mt-2">
          {filteredHistory.map((item) => {
            const key = `${item.source}|${item.id}`;
            const isSelected = selectedKeys.has(key);
            const percent = item.duration > 0 ? Math.round((item.position / item.duration) * 100) : 0;

            return (
              <div
                key={key}
                onClick={() => {
                  if (isEditing) toggleSelectKey(key);
                  else handleResumeClick(item);
                }}
                className="py-3 sm:py-4 flex items-center gap-3 sm:gap-4 group cursor-pointer hover:bg-slate-900/40 px-2 rounded-xl transition-colors"
              >
                {/* Checkbox if in edit mode */}
                {isEditing && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleSelectKey(key);
                    }}
                    className="text-slate-400 hover:text-rose-500"
                  >
                    {isSelected ? (
                      <CheckSquare className="w-5 h-5 text-rose-500 fill-rose-500/20" />
                    ) : (
                      <Square className="w-5 h-5" />
                    )}
                  </button>
                )}

                {/* Poster Cover */}
                <div className="relative w-16 sm:w-20 aspect-[3/4] rounded-lg overflow-hidden bg-slate-950 shrink-0 border border-slate-800">
                  <img
                    src={item.cover}
                    alt={item.title}
                    loading="lazy"
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                    onError={(e) => ((e.target as HTMLElement).style.display = 'none')}
                  />
                  <div className="absolute top-1 left-1 px-1 py-0.2 rounded bg-black/70 text-[9px] text-slate-200">
                    {item.sourceName || item.source}
                  </div>
                </div>

                {/* Content Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm sm:text-base font-bold text-slate-100 group-hover:text-rose-400 transition-colors line-clamp-1">
                      {item.title}
                    </h3>
                  </div>

                  <p className="text-xs text-rose-400 font-medium mt-1">
                    看到第 {item.index + 1} 集
                    {item.episodeTitle ? ` · ${item.episodeTitle}` : ''}
                  </p>

                  <div className="flex items-center gap-3 mt-1.5 text-xs text-slate-400">
                    <span>
                      {formatTime(item.position)} / {formatTime(item.duration)} ({percent}%)
                    </span>
                    <span className="text-slate-600">·</span>
                    <span className="text-[11px] text-slate-500">{formatDate(item.updatedAt)}</span>
                  </div>

                  {/* Progress Bar */}
                  <div className="w-full max-w-md h-1.5 bg-slate-800 rounded-full mt-2 overflow-hidden">
                    <div
                      className="h-full bg-rose-500 rounded-full"
                      style={{ width: `${Math.min(100, Math.max(2, percent))}%` }}
                    />
                  </div>
                </div>

                {/* Play Resume Button */}
                {!isEditing && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleResumeClick(item);
                    }}
                    className="p-2 sm:px-3.5 sm:py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold flex items-center gap-1.5 shadow-md shadow-rose-950/40 shrink-0 transition-colors"
                  >
                    <Play className="w-3.5 h-3.5 fill-white" />
                    <span className="hidden sm:inline">继续播放</span>
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
