import React from 'react';
import { Bookmark, Flame, Play, Eye } from 'lucide-react';
import { Drama } from '../../types';
import { CoverImage } from '../common/CoverImage';

interface DramaCardProps {
  drama: Drama;
  onSelect: (drama: Drama) => void;
  isFavorited?: boolean;
  onToggleFavorite?: (drama: Drama, e: React.MouseEvent) => void;
  progressPercent?: number;
}

export const DramaCard: React.FC<DramaCardProps> = ({
  drama,
  onSelect,
  isFavorited = false,
  onToggleFavorite,
  progressPercent,
}) => {
  const isFinished = drama.releaseStatus === 'finished' || drama.releaseStatus === 'completed';

  return (
    <div
      onClick={() => onSelect(drama)}
      className="group relative bg-slate-900/60 rounded-xl overflow-hidden border border-slate-800/80 hover:border-rose-500/60 hover:shadow-lg hover:shadow-rose-950/20 transition-all duration-300 cursor-pointer flex flex-col"
    >
      {/* Poster Container */}
      <div className="relative aspect-[3/4] w-full overflow-hidden bg-slate-950">
        <CoverImage
          src={drama.cover}
          source={drama.source}
          alt={drama.title}
          loading="lazy"
          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
        />

        {/* Gradient Overlay */}
        <div className="absolute inset-0 bg-gradient-to-t from-[#0e121d] via-transparent to-black/30 opacity-80 group-hover:opacity-60 transition-opacity" />

        {/* Top Badges：3 列布局下卡片只有 ~120px 宽，小屏只留状态徽章，
            源名交给下方标签区，避免出现「爱看机…」这种半截文字 */}
        <div className="absolute top-2 left-2 right-2 flex items-center justify-end sm:justify-between gap-1 pointer-events-none">
          <span className="hidden sm:inline-block px-1.5 py-0.5 text-[10px] font-semibold rounded bg-black/60 backdrop-blur-md text-slate-200 border border-white/10 truncate max-w-[52%] min-w-0">
            {drama.sourceName || drama.source}
          </span>

          <div className="flex items-center gap-1 shrink-0">
            {drama.vip && (
              <span className="px-1.5 py-0.5 text-[10px] font-bold rounded bg-amber-500 text-black shadow-sm">
                VIP
              </span>
            )}
            <span
              className={`px-1 py-0.5 text-[10px] font-medium rounded backdrop-blur-md whitespace-nowrap ${
                isFinished ? 'bg-emerald-600/80 text-white' : 'bg-rose-600/80 text-white'
              }`}
            >
              {isFinished ? '完结' : '连载'}
            </span>
          </div>
        </div>

        {/* Play Icon on hover */}
        <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
          <div className="w-12 h-12 rounded-full bg-rose-600/90 text-white flex items-center justify-center shadow-xl shadow-rose-900/50 scale-75 group-hover:scale-100 transition-transform">
            <Play className="w-6 h-6 fill-white ml-0.5" />
          </div>
        </div>

        {/* Favorite Bookmark Button */}
        {onToggleFavorite && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onToggleFavorite(drama, e);
            }}
            className={`absolute bottom-2 right-2 p-1.5 rounded-full backdrop-blur-md transition-all ${
              isFavorited
                ? 'bg-rose-600 text-white shadow-md'
                : 'bg-black/50 text-slate-300 hover:text-white hover:bg-black/80'
            }`}
            title={isFavorited ? '取消追剧' : '追剧 / 收藏'}
          >
            <Bookmark className={`w-3.5 h-3.5 ${isFavorited ? 'fill-white' : ''}`} />
          </button>
        )}

        {/* Bottom meta stats */}
        <div className="absolute bottom-2 left-2 text-[11px] text-slate-300 flex items-center gap-1.5 font-medium drop-shadow pointer-events-none">
          {drama.heat && (
            <span className="flex items-center gap-0.5 text-amber-300">
              <Flame className="w-3 h-3 fill-amber-400" />
              {drama.heat}
            </span>
          )}
          <span>{drama.episodes ? `${drama.episodes}集` : ''}</span>
        </div>

        {/* Watch Progress Bar if available */}
        {typeof progressPercent === 'number' && progressPercent > 0 && (
          <div className="absolute bottom-0 left-0 right-0 h-1 bg-slate-800">
            <div
              className="h-full bg-rose-500"
              style={{ width: `${Math.min(100, progressPercent)}%` }}
            />
          </div>
        )}
      </div>

      {/* Info Container */}
      <div className="p-2 sm:p-2.5 flex-1 flex flex-col justify-between">
        <div>
          <h3
            className="text-[11px] sm:text-xs md:text-sm font-semibold text-slate-100 group-hover:text-rose-400 transition-colors line-clamp-1"
            title={drama.title}
          >
            {drama.title}
          </h3>

          {/* 3 列布局下卡片很窄，描述只在大屏显示一行，避免挤压封面 */}
          <div className="mt-1 hidden sm:block">
            <p className="text-[11px] text-slate-400 line-clamp-1 leading-relaxed">
              {drama.description}
            </p>
          </div>
        </div>

        {/* Tags and Peers */}
        <div className="mt-2 pt-2 border-t border-slate-800/60 flex flex-wrap items-center gap-1">
          {drama.tags.slice(0, 2).map((tag) => (
            <span
              key={tag}
              className="px-1.5 py-0.5 text-[10px] rounded bg-slate-800 text-slate-300"
            >
              {tag}
            </span>
          ))}

          {/* Cross-source peers badges */}
          {drama.peers && drama.peers.length > 0 && (
            <div className="ml-auto flex items-center gap-0.5 text-[9px] text-slate-400">
              <span className="text-slate-500">其它源:</span>
              {drama.peers.map((p) => (
                <span
                  key={p.source}
                  className="px-1 py-0.2 rounded bg-slate-800/80 text-rose-300 border border-rose-500/20"
                >
                  {p.sourceName || p.source}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
