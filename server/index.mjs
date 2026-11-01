// Node 本地抓取服务入口（`npm run serve`，默认 8788 端口）。
//
// 本文件只负责「Node 运行时相关」的部分：
//   - 静态文件托管（dist/）
//   - CORS 预检兜底
//   - 把磁盘存储接到 covers / library 上
//   - Vite dev / preview 的中间件复用
// 真正的路由全在 router.mjs，那份代码同样跑在 Cloudflare Pages Functions 上。
//
// 路由一览（全部同源，前端直连）：
//   GET  /api/health
//   POST /api/catalog            目录（站源 / 分类 / 翻页）
//   POST /api/categories         分类列表
//   POST /api/search             单源搜索
//   POST /api/search/start       跨源聚合搜索（立即返回会话号）
//   POST /api/search/poll        轮询聚合快照
//   POST /api/search/cancel      结束会话
//   POST /api/detail             详情 + 分集
//   POST /api/resolve            取播放直链（多线路备选）
//   POST /api/source/test        规则校验（带在线连通性探测）
//   POST /api/source/import      订阅 / JSON 文本导入 → 站点草稿列表
//   GET  /api/live/sources       直播源列表
//   POST /api/live/platforms     直播分类
//   POST /api/live/channels      直播频道
//   POST /api/live/play          直播取流
//   GET  /api/proxy              原始抓取（调试 / 规则测试）
//   GET  /api/hls                m3u8 改写 + 去广告
//   GET  /api/media              分片 / 直链转发（保留 Range）
//   GET  /api/cover              封面代理（豆瓣防盗链）
//   GET  /api/library            收藏夹 / 播放记录（磁盘共享库）

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize as normalizePath } from 'node:path';

import { handleRequest } from './router.mjs';
import { useFsCoverStore } from './lib/covers-node.mjs';
import { useFsLibraryStore } from './lib/library-node.mjs';

// 磁盘存储：封面缓存 + 收藏夹。边缘运行时用 Cache API / KV 顶这两块。
useFsCoverStore();
useFsLibraryStore();

function sendJSON(res, status, payload) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
  });
  res.end(JSON.stringify(payload));
}

function sendError(res, error) {
  const message = error?.message || String(error || '未知错误');
  sendJSON(res, 200, { ok: false, error: message });
}

/** Node 中间件：给 Vite dev / preview 复用同一套路由。 */
export function apiMiddleware() {
  return async (req, res, next) => {
    const url = new URL(req.url || '/', 'http://127.0.0.1');
    if (!url.pathname.startsWith('/api/')) return next();
    try {
      await handleRequest(req, res, url);
    } catch (error) {
      sendError(res, error);
    }
  };
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.mp4': 'video/mp4',
};

async function serveStatic(req, res, distDir) {
  const url = new URL(req.url || '/', 'http://127.0.0.1');
  let pathname = decodeURIComponent(url.pathname);
  if (pathname === '/') pathname = '/index.html';
  const target = normalizePath(join(distDir, pathname));
  if (!target.startsWith(normalizePath(distDir))) {
    res.writeHead(403).end('Forbidden');
    return;
  }
  try {
    const info = await stat(target);
    if (!info.isFile()) throw new Error('not a file');
    const body = await readFile(target);
    res.writeHead(200, {
      'Content-Type': MIME[extname(target).toLowerCase()] || 'application/octet-stream',
      'Content-Length': body.length,
    });
    res.end(body);
  } catch {
    try {
      const body = await readFile(join(distDir, 'index.html'));
      res.writeHead(200, { 'Content-Type': MIME['.html'] });
      res.end(body);
    } catch {
      res.writeHead(404).end('Not Found');
    }
  }
}

export function createAppServer({ distDir = join(process.cwd(), 'dist') } = {}) {
  return createServer(async (req, res) => {
    const url = new URL(req.url || '/', 'http://127.0.0.1');
    if (url.pathname.startsWith('/api/')) {
      try {
        await handleRequest(req, res, url);
      } catch (error) {
        sendError(res, error);
      }
      return;
    }
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': '*',
        'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      });
      return res.end();
    }
    await serveStatic(req, res, distDir);
  });
}

/** 独立运行：node server/index.mjs（默认 8788 端口）。 */
if (process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('server/index.mjs')) {
  const port = Number.parseInt(process.env.PORT || '8788', 10);
  createAppServer().listen(port, '0.0.0.0', () => {
    console.log(`[guoappnew] 抓取服务已启动: http://127.0.0.1:${port}`);
  });
}

export { handleRequest, parseImport } from './router.mjs';
export { DEFAULT_UA, mergeHeaders, splitSpec, normalizeKey } from './router.mjs';
