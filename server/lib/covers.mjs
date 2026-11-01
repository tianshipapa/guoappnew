// 封面代理：移植 guoappxp native/core/app_covers.go
//
// 为什么必须放在服务端：
// 爱看机器人（ikanbot）的海报全部指向豆瓣 CDN（img1/2/3/9.doubanio.com），
// 豆瓣图床按 Referer 防盗链 —— 浏览器里 <img src> 带的 Referer 是本站页面地址，
// 实测直接回 HTTP 418（0 字节），所以列表页会出现大量空封面。
// 服务端按域名补上正确的 Referer（豆瓣 → movie.douban.com）再转发即可。
//
// 另外沿用 Go 版的兜底解码：少数图床会返回加密过的字节流（AES-CBC / XOR），
// 只有在字节头不是已知图片格式时才尝试，正常图片直接透传。

import { createCipheriv, createDecipheriv, createHash } from 'node:crypto';

import { fetchBinary } from './http.mjs';

const MAX_BYTES = 20 << 20;
const CACHE_MAX_BYTES = 256 << 20;
const CACHE_MAX_ENTRIES = 2000;
const TTL = 30 * 24 * 3600 * 1000;

// 与 Go 版保持一致的兜底解码参数
const AES_KEY = Buffer.from('f5d965df75336270', 'utf-8');
const AES_IV = Buffer.from('97b60394abc2fbe1', 'utf-8');
const XOR_KEY = Buffer.from('2019ysapp7527', 'utf-8');

/**
 * 缓存存储层。
 *
 * 默认是进程内 LRU —— Node 与边缘运行时都能跑，但进程/隔离实例一换就丢。
 * Node 入口会通过 `setCoverStore()` 换成磁盘实现（server/lib/covers-node.mjs），
 * 边缘运行时则靠 Cloudflare 的 Cache API 做跨实例缓存，这里只当一级内存缓存。
 *
 * store 契约：
 *   get(key)             -> { data:Buffer, type:string, at:number } | null
 *   set(key, data, type) -> void
 *   stats()              -> { entries, bytes, directory }
 */
export function createMemoryCoverStore({ maxBytes = CACHE_MAX_BYTES, maxEntries = 2000, ttl = TTL } = {}) {
  const entries = new Map();
  let bytes = 0;

  function drop(key) {
    const entry = entries.get(key);
    if (!entry) return;
    entries.delete(key);
    bytes -= entry.data.length;
  }

  function prune() {
    if (bytes <= maxBytes && entries.size <= maxEntries) return;
    const sorted = [...entries.entries()].sort((a, b) => a[1].usedAt - b[1].usedAt);
    const overflowEntries = entries.size - maxEntries;
    let overflowBytes = bytes - maxBytes;
    let removed = 0;
    for (const [key, entry] of sorted) {
      if (removed >= overflowEntries && overflowBytes <= 0) break;
      drop(key);
      overflowBytes -= entry.data.length;
      removed += 1;
    }
  }

  return {
    async get(key) {
      const entry = entries.get(key);
      if (!entry) return null;
      if (Date.now() - entry.at > ttl) {
        drop(key);
        return null;
      }
      entry.usedAt = Date.now();
      return { data: entry.data, type: entry.type, at: entry.at };
    },
    async set(key, data, type) {
      drop(key);
      entries.set(key, { data, type, at: Date.now(), usedAt: Date.now() });
      bytes += data.length;
      prune();
    },
    stats() {
      return { entries: entries.size, bytes, directory: 'memory' };
    },
  };
}

let store = createMemoryCoverStore();

/** 替换存储层（Node 走磁盘，测试可注入假实现）。 */
export function setCoverStore(next) {
  store = next || createMemoryCoverStore();
}

// 下载并发闸门：guoappxp 用 `slots: make(chan struct{}, 4)`，
// 首屏几十张封面同时打豆瓣会被限速甚至 418，这里同样压到 4 路。
const MAX_CONCURRENT = 4;
let active = 0;
const waiting = [];

function acquireSlot() {
  if (active < MAX_CONCURRENT) {
    active += 1;
    return Promise.resolve();
  }
  return new Promise((resolve) => waiting.push(resolve));
}

function releaseSlot() {
  const next = waiting.shift();
  // 有排队者就把名额直接移交，active 数量不变
  if (next) next();
  else active -= 1;
}

/** 同一张图并发请求时只下载一次 */
const pending = new Map();

const DOUBAN_HOST = /(?:^|\.)(?:doubanio\.com|douban\.com)$/i;

/** 该封面地址是否需要服务端代抓（目前只有豆瓣图床有防盗链）。 */
export function needsCoverProxy(address) {
  try {
    return DOUBAN_HOST.test(new URL(String(address || '')).hostname);
  } catch {
    return false;
  }
}

/**
 * 按地址决定 Referer。
 * - 豆瓣图床：必须是豆瓣电影站页面，否则 418 / 302 到默认图
 * - 其它：不设 Referer（乱设反而会被部分 CDN 拒绝）
 */
export function coverReferer(address, explicit = '') {
  const value = String(explicit || '').trim();
  if (value) return value;
  try {
    const parsed = new URL(String(address || ''));
    if (DOUBAN_HOST.test(parsed.hostname)) return 'https://movie.douban.com/';
  } catch {
    /* 非法地址交给下游报错 */
  }
  return '';
}

/** 从字节头判断图片类型；不是图片返回空串。 */
export function imageMime(data) {
  if (!data || data.length < 12) return '';
  if (data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return 'image/jpeg';
  if (data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e && data[3] === 0x47) return 'image/png';
  if (data.toString('latin1', 0, 6) === 'GIF87a' || data.toString('latin1', 0, 6) === 'GIF89a') return 'image/gif';
  if (data.toString('latin1', 0, 4) === 'RIFF' && data.toString('latin1', 8, 12) === 'WEBP') return 'image/webp';
  if (data[0] === 0x42 && data[1] === 0x4d) return 'image/bmp';
  if (data.toString('latin1', 4, 8) === 'ftyp') {
    const brand = data.toString('latin1', 8, 12);
    if (brand.startsWith('avi')) return 'image/avif';
    if (brand.startsWith('heic') || brand.startsWith('heix') || brand.startsWith('mif1')) return 'image/heic';
  }
  const head = data.toString('utf-8', 0, Math.min(64, data.length)).trimStart();
  if (head.startsWith('<svg') || (head.startsWith('<?xml') && head.includes('<svg'))) return 'image/svg+xml';
  return '';
}

function pkcs7Unpad(buffer) {
  if (!buffer.length) return buffer;
  const pad = buffer[buffer.length - 1];
  if (pad < 1 || pad > 16 || pad > buffer.length) return buffer;
  for (let i = buffer.length - pad; i < buffer.length; i += 1) {
    if (buffer[i] !== pad) return buffer;
  }
  return buffer.subarray(0, buffer.length - pad);
}

/** 图片被加密时按 Go 版顺序尝试：AES-CBC（可带 Salted__ 头）→ XOR。 */
export function decodeCover(raw) {
  if (!raw || !raw.length) return raw;
  if (imageMime(raw)) return raw;

  let encrypted = raw;
  if (raw.length > 16 && raw.toString('latin1', 0, 8) === 'Salted__') encrypted = raw.subarray(16);
  if (encrypted.length) {
    try {
      // Go 版把密文按 16 字节补齐后再 CryptBlocks，这里同样补零
      const aligned = Buffer.alloc(Math.ceil(encrypted.length / 16) * 16);
      Buffer.from(encrypted).copy(aligned);
      // Go 版 aes.NewCipher(16 字节密钥) 等价于 AES-128-CBC
      const decipher = createDecipheriv('aes-128-cbc', AES_KEY, AES_IV);
      decipher.setAutoPadding(false);
      const plain = Buffer.concat([decipher.update(aligned), decipher.final()]).subarray(0, encrypted.length);
      const trimmed = pkcs7Unpad(plain);
      if (imageMime(trimmed)) return trimmed;
      if (imageMime(plain)) return plain;
    } catch {
      /* 不是 AES 加密，继续试 XOR */
    }
  }

  const xored = Buffer.from(raw);
  const limit = Math.min(100, xored.length);
  for (let i = 0; i < limit; i += 1) xored[i] ^= XOR_KEY[i % XOR_KEY.length];
  if (imageMime(xored)) return xored;
  return raw;
}

function cacheKey(address, source) {
  return createHash('sha256').update(`${source}\u0000${address}`).digest('hex');
}

async function readCached(key) {
  try {
    const hit = await store.get(key);
    if (!hit) return null;
    return { data: hit.data, type: hit.type || imageMime(hit.data) };
  } catch {
    return null;
  }
}

async function writeCache(key, data, type) {
  try {
    await store.set(key, data, type);
  } catch {
    /* 缓存写失败不影响本次返回 */
  }
}

/**
 * 取封面字节。
 * @param {string} address 原始封面地址
 * @param {{ source?: string, referer?: string, force?: boolean }} options
 * @returns {Promise<{ data: Buffer, type: string, cached: boolean, referer: string }>}
 */
export async function resolveCover(address, options = {}) {
  const url = String(address || '').trim();
  if (!/^https?:\/\//i.test(url)) throw new Error('封面地址无效');

  const key = cacheKey(url, options.source || '');
  if (!options.force) {
    const hit = await readCached(key);
    if (hit) return { ...hit, cached: true, referer: coverReferer(url, options.referer) };
  }

  const running = pending.get(key);
  if (running) return running;

  const referer = coverReferer(url, options.referer);
  const job = (async () => {
    await acquireSlot();
    try {
      const response = await fetchBinary(url, { referer, timeout: 15000 });
      if (response.status !== 200) throw new Error(`封面请求失败：HTTP ${response.status}`);
      const chunks = [];
      let size = 0;
      for await (const chunk of response.body) {
        size += chunk.length;
        if (size > MAX_BYTES) throw new Error('封面文件过大');
        chunks.push(chunk);
      }
      const raw = Buffer.concat(chunks);
      const data = decodeCover(raw);
      const type = imageMime(data) || 'application/octet-stream';
      if (type === 'application/octet-stream') throw new Error('站源未返回有效海报');
      await writeCache(key, data, type);
      return { data, type, cached: false, referer };
    } finally {
      releaseSlot();
    }
  })();

  pending.set(key, job);
  try {
    return await job;
  } finally {
    pending.delete(key);
  }
}

/** 缓存统计（调试用）。 */
export function coverCacheStats() {
  return store.stats();
}

/** 预热：把某个站源列表里的豆瓣封面批量抓下来，避免首屏空图。 */
export async function warmCovers(addresses, options = {}) {
  const targets = (addresses || []).filter((item) => needsCoverProxy(item)).slice(0, 40);
  const results = await Promise.allSettled(targets.map((item) => resolveCover(item, options)));
  return results.filter((item) => item.status === 'fulfilled').length;
}

// 保留给单测：直接验证加解密往返
export function encryptForTest(data) {
  const cipher = createCipheriv('aes-128-cbc', AES_KEY, AES_IV);
  return Buffer.concat([cipher.update(data), cipher.final()]);
}
