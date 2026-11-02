// Vercel 部署入口：把整个 /api/* 交给 server/router.mjs。
//
// 为什么不用 api/[...path].mjs 这种 catch-all 文件名？
// 实测 Vercel 的 api/ 目录 catch-all 有两个坑：
//   1) 它只能匹配「单级」路径——/api/live/sources、/api/source/test、/api/cover/stats
//      这类多级路径会在 Vercel 层直接 404（x-vercel-error: NOT_FOUND），根本到不了函数；
//   2) catch-all 下 req.url 是否带 /api 前缀并不一致，按 /api/xxx 匹配会偶发 404。
// 因此这里改用固定入口 api/index.mjs，由 vercel.json 的 rewrite
//   { "source": "/api/(.*)", "destination": "/api/index?upstreamPath=$1" }
// 把完整路径通过 upstreamPath 显式传进来，路由层不再依赖 req.url 的前缀约定，
// 单级 / 多级路径、GET / POST 全部稳定到达同一个函数。
//
// 与 Cloudflare Pages Functions 的区别：
//   - Vercel 的 Node.js 运行时原生就是 Node 的 req/res（http.IncomingMessage /
//     http.ServerResponse），router.mjs 的「类 Node 契约」直接满足，无需再写一层
//     Web Request ↔ Node 的翻译桥（Cloudflare 那边才需要 bridge.mjs）。
//   - 没有边缘 Cache API，封面改用路由层内置的「进程内内存缓存」——实例热路径命中，
//     冷启动回源一次；同一张海报不会在单实例内重复抓。
//   - 文件系统只读（/tmp 除外），因此不接磁盘 store；library 默认走「进程内 +
//     前端 localStorage 镜像」，与「未绑 KV 的 Cloudflare」行为完全一致。
//   - 实例同样无状态、可能被回收，所以 setRuntime('edge')：聚合搜索一次性跑完。
//
// 限制提示：Vercel Functions 跑在 AWS Lambda 上，出站除 25 端口外不限制，
// 秀果直播 :81 面板源云端可用，无需降级（与 Cloudflare 的 4 端口限制不同）。

import { handleRequest, setRuntime } from '../server/router.mjs';

// 告诉路由层：这里没有常驻进程，进程内状态（聚合搜索会话）不能跨请求复用。
setRuntime('edge');

/**
 * Vercel 的 Node 运行时在某些配置下会把请求体提前解析到 req.body（字符串 / Buffer）。
 * router 的 readBody() 用 `for await (const chunk of req)` 读流，如果流已被消费，
 * 这里把 req.body 包成一个一次性 async 迭代器兜底，避免 POST 拿不到参数。
 * 若 req.body 为空（标准裸流场景），则原样返回，交给流迭代。
 */
function adaptReq(req) {
  const body = req.body;
  // Vercel 某些配置会把请求体提前解析到 req.body；router 的 readBody() 用
  // Buffer.concat 拼装，要求每个 chunk 是 Buffer/Uint8Array，所以字符串要转回 Buffer。
  const chunk =
    typeof body === 'string' ? Buffer.from(body, 'utf-8') : body;
  if (chunk != null && (Buffer.isBuffer(chunk) || chunk instanceof Uint8Array)) {
    return Object.create(req, {
      [Symbol.asyncIterator]: {
        configurable: true,
        value: async function* () {
          yield chunk;
        },
      },
    });
  }
  return req;
}

/**
 * 还原真实请求路径。
 * Vercel 的 rewrite 把 /api/<x> 转发到 /api/index，函数内 req.url 变成
 * `/api/index?upstreamPath=<x>`。这里读取 upstreamPath 还原出 /api/<x>；
 * 若没有该参数（本地 vercel dev 直接命中、或单测构造的裸 req），则回退用 req.url 本身。
 */
function buildURL(req) {
  const host = req.headers.host || 'localhost';
  const proto = req.headers['x-forwarded-proto'] || 'https';
  const base = `${proto}://${host}`;
  const url = new URL(req.url || '/', base);
  const upstream = url.searchParams.get('upstreamPath');
  if (upstream != null) {
    url.pathname = '/api/' + upstream.replace(/^\/+/, '');
  }
  return url;
}

export default async function handler(req, res) {
  const url = buildURL(req);
  try {
    await handleRequest(adaptReq(req), res, url);
  } catch (error) {
    const message = error?.message || String(error || '未知错误');
    if (!res.headersSent) {
      // 与 Cloudflare 版保持一致：兜底一律非 2xx。回 200 会让播放器把错误 JSON
      // 当成 m3u8 / 分片内容，既触发不了重试也看不出上游有问题。
      res.writeHead(502, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        'Access-Control-Allow-Origin': '*',
      });
    }
    res.end(JSON.stringify({ ok: false, error: message }));
  }
}
