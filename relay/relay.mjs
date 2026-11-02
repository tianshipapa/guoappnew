#!/usr/bin/env node
// 抓取中继（relay）：破解「只放行中国大陆 IP」的地域限制。
//
// 背景：agneschoi / 51shumai / jennyhow 这类采集站按 IP 归属地放行，海外机房
// （Cloudflare Pages、Vercel、Fly、AWS）直连不是 403 就是连接重置——换节点、
// 换区域、开 Smart Placement 都没用，唯一的解是让出口 IP 落在中国大陆。
//
// 用法：把这一个文件扔到国内任意一台机器（轻量服务器 / 家宽小主机 / 树莓派）上跑起来，
// 然后在站点侧配两个环境变量：
//   GUOAPP_FETCH_RELAY=http://<国内机器>:8787/?url=
//   GUOAPP_FETCH_RELAY_TOKEN=<随便一串随机字符>     # 强烈建议配，否则等于开放代理
// 直连失败或返回 403/451 时会自动改走这里，正文原样回给站点。
//
// 启动：node relay.mjs
// 可选环境变量：
//   PORT=8787                   监听端口
//   RELAY_TOKEN=xxx             鉴权令牌（请求头 x-guopp-token 或 ?token=）
//   RELAY_ALLOW_HOSTS=a.com,b.cn 只允许转发这些域名（逗号分隔，子域自动放行；空=不限）
//   RELAY_TIMEOUT_MS=20000      单次上游超时
//
// 注意：这是**正向转发器**，不是通用代理。请务必配 RELAY_ALLOW_HOSTS + RELAY_TOKEN，
// 只放行你真的要抓的那几个站，别把它做成对公网开放的开放代理（云厂商会判违规）。

import http from 'node:http';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const PORT = Number.parseInt(process.env.PORT || '8787', 10);
const TOKEN = String(process.env.RELAY_TOKEN || '').trim();
const TIMEOUT_MS = Number.parseInt(process.env.RELAY_TIMEOUT_MS || '20000', 10);
const MAX_BODY_BYTES = 2 << 20; // POST 表单体上限 2MB

const ALLOW_HOSTS = String(process.env.RELAY_ALLOW_HOSTS || '')
  .split(',')
  .map((item) => item.trim().toLowerCase())
  .filter(Boolean);

const DEFAULT_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

// fetch 会自动解压 gzip/br，content-encoding / content-length 不能透传，
// 否则下游会按「压缩后」的长度去解压，直接报错。这里只挑必要的头回传。
const PASS_RESPONSE_HEADERS = [
  'content-type',
  'content-range',
  'accept-ranges',
  'etag',
  'last-modified',
  'cache-control',
];

function hostAllowed(host) {
  if (!ALLOW_HOSTS.length) return true;
  const name = String(host || '').toLowerCase();
  return ALLOW_HOSTS.some((rule) => {
    if (rule.startsWith('.')) return name === rule.slice(1) || name.endsWith(rule);
    return name === rule || name.endsWith(`.${rule}`);
  });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error('请求体过大'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function send(res, status, payload, extraHeaders = {}) {
  const body = typeof payload === 'string' ? payload : JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
    ...extraHeaders,
  });
  res.end(body);
}

async function relay(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  if (url.pathname === '/healthz') {
    send(res, 200, { ok: true, allow: ALLOW_HOSTS.length ? ALLOW_HOSTS : 'all', token: Boolean(TOKEN) });
    return;
  }

  if (TOKEN) {
    const given = String(req.headers['x-guopp-token'] || url.searchParams.get('token') || '');
    if (given !== TOKEN) {
      send(res, 401, { ok: false, error: '中继令牌不正确' });
      return;
    }
  }

  // 目标地址三种给法：?url= / ?target= / 请求头 x-guopp-target
  const rawTarget = url.searchParams.get('url') || url.searchParams.get('target') || req.headers['x-guopp-target'] || '';
  let target;
  try {
    target = new URL(String(rawTarget));
  } catch {
    send(res, 400, { ok: false, error: '缺少或非法的目标地址（?url= 或 x-guopp-target）' });
    return;
  }
  if (!/^https?:$/.test(target.protocol)) {
    send(res, 400, { ok: false, error: `不支持的协议：${target.protocol}` });
    return;
  }
  if (!hostAllowed(target.hostname)) {
    send(res, 403, { ok: false, error: `目标域名不在白名单内：${target.hostname}` });
    return;
  }

  const method = String(req.headers['x-guopp-method'] || (req.method === 'POST' ? 'POST' : 'GET')).toUpperCase();
  const upstreamHeaders = {
    'User-Agent': String(req.headers['x-guopp-ua'] || DEFAULT_UA),
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': String(req.headers['x-guopp-accept-language'] || 'zh-CN,zh;q=0.9,en;q=0.6'),
  };
  for (const [from, to] of [
    ['x-guopp-referer', 'Referer'],
    ['x-guopp-cookie', 'Cookie'],
    ['x-guopp-range', 'Range'],
  ]) {
    const value = req.headers[from];
    if (value) upstreamHeaders[to] = String(value);
  }

  let body;
  if (method !== 'GET' && method !== 'HEAD') {
    body = await readBody(req);
    upstreamHeaders['Content-Type'] = String(
      req.headers['content-type'] || 'application/x-www-form-urlencoded'
    );
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(target.toString(), {
      method,
      headers: upstreamHeaders,
      body,
      redirect: 'follow',
      signal: controller.signal,
    });

    const headers = {
      'x-guopp-relayed': '1',
      'x-guopp-status': String(response.status),
      'x-guopp-url': response.url || target.toString(),
      'Access-Control-Allow-Origin': '*',
    };
    for (const name of PASS_RESPONSE_HEADERS) {
      const value = response.headers.get(name);
      if (value) headers[name] = value;
    }
    // 其余头一律不透传：避免把上游的 CORS / 安全头 / cookie 带进站点

    clearTimeout(timer);
    // 一行访问日志：站点侧报「抓不到」时，先看这里到底有没有请求过来
    console.log(`${method} ${response.status} ${target.toString()}`);
    res.writeHead(response.status, headers);
    if (!response.body) {
      res.end();
      return;
    }
    // 流式回传：视频分片、大页面都不进内存
    await pipeline(Readable.fromWeb(response.body), res);
  } catch (error) {
    clearTimeout(timer);
    const message =
      error?.name === 'AbortError' ? `上游超时（${TIMEOUT_MS}ms）` : String(error?.message || error);
    if (!res.headersSent) send(res, 502, { ok: false, error: `中继抓取失败：${message}` });
    else res.end();
  }
}

const server = http.createServer((req, res) => {
  relay(req, res).catch((error) => {
    if (!res.headersSent) send(res, 500, { ok: false, error: String(error?.message || error) });
    else res.end();
  });
});

server.listen(PORT, () => {
  console.log(`[relay] 监听 :${PORT}`);
  console.log(`[relay] 白名单：${ALLOW_HOSTS.length ? ALLOW_HOSTS.join(', ') : '未限制（建议配置 RELAY_ALLOW_HOSTS）'}`);
  console.log(`[relay] 鉴权：${TOKEN ? '已开启' : '未开启（建议配置 RELAY_TOKEN）'}`);
  console.log(`[relay] 自检：curl "http://127.0.0.1:${PORT}/healthz"`);
});
