// 收藏夹 / 播放记录：移植 guoappxp native/server/library.go
//
// 同一份语义，三层落地：
//   - Node 本地服务：server/data/library.json（server/lib/library-node.mjs）
//   - Cloudflare Pages Functions：KV 命名空间（functions/_lib/library-kv.mjs）
//   - 都没配置时：进程内存储，重启即丢（不报错，前端还有 localStorage 镜像）
// 前端始终在 localStorage 留一份镜像，服务端不可用时照常可用。
//
// 接口语义（与 Go 版一致）：
//   list  favorites | history
//   op    put（同剧只留一条并置顶） / remove / clear / toggle
//   item  单条记录
//   keys  批量删除的 "source|id" 列表

const HISTORY_LIMIT = 300;
const FAVORITE_LIMIT = 600;
const MAX_TITLE = 256;
const MAX_COVER = 2048;

/**
 * 存储层契约：
 *   read()          -> Promise<string|null>   读取原始 JSON 文本
 *   write(text)     -> Promise<void>          整体覆盖写入
 *   describe()      -> string                 调试用的位置描述
 */
export function createMemoryLibraryStore() {
  let text = null;
  return {
    async read() {
      return text;
    },
    async write(next) {
      text = next;
    },
    describe() {
      return 'memory';
    },
  };
}

let store = createMemoryLibraryStore();
let cache = null;
let writing = Promise.resolve();

/** 替换存储层（Node 走磁盘，边缘走 KV）。 */
export function setLibraryStore(next) {
  store = next || createMemoryLibraryStore();
  cache = null;
}

/** 存储位置描述（/api/library 调试信息）。 */
export function libraryBackend() {
  try {
    return store.describe?.() || 'unknown';
  } catch {
    return 'unknown';
  }
}

function clampText(value, limit) {
  const text = String(value ?? '').trim();
  const chars = [...text];
  return chars.length > limit ? chars.slice(0, limit).join('') : text;
}

function sanitize(entry) {
  const clean = {
    id: clampText(entry?.id, 128),
    source: clampText(entry?.source, 64),
    sourceName: clampText(entry?.sourceName, 64),
    title: clampText(entry?.title, MAX_TITLE),
    cover: clampText(entry?.cover, MAX_COVER),
    episodes: clampText(entry?.episodes, 32),
    index: Number(entry?.index) || 0,
    episodeTitle: clampText(entry?.episodeTitle, MAX_TITLE),
    position: Number(entry?.position) || 0,
    duration: Number(entry?.duration) || 0,
    updatedAt: Number(entry?.updatedAt) || 0,
    // 收藏夹专用：想看 / 在看 / 已看
    status: clampText(entry?.status, 16) || 'watching',
  };
  if (clean.index < 0) clean.index = 0;
  if (clean.position < 0) clean.position = 0;
  if (clean.duration < 0) clean.duration = 0;
  if (!clean.title) clean.title = '未命名';
  if (clean.updatedAt <= 0) clean.updatedAt = Date.now();
  return clean;
}

function sanitizeList(items, limit) {
  if (!Array.isArray(items)) return [];
  return items
    .slice(0, limit)
    .filter((item) => item && clampText(item.id, 128))
    .map(sanitize);
}

export function entryKey(entry) {
  return `${String(entry?.source ?? '').trim()}|${String(entry?.id ?? '').trim()}`;
}

function clone(data) {
  return {
    favorites: data.favorites.map((item) => ({ ...item })),
    history: data.history.map((item) => ({ ...item })),
  };
}

function emptyLibrary() {
  return { favorites: [], history: [] };
}

/** 读库（内存缓存 + 底层存储）。 */
export async function readLibrary() {
  if (cache) return clone(cache);
  const data = emptyLibrary();
  try {
    const raw = await store.read();
    if (raw) {
      const parsed = JSON.parse(raw);
      data.favorites = sanitizeList(parsed?.favorites, FAVORITE_LIMIT);
      data.history = sanitizeList(parsed?.history, HISTORY_LIMIT);
    }
  } catch {
    /* 首次运行 / 数据损坏：按空库处理 */
  }
  data.history.sort((left, right) => right.updatedAt - left.updatedAt);
  cache = data;
  return clone(data);
}

/** 由存储层保证原子性（Node 用 tmp+rename，KV 本身是单键覆盖）。 */
async function persist(data) {
  cache = clone(data);
  await store.write(JSON.stringify(data, null, 2));
}

function trimList(items, limit) {
  return items.length > limit ? items.slice(0, limit) : items;
}

function apply(data, list, op, entry, keys) {
  const isHistory = list === 'history';
  let target = isHistory ? data.history : data.favorites;

  if (op === 'clear') {
    target = [];
  } else if (op === 'remove') {
    const wanted = new Set(keys);
    target = target.filter((item) => !wanted.has(entryKey(item)));
  } else if (op === 'toggle') {
    const key = entryKey(entry);
    const kept = target.filter((item) => entryKey(item) !== key);
    const removed = kept.length !== target.length;
    target = removed ? kept : [sanitize(entry), ...kept];
  } else {
    // put：同剧只保留一条，并移到最前面（续播位置随之更新）
    const key = entryKey(entry);
    target = [sanitize(entry), ...target.filter((item) => entryKey(item) !== key)];
  }

  if (isHistory) data.history = trimList(target, HISTORY_LIMIT);
  else data.favorites = trimList(target, FAVORITE_LIMIT);
  return data;
}

function parseKeys(value) {
  if (Array.isArray(value)) return value.map((item) => String(item)).filter(Boolean);
  if (typeof value === 'string' && value.trim()) return [value.trim()];
  return [];
}

/**
 * 应用一次写操作。
 * @param {{list?: string, op?: string, item?: object, keys?: string[]|string, key?: string}} payload
 */
export async function applyLibrary(payload) {
  const list = String(payload?.list || '');
  if (list !== 'history' && list !== 'favorites') throw new Error('list 只能是 history 或 favorites');

  let op = String(payload?.op || 'put');
  if (!['put', 'remove', 'clear', 'toggle'].includes(op)) throw new Error('不支持的操作');

  const entry = payload?.item && typeof payload.item === 'object' ? payload.item : {};
  let keys = parseKeys(payload?.keys);
  if (!keys.length) keys = parseKeys(payload?.key);

  if ((op === 'put' || op === 'toggle') && !clampText(entry.id, 128)) {
    throw new Error('缺少剧集 id');
  }

  // 串行化写入：并发上报时不至于互相覆盖
  let result;
  writing = writing.then(async () => {
    const data = await readLibrary();
    apply(data, list, op, entry, keys);
    await persist(data);
    result = clone(data);
  });
  await writing;
  return result || (await readLibrary());
}
