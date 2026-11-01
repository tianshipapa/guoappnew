import React, { useState, useRef, useEffect } from 'react';
import Hls from 'hls.js';
import { Tv, Play, Pause, Volume2, VolumeX, Maximize, Radio, Sparkles } from 'lucide-react';
import { LiveChannel, LiveGroup } from '../../types';
import { LIVE_CHANNEL_GROUPS } from '../../data/liveChannels';

export const LiveView: React.FC = () => {
  const [groups] = useState<LiveGroup[]>(LIVE_CHANNEL_GROUPS);
  const [activeGroupIndex, setActiveGroupIndex] = useState(0);
  const currentGroup = groups[activeGroupIndex] || groups[0];

  const [activeChannel, setActiveChannel] = useState<LiveChannel>(currentGroup.channels[0]);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const hlsRef = useRef<Hls | null>(null);

  // Mount live stream
  useEffect(() => {
    const video = videoRef.current;
    const url = activeChannel?.urls?.[0];
    if (!video || !url) return;

    setIsLoading(true);
    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }

    if (url.includes('.m3u8') && Hls.isSupported()) {
      const hls = new Hls({ enableWorker: true, lowLatencyMode: true });
      hlsRef.current = hls;
      hls.loadSource(url);
      hls.attachMedia(video);
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        setIsLoading(false);
        video.play().catch(() => {});
      });
      hls.on(Hls.Events.ERROR, () => {
        setIsLoading(false);
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
  }, [activeChannel]);

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
    if (video.requestFullscreen) {
      video.requestFullscreen().catch(() => {});
    }
  };

  return (
    <div className="max-w-6xl mx-auto px-3 md:px-6 py-4">
      {/* Header */}
      <div className="flex items-center justify-between pb-3 mb-4 border-b border-slate-800">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-amber-500/20 text-amber-400 border border-amber-500/30 flex items-center justify-center">
            <Tv className="w-4 h-4" />
          </div>
          <div>
            <h2 className="text-base sm:text-lg font-bold text-slate-100 flex items-center gap-2">
              <span>电视与轮播直播</span>
              <span className="flex items-center gap-1 text-[10px] text-rose-400 bg-rose-500/20 border border-rose-500/30 px-2 py-0.5 rounded-full animate-pulse">
                <Radio className="w-2.5 h-2.5" />
                <span>LIVE 直播中</span>
              </span>
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              央视、卫视、24小时高清短剧轮播剧场
            </p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left / Top: Live Player Surface */}
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
                  <div className="w-8 h-8 border-3 border-amber-500 border-t-transparent rounded-full animate-spin" />
                  <span>正在缓冲直播信号…</span>
                </div>
              </div>
            )}

            {/* Live Indicator */}
            <div className="absolute top-3 left-3 flex items-center gap-2 pointer-events-none">
              <span className="px-2 py-0.5 rounded bg-rose-600 text-white text-[11px] font-bold flex items-center gap-1 shadow-md">
                <span className="w-1.5 h-1.5 rounded-full bg-white animate-ping" />
                LIVE
              </span>
              <span className="px-2 py-0.5 rounded bg-black/70 backdrop-blur text-slate-200 text-xs font-semibold">
                {activeChannel.name}
              </span>
            </div>

            {/* Overlay Controls */}
            <div className="absolute bottom-0 left-0 right-0 p-3 bg-gradient-to-t from-black/90 to-transparent flex items-center justify-between text-slate-200 opacity-0 group-hover:opacity-100 transition-opacity">
              <div className="flex items-center gap-3">
                <button onClick={togglePlay} className="p-1 hover:text-amber-400 transition-colors">
                  {isPlaying ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5 fill-current" />}
                </button>
                <button onClick={toggleMute} className="p-1 hover:text-amber-400 transition-colors">
                  {isMuted ? <VolumeX className="w-5 h-5" /> : <Volume2 className="w-5 h-5" />}
                </button>
                <span className="text-xs text-slate-300 font-medium">
                  {activeChannel.epgCurrent || '高清直播中'}
                </span>
              </div>

              <button onClick={toggleFullscreen} className="p-1 hover:text-amber-400 transition-colors">
                <Maximize className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Current Channel Details Card */}
          <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-3 flex items-center justify-between">
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-mono font-bold text-amber-400 bg-amber-500/10 px-1.5 py-0.5 rounded border border-amber-500/20">
                  CH {activeChannel.number}
                </span>
                <h3 className="text-sm font-bold text-slate-100">{activeChannel.name}</h3>
              </div>
              <p className="text-xs text-slate-400 mt-1">
                {activeChannel.subtitle || activeChannel.group} · {activeChannel.epgCurrent}
              </p>
            </div>

            <div className="px-3 py-1 rounded-lg bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 text-xs font-medium flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              <span>信号稳定</span>
            </div>
          </div>
        </div>

        {/* Right / Bottom: Category Tabs & Channels List */}
        <div className="bg-slate-900/70 border border-slate-800 rounded-2xl p-4 flex flex-col h-[520px]">
          {/* Group Switcher Tabs */}
          <div className="flex items-center gap-1.5 pb-3 border-b border-slate-800 overflow-x-auto no-scrollbar shrink-0">
            {groups.map((grp, idx) => (
              <button
                key={grp.name}
                onClick={() => setActiveGroupIndex(idx)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-colors ${
                  activeGroupIndex === idx
                    ? 'bg-amber-500 text-black font-bold shadow-sm'
                    : 'bg-slate-800 text-slate-300 hover:text-white'
                }`}
              >
                {grp.name}
              </button>
            ))}
          </div>

          {/* Channels List */}
          <div className="flex-1 overflow-y-auto mt-3 divide-y divide-slate-800/60 pr-1">
            {currentGroup.channels.map((ch) => {
              const isSelected = activeChannel.key === ch.key;
              return (
                <button
                  key={ch.key}
                  onClick={() => setActiveChannel(ch)}
                  className={`w-full py-2.5 px-3 flex items-center justify-between text-left rounded-xl transition-all my-1 ${
                    isSelected
                      ? 'bg-amber-500/15 border border-amber-500/40 text-amber-300'
                      : 'hover:bg-slate-800/80 text-slate-300 hover:text-white'
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    <span className="w-8 font-mono text-xs font-bold text-slate-400">
                      {ch.number}
                    </span>
                    <div>
                      <div className="text-xs sm:text-sm font-semibold">{ch.name}</div>
                      <div className="text-[11px] text-slate-500 line-clamp-1">
                        {ch.epgCurrent || ch.subtitle}
                      </div>
                    </div>
                  </div>

                  {isSelected && (
                    <span className="text-[10px] text-amber-400 font-bold px-1.5 py-0.5 rounded bg-amber-400/20">
                      播放中
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};
