import React, { useCallback, useEffect, useRef, useState } from 'react';
import Hls from 'hls.js';
import {
  Tv,
  Play,
  Pause,
  Volume2,
  VolumeX,
  Maximize,
  Radio,
  RefreshCw,
  Settings2,
  Plus,
  Trash2,
  Loader2,
  AlertCircle,
  X,
} from 'lucide-react';
import { LiveChannel, LivePlatform, LiveSourceSite } from '../../types';
import { liveService } from '../../services/live';
import type { LivePlayback } from '../../services/live';
import {
  deleteLiveSource,
  loadLastLiveSource,
  loadLiveSources,
  loadUserSettings,
  saveLastLiveSource,
  saveLiveSource,
} from '../../utils/storage';

export const LiveView: React.FC = () => {
  const [sources, setSources] = useState<LiveSourceSite[]>([]);
  const [activeSourceId, setActiveSourceId] = useState<string>(() => loadLastLiveSource());
  const [platforms, setPlatforms] = useState<LivePlatform[]>([]);
  const [activePlatformId, setActivePlatformId] = useState<string>('all');
  const [channels, setChannels] = useState<LiveChannel[]>([]);
  const [activeChannel, setActiveChannel] = useState<LiveChannel | null>(null);
  const [playback, setPlayback] = useState<LivePlayback | null>(null);
  const [error, setError] = useState<string>('');
  const [isBooting, setIsBooting] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [showManager, setShowManager] = useState(false);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const hlsRef = useRef<Hls | null>(null);

  // ---- 直播源列表 ----
  const refreshSources = useCallback(async () => {
    setIsBooting(true);
    try {
      const list = await liveService.allSources();
      setSources(list);
      setError('');
      // 上次选中的源可能已被删除，回落到第一个内置源
      setActiveSourceId((current) => {
        if (list.some((item) => item.id === current)) return current;
        const fallback = list.find((item) => item.builtin) || list[0];
        return fallback?.id || current;
      });
    } catch (e: any) {
      setError(e?.message || '直播源列表加载失败，请确认本地抓取服务已启动');
    } finally {
      setIsBooting(false);
    }
  }, []);

  useEffect(() => {
    void refreshSources();
  }, [refreshSources]);

  // ---- 分类 ----
  useEffect(() => {
    if (!activeSourceId) return;
    let cancelled = false;
    setPlatforms([]);
    // 换源时先清空分类，否则会用旧分类 id 去请求新源
    setActivePlatformId('');
    setChannels([]);
    setActiveChannel(null);
    setPlayback(null);
    setError('');

    liveService
      .platforms(activeSourceId)
      .then((list) => {
        if (cancelled) return;
        setPlatforms(list);
        setActivePlatformId(list[0]?.id || 'all');
      })
      .catch((e: any) => {
        if (cancelled) return;
        setError(e?.message || '该直播源暂无分类');
      });

    saveLastLiveSource(activeSourceId);
    return () => {
      cancelled = true;
    };
  }, [activeSourceId]);

  // ---- 频道 ----
  useEffect(() => {
    if (!activeSourceId || !activePlatformId) return;
    let cancelled = false;
    setIsLoading(true);
    setChannels([]);
    setActiveChannel(null);
    setPlayback(null);

    const platform = platforms.find((item) => item.id === activePlatformId);
    liveService
      .channels(activeSourceId, platform || activePlatformId)
      .then((list) => {
        if (cancelled) return;
        setChannels(list);
        setActiveChannel(list[0] || null);
        if (!list.length) setError('该分类下没有可用频道');
        else setError('');
      })
      .catch((e: any) => {
        if (cancelled) return;
        setError(e?.message || '频道列表加载失败');
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [activeSourceId, activePlatformId, platforms]);

  // ---- 取流 ----
  useEffect(() => {
    if (!activeSourceId || !activeChannel) return;
    let cancelled = false;
    setIsLoading(true);
    setPlayback(null);

    liveService
      .play(activeSourceId, activeChannel, loadUserSettings().adBlock)
      .then((result) => {
        if (cancelled) return;
        setPlayback(result);
        setError('');
      })
      .catch((e: any) => {
        if (cancelled) return;
        setError(e?.message || '取流失败');
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [activeSourceId, activeChannel]);

  // ---- 挂载播放器 ----
  useEffect(() => {
    const video = videoRef.current;
    const url = playback?.playUrl;
    if (!video || !url) return;

    setIsLoading(true);
    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }

    const isHls = url.includes('.m3u8') || url.includes('/api/hls');
    if (isHls && Hls.isSupported()) {
      const hls = new Hls({ enableWorker: true, lowLatencyMode: true });
      hlsRef.current = hls;
      hls.loadSource(url);
      hls.attachMedia(video);
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        setIsLoading(false);
        video.play().catch(() => {});
      });
      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (data.fatal) {
          setError('直播信号中断，可尝试切换其他频道');
          setIsLoading(false);
        }
      });
    } else {
      video.src = url;
      video.load();
      video.play().catch(() => {});
      setIsLoading(false);
    }

    return () => {
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
    };
  }, [playback?.playUrl]);

  const togglePlay = () => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      video.play().catch(() => {});
      setIsPlaying(true);
    } else {
      video.pause();
      setIsPlaying(false);
    }
  };

  const toggleMute = () => {
    const video = videoRef.current;
    if (!video) return;
    video.muted = !video.muted;
    setIsMuted(video.muted);
  };

  const toggleFullscreen = () => {
    const video = videoRef.current;
    if (!video) return;
    if (video.requestFullscreen) video.requestFullscreen().catch(() => {});
  };

  const activeSource = sources.find((item) => item.id === activeSourceId);

  return (
    <div className="max-w-6xl mx-auto px-3 md:px-6 py-4">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 pb-3 mb-4 border-b border-slate-800">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-amber-500/20 text-amber-400 border border-amber-500/30 flex items-center justify-center">
            <Tv className="w-4 h-4" />
          </div>
          <div>
            <h2 className="text-base sm:text-lg font-bold text-slate-100 flex items-center gap-2">
              <span>电视直播</span>
              <span className="flex items-center gap-1 text-[10px] text-rose-400 bg-rose-500/20 border border-rose-500/30 px-2 py-0.5 rounded-full">
                <Radio className="w-2.5 h-2.5" />
                <span>LIVE</span>
              </span>
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              {activeSource?.description || '内置公开直播源 + 自定义 m3u / txt / API 面板'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => void refreshSources()}
            className="p-2 rounded-lg bg-slate-800 text-slate-300 hover:text-white transition-colors"
            title="刷新直播源"
          >
            <RefreshCw className={`w-4 h-4 ${isBooting ? 'animate-spin' : ''}`} />
          </button>
          <button
            onClick={() => setShowManager(true)}
            className="px-3 py-2 rounded-lg bg-slate-800 text-slate-300 hover:text-white text-xs font-medium flex items-center gap-1.5 transition-colors"
          >
            <Settings2 className="w-3.5 h-3.5" />
            <span>管理直播源</span>
          </button>
        </div>
      </div>

      {/* Source switcher */}
      <div className="flex items-center gap-1.5 pb-3 overflow-x-auto no-scrollbar">
        {sources.map((source) => (
          <button
            key={source.id}
            onClick={() => setActiveSourceId(source.id)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-colors flex items-center gap-1.5 ${
              activeSourceId === source.id
                ? 'bg-amber-500 text-black font-bold shadow-sm'
                : 'bg-slate-800 text-slate-300 hover:text-white'
            }`}
          >
            <span>{source.name}</span>
            {!source.builtin && (
              <span className="text-[9px] px-1 rounded bg-black/20">自定义</span>
            )}
          </button>
        ))}
        {!sources.length && !isBooting && (
          <span className="text-xs text-slate-500">暂无直播源，请点击「管理直播源」添加</span>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Player */}
        <div className="lg:col-span-2 flex flex-col gap-3">
          <div className="relative aspect-video bg-black rounded-2xl overflow-hidden shadow-2xl border border-slate-800 flex items-center justify-center group">
            <video
              ref={videoRef}
              playsInline
              className="w-full h-full object-contain cursor-pointer"
              onClick={togglePlay}
              onPlay={() => setIsPlaying(true)}
              onPause={() => setIsPlaying(false)}
            />

            {isLoading && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/60 pointer-events-none">
                <div className="flex flex-col items-center gap-2 text-xs text-slate-300">
                  <div className="w-8 h-8 border-[3px] border-amber-500 border-t-transparent rounded-full animate-spin" />
                  <span>正在缓冲直播信号…</span>
                </div>
              </div>
            )}

            {!isLoading && error && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/70 px-6 text-center">
                <div className="flex flex-col items-center gap-2 text-xs text-rose-300 max-w-xs">
                  <AlertCircle className="w-6 h-6" />
                  <span>{error}</span>
                  <span className="text-[11px] text-slate-500">
                    部分公开源在特定网络下不可达，可切换源或频道重试
                  </span>
                </div>
              </div>
            )}

            {activeChannel && (
              <div className="absolute top-3 left-3 flex items-center gap-2 pointer-events-none">
                <span className="px-2 py-0.5 rounded bg-rose-600 text-white text-[11px] font-bold flex items-center gap-1 shadow-md">
                  <span className="w-1.5 h-1.5 rounded-full bg-white animate-ping" />
                  LIVE
                </span>
                <span className="px-2 py-0.5 rounded bg-black/70 backdrop-blur text-slate-200 text-xs font-semibold">
                  {activeChannel.name}
                </span>
              </div>
            )}

            <div className="absolute bottom-0 left-0 right-0 p-3 bg-gradient-to-t from-black/90 to-transparent flex items-center justify-between text-slate-200 opacity-0 group-hover:opacity-100 transition-opacity">
              <div className="flex items-center gap-3">
                <button onClick={togglePlay} className="p-1 hover:text-amber-400 transition-colors">
                  {isPlaying ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5 fill-current" />}
                </button>
                <button onClick={toggleMute} className="p-1 hover:text-amber-400 transition-colors">
                  {isMuted ? <VolumeX className="w-5 h-5" /> : <Volume2 className="w-5 h-5" />}
                </button>
                <span className="text-xs text-slate-300 font-medium">
                  {activeChannel?.group || '高清直播中'}
                </span>
              </div>
              <button onClick={toggleFullscreen} className="p-1 hover:text-amber-400 transition-colors">
                <Maximize className="w-4 h-4" />
              </button>
            </div>
          </div>

          {activeChannel && (
            <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-3 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-mono font-bold text-amber-400 bg-amber-500/10 px-1.5 py-0.5 rounded border border-amber-500/20">
                    CH {activeChannel.number}
                  </span>
                  <h3 className="text-sm font-bold text-slate-100 truncate">{activeChannel.name}</h3>
                </div>
                <p className="text-xs text-slate-400 mt-1 truncate">
                  {activeChannel.group}
                  {playback?.urls && playback.urls.length > 1 ? ` · ${playback.urls.length} 条线路` : ''}
                </p>
              </div>
              <div className="shrink-0 px-3 py-1 rounded-lg bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 text-xs font-medium flex items-center gap-1">
                <span className={`w-2 h-2 rounded-full bg-emerald-400 ${playback ? 'animate-pulse' : ''}`} />
                <span>{playback ? '信号就绪' : '待连接'}</span>
              </div>
            </div>
          )}
        </div>

        {/* Category + Channels */}
        <div className="bg-slate-900/70 border border-slate-800 rounded-2xl p-4 flex flex-col h-[520px]">
          <div className="flex items-center gap-1.5 pb-3 border-b border-slate-800 overflow-x-auto no-scrollbar shrink-0">
            {platforms.map((item) => (
              <button
                key={item.id}
                onClick={() => setActivePlatformId(item.id)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-colors ${
                  activePlatformId === item.id
                    ? 'bg-amber-500 text-black font-bold shadow-sm'
                    : 'bg-slate-800 text-slate-300 hover:text-white'
                }`}
              >
                {item.name}
                {item.count ? <span className="ml-1 opacity-60">{item.count}</span> : null}
              </button>
            ))}
          </div>

          <div className="flex-1 overflow-y-auto mt-3 divide-y divide-slate-800/60 pr-1">
            {isLoading && !channels.length && (
              <div className="flex items-center justify-center gap-2 py-10 text-xs text-slate-400">
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>加载频道…</span>
              </div>
            )}

            {channels.map((channel) => {
              const isSelected = activeChannel?.key === channel.key;
              return (
                <button
                  key={channel.key}
                  onClick={() => setActiveChannel(channel)}
                  className={`w-full py-2.5 px-3 flex items-center justify-between gap-2 text-left rounded-xl transition-all my-1 ${
                    isSelected
                      ? 'bg-amber-500/15 border border-amber-500/40 text-amber-300'
                      : 'hover:bg-slate-800/80 text-slate-300 hover:text-white'
                  }`}
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <span className="w-8 shrink-0 font-mono text-xs font-bold text-slate-400">
                      {channel.number}
                    </span>
                    <div className="min-w-0">
                      <div className="text-xs sm:text-sm font-semibold truncate">{channel.name}</div>
                      <div className="text-[11px] text-slate-500 truncate">{channel.group}</div>
                    </div>
                  </div>
                  {isSelected && (
                    <span className="shrink-0 text-[10px] text-amber-400 font-bold px-1.5 py-0.5 rounded bg-amber-400/20">
                      播放中
                    </span>
                  )}
                </button>
              );
            })}

            {!isLoading && !channels.length && (
              <div className="py-10 text-center text-xs text-slate-500">该分类暂无频道</div>
            )}
          </div>
        </div>
      </div>

      {showManager && (
        <LiveSourceManager
          sources={sources}
          onClose={() => setShowManager(false)}
          onChanged={async () => {
            await refreshSources();
          }}
        />
      )}
    </div>
  );
};

/** 直播源管理：内置源只读，自定义源可增删（存 localStorage，随请求带给服务端）。 */
const LiveSourceManager: React.FC<{
  sources: LiveSourceSite[];
  onClose: () => void;
  onChanged: () => Promise<void> | void;
}> = ({ sources, onClose, onChanged }) => {
  const [name, setName] = useState('');
  const [urls, setUrls] = useState('');
  const [protocol, setProtocol] = useState<'list' | 'pingtai'>('list');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  const builtin = sources.filter((item) => item.builtin);
  // 服务端只回内置源（带 builtin 标记），自定义源的 endpoints 只在本地，直接从存储读
  const custom = loadLiveSources();

  const submit = async () => {
    const trimmedName = name.trim();
    const endpoints = urls
      .split(/[\n,]/)
      .map((item) => item.trim())
      .filter(Boolean);
    if (!trimmedName) {
      setMessage('请填写直播源名称');
      return;
    }
    if (!endpoints.length) {
      setMessage('请至少填写一个地址（m3u / txt / 面板地址）');
      return;
    }
    setBusy(true);
    setMessage('');
    try {
      saveLiveSource({
        id: `custom-live-${Date.now()}`,
        name: trimmedName,
        description: protocol === 'pingtai' ? 'API 面板源' : 'm3u / txt 列表源',
        protocol,
        endpoints,
        group: trimmedName,
        builtin: false,
      });
      setName('');
      setUrls('');
      await onChanged();
      setMessage('已添加');
    } catch (e: any) {
      setMessage(e?.message || '添加失败');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    setBusy(true);
    try {
      deleteLiveSource(id);
      await onChanged();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-3">
      <div className="w-full max-w-xl max-h-[86vh] overflow-y-auto bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl">
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800 sticky top-0 bg-slate-900 z-10">
          <h3 className="text-sm font-bold text-slate-100 flex items-center gap-2">
            <Tv className="w-4 h-4 text-amber-400" />
            管理直播源
          </h3>
          <button onClick={onClose} className="p-1 text-slate-400 hover:text-white">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-4 space-y-4">
          <div className="space-y-2">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="直播源名称，如「我的 IPTV」"
                className="sm:col-span-2 px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-amber-500"
              />
              <select
                value={protocol}
                onChange={(e) => setProtocol(e.target.value as 'list' | 'pingtai')}
                className="px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-xs text-slate-100 focus:outline-none focus:border-amber-500"
              >
                <option value="list">列表源 (m3u/txt)</option>
                <option value="pingtai">面板源 (API)</option>
              </select>
            </div>
            <textarea
              value={urls}
              onChange={(e) => setUrls(e.target.value)}
              rows={3}
              placeholder={
                protocol === 'pingtai'
                  ? '面板地址，如 https://xxx.com/api （每行一个，按顺序尝试）'
                  : 'm3u / txt 地址，每行一个（支持 #genre# 分类与 #EXTINF 标签）'
              }
              className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-amber-500 resize-none"
            />
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-slate-500">{message}</span>
              <button
                onClick={() => void submit()}
                disabled={busy}
                className="px-3 py-1.5 rounded-lg bg-amber-500 text-black text-xs font-bold flex items-center gap-1.5 disabled:opacity-60"
              >
                {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
                <span>添加直播源</span>
              </button>
            </div>
          </div>

          <div>
            <div className="text-[11px] font-bold text-slate-400 mb-2">内置源</div>
            <div className="space-y-1.5">
              {builtin.map((item) => (
                <div
                  key={item.id}
                  className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg bg-slate-800/60 border border-slate-800"
                >
                  <div className="min-w-0">
                    <div className="text-xs font-semibold text-slate-200 truncate">{item.name}</div>
                    <div className="text-[11px] text-slate-500 truncate">
                      {item.description || item.protocol}
                    </div>
                  </div>
                  <span className="shrink-0 text-[10px] px-1.5 py-0.5 rounded bg-slate-700 text-slate-400">
                    内置
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div>
            <div className="text-[11px] font-bold text-slate-400 mb-2">自定义源</div>
            {custom.length ? (
              <div className="space-y-1.5">
                {custom.map((item) => (
                  <div
                    key={item.id}
                    className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg bg-slate-800/60 border border-slate-800"
                  >
                    <div className="min-w-0">
                      <div className="text-xs font-semibold text-slate-200 truncate">{item.name}</div>
                      <div className="text-[11px] text-slate-500 truncate">
                        {item.protocol === 'pingtai' ? '面板源' : '列表源'} · {(item.endpoints || []).length} 个地址
                      </div>
                    </div>
                    <button
                      onClick={() => void remove(item.id)}
                      className="shrink-0 p-1.5 rounded-md text-slate-400 hover:text-rose-400 hover:bg-rose-500/10"
                      title="删除"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-[11px] text-slate-500 py-3 text-center">还没有自定义直播源</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
