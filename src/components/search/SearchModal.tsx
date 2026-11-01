import React, { useState, useEffect, useRef } from 'react';
import {
  Search,
  X,
  Keyboard,
  Clock,
  Sparkles,
  Layers,
  ArrowRight,
  Loader2,
  AlertCircle,
} from 'lucide-react';
import { AggregateSearchSnapshot, Drama, SourceSite } from '../../types';
import { apiService } from '../../services/api';
import { LetterKeyboard } from './LetterKeyboard';
import { DramaCard } from '../explore/DramaCard';
import {
  loadRecentSearches,
  addRecentSearch,
  clearRecentSearches,
} from '../../utils/storage';

interface SearchModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectDrama: (drama: Drama) => void;
  initialQuery?: string;
  currentSource: string;
  sources: SourceSite[];
  allSourcesEnabled: boolean;
  onToggleAllSources: (enabled: boolean) => void;
  tvKeyboardDefault?: boolean;
}

export const SearchModal: React.FC<SearchModalProps> = ({
  isOpen,
  onClose,
  onSelectDrama,
  initialQuery = '',
  currentSource,
  sources,
  allSourcesEnabled,
  onToggleAllSources,
  tvKeyboardDefault = false,
}) => {
  const [query, setQuery] = useState(initialQuery);
  const [results, setResults] = useState<Drama[]>([]);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [recentSearches, setRecentSearches] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [showKeyboard, setShowKeyboard] = useState(tvKeyboardDefault);
  /** 跨源聚合进度（单源搜索时为空）。 */
  const [progress, setProgress] = useState<AggregateSearchSnapshot | null>(null);

  const inputRef = useRef<HTMLInputElement | null>(null);
  const cancelRef = useRef<(() => void) | null>(null);

  // 关闭 / 重开时中断上一个会话，避免旧结果覆盖新结果
  const stopSearch = () => {
    cancelRef.current?.();
    cancelRef.current = null;
  };

  useEffect(() => {
    if (!isOpen) {
      stopSearch();
      setIsLoading(false);
    }
  }, [isOpen]);

  // Load recent searches
  useEffect(() => {
    if (isOpen) {
      setRecentSearches(loadRecentSearches());
      if (initialQuery) {
        setQuery(initialQuery);
        executeSearch(initialQuery);
      }
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [isOpen, initialQuery]);

  // Handle autocomplete suggestions
  useEffect(() => {
    const q = query.trim();
    if (q.length >= 1) {
      const timer = setTimeout(async () => {
        const list = await apiService.getSuggestions(q);
        setSuggestions(list);
      }, 200);
      return () => clearTimeout(timer);
    } else {
      setSuggestions([]);
    }
  }, [query]);

  // Execute Search
  const executeSearch = async (searchTerm: string) => {
    const term = searchTerm.trim();
    if (!term) return;

    stopSearch();
    setIsLoading(true);
    setResults([]);
    setProgress(null);
    setRecentSearches(addRecentSearch(term));

    if (allSourcesEnabled) {
      // 跨源聚合：服务端并发抓取，前端按快照增量刷新
      const sourceIds = apiService.getAvailableSources().map((source) => source.id);
      const cancel = apiService.startAggregateSearch(sourceIds, term, (snapshot) => {
        setResults(snapshot.items || []);
        setProgress(snapshot);
        if (snapshot.finished) {
          setIsLoading(false);
          cancelRef.current = null;
        }
      });
      cancelRef.current = cancel;
      return;
    }

    // 单源
    try {
      const data = await apiService.searchSource(currentSource, term);
      setResults(data);
    } catch (e) {
      console.error('Search error', e);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSubmit = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    executeSearch(query);
  };

  const handleRecentClick = (term: string) => {
    setQuery(term);
    executeSearch(term);
  };

  const handleClearHistory = () => {
    clearRecentSearches();
    setRecentSearches([]);
  };

  if (!isOpen) return null;

  const currentSourceName = sources.find((s) => s.id === currentSource)?.name || '当前源';

  return (
    <div className="fixed inset-0 z-50 bg-black/85 backdrop-blur-md flex flex-col overflow-hidden animate-in fade-in duration-200">
      {/* Top Search Bar */}
      <div className="bg-[#121624] border-b border-slate-800 p-3 md:p-4 shrink-0 shadow-lg">
        <div className="max-w-5xl mx-auto flex items-center gap-2 md:gap-3">
          <form
            onSubmit={handleSubmit}
            className="flex-1 flex items-center gap-2 bg-slate-900 border border-slate-700/80 rounded-xl px-3 py-2 focus-within:border-rose-500 focus-within:ring-1 focus-within:ring-rose-500"
          >
            <Search className="w-5 h-5 text-slate-400 shrink-0" />
            <input
              ref={inputRef}
              type="text"
              placeholder="搜索剧名 / 拼音首字母如 BDZC (霸道总裁)..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="w-full bg-transparent text-sm md:text-base text-slate-100 placeholder-slate-500 focus:outline-none"
            />

            {query && (
              <button
                type="button"
                onClick={() => setQuery('')}
                className="p-1 rounded-full text-slate-400 hover:text-white hover:bg-slate-800"
              >
                <X className="w-4 h-4" />
              </button>
            )}

            {/* TV Keyboard toggle */}
            <button
              type="button"
              onClick={() => setShowKeyboard(!showKeyboard)}
              className={`p-1.5 rounded-lg border transition-colors ${
                showKeyboard
                  ? 'bg-rose-500/20 text-rose-400 border-rose-500/40'
                  : 'bg-slate-800 text-slate-400 border-slate-700 hover:text-slate-200'
              }`}
              title="打开拼音/字母软键盘"
            >
              <Keyboard className="w-4 h-4" />
            </button>
          </form>

          {/* All Sources Checkbox */}
          <label
            className="flex items-center gap-1.5 text-xs text-slate-300 bg-slate-900 border border-slate-800 px-3 py-2.5 rounded-xl cursor-pointer hover:border-slate-700 shrink-0 select-none"
            title="勾选并发聚合所有开启的源并去重"
          >
            <input
              type="checkbox"
              checked={allSourcesEnabled}
              onChange={(e) => onToggleAllSources(e.target.checked)}
              className="w-4 h-4 rounded text-rose-500 border-slate-600 bg-slate-800 focus:ring-0 cursor-pointer"
            />
            <span className="font-medium">全部源</span>
          </label>

          <button
            onClick={() => handleSubmit()}
            className="bg-rose-600 hover:bg-rose-500 text-white text-sm font-semibold px-4 py-2.5 rounded-xl shadow-md shadow-rose-950/40 transition-colors shrink-0"
          >
            搜索
          </button>

          <button
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded-xl transition-colors shrink-0"
          >
            <X className="w-6 h-6" />
          </button>
        </div>

        {/* Search Mode Status Indicator */}
        <div className="max-w-5xl mx-auto mt-2 flex items-center justify-between gap-3 text-xs text-slate-400">
          <div className="flex items-center gap-1.5 min-w-0">
            <Sparkles className="w-3.5 h-3.5 text-rose-400 shrink-0" />
            <span className="truncate">
              {allSourcesEnabled ? '正在使用【全站源并发聚合去重搜索】' : `当前仅搜索【${currentSourceName}】`}
            </span>
          </div>

          {progress ? (
            <div className="flex items-center gap-2 shrink-0">
              <span className="text-[11px] text-slate-500">
                已完成 {progress.done}/{progress.total} 源 · 命中 {progress.items.length} 部
              </span>
              {progress.pending && progress.pending.length > 0 && (
                <span className="text-[11px] text-amber-400/80">
                  抓取中 {progress.pending.length}
                </span>
              )}
              {progress.failures && Object.keys(progress.failures).length > 0 && (
                <span className="text-[11px] text-rose-400/80">
                  失败 {Object.keys(progress.failures).length}
                </span>
              )}
            </div>
          ) : (
            <span className="text-[11px] text-slate-500 hidden sm:inline shrink-0">
              支持完整剧名或拼音首字母（如：龙王出狱 → LWCY）
            </span>
          )}
        </div>

        {progress?.warning && (
          <div className="max-w-5xl mx-auto mt-1.5 flex items-start gap-1.5 text-[11px] text-amber-400/90">
            <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-px" />
            <span className="break-all">{progress.warning}</span>
          </div>
        )}
      </div>

      {/* Main Content Area */}
      <div className="flex-1 overflow-y-auto p-3 md:p-6 max-w-5xl mx-auto w-full">
        {/* Soft Keyboard if toggled */}
        {showKeyboard && (
          <div className="mb-6 max-w-lg mx-auto">
            <LetterKeyboard
              value={query}
              onChange={(val) => setQuery(val)}
              onSubmit={() => executeSearch(query)}
            />
          </div>
        )}

        {/* Suggestions chips */}
        {suggestions.length > 0 && (
          <div className="mb-4 flex items-center gap-1.5 flex-wrap">
            <span className="text-xs text-slate-400 font-medium mr-1">联想词:</span>
            {suggestions.map((s) => (
              <button
                key={s}
                onClick={() => {
                  setQuery(s);
                  executeSearch(s);
                }}
                className="px-2.5 py-1 rounded-full bg-slate-800/90 hover:bg-rose-600/30 text-xs text-slate-200 border border-slate-700/60 hover:border-rose-500/40 transition-colors"
              >
                {s}
              </button>
            ))}
          </div>
        )}

        {/* Recent Searches */}
        {recentSearches.length > 0 && results.length === 0 && !isLoading && (
          <div className="mb-6 bg-slate-900/60 border border-slate-800 rounded-2xl p-4">
            <div className="flex items-center justify-between pb-2 mb-3 border-b border-slate-800/80">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-300">
                <Clock className="w-3.5 h-3.5 text-rose-400" />
                <span>最近搜索</span>
              </div>
              <button
                onClick={handleClearHistory}
                className="text-[11px] text-slate-500 hover:text-slate-300 transition-colors"
              >
                清空历史
              </button>
            </div>

            <div className="flex flex-wrap gap-2">
              {recentSearches.map((term) => (
                <button
                  key={term}
                  onClick={() => handleRecentClick(term)}
                  className="px-3 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs text-slate-200 border border-slate-700 transition-colors flex items-center gap-1"
                >
                  <span>{term}</span>
                  <ArrowRight className="w-2.5 h-2.5 text-slate-400" />
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Loading state（还没有任何结果时占位，聚合搜索边出边显） */}
        {isLoading && results.length === 0 && (
          <div className="py-20 flex flex-col items-center justify-center gap-3 text-slate-400">
            <Loader2 className="w-8 h-8 text-rose-500 animate-spin" />
            <span className="text-sm">
              {progress
                ? `正在并发抓取站源（${progress.done}/${progress.total}）…`
                : '正在全网并发搜索短剧…'}
            </span>
            {progress?.pending && progress.pending.length > 0 && (
              <span className="text-[11px] text-slate-500">
                等待：{progress.pending.slice(0, 4).join('、')}
                {progress.pending.length > 4 ? ` 等 ${progress.pending.length} 个源` : ''}
              </span>
            )}
          </div>
        )}

        {/* Results Grid */}
        {results.length > 0 && (
          <div>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-bold text-slate-200">
                搜索结果（找到 {results.length} 部匹配剧目）
              </h3>
              {isLoading && (
                <span className="text-[11px] text-rose-400 flex items-center gap-1">
                  <Loader2 className="w-3 h-3 animate-spin" />
                  仍在抓取更多源…
                </span>
              )}
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3 sm:gap-4">
              {results.map((drama) => (
                <DramaCard
                  key={`${drama.source}_${drama.id}`}
                  drama={drama}
                  onSelect={(d) => {
                    onSelectDrama(d);
                    onClose();
                  }}
                />
              ))}
            </div>
          </div>
        )}

        {/* Empty state when searched */}
        {!isLoading && results.length === 0 && query && (
          <div className="py-20 text-center text-slate-400">
            <p className="text-base font-semibold text-slate-300">未找到相关短剧</p>
            <p className="text-xs text-slate-500 mt-1">
              可尝试切换【全部源】、缩短关键词或输入拼音首字母检索
            </p>
          </div>
        )}
      </div>
    </div>
  );
};
