import React, { useEffect, useRef, useState, useCallback } from 'react';
import Hls from 'hls.js';
import {
  Play,
  Pause,
  Volume2,
  VolumeX,
  Maximize,
  Minimize,
  RotateCcw,
  SkipForward,
  SkipBack,
  Wifi,
  Sparkles,
  Repeat,
  AlertCircle,
} from 'lucide-react';
import { Episode, Drama, UserSettings } from '../../types';
import { apiService, ResolvedSource } from '../../services/api';

interface VideoPlayerProps {
  drama: Drama;
  episode: Episode;
  episodeIndex: number;
  totalEpisodes: number;
  onNextEpisode: () => void;
  onPrevEpisode: () => void;
  onProgressUpdate: (position: number, duration: number) => void;
  initialPosition?: number;
  settings: UserSettings;
  onUpdateSettings: (settings: UserSettings) => void;
}

const PLAY_RATES = [0.5, 0.75, 1.0, 1.25, 1.5, 2.0, 3.0];

export const VideoPlayer: React.FC<VideoPlayerProps> = ({
  drama,
  episode,
  episodeIndex,
  totalEpisodes,
  onNextEpisode,
  onPrevEpisode,
  onProgressUpdate,
  initialPosition = 0,
  settings,
  onUpdateSettings,
}) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const hlsRef = useRef<Hls | null>(null);

  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [isMuted, setIsMuted] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showControls, setShowControls] = useState(true);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState('');
  const [noticeMessage, setNoticeMessage] = useState('');

  // 播放线路（服务端解析出的多线路备选）
  const [resolved, setResolved] = useState<ResolvedSource | null>(null);
  const [routeIndex, setRouteIndex] = useState(0);
  const routes = resolved?.variants?.length ? resolved.variants : [];

  // Menus
  const [showSpeedMenu, setShowSpeedMenu] = useState(false);
  const [showRouteMenu, setShowRouteMenu] = useState(false);

  const hideControlsTimerRef = useRef<any>(null);
  const lastSavedTimeRef = useRef<number>(0);

  const resetHideTimer = () => {
    setShowControls(true);
    if (hideControlsTimerRef.current) clearTimeout(hideControlsTimerRef.current);
    hideControlsTimerRef.current = setTimeout(() => {
      if (isPlaying) setShowControls(false);
    }, 3500);
  };

  /** 解析当前分集的播放地址（含广告过滤开关）。 */
  useEffect(() => {
    let mounted = true;
    setIsLoading(true);
    setErrorMessage('');
    setResolved(null);
    setRouteIndex(0);

    apiService
      .resolveStream(drama, episode, { adBlock: settings.adBlock })
      .then((result) => {
        if (!mounted) return;
        setResolved(result);
      })
      .catch((error: Error) => {
        if (!mounted) return;
        setIsLoading(false);
        setErrorMessage(error.message || '该分集暂时无法播放');
      });

    return () => {
      mounted = false;
    };
  }, [drama.id, drama.source, episode.id, settings.adBlock]);

  const currentPlayUrl = routes[routeIndex]?.playUrl || resolved?.playUrl || '';

  // Mount Stream (HLS or standard MP4)
  const mountStream = useCallback(
    (url: string, resumeTime: number = 0) => {
      const video = videoRef.current;
      if (!video || !url) return;

      setIsLoading(true);
      setErrorMessage('');

      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }

      const isHlsUrl = url.includes('.m3u8') || url.includes('/api/hls');

      if (isHlsUrl && Hls.isSupported()) {
        const hls = new Hls({ enableWorker: true, lowLatencyMode: true });
        hlsRef.current = hls;

        hls.loadSource(url);
        hls.attachMedia(video);

        hls.on(Hls.Events.MANIFEST_PARSED, () => {
          setIsLoading(false);
          if (resumeTime > 0) {
            try {
              video.currentTime = resumeTime;
            } catch (e) {}
          }
          video.play().catch(() => {});
        });

        hls.on(Hls.Events.ERROR, (_event, data) => {
          if (data.fatal) {
            console.warn('Fatal HLS error, attempting failover route', data);
            handleRouteFailover('网络流加载中断');
          }
        });
      } else {
        video.src = url;
        video.load();
        if (resumeTime > 0) {
          video.addEventListener(
            'loadedmetadata',
            () => {
              try {
                video.currentTime = resumeTime;
              } catch (e) {}
            },
            { once: true }
          );
        }
        video.play().catch(() => {});
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  // Auto failover route
  const handleRouteFailover = (reason?: string) => {
    const total = routes.length || 1;
    const nextRoute = (routeIndex + 1) % total;
    if (total > 1 && nextRoute !== routeIndex) {
      setNoticeMessage(`当前线路加载失败，自动切换至线路 ${nextRoute + 1}/${total}…`);
      setRouteIndex(nextRoute);
      setTimeout(() => setNoticeMessage(''), 4000);
    } else {
      setErrorMessage(reason || '播放失败，请尝试刷新或切换站源');
    }
  };

  // Switch episode or route
  useEffect(() => {
    if (!currentPlayUrl) return;
    mountStream(currentPlayUrl, initialPosition);
    return () => {
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
    };
  }, [currentPlayUrl, episode.id, mountStream]);

  // Video event listeners
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    video.playbackRate = settings.playbackRate;

    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);
    const onWaiting = () => setIsLoading(true);
    const onPlaying = () => {
      setIsLoading(false);
      setIsPlaying(true);
    };

    const onTimeUpdate = () => {
      const pos = video.currentTime;
      setCurrentTime(pos);
      setDuration(video.duration || 0);

      const now = Date.now();
      if (now - lastSavedTimeRef.current > 5000) {
        lastSavedTimeRef.current = now;
        onProgressUpdate(pos, video.duration || 0);
      }
    };

    const onEnded = () => {
      onProgressUpdate(video.duration || 0, video.duration || 0);
      if (settings.autoNext && episodeIndex < totalEpisodes - 1) {
        setNoticeMessage('即将自动播放下一集…');
        setTimeout(() => {
          setNoticeMessage('');
          onNextEpisode();
        }, 1200);
      }
    };

    const onError = () => {
      setIsLoading(false);
      handleRouteFailover('线路加载错误');
    };

    video.addEventListener('play', onPlay);
    video.addEventListener('pause', onPause);
    video.addEventListener('waiting', onWaiting);
    video.addEventListener('playing', onPlaying);
    video.addEventListener('timeupdate', onTimeUpdate);
    video.addEventListener('ended', onEnded);
    video.addEventListener('error', onError);

    return () => {
      video.removeEventListener('play', onPlay);
      video.removeEventListener('pause', onPause);
      video.removeEventListener('waiting', onWaiting);
      video.removeEventListener('playing', onPlaying);
      video.removeEventListener('timeupdate', onTimeUpdate);
      video.removeEventListener('ended', onEnded);
      video.removeEventListener('error', onError);
    };
  }, [settings.playbackRate, settings.autoNext, episodeIndex, totalEpisodes, onNextEpisode, onProgressUpdate]);

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement)?.tagName)) return;

      if (e.code === 'Space') {
        e.preventDefault();
        togglePlay();
      } else if (e.code === 'ArrowRight') {
        e.preventDefault();
        seek(Math.min(duration, currentTime + 5));
      } else if (e.code === 'ArrowLeft') {
        e.preventDefault();
        seek(Math.max(0, currentTime - 5));
      } else if (e.code === 'ArrowUp') {
        e.preventDefault();
        if (episodeIndex > 0) onPrevEpisode();
      } else if (e.code === 'ArrowDown') {
        e.preventDefault();
        if (episodeIndex < totalEpisodes - 1) onNextEpisode();
      } else if (e.code === 'KeyF') {
        e.preventDefault();
        toggleFullscreen();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [currentTime, duration, episodeIndex, totalEpisodes, isPlaying]);

  // 全屏状态跟随浏览器（用户按 Esc / 双击退出时同步图标）
  useEffect(() => {
    const onChange = () => {
      const element =
        document.fullscreenElement || (document as any).webkitFullscreenElement || null;
      setIsFullscreen(Boolean(element));
    };
    document.addEventListener('fullscreenchange', onChange);
    document.addEventListener('webkitfullscreenchange', onChange);
    return () => {
      document.removeEventListener('fullscreenchange', onChange);
      document.removeEventListener('webkitfullscreenchange', onChange);
    };
  }, []);

  const togglePlay = () => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) video.play().catch(() => {});
    else video.pause();
    resetHideTimer();
  };

  const seek = (seconds: number) => {
    const video = videoRef.current;
    if (!video) return;
    try {
      video.currentTime = seconds;
      setCurrentTime(seconds);
    } catch (e) {}
    resetHideTimer();
  };

  const toggleMute = () => {
    const video = videoRef.current;
    if (!video) return;
    const nextMuted = !isMuted;
    video.muted = nextMuted;
    setIsMuted(nextMuted);
    resetHideTimer();
  };

  const handleVolumeChange = (newVol: number) => {
    const video = videoRef.current;
    if (!video) return;
    video.volume = newVol;
    setVolume(newVol);
    setIsMuted(newVol === 0);
    resetHideTimer();
  };

  const setPlaybackRate = (rate: number) => {
    const video = videoRef.current;
    if (!video) return;
    video.playbackRate = rate;
    onUpdateSettings({ ...settings, playbackRate: rate });
    setShowSpeedMenu(false);
    resetHideTimer();
  };

  const toggleFullscreen = useCallback(async () => {
    const container = containerRef.current;
    const video = videoRef.current as
      | (HTMLVideoElement & { webkitEnterFullscreen?: () => void })
      | null;
    if (!container) return;

    // 已在全屏 → 退出
    if (document.fullscreenElement || (document as any).webkitFullscreenElement) {
      try {
        const exit =
          (document as any).exitFullscreen?.bind(document) ||
          (document as any).webkitExitFullscreen?.bind(document);
        if (exit) await exit();
      } catch {
        /* 用户已手动退出 */
      }
      setIsFullscreen(false);
      return;
    }

    // 标准 API + 各浏览器前缀
    const request =
      container.requestFullscreen?.bind(container) ||
      (container as any).webkitRequestFullscreen?.bind(container) ||
      (container as any).msRequestFullscreen?.bind(container);
    if (request) {
      try {
        await request({ navigationUI: 'hide' });
        setIsFullscreen(true);
        resetHideTimer();
        return;
      } catch {
        /* 落到 video 兜底 */
      }
    }

    // iOS Safari：div 无法全屏，只能让 <video> 自己进全屏
    if (video?.webkitEnterFullscreen) {
      video.webkitEnterFullscreen();
      setIsFullscreen(true);
      return;
    }

    setNoticeMessage('当前浏览器不支持网页全屏，可按 F11 使用系统全屏');
    setTimeout(() => setNoticeMessage(''), 3000);
  }, []);

  const formatTime = (seconds: number) => {
    const total = Math.max(0, Math.floor(seconds || 0));
    const m = Math.floor(total / 60);
    const s = total % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  const videoFilterStyle =
    settings.pictureQuality.mode === 'sharpen'
      ? {
          filter: `contrast(${100 + (settings.pictureQuality.strength || 50) * 0.25}%) saturate(${
            100 + (settings.pictureQuality.strength || 50) * 0.15
          }%)`,
        }
      : {};

  return (
    <div
      ref={containerRef}
      onMouseMove={resetHideTimer}
      onClick={resetHideTimer}
      className="player-shell relative w-full aspect-[9/16] sm:aspect-[16/9] max-h-[80vh] bg-black rounded-2xl overflow-hidden shadow-2xl border border-slate-800/80 group select-none flex items-center justify-center"
    >
      <video
        ref={videoRef}
        playsInline
        style={videoFilterStyle}
        className="w-full h-full object-contain cursor-pointer"
        onClick={togglePlay}
      />

      {isLoading && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/40 backdrop-blur-[2px] pointer-events-none z-30">
          <div className="flex flex-col items-center gap-2">
            <div className="w-10 h-10 border-4 border-rose-500 border-t-transparent rounded-full animate-spin" />
            <span className="text-xs font-medium text-slate-300">加载剧集中…</span>
          </div>
        </div>
      )}

      {noticeMessage && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 px-4 py-2 rounded-full bg-slate-900/90 border border-rose-500/40 text-xs text-rose-300 shadow-xl flex items-center gap-2 z-30 animate-pulse">
          <Wifi className="w-3.5 h-3.5" />
          <span>{noticeMessage}</span>
        </div>
      )}

      {errorMessage && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/80 p-4 text-center z-30">
          <AlertCircle className="w-10 h-10 text-rose-500 mb-2" />
          <h4 className="text-sm font-semibold text-slate-200">{errorMessage}</h4>
          <div className="flex items-center gap-2 mt-4">
            <button
              onClick={() => {
                apiService.clearResolveCache();
                if (currentPlayUrl) mountStream(currentPlayUrl, currentTime);
              }}
              className="px-3.5 py-1.5 rounded-lg bg-rose-600 text-white text-xs font-medium hover:bg-rose-500 flex items-center gap-1.5"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>原线路重试</span>
            </button>
            {routes.length > 1 && (
              <button
                onClick={() => handleRouteFailover()}
                className="px-3.5 py-1.5 rounded-lg bg-slate-800 text-slate-200 text-xs font-medium hover:bg-slate-700 border border-slate-700"
              >
                切换下一线路
              </button>
            )}
          </div>
        </div>
      )}

      {/* Top Bar inside Player */}
      <div
        className={`absolute top-0 left-0 right-0 p-4 bg-gradient-to-b from-black/80 via-black/40 to-transparent flex items-center justify-between z-25 transition-opacity duration-300 ${
          showControls ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
      >
        <div className="flex items-center gap-2 min-w-0">
          <span className="px-2 py-0.5 rounded bg-rose-600 text-[11px] font-bold text-white shadow-sm shrink-0">
            {drama.sourceName || drama.source}
          </span>
          <h2 className="text-xs sm:text-sm font-bold text-slate-100 drop-shadow line-clamp-1">
            {drama.title} · {episode.title}
          </h2>
        </div>

        <div className="relative shrink-0">
          <button
            onClick={() => setShowRouteMenu(!showRouteMenu)}
            className="flex items-center gap-1 px-2.5 py-1 rounded-md bg-black/50 hover:bg-black/80 text-[11px] text-slate-300 border border-white/10 backdrop-blur"
          >
            <Wifi className="w-3 h-3 text-emerald-400" />
            <span>
              线路 {routes.length ? routeIndex + 1 : 1}/{Math.max(routes.length, 1)}
            </span>
          </button>

          {showRouteMenu && routes.length > 1 && (
            <div className="absolute right-0 top-full mt-1.5 w-40 max-h-56 overflow-y-auto bg-slate-900 border border-slate-700 rounded-xl shadow-2xl p-1 z-40">
              <div className="px-2 py-1 text-[10px] text-slate-500 uppercase font-semibold">
                播放线路
              </div>
              {routes.map((route, i) => (
                <button
                  key={`${route.rawUrl}_${i}`}
                  onClick={() => {
                    setRouteIndex(i);
                    setShowRouteMenu(false);
                  }}
                  className={`w-full text-left px-2.5 py-1.5 rounded-md text-xs flex items-center justify-between ${
                    routeIndex === i
                      ? 'bg-rose-500/20 text-rose-400 font-semibold'
                      : 'text-slate-300 hover:bg-slate-800'
                  }`}
                >
                  <span className="truncate">
                    {route.label || (route.quality ? `${route.quality}P` : `线路 ${i + 1}`)}
                  </span>
                  {routeIndex === i && <span className="text-[10px]">当前</span>}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {!isPlaying && !isLoading && !errorMessage && (
        <button
          onClick={togglePlay}
          className="absolute w-16 h-16 rounded-full bg-rose-600/90 text-white flex items-center justify-center shadow-2xl shadow-rose-950/60 hover:scale-110 transition-transform z-20"
        >
          <Play className="w-8 h-8 fill-white ml-1" />
        </button>
      )}

      {/* Bottom Controls Bar */}
      <div
        className={`absolute bottom-0 left-0 right-0 p-3 md:p-4 bg-gradient-to-t from-black/90 via-black/50 to-transparent z-25 transition-opacity duration-300 ${
          showControls ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
      >
        <div className="relative group/bar flex items-center mb-2.5 cursor-pointer">
          <input
            type="range"
            min={0}
            max={duration || 100}
            value={currentTime}
            onChange={(e) => seek(Number(e.target.value))}
            className="w-full h-1.5 bg-slate-700/80 rounded-lg appearance-none cursor-pointer accent-rose-500 focus:outline-none"
          />
        </div>

        <div className="flex items-center justify-between text-slate-200">
          <div className="flex items-center gap-2 sm:gap-3">
            <button onClick={togglePlay} className="p-1.5 hover:text-rose-400 transition-colors" title={isPlaying ? '暂停 (Space)' : '播放 (Space)'}>
              {isPlaying ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5 fill-current" />}
            </button>

            <button
              onClick={onPrevEpisode}
              disabled={episodeIndex <= 0}
              className="p-1.5 hover:text-rose-400 disabled:opacity-30 transition-colors"
              title="上一集 (↑)"
            >
              <SkipBack className="w-4 h-4" />
            </button>

            <button
              onClick={onNextEpisode}
              disabled={episodeIndex >= totalEpisodes - 1}
              className="p-1.5 hover:text-rose-400 disabled:opacity-30 transition-colors"
              title="下一集 (↓)"
            >
              <SkipForward className="w-4 h-4" />
            </button>

            <div className="flex items-center gap-1 group/vol">
              <button onClick={toggleMute} className="p-1 hover:text-rose-400 transition-colors">
                {isMuted || volume === 0 ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
              </button>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={isMuted ? 0 : volume}
                onChange={(e) => handleVolumeChange(Number(e.target.value))}
                className="w-14 h-1 bg-slate-700 rounded appearance-none accent-rose-500 cursor-pointer hidden sm:block"
              />
            </div>

            <span className="text-[11px] text-slate-400 font-mono ml-1">
              {formatTime(currentTime)} / {formatTime(duration)}
            </span>
          </div>

          <div className="flex items-center gap-2 relative">
            <button
              onClick={() => onUpdateSettings({ ...settings, autoNext: !settings.autoNext })}
              className={`p-1.5 rounded-md text-xs flex items-center gap-1 transition-colors ${
                settings.autoNext ? 'text-rose-400 font-semibold' : 'text-slate-400 hover:text-slate-200'
              }`}
              title={settings.autoNext ? '自动连播：已开启' : '自动连播：已关闭'}
            >
              <Repeat className="w-3.5 h-3.5" />
              <span className="text-[10px] hidden sm:inline">连播</span>
            </button>

            <div className="relative">
              <button
                onClick={() => setShowSpeedMenu(!showSpeedMenu)}
                className="px-2 py-1 rounded text-xs font-semibold hover:text-rose-400 transition-colors"
              >
                {settings.playbackRate}x
              </button>

              {showSpeedMenu && (
                <div className="absolute right-0 bottom-full mb-2 w-24 bg-slate-900 border border-slate-700 rounded-xl shadow-2xl p-1 z-40">
                  <div className="px-2 py-1 text-[10px] text-slate-500 uppercase font-semibold">
                    播放倍速
                  </div>
                  {PLAY_RATES.map((rate) => (
                    <button
                      key={rate}
                      onClick={() => setPlaybackRate(rate)}
                      className={`w-full text-left px-2.5 py-1.5 rounded-md text-xs ${
                        settings.playbackRate === rate
                          ? 'bg-rose-500/20 text-rose-400 font-bold'
                          : 'text-slate-300 hover:bg-slate-800'
                      }`}
                    >
                      {rate}x
                    </button>
                  ))}
                </div>
              )}
            </div>

            <button
              onClick={() =>
                onUpdateSettings({
                  ...settings,
                  pictureQuality: {
                    ...settings.pictureQuality,
                    mode: settings.pictureQuality.mode === 'sharpen' ? 'original' : 'sharpen',
                  },
                })
              }
              className={`p-1.5 rounded-md text-xs flex items-center gap-1 transition-colors ${
                settings.pictureQuality.mode === 'sharpen'
                  ? 'text-amber-400 bg-amber-500/10'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
              title="画质增强 / 画面锐化"
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span className="text-[10px] hidden md:inline">
                {settings.pictureQuality.mode === 'sharpen' ? '锐化开' : '原画'}
              </span>
            </button>

            <button onClick={toggleFullscreen} className="p-1.5 hover:text-rose-400 transition-colors" title="全屏 (F)">
              {isFullscreen ? <Minimize className="w-4 h-4" /> : <Maximize className="w-4 h-4" />}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
