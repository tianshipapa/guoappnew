import React, { useState, useEffect } from 'react';
import {
  Play,
  Bookmark,
  Share2,
  Layers,
  ChevronLeft,
  Flame,
  Clock,
  Sparkles,
  ArrowRight,
  Eye,
  Check,
} from 'lucide-react';
import { Drama, Episode, DramaDetail, UserSettings, HistoryItem } from '../../types';
import { apiService } from '../../services/api';
import { VideoPlayer } from '../player/VideoPlayer';
import { EpisodeDrawer } from '../player/EpisodeDrawer';
import { CoverImage } from '../common/CoverImage';

interface DramaDetailViewProps {
  drama: Drama;
  onBack: () => void;
  isFavorited: boolean;
  onToggleFavorite: (drama: Drama) => void;
  historyItem?: HistoryItem;
  onUpdateHistory: (position: number, duration: number, index: number, epTitle: string) => void;
  settings: UserSettings;
  onUpdateSettings: (settings: UserSettings) => void;
  onSwitchPeer: (peerDrama: Drama) => void;
  /** 详情加载完成后回填真实集数 / 封面等字段，供收藏夹与播放记录使用 */
  onDramaResolved?: (drama: Drama) => void;
  initialResumeIndex?: number;
  initialResumePosition?: number;
}

export const DramaDetailView: React.FC<DramaDetailViewProps> = ({
  drama,
  onBack,
  isFavorited,
  onToggleFavorite,
  historyItem,
  onUpdateHistory,
  settings,
  onUpdateSettings,
  onSwitchPeer,
  onDramaResolved,
  initialResumeIndex,
  initialResumePosition,
}) => {
  const [detail, setDetail] = useState<DramaDetail | null>(null);
  const [currentEpisodeIndex, setCurrentEpisodeIndex] = useState<number>(
    initialResumeIndex ?? (historyItem ? historyItem.index : 0)
  );
  const [episodesReversed, setEpisodesReversed] = useState<boolean>(settings.episodesReversed);
  const [isPlayingMode, setIsPlayingMode] = useState<boolean>(true);
  const [isCopied, setIsCopied] = useState<boolean>(false);

  // Load drama episodes
  useEffect(() => {
    let isMounted = true;
    apiService.fetchDramaDetail(drama.id, drama.source).then((res) => {
      if (!isMounted) return;
      setDetail(res);
      // 列表卡片本身不带集数，详情回来后把真实集数/封面回填给上层，
      // 否则收藏夹会显示「0集」，续播时也只能按兜底集数推算。
      const total = res.episodes?.length || 0;
      const merged: Drama = {
        ...drama,
        ...(res.drama || {}),
        id: drama.id,
        source: drama.source,
        episodes: total || res.drama?.episodes || drama.episodes,
        cover: res.drama?.cover || drama.cover,
        title: res.drama?.title || drama.title,
      };
      onDramaResolved?.(merged);
    });
    return () => {
      isMounted = false;
    };
    // onDramaResolved 每次渲染都是新函数，故意不放进依赖数组，只在换剧时重取详情
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drama.id, drama.source]);

  const episodes = detail?.episodes || [];
  const currentEpisode = episodes[currentEpisodeIndex] || episodes[0];

  const handleShare = () => {
    navigator.clipboard?.writeText(window.location.href);
    setIsCopied(true);
    setTimeout(() => setIsCopied(false), 2000);
  };

  const handleProgress = (pos: number, dur: number) => {
    if (currentEpisode) {
      onUpdateHistory(pos, dur, currentEpisodeIndex, currentEpisode.title);
    }
  };

  const isFinished = drama.releaseStatus === 'finished' || drama.releaseStatus === 'completed';

  return (
    <div className="min-h-screen bg-[#0d101a] text-slate-100 pb-20 animate-in fade-in duration-200">
      {/* Top back & action navigation */}
      <div className="sticky top-0 z-40 bg-[#0d101a]/95 backdrop-blur border-b border-slate-800/80 px-3 md:px-6 py-2.5 flex items-center justify-between">
        <button
          onClick={onBack}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-800/80 hover:bg-slate-750 text-slate-200 text-xs font-semibold border border-slate-700/60 transition-colors"
        >
          <ChevronLeft className="w-4 h-4" />
          <span>返回目录</span>
        </button>

        <div className="flex items-center gap-2">
          {/* Favorite toggle */}
          <button
            onClick={() => onToggleFavorite(drama)}
            className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-semibold border transition-all ${
              isFavorited
                ? 'bg-rose-600 text-white border-rose-500 shadow-sm shadow-rose-950/40'
                : 'bg-slate-800 text-slate-300 border-slate-700 hover:text-white'
            }`}
          >
            <Bookmark className={`w-3.5 h-3.5 ${isFavorited ? 'fill-white' : ''}`} />
            <span>{isFavorited ? '已收藏' : '收藏'}</span>
          </button>

          {/* Share */}
          <button
            onClick={handleShare}
            className="p-1.5 rounded-xl bg-slate-800 hover:bg-slate-750 text-slate-300 border border-slate-700 hover:text-white transition-colors"
            title="分享剧目链接"
          >
            {isCopied ? <Check className="w-4 h-4 text-emerald-400" /> : <Share2 className="w-4 h-4" />}
          </button>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-3 md:px-6 pt-4">
        {/* Main Video Player Surface */}
        {currentEpisode && (
          <div className="mb-6">
            <VideoPlayer
              drama={drama}
              episode={currentEpisode}
              episodeIndex={currentEpisodeIndex}
              totalEpisodes={episodes.length}
              onNextEpisode={() => {
                if (currentEpisodeIndex < episodes.length - 1) {
                  setCurrentEpisodeIndex(currentEpisodeIndex + 1);
                }
              }}
              onPrevEpisode={() => {
                if (currentEpisodeIndex > 0) {
                  setCurrentEpisodeIndex(currentEpisodeIndex - 1);
                }
              }}
              onProgressUpdate={handleProgress}
              initialPosition={initialResumePosition ?? historyItem?.position ?? 0}
              settings={settings}
              onUpdateSettings={onUpdateSettings}
            />
          </div>
        )}

        {/* Drama Info Header Card */}
        <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-4 md:p-6 shadow-xl">
          <div className="flex flex-col md:flex-row gap-5">
            {/* Poster thumbnail */}
            <div className="w-24 sm:w-32 aspect-[3/4] rounded-xl overflow-hidden bg-slate-950 border border-slate-800 shrink-0 shadow-lg">
              <CoverImage
                src={drama.cover}
                source={drama.source}
                alt={drama.title}
                loading="eager"
                className="w-full h-full object-cover"
              />
            </div>

            {/* Details */}
            <div className="flex-1 min-w-0 flex flex-col justify-between">
              <div>
                <div className="flex flex-wrap items-center gap-2 mb-1.5">
                  <span className="px-2 py-0.5 rounded-md bg-rose-600 text-white text-[11px] font-bold shadow-sm">
                    {drama.sourceName || drama.source}
                  </span>

                  <span
                    className={`px-2 py-0.5 rounded-md text-[11px] font-medium ${
                      isFinished ? 'bg-emerald-500/20 text-emerald-300' : 'bg-rose-500/20 text-rose-300'
                    }`}
                  >
                    {isFinished ? '已完结' : '连载中'}
                  </span>

                  {drama.vip && (
                    <span className="px-2 py-0.5 rounded-md bg-amber-500/20 text-amber-300 text-[11px] font-bold">
                      VIP 剧目
                    </span>
                  )}
                </div>

                <h1 className="text-lg md:text-2xl font-extrabold text-slate-100 tracking-tight">
                  {drama.title}
                </h1>

                {/* Stats */}
                <div className="flex items-center gap-4 mt-2 text-xs text-slate-400">
                  {drama.heat && (
                    <span className="flex items-center gap-1 text-amber-400 font-medium">
                      <Flame className="w-3.5 h-3.5 fill-amber-400" />
                      <span>{drama.heat} 热度</span>
                    </span>
                  )}
                  {drama.views && (
                    <span className="flex items-center gap-1 text-slate-300">
                      <Eye className="w-3.5 h-3.5 text-sky-400" />
                      <span>{drama.views} 播放</span>
                    </span>
                  )}
                  <span>共 {episodes.length || drama.episodes} 集</span>
                  {drama.onlineDate && <span>上线：{drama.onlineDate}</span>}
                </div>

                {/* Tags */}
                <div className="flex flex-wrap items-center gap-1.5 mt-2.5">
                  {drama.tags.map((t) => (
                    <span
                      key={t}
                      className="px-2 py-0.5 rounded-md bg-slate-800 text-slate-300 text-[11px]"
                    >
                      {t}
                    </span>
                  ))}
                </div>
              </div>

              {/* Cross-source peers / alternative sources switcher */}
              {drama.peers && drama.peers.length > 0 && (
                <div className="mt-4 pt-3 border-t border-slate-800/80 flex items-center gap-2 flex-wrap">
                  <span className="text-xs text-slate-400 flex items-center gap-1">
                    <Layers className="w-3.5 h-3.5 text-rose-400" />
                    <span>本剧还可在其它站源播放:</span>
                  </span>
                  {drama.peers.map((peer) => (
                    <button
                      key={peer.source}
                      onClick={() => onSwitchPeer(peer)}
                      className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-rose-600/30 text-rose-300 border border-rose-500/30 text-xs font-medium transition-colors flex items-center gap-1"
                    >
                      <span>切换至【{peer.sourceName || peer.source}】</span>
                      <ArrowRight className="w-3 h-3" />
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Synopsis */}
          <div className="mt-4 pt-4 border-t border-slate-800/80">
            <h4 className="text-xs font-bold text-slate-300 uppercase tracking-wider mb-1.5">
              剧情简介
            </h4>
            <p className="text-xs sm:text-sm text-slate-300 leading-relaxed">
              {drama.description}
            </p>
          </div>
        </div>

        {/* Episode Selector Drawer */}
        {episodes.length > 0 && (
          <EpisodeDrawer
            episodes={episodes}
            currentIndex={currentEpisodeIndex}
            onSelectEpisode={(idx) => setCurrentEpisodeIndex(idx)}
            reversed={episodesReversed}
            onToggleReversed={() => {
              const nextRev = !episodesReversed;
              setEpisodesReversed(nextRev);
              onUpdateSettings({ ...settings, episodesReversed: nextRev });
            }}
          />
        )}
      </div>
    </div>
  );
};
