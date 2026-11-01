import { HistoryItem, FavoriteItem, CustomSourceSite, UserSettings } from '../types';

const STORAGE_KEYS = {
  HISTORY: 'duanju_history_v1',
  FAVORITES: 'duanju_favorites_v1',
  SETTINGS: 'duanju_settings_v1',
  CUSTOM_SOURCES: 'duanju_custom_sources_v1',
  SOURCES_VISIBILITY: 'duanju_sources_visibility_v1',
  RECENT_SEARCHES: 'duanju_recent_searches_v1',
  LAST_SOURCE: 'duanju_last_source_v1',
};

const DEFAULT_SETTINGS: UserSettings = {
  autoNext: true,
  adBlock: true,
  playbackRate: 1,
  pictureQuality: {
    mode: 'original',
    strength: 50,
  },
  episodesReversed: false,
  allSourcesSearch: true,
  tvLetterKeyboard: false,
  themeColor: '#f43f5e', // Hongguo Rose
  danmakuEnabled: true,
};

// Safe JSON get/set
function getStoredJson<T>(key: string, defaultValue: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return defaultValue;
    return JSON.parse(raw) as T;
  } catch (e) {
    console.warn(`Failed to read ${key} from localStorage`, e);
    return defaultValue;
  }
}

function setStoredJson<T>(key: string, value: T): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (e) {
    console.warn(`Failed to write ${key} to localStorage`, e);
  }
}

// User Settings
export function loadUserSettings(): UserSettings {
  const loaded = getStoredJson<Partial<UserSettings>>(STORAGE_KEYS.SETTINGS, {});
  return { ...DEFAULT_SETTINGS, ...loaded };
}

export function saveUserSettings(settings: UserSettings): void {
  setStoredJson(STORAGE_KEYS.SETTINGS, settings);
}

// Watch History
export function loadHistory(): HistoryItem[] {
  return getStoredJson<HistoryItem[]>(STORAGE_KEYS.HISTORY, []);
}

export function saveHistoryItem(item: HistoryItem): HistoryItem[] {
  const list = loadHistory();
  // Filter out existing entry for this drama ID and source
  const filtered = list.filter((x) => !(x.id === item.id && x.source === item.source));
  const updated = [item, ...filtered].slice(0, 100); // keep max 100 recent entries
  setStoredJson(STORAGE_KEYS.HISTORY, updated);
  return updated;
}

export function removeHistoryItems(keys: { id: string; source: string }[]): HistoryItem[] {
  const list = loadHistory();
  const set = new Set(keys.map((k) => `${k.source}|${k.id}`));
  const updated = list.filter((x) => !set.has(`${x.source}|${x.id}`));
  setStoredJson(STORAGE_KEYS.HISTORY, updated);
  return updated;
}

export function clearAllHistory(): void {
  setStoredJson(STORAGE_KEYS.HISTORY, []);
}

// Favorites / Watchlist
export function loadFavorites(): FavoriteItem[] {
  return getStoredJson<FavoriteItem[]>(STORAGE_KEYS.FAVORITES, []);
}

export function toggleFavorite(item: FavoriteItem): { favorites: FavoriteItem[]; isFav: boolean } {
  const list = loadFavorites();
  const index = list.findIndex((x) => x.id === item.id && x.source === item.source);
  let updated: FavoriteItem[];
  let isFav = false;
  if (index >= 0) {
    updated = list.filter((_, idx) => idx !== index);
    isFav = false;
  } else {
    updated = [{ ...item, updatedAt: Date.now() }, ...list];
    isFav = true;
  }
  setStoredJson(STORAGE_KEYS.FAVORITES, updated);
  return { favorites: updated, isFav };
}

export function updateFavoriteStatus(id: string, source: string, status: FavoriteItem['status']): FavoriteItem[] {
  const list = loadFavorites();
  const updated = list.map((x) => {
    if (x.id === id && x.source === source) {
      return { ...x, status, updatedAt: Date.now() };
    }
    return x;
  });
  setStoredJson(STORAGE_KEYS.FAVORITES, updated);
  return updated;
}

export function removeFavoriteItems(keys: { id: string; source: string }[]): FavoriteItem[] {
  const list = loadFavorites();
  const set = new Set(keys.map((k) => `${k.source}|${k.id}`));
  const updated = list.filter((x) => !set.has(`${x.source}|${x.id}`));
  setStoredJson(STORAGE_KEYS.FAVORITES, updated);
  return updated;
}

// Custom Sources
export function loadCustomSources(): CustomSourceSite[] {
  return getStoredJson<CustomSourceSite[]>(STORAGE_KEYS.CUSTOM_SOURCES, []);
}

export function saveCustomSource(source: CustomSourceSite): CustomSourceSite[] {
  const list = loadCustomSources();
  const filtered = list.filter((x) => x.id !== source.id);
  const updated = [...filtered, source];
  setStoredJson(STORAGE_KEYS.CUSTOM_SOURCES, updated);
  return updated;
}

export function deleteCustomSource(id: string): CustomSourceSite[] {
  const list = loadCustomSources();
  const updated = list.filter((x) => x.id !== id);
  setStoredJson(STORAGE_KEYS.CUSTOM_SOURCES, updated);
  return updated;
}

// Source Visibility
export function loadSourceVisibility(): Record<string, boolean> {
  return getStoredJson<Record<string, boolean>>(STORAGE_KEYS.SOURCES_VISIBILITY, {});
}

export function saveSourceVisibility(map: Record<string, boolean>): void {
  setStoredJson(STORAGE_KEYS.SOURCES_VISIBILITY, map);
}

// Recent Searches
export function loadRecentSearches(): string[] {
  return getStoredJson<string[]>(STORAGE_KEYS.RECENT_SEARCHES, []);
}

export function addRecentSearch(query: string): string[] {
  const clean = query.trim();
  if (!clean) return loadRecentSearches();
  const list = loadRecentSearches().filter((x) => x !== clean);
  const updated = [clean, ...list].slice(0, 20);
  setStoredJson(STORAGE_KEYS.RECENT_SEARCHES, updated);
  return updated;
}

export function clearRecentSearches(): void {
  setStoredJson(STORAGE_KEYS.RECENT_SEARCHES, []);
}

// Last Active Source
export function loadLastActiveSource(): string {
  try {
    return localStorage.getItem(STORAGE_KEYS.LAST_SOURCE) || 'hongguo';
  } catch {
    return 'hongguo';
  }
}

export function saveLastActiveSource(source: string): void {
  try {
    localStorage.setItem(STORAGE_KEYS.LAST_SOURCE, source);
  } catch {}
}
