import React, { useState } from 'react';
import {
  Film,
  Search,
  Tv,
  Bookmark,
  History,
  SlidersHorizontal,
  Settings,
  Layers,
  Eye,
  Check,
} from 'lucide-react';
import { SourceSite, UserSettings } from '../../types';
import { CoreStatusPill } from './CoreStatusPill';

interface NavbarProps {
  sources: SourceSite[];
  currentSource: string;
  onSelectSource: (sourceId: string) => void;
  onOpenSearch: (initialQuery?: string) => void;
  onOpenCustomSources: () => void;
  onOpenSourceVisibility: () => void;
  onOpenLive: () => void;
  onOpenFavorites: () => void;
  onOpenHistory: () => void;
  onOpenSettings: () => void;
  settings: UserSettings;
  onUpdateSettings: (settings: UserSettings) => void;
  activeView: string;
  onNavigateHome: () => void;
}

export const Navbar: React.FC<NavbarProps> = ({
  sources,
  currentSource,
  onSelectSource,
  onOpenSearch,
  onOpenCustomSources,
  onOpenSourceVisibility,
  onOpenLive,
  onOpenFavorites,
  onOpenHistory,
  onOpenSettings,
  settings,
  onUpdateSettings,
  activeView,
  onNavigateHome,
}) => {
  const [quickQuery, setQuickQuery] = useState('');

  const handleQuickSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (quickQuery.trim()) {
      onOpenSearch(quickQuery.trim());
      setQuickQuery('');
    } else {
      onOpenSearch();
    }
  };

  const currentSourceObj = sources.find((s) => s.id === currentSource) || sources[0];

  return (
    <header className="sticky top-0 z-40 bg-[#121624]/95 backdrop-blur border-b border-slate-800/80 px-3 md:px-6 py-2.5 transition-all">
      <div className="max-w-7xl mx-auto flex items-center justify-between gap-2 md:gap-4">
        {/* Brand & Source Dropdown */}
        <div className="flex items-center gap-2 md:gap-4 shrink-0">
          <button
            onClick={onNavigateHome}
            className="flex items-center gap-2 group text-left focus:outline-none"
            title="返回短剧首页"
          >
            <div className="w-8 h-8 rounded-lg bg-gradient-to-tr from-rose-600 to-rose-500 flex items-center justify-center text-white shadow-md shadow-rose-950/40 group-hover:scale-105 transition-transform">
              <Film className="w-4 h-4" />
            </div>
            <div className="hidden sm:block">
              <span className="text-base font-bold bg-gradient-to-r from-white via-slate-100 to-slate-300 bg-clip-text text-transparent">
                短剧视界
              </span>
              <span className="ml-1.5 px-1.5 py-0.5 text-[10px] font-medium rounded bg-rose-500/20 text-rose-400 border border-rose-500/30">
                红果鉴 / 真果鉴
              </span>
            </div>
          </button>

          {/* Source Selector */}
          <div className="relative">
            <select
              value={currentSource}
              onChange={(e) => onSelectSource(e.target.value)}
              className="bg-slate-800/90 text-xs md:text-sm font-medium text-slate-200 border border-slate-700/80 rounded-lg px-2.5 py-1.5 pr-7 appearance-none cursor-pointer focus:outline-none focus:ring-1 focus:ring-rose-500 focus:border-rose-500 transition-colors shadow-sm"
              title="切换站源"
            >
              {sources.map((s) => (
                <option key={s.id} value={s.id} className="bg-slate-900 text-slate-100">
                  {s.name} {s.isCustom ? '(自定义)' : ''}
                </option>
              ))}
            </select>
            <div className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-slate-400">
              <SlidersHorizontal className="w-3 h-3" />
            </div>
          </div>

          <CoreStatusPill onClick={onOpenCustomSources} />
        </div>

        {/* Search Bar */}
        <form
          onSubmit={handleQuickSearchSubmit}
          className="flex-1 max-w-md mx-2 flex items-center gap-1.5 bg-slate-900/80 border border-slate-700/80 rounded-lg px-2.5 py-1 focus-within:border-rose-500/80 focus-within:ring-1 focus-within:ring-rose-500/50 transition-all"
        >
          <Search className="w-4 h-4 text-slate-400 shrink-0" />
          <input
            type="text"
            placeholder="搜剧名 / 支持拼音首字母如 BDZC..."
            value={quickQuery}
            onChange={(e) => setQuickQuery(e.target.value)}
            onFocus={() => {
              if (!quickQuery) onOpenSearch();
            }}
            className="w-full bg-transparent text-xs md:text-sm text-slate-100 placeholder-slate-500 focus:outline-none"
          />

          {/* All Sources Checkbox */}
          <label
            className="hidden md:flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-200 cursor-pointer select-none px-1.5 py-0.5 rounded border border-transparent hover:border-slate-700 shrink-0"
            title="勾选后搜索并并发聚合所有可见源（含自定义源）"
          >
            <input
              type="checkbox"
              checked={settings.allSourcesSearch}
              onChange={(e) =>
                onUpdateSettings({ ...settings, allSourcesSearch: e.target.checked })
              }
              className="w-3.5 h-3.5 rounded text-rose-500 border-slate-600 bg-slate-800 focus:ring-0 focus:ring-offset-0 cursor-pointer"
            />
            <span className="text-[11px]">全部源</span>
          </label>

          <button
            type="submit"
            className="bg-rose-600 hover:bg-rose-500 text-white text-xs font-medium px-2.5 py-1 rounded-md transition-colors shrink-0"
          >
            搜索
          </button>
        </form>

        {/* Action Shortcut Buttons */}
        <div className="hidden lg:flex items-center gap-1 text-xs">
          <button
            onClick={onOpenCustomSources}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-slate-300 hover:text-white hover:bg-slate-800 transition-colors"
            title="管理自定义 MacCMS 或 API 站源"
          >
            <Layers className="w-3.5 h-3.5 text-rose-400" />
            <span>自定义源</span>
          </button>

          <button
            onClick={onOpenSourceVisibility}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-slate-300 hover:text-white hover:bg-slate-800 transition-colors"
            title="管理站源开启与显示"
          >
            <Eye className="w-3.5 h-3.5 text-sky-400" />
            <span>源显示</span>
          </button>

          <button
            onClick={onOpenLive}
            className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg transition-colors ${
              activeView === 'live'
                ? 'bg-rose-600 text-white font-medium'
                : 'text-slate-300 hover:text-white hover:bg-slate-800'
            }`}
            title="电视与网络直播"
          >
            <Tv className="w-3.5 h-3.5 text-amber-400" />
            <span>直播</span>
          </button>

          <button
            onClick={onOpenFavorites}
            className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg transition-colors ${
              activeView === 'favorites'
                ? 'bg-rose-600 text-white font-medium'
                : 'text-slate-300 hover:text-white hover:bg-slate-800'
            }`}
            title="我的收藏夹（支持续播）"
          >
            <Bookmark className="w-3.5 h-3.5 text-emerald-400" />
            <span>收藏夹</span>
          </button>

          <button
            onClick={onOpenHistory}
            className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg transition-colors ${
              activeView === 'history'
                ? 'bg-rose-600 text-white font-medium'
                : 'text-slate-300 hover:text-white hover:bg-slate-800'
            }`}
            title="观看记录"
          >
            <History className="w-3.5 h-3.5 text-indigo-400" />
            <span>历史</span>
          </button>

          <button
            onClick={onOpenSettings}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
            title="系统设置与关于"
          >
            <Settings className="w-4 h-4" />
          </button>
        </div>

        {/* Mobile Quick Setting Button */}
        <div className="flex lg:hidden items-center gap-1">
          <button
            onClick={onOpenSettings}
            className="p-1.5 rounded-lg text-slate-300 hover:text-white hover:bg-slate-800 transition-colors"
            title="设置"
          >
            <Settings className="w-4 h-4" />
          </button>
        </div>
      </div>
    </header>
  );
};
