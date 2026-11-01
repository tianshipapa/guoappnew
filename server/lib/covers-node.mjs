// 封面缓存的 Node 磁盘实现。
//
// covers.mjs 是运行时无关的纯逻辑 + 内存 LRU；本文件把 LRU 换成磁盘目录，
// 只在 Node 入口（server/index.mjs）里引入，边缘运行时永远不会碰它。
//
// 目录布局：<cacheDir>/<sha256>.img，文件名即缓存键，扩展名固定 .img。

import { mkdir, readFile, readdir, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { setCoverStore } from './covers.mjs';

const CACHE_MAX_BYTES = 256 << 20;
const CACHE_MAX_ENTRIES = 2000;
const TTL = 30 * 24 * 3600 * 1000;

export const DEFAULT_COVER_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'data',
  'covers'
);

/**
 * 创建一个磁盘封面缓存。
 * @param {string} [dir]
 */
export function createFsCoverStore(dir = DEFAULT_COVER_DIR) {
  const cacheDir = dir;
  /** key -> { size, type, at, usedAt } */
  const index = new Map();
  let total = 0;
  let scanned = false;
  let writing = Promise.resolve();

  async function ensureScanned() {
    if (scanned) return;
    scanned = true;
    try {
      const files = await readdir(cacheDir);
      for (const name of files) {
        if (!name.endsWith('.img')) continue;
        const key = name.slice(0, -4);
        if (key.length !== 64) continue;
        const info = await stat(join(cacheDir, name));
        if (!info.isFile() || info.size <= 0) continue;
        index.set(key, { size: info.size, type: '', at: info.mtimeMs, usedAt: info.mtimeMs });
        total += info.size;
      }
    } catch {
      /* 目录还不存在 */
    }
    void prune();
  }

  function prune() {
    if (total <= CACHE_MAX_BYTES && index.size <= CACHE_MAX_ENTRIES) return;
    const entries = [...index.entries()].sort((a, b) => a[1].usedAt - b[1].usedAt);
    const overflowEntries = index.size - CACHE_MAX_ENTRIES;
    let overflowBytes = total - CACHE_MAX_BYTES;
    let removed = 0;
    for (const [key, entry] of entries) {
      if (removed >= overflowEntries && overflowBytes <= 0) break;
      index.delete(key);
      total -= entry.size;
      overflowBytes -= entry.size;
      removed += 1;
      void unlink(join(cacheDir, `${key}.img`)).catch(() => {});
    }
  }

  return {
    async get(key) {
      await ensureScanned();
      const entry = index.get(key);
      if (!entry) return null;
      if (Date.now() - entry.at > TTL) {
        index.delete(key);
        total -= entry.size;
        void unlink(join(cacheDir, `${key}.img`)).catch(() => {});
        return null;
      }
      try {
        const data = await readFile(join(cacheDir, `${key}.img`));
        entry.usedAt = Date.now();
        return { data, type: entry.type, at: entry.at };
      } catch {
        index.delete(key);
        total -= entry.size;
        return null;
      }
    },

    async set(key, data, type) {
      await mkdir(cacheDir, { recursive: true });
      const target = join(cacheDir, `${key}.img`);
      const part = `${target}.tmp`;
      // 串行化写入，避免并发 rename 互相踩踏
      const job = writing.then(async () => {
        await writeFile(part, data);
        await rename(part, target);
      });
      writing = job.catch(() => {});
      await job;
      const previous = index.get(key);
      if (previous) total -= previous.size;
      index.set(key, { size: data.length, type, at: Date.now(), usedAt: Date.now() });
      total += data.length;
      void prune();
    },

    stats() {
      return { entries: index.size, bytes: total, directory: cacheDir };
    },
  };
}

/** 装上磁盘存储（Node 入口调用）。 */
export function useFsCoverStore(dir = DEFAULT_COVER_DIR) {
  const store = createFsCoverStore(dir);
  setCoverStore(store);
  return store;
}

/** 测试用：改写缓存目录。 */
export function setCoverCacheDir(dir) {
  setCoverStore(createFsCoverStore(dir));
}
