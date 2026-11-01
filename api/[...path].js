// Vercel 部署入口：把整个 /api/* 交给 server/router.mjs。
//
// 与 Cloudflare Pages Functions 的区别：
//   - Vercel 的 Node.js 运行时原生就是 Node 的 req/res（http.IncomingMessage /
//     http.ServerResponse），router.mjs 的「类 Node 契约」直接满足，无需再写一层
//     Web Request ↔ Node 的翻译桥（Cloudflare 那边才需要 bridge.mjs）。
//   - 没有边缘 Cache API，封面改用路由层内置的「进程内内存缓存」——实例热路径命中，
//     冷启动回源一次；同一张海报不会在单实例内重复抓。
//   - 文件系统只读（/tmp 除外），因此不接磁盘 store；library 默认走「进程内 +
//     前端 localStorage 镜像」，与「未绑定 KV 的 Cloudflare」行为完全一致。
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

/** 用 Vercel 注入的 host / x-forwarded-proto 拼出完整 URL（req.url 只有 path+search）。 */
function buildURL(req) {
  const host = req.headers.host || 'localhost';
  const proto = req.headers['x-forwarded-proto'] || 'https';
  return new URL(req.url || '/', `${proto}://${host}`);
}

export default async function handler(req, res) {
  const url = buildURL(req);
  try {
    await handleRequest(adaptReq(req), res, url);
  } catch (error) {
    const message = error?.message || String(error || '未知错误');
    if (!res.headersSent) {
      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Access-Control-Allow-Origin': '*',
      });
    }
    res.end(JSON.stringify({ ok: false, error: message }));
  }
}
