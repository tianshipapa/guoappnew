import React, { useState, useEffect, useCallback } from 'react';
import { Navbar } from './components/layout/Navbar';
import { BottomNav } from './components/layout/BottomNav';
import { CategoryBar } from './components/explore/CategoryBar';
import { FilterBar } from './components/explore/FilterBar';
import { DramaCard } from './components/explore/DramaCard';
import { DramaDetailView } from './components/detail/DramaDetailView';
import { HistoryView } from './components/library/HistoryView';
import { FollowView } from './components/library/FollowView';
import { LiveView } from './components/live/LiveView';
import { SearchModal } from './components/search/SearchModal';
import { CustomSourcesModal } from './components/sources/CustomSourcesModal';
import { SourceVisibilityModal } from './components/sources/SourceVisibilityModal';
import { SettingsModal } from './components/settings/SettingsModal';

import {
  Drama,
  SourceSite,
  CustomSourceSite,
  UserSettings,
  HistoryItem,
  FavoriteItem,
  FollowStatus,
} from './types';
import { apiService } from './services/api';
import { BUILTIN_SOURCES } from './data/sources';
import {
  loadUserSettings,
  saveUserSettings,
  loadHistory,
  saveHistoryItem,
  removeHistoryItems,
  clearAllHistory,
  loadFavorites,
  toggleFavorite,
  updateFavoriteStatus,
  removeFavoriteItems,
  loadCustomSources,
  saveCustomSource,
  deleteCustomSource,
  loadSourceVisibility,
  saveSourceVisibility,
  loadLastActiveSource,
  saveLastActiveSource,
} from './utils/storage';
import { Loader2, Sparkles, RefreshCw, Layers } from 'lucide-react';

export const App: React.FC = () => {
  // Persistence state
  const [settings, setSettings] = useState<UserSettings>(loadUserSettings);
  const [history, setHistory] = useState<HistoryItem[]>(loadHistory);
  const [favorites, setFavorites] = useState<FavoriteItem[]>(loadFavorites);
  const [customSources, setCustomSources] = useState<CustomSourceSite[]>(loadCustomSources);
  const [visibilityMap, setVisibilityMap] = useState<Record<string, boolean>>(loadSourceVisibility);
  const [currentSource, setCurrentSource] = useState<string>(loadLastActiveSource);

  // Active view & navigation
  const [activeView, setActiveView] = useState<'explore' | 'favorites' | 'history' | 'live'>(
    'explore'
  );
  const [selectedDrama, setSelectedDrama] = useState<Drama | null>(null);
  const [resumeIndex, setResumeIndex] = useState<number | undefined>(undefined);
  const [resumePosition, setResumePosition] = useState<number | undefined>(undefined);

  // Modals state
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [searchInitialQuery, setSearchInitialQuery] = useState('');
  const [isCustomSourcesOpen, setIsCustomSourcesOpen] = useState(false);
  const [isVisibilityOpen, setIsVisibilityOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  // Catalog filters & pagination
  const [selectedCategory, setSelectedCategory] = useState<string>('');
  const [sourceCategories, setSourceCategories] = useState<{ id: string; name: string }[]>([]);
  const [currentSort, setCurrentSort] = useState<string>('default');
  const [currentStatus, setCurrentStatus] = useState<string>('all');
  const [catalog, setCatalog] = useState<Drama[]>([]);
  const [isLoadingCatalog, setIsLoadingCatalog] = useState(false);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [totalCount, setTotalCount] = useState(0);

  // Fetch categories when currentSource changes
  useEffect(() => {
    let isMounted = true;
    apiService.fetchCategories(currentSource).then((cats) => {
      if (isMounted) {
        setSourceCategories(cats);
        setSelectedCategory('');
        setPage(1);
      }
    });
    return () => {
      isMounted = false;
    };
  }, [currentSource]);

  // Compute all available sources
  const allSources: SourceSite[] = [
    ...BUILTIN_SOURCES,
    ...customSources.map((c) => ({
      id: c.id,
      name: c.name,
      description: `自定义源 · ${c.kind?.toUpperCase() || 'API'}`,
      onlineSearch: true,
      pagedSearch: true,
      isCustom: true,
      native: true,
    })),
  ];

  const visibleSources = allSources.filter((s) => visibilityMap[s.id] !== false);
  const activeSourceObj =
    visibleSources.find((s) => s.id === currentSource) || visibleSources[0] || BUILTIN_SOURCES[0];

  // Keep active source in sync
  useEffect(() => {
    if (visibleSources.length > 0 && !visibleSources.some((s) => s.id === currentSource)) {
      const next = visibleSources[0].id;
      setCurrentSource(next);
      saveLastActiveSource(next);
    }
  }, [visibleSources, currentSource]);

  // Load catalog
  const loadCatalog = useCallback(
    async (resetPage: boolean = false) => {
      setIsLoadingCatalog(true);
      const targetPage = resetPage ? 1 : page;

      try {
        const res = await apiService.fetchCatalog({
          sourceId: currentSource,
          category: selectedCategory,
          sortBy: currentSort,
          releaseStatus: currentStatus,
          page: targetPage,
          pageSize: 15,
        });

        if (resetPage) {
          setCatalog(res.items);
          setPage(1);
        } else {
          setCatalog((prev) => (targetPage === 1 ? res.items : [...prev, ...res.items]));
        }
        setHasMore(res.hasMore);
        setTotalCount(res.total);
      } catch (e) {
        console.error('Failed to load catalog', e);
      } finally {
        setIsLoadingCatalog(false);
      }
    },
    [currentSource, selectedCategory, currentSort, currentStatus, page]
  );

  // Trigger catalog reload when filters or source change
  useEffect(() => {
    loadCatalog(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentSource, selectedCategory, currentSort, currentStatus]);

  // Handle Load More
  const handleLoadMore = () => {
    if (!isLoadingCatalog && hasMore) {
      setPage((prev) => prev + 1);
    }
  };

  useEffect(() => {
    if (page > 1) {
      loadCatalog(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page]);

  // Source selection
  const handleSelectSource = (sourceId: string) => {
    setCurrentSource(sourceId);
    saveLastActiveSource(sourceId);
  };

  // Open Search
  const handleOpenSearch = (query?: string) => {
    setSearchInitialQuery(query || '');
    setIsSearchOpen(true);
  };

  // Select Drama
  const handleSelectDrama = (drama: Drama, initialIdx?: number, initialPos?: number) => {
    setSelectedDrama(drama);
    setResumeIndex(initialIdx);
    setResumePosition(initialPos);
  };

  // Toggle Favorite
  const handleToggleFavorite = (drama: Drama) => {
    const item: FavoriteItem = {
      id: drama.id,
      source: drama.source,
      sourceName: drama.sourceName || drama.source,
      title: drama.title,
      cover: drama.cover,
      episodes: drama.episodes,
      status: 'watching',
      category: drama.category,
      tags: drama.tags,
      updatedAt: Date.now(),
    };
    const { favorites: nextFavs } = toggleFavorite(item);
    setFavorites(nextFavs);
  };

  // Update Favorite Status
  const handleUpdateFavoriteStatus = (id: string, source: string, status: FollowStatus) => {
    const updated = updateFavoriteStatus(id, source, status);
    setFavorites(updated);
  };

  // Delete Favorite items
  const handleDeleteFavorites = (keys: { id: string; source: string }[]) => {
    const updated = removeFavoriteItems(keys);
    setFavorites(updated);
  };

  // Progress update from VideoPlayer
  const handleUpdateHistory = (pos: number, dur: number, index: number, epTitle: string) => {
    if (!selectedDrama) return;
    const historyEntry: HistoryItem = {
      id: selectedDrama.id,
      source: selectedDrama.source,
      sourceName: selectedDrama.sourceName || selectedDrama.source,
      title: selectedDrama.title,
      cover: selectedDrama.cover,
      episodes: selectedDrama.episodes,
      index,
      episodeTitle: epTitle,
      position: pos,
      duration: dur,
      updatedAt: Date.now(),
    };
    const updated = saveHistoryItem(historyEntry);
    setHistory(updated);
  };

  // Delete History items
  const handleDeleteHistory = (keys: { id: string; source: string }[]) => {
    const updated = removeHistoryItems(keys);
    setHistory(updated);
  };

  // Clear all history
  const handleClearAllHistory = () => {
    clearAllHistory();
    setHistory([]);
  };

  // Custom Source Actions
  const handleSaveCustomSource = (source: CustomSourceSite) => {
    const isNew = !customSources.some((item) => item.id === source.id);
    const updated = saveCustomSource(source);
    setCustomSources(updated);
    // 新增源后直接切过去，省得用户再翻一遍源列表
    if (isNew && source.enabled) {
      setSelectedDrama(null);
      setActiveView('explore');
      setCurrentSource(source.id);
      saveLastActiveSource(source.id);
    }
  };

  const handleDeleteCustomSource = (id: string) => {
    const updated = deleteCustomSource(id);
    setCustomSources(updated);
  };

  // Visibility Actions
  const handleToggleVisibility = (sourceId: string, visible: boolean) => {
    const next = { ...visibilityMap, [sourceId]: visible };
    setVisibilityMap(next);
    saveSourceVisibility(next);
  };

  const handleEnableAllSources = () => {
    const next: Record<string, boolean> = {};
    allSources.forEach((s) => {
      next[s.id] = true;
    });
    setVisibilityMap(next);
    saveSourceVisibility(next);
  };

  // Update User Settings
  const handleUpdateSettings = (newSettings: UserSettings) => {
    setSettings(newSettings);
    saveUserSettings(newSettings);
  };

  // Clear all storage
  const handleClearStorage = () => {
    localStorage.clear();
    setHistory([]);
    setFavorites([]);
    setCustomSources([]);
    setVisibilityMap({});
    const defaultSettings = loadUserSettings();
    setSettings(defaultSettings);
    setIsSettingsOpen(false);
  };

  const isFavoritedDrama = (dramaId: string, source: string) => {
    return favorites.some((f) => f.id === dramaId && f.source === source);
  };

  return (
    <div className="min-h-screen bg-[#0b0d14] text-slate-100 flex flex-col">
      {/* Top Navigation */}
      <Navbar
        sources={visibleSources}
        currentSource={activeSourceObj.id}
        onSelectSource={handleSelectSource}
        onOpenSearch={handleOpenSearch}
        onOpenCustomSources={() => setIsCustomSourcesOpen(true)}
        onOpenSourceVisibility={() => setIsVisibilityOpen(true)}
        onOpenLive={() => {
          setSelectedDrama(null);
          setActiveView('live');
        }}
        onOpenFavorites={() => {
          setSelectedDrama(null);
          setActiveView('favorites');
        }}
        onOpenHistory={() => {
          setSelectedDrama(null);
          setActiveView('history');
        }}
        onOpenSettings={() => setIsSettingsOpen(true)}
        settings={settings}
        onUpdateSettings={handleUpdateSettings}
        activeView={selectedDrama ? 'detail' : activeView}
        onNavigateHome={() => {
          setSelectedDrama(null);
          setActiveView('explore');
        }}
      />

      {/* Main View Router */}
      <main className="flex-1 pb-16 lg:pb-6">
        {selectedDrama ? (
          /* Drama Detail & Player View */
          <DramaDetailView
            drama={selectedDrama}
            onBack={() => setSelectedDrama(null)}
            isFavorited={isFavoritedDrama(selectedDrama.id, selectedDrama.source)}
            onToggleFavorite={handleToggleFavorite}
            historyItem={history.find(
              (h) => h.id === selectedDrama.id && h.source === selectedDrama.source
            )}
            onUpdateHistory={handleUpdateHistory}
            settings={settings}
            onUpdateSettings={handleUpdateSettings}
            onSwitchPeer={(peer) => {
              setSelectedDrama(peer);
              setResumeIndex(undefined);
              setResumePosition(undefined);
            }}
            initialResumeIndex={resumeIndex}
            initialResumePosition={resumePosition}
          />
        ) : activeView === 'live' ? (
          /* Live Stream View */
          <LiveView />
        ) : activeView === 'favorites' ? (
          /* Favorites / Follow View */
          <FollowView
            favorites={favorites}
            onSelectDrama={(d) => handleSelectDrama(d)}
            onDeleteItems={handleDeleteFavorites}
            onUpdateStatus={handleUpdateFavoriteStatus}
          />
        ) : activeView === 'history' ? (
          /* Watch History View */
          <HistoryView
            history={history}
            onSelectDrama={(d, idx, pos) => handleSelectDrama(d, idx, pos)}
            onDeleteItems={handleDeleteHistory}
            onClearAll={handleClearAllHistory}
          />
        ) : (
          /* Explore / Catalog View */
          <div>
            {/* Sliding Categories */}
            <CategoryBar
              selectedCategory={selectedCategory}
              onSelectCategory={(catId) => setSelectedCategory(catId)}
              categories={sourceCategories}
            />

            {/* Filter and Sort Toolbar */}
            <FilterBar
              currentSort={currentSort}
              onSelectSort={(s) => setCurrentSort(s)}
              currentStatus={currentStatus}
              onSelectStatus={(st) => setCurrentStatus(st)}
              totalCount={totalCount}
              sourceName={activeSourceObj.name}
              sourceDescription={activeSourceObj.description}
            />

            {/* Drama Grid */}
            <div className="max-w-7xl mx-auto px-3 md:px-6 py-4">
              {isLoadingCatalog && catalog.length === 0 ? (
                <div className="py-24 flex flex-col items-center justify-center gap-3 text-slate-400">
                  <Loader2 className="w-9 h-9 text-rose-500 animate-spin" />
                  <span className="text-sm font-medium">正在加载站源剧集…</span>
                </div>
              ) : catalog.length === 0 ? (
                <div className="py-24 text-center text-slate-400">
                  <Layers className="w-12 h-12 text-slate-600 mx-auto mb-3" />
                  <p className="text-base font-semibold text-slate-300">该分类暂无剧目</p>
                  <p className="text-xs text-slate-500 mt-1">请尝试切换分类或站源查看更多内容</p>
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3 sm:gap-4 md:gap-5">
                    {catalog.map((drama) => {
                      const hist = history.find(
                        (h) => h.id === drama.id && h.source === drama.source
                      );
                      const progressPercent =
                        hist && hist.duration > 0
                          ? Math.round((hist.position / hist.duration) * 100)
                          : undefined;

                      return (
                        <DramaCard
                          key={`${drama.source}_${drama.id}`}
                          drama={drama}
                          onSelect={(d) => handleSelectDrama(d)}
                          isFavorited={isFavoritedDrama(drama.id, drama.source)}
                          onToggleFavorite={handleToggleFavorite}
                          progressPercent={progressPercent}
                        />
                      );
                    })}
                  </div>

                  {/* Load More Button */}
                  {hasMore && (
                    <div className="mt-8 flex justify-center">
                      <button
                        onClick={handleLoadMore}
                        disabled={isLoadingCatalog}
                        className="px-6 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-slate-300 hover:text-white border border-slate-800 text-xs sm:text-sm font-semibold transition-all flex items-center gap-2 shadow-lg"
                      >
                        {isLoadingCatalog ? (
                          <>
                            <Loader2 className="w-4 h-4 animate-spin text-rose-500" />
                            <span>加载中…</span>
                          </>
                        ) : (
                          <>
                            <RefreshCw className="w-4 h-4 text-slate-400" />
                            <span>加载更多剧目</span>
                          </>
                        )}
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        )}
      </main>

      {/* Mobile Bottom Navigation Bar */}
      {!selectedDrama && (
        <BottomNav
          activeView={activeView}
          onSelectView={(v) => {
            setSelectedDrama(null);
            setActiveView(v as any);
          }}
          favoritesCount={favorites.length}
        />
      )}

      {/* Search Modal */}
      <SearchModal
        isOpen={isSearchOpen}
        onClose={() => setIsSearchOpen(false)}
        onSelectDrama={(drama) => {
          handleSelectDrama(drama);
          setIsSearchOpen(false);
        }}
        initialQuery={searchInitialQuery}
        currentSource={activeSourceObj.id}
        sources={visibleSources}
        allSourcesEnabled={settings.allSourcesSearch}
        onToggleAllSources={(enabled) =>
          handleUpdateSettings({ ...settings, allSourcesSearch: enabled })
        }
        tvKeyboardDefault={settings.tvLetterKeyboard}
      />

      {/* Custom Sources Modal */}
      <CustomSourcesModal
        isOpen={isCustomSourcesOpen}
        onClose={() => setIsCustomSourcesOpen(false)}
        customSources={customSources}
        onSaveSource={handleSaveCustomSource}
        onDeleteSource={handleDeleteCustomSource}
      />

      {/* Source Visibility Modal */}
      <SourceVisibilityModal
        isOpen={isVisibilityOpen}
        onClose={() => setIsVisibilityOpen(false)}
        allSources={allSources}
        visibilityMap={visibilityMap}
        onToggleVisibility={handleToggleVisibility}
        onEnableAll={handleEnableAllSources}
      />

      {/* Settings Modal */}
      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        settings={settings}
        onUpdateSettings={handleUpdateSettings}
        historyCount={history.length}
        favoritesCount={favorites.length}
        customSourcesCount={customSources.length}
        onClearStorage={handleClearStorage}
      />
    </div>
  );
};

export default App;
