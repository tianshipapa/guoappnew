// 收藏夹的 Node 磁盘实现。
//
// library.mjs 只有纯语义 + 存储层抽象；本文件把存储层换成 server/data/library.json，
// 只在 Node 入口引入，边缘运行时不会加载。
//
// 写盘策略：先写 .tmp 再 rename，中途崩溃不会留下半截 JSON。

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { setLibraryStore } from './library.mjs';

export const DEFAULT_LIBRARY_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'data',
  'library.json'
);

/**
 * 创建一个 JSON 文件存储。
 * @param {string} [path]
 */
export function createFsLibraryStore(path = DEFAULT_LIBRARY_PATH) {
  const libraryPath = path;

  return {
    async read() {
      try {
        return await readFile(libraryPath, 'utf-8');
      } catch {
        return null;
      }
    },

    async write(text) {
      await mkdir(dirname(libraryPath), { recursive: true });
      const part = `${libraryPath}.tmp`;
      await writeFile(part, text, 'utf-8');
      await rename(part, libraryPath);
    },

    describe() {
      return libraryPath;
    },
  };
}

/** 装上磁盘存储（Node 入口调用）。 */
export function useFsLibraryStore(path = DEFAULT_LIBRARY_PATH) {
  const store = createFsLibraryStore(path);
  setLibraryStore(store);
  return store;
}

/** 测试 / 部署时改写存储位置。 */
export function setLibraryPath(path) {
  setLibraryStore(createFsLibraryStore(path));
}

export {
  readLibrary,
  applyLibrary,
  entryKey,
  setLibraryStore,
  libraryBackend,
  createMemoryLibraryStore,
} from './library.mjs';
