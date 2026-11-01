import React, { useState, useMemo } from 'react';
import { ArrowUpDown, Play, Check } from 'lucide-react';
import { Episode } from '../../types';

interface EpisodeDrawerProps {
  episodes: Episode[];
  currentIndex: number;
  onSelectEpisode: (index: number) => void;
  reversed: boolean;
  onToggleReversed: () => void;
}

export const EpisodeDrawer: React.FC<EpisodeDrawerProps> = ({
  episodes,
  currentIndex,
  onSelectEpisode,
  reversed,
  onToggleReversed,
}) => {
  const [jumpNumber, setJumpNumber] = useState('');
  const total = episodes.length;

  // Group by 50 episodes per tab
  const rangeSize = 50;
  const tabCount = Math.max(1, Math.ceil(total / rangeSize));
  const activeTabDefault = Math.floor(currentIndex / rangeSize);
  const [activeTab, setActiveTab] = useState(activeTabDefault);

  // Filter episodes for current range tab
  const currentRangeEpisodes = useMemo(() => {
    const start = activeTab * rangeSize;
    const end = Math.min(total, start + rangeSize);
    const slice = episodes.slice(start, end).map((ep, idx) => ({
      ...ep,
      originalIndex: start + idx,
    }));
    return reversed ? [...slice].reverse() : slice;
  }, [episodes, activeTab, rangeSize, reversed, total]);

  const handleJump = (e: React.FormEvent) => {
    e.preventDefault();
    const num = parseInt(jumpNumber, 10);
    if (!isNaN(num) && num >= 1 && num <= total) {
      onSelectEpisode(num - 1);
      setActiveTab(Math.floor((num - 1) / rangeSize));
      setJumpNumber('');
    }
  };

  return (
    <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-3 md:p-4 mt-4">
      {/* Drawer Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-800">
        <div className="flex items-center gap-2">
          <h3 className="text-sm md:text-base font-bold text-slate-100">剧集选集</h3>
          <span className="text-xs text-slate-400">
            共 {total} 集 · 当前第 {currentIndex + 1} 集
          </span>
        </div>

        {/* Controls: Reverse toggle & Jump Input */}
        <div className="flex items-center gap-2">
          <button
            onClick={onToggleReversed}
            className={`flex items-center gap-1 text-xs px-2.5 py-1 rounded-lg border transition-colors ${
              reversed
                ? 'bg-rose-500/20 text-rose-400 border-rose-500/40'
                : 'bg-slate-800 text-slate-300 border-slate-700 hover:text-white'
            }`}
            title="切换选集正序或倒序"
          >
            <ArrowUpDown className="w-3 h-3" />
            <span>{reversed ? '倒序' : '正序'}</span>
          </button>

          {/* Jump form */}
          <form onSubmit={handleJump} className="flex items-center gap-1">
            <input
              type="number"
              placeholder={`1-${total}`}
              value={jumpNumber}
              onChange={(e) => setJumpNumber(e.target.value)}
              min={1}
              max={total}
              className="w-16 bg-slate-800 text-xs text-center text-slate-200 border border-slate-700 rounded-md py-1 px-1 focus:outline-none focus:border-rose-500"
            />
            <button
              type="submit"
              className="bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs px-2 py-1 rounded-md border border-slate-700 transition-colors"
            >
              跳转
            </button>
          </form>
        </div>
      </div>

      {/* Range Tabs (e.g. 1-50, 51-100) if > 50 episodes */}
      {tabCount > 1 && (
        <div className="flex items-center gap-2 py-2 overflow-x-auto no-scrollbar border-b border-slate-800/60">
          {Array.from({ length: tabCount }).map((_, i) => {
            const start = i * rangeSize + 1;
            const end = Math.min(total, (i + 1) * rangeSize);
            const isTabActive = activeTab === i;
            return (
              <button
                key={i}
                onClick={() => setActiveTab(i)}
                className={`px-3 py-1 rounded-md text-xs font-medium whitespace-nowrap transition-colors ${
                  isTabActive
                    ? 'bg-rose-600 text-white shadow-sm'
                    : 'bg-slate-800/60 text-slate-400 hover:text-slate-200'
                }`}
              >
                {start}-{end}
              </button>
            );
          })}
        </div>
      )}

      {/* Episodes Grid */}
      <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 lg:grid-cols-10 gap-2 mt-3 max-h-72 overflow-y-auto pr-1">
        {currentRangeEpisodes.map((ep) => {
          const isPlaying = ep.originalIndex === currentIndex;
          const isWatched = ep.originalIndex < currentIndex;

          return (
            <button
              key={ep.id}
              onClick={() => onSelectEpisode(ep.originalIndex)}
              className={`relative flex flex-col items-center justify-center py-2 px-1 rounded-xl text-xs font-medium border transition-all ${
                isPlaying
                  ? 'bg-rose-600 text-white border-rose-500 shadow-md shadow-rose-950/40 scale-105 z-10'
                  : 'bg-slate-800/80 hover:bg-slate-750 text-slate-200 border-slate-700/60 hover:border-slate-500'
              }`}
            >
              {/* Playing indicator */}
              {isPlaying && (
                <div className="absolute top-1 right-1">
                  <Play className="w-2.5 h-2.5 fill-white" />
                </div>
              )}

              {/* VIP badge */}
              {ep.vip && !isPlaying && (
                <span className="absolute top-0.5 right-1 text-[8px] text-amber-400 font-bold">
                  VIP
                </span>
              )}

              <span className="text-sm font-bold">{ep.number}</span>
              <span className="text-[10px] text-slate-400/80 line-clamp-1 scale-90">
                {ep.title.replace(/^第\d+集\s*/, '') || `第${ep.number}集`}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
};
