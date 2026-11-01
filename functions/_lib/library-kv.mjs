// 收藏夹的 Cloudflare KV 实现。
//
// 边缘运行时没有文件系统，library.mjs 的默认存储是「进程内」，实例一换就丢；
// 绑定 KV 之后换设备、换浏览器都能看到同一份收藏夹。
//
// 单键整体覆盖（key = library），与 Go 版 library.json 的语义一致：
// 数据量上限 300 条历史 + 600 条收藏，单值远小于 KV 的 25MB 限制。

import { setLibraryStore } from '../../server/lib/library.mjs';

const KEY = 'library';

/**
 * 装上 KV 存储。
 * @param {KVNamespace} kv Cloudflare KV 绑定
 */
export function useKvLibraryStore(kv) {
  setLibraryStore({
    async read() {
      return (await kv.get(KEY)) ?? null;
    },

    async write(text) {
      await kv.put(KEY, text);
    },

    describe() {
      return 'kv:library';
    },
  });
}
