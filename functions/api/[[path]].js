// Cloudflare Pages Functions 入口：把整个 /api/* 交给 server/router.mjs。
//
// 与 Node 版的唯一区别在「外壳」：
//   - 请求/响应翻译：./../_lib/bridge.js
//   - 封面缓存：边缘 Cache API（Node 版是 server/data/covers 磁盘）
//   - 收藏夹：KV（Node 版是 server/data/library.json）
// 抓取、m3u8 改写、去广告、站源解析等业务逻辑一行都没有分叉。
//
// 限制提示（写进 README 了）：Workers 只允许 443/80/8080/8443 等标准端口，
// 秀果直播的 :81 面板源在云端不可用，需要本地服务。Vercel 不受此限（见 api/[...path].js）。

import { handleRequest, setRuntime } from '../../server/router.mjs';
import { configureFetch } from '../../server/lib/http.mjs';
import { setLivePortRestricted } from '../../server/lib/live/index.mjs';
import { useKvLibraryStore } from '../_lib/library-kv.mjs';
import { createBridge } from '../_lib/bridge.mjs';

// 告诉路由层：这里没有常驻进程，进程内状态（聚合搜索会话）不能跨请求复用
setRuntime('edge');
// Cloudflare 出站端口受限：标记秀果 :81 面板源云端不可用（仅 Cloudflare；Vercel 不调用，不受影响）。
setLivePortRestricted(true);

let lastKv = null;
let lastRelaySignature = '';

/**
 * Pages 的环境变量只在 context.env 里，process.env 读不到——
 * 抓取中继必须在这里显式注入，否则 GUOAPP_FETCH_RELAY 配了也没用。
 */
function configureRelay(env) {
  if (!env) return;
  const relay = env.GUOAPP_FETCH_RELAY;
  const token = env.GUOAPP_FETCH_RELAY_TOKEN;
  const force = env.GUOAPP_FETCH_RELAY_FORCE;
  const signature = `${relay || ''}#${token || ''}#${force || ''}`;
  if (signature === lastRelaySignature) return;
  lastRelaySignature = signature;
  configureFetch({ relay, token, force });
}

/** KV 绑定只装一次，避免每次请求都清掉 library.mjs 的内存缓存。 */
function configure(env) {
  configureRelay(env);
  const kv = env?.LIBRARY_KV;
  if (!kv || kv === lastKv) return;
  lastKv = kv;
  useKvLibraryStore(kv);
}

/** 跑一次路由，返回 Web Response。 */
async function runRouter(request) {
  const url = new URL(request.url);
  const { req, res, response } = createBridge(request);

  // 不 await：流式响应要尽早把 Response 交出去，后续 write 继续往流里推
  const task = handleRequest(req, res, url).catch((error) => {
    const message = error?.message || String(error || '未知错误');
    // 兜底必须是**非 2xx**：以前这里回 200 + JSON，hls.js 拿到 200 会把它当 m3u8
    // 解析，报的是「清单解析失败」，既触发不了重试也看不出上游有问题。回 502
    // 才能让播放器走「原地重连 → 换线路 → 重新解析」这条恢复链。
    try {
      res.writeHead(502, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        'Access-Control-Allow-Origin': '*',
      });
      res.end(JSON.stringify({ ok: false, error: message }));
    } catch {
      /* 响应已经开始，无法再改状态码 */
    }
  });

  const out = await response();
  // 纯 JSON 这类一次性响应在这里已经写完；流式响应则交给运行时继续消费
  void task;
  return out;
}

/**
 * 封面走边缘缓存：同一张豆瓣海报在全球节点只回源一次。
 * 注意只缓存真正成功的图片，错误占位图（no-store）不缓存。
 */
async function handleCover(context) {
  const { request, waitUntil } = context;
  const cache = typeof caches !== 'undefined' ? caches.default : null;
  if (!cache) return runRouter(request);

  const key = new Request(request.url, { method: 'GET' });
  const hit = await cache.match(key).catch(() => null);
  if (hit) return hit;

  const fresh = await runRouter(request);
  const type = fresh.headers.get('content-type') || '';
  const cacheControl = fresh.headers.get('cache-control') || '';
  if (fresh.status === 200 && type.startsWith('image/') && !cacheControl.includes('no-store')) {
    waitUntil(cache.put(key, fresh.clone()).catch(() => {}));
  }
  return fresh;
}

export async function onRequest(context) {
  const { request, env, next } = context;
  const url = new URL(request.url);
  if (!url.pathname.startsWith('/api/')) return next();

  configure(env);

  if (request.method === 'GET' && url.pathname === '/api/cover') {
    return handleCover(context);
  }
  return runRouter(request);
}
