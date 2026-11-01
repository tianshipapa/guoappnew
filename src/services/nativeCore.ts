// 本地抓取服务的客户端封装。
//
// 部署形态有两种：
// 1. `npm run dev`：Vite 插件把 /api/* 挂在同一个端口上，走同源相对路径；
// 2. Cloudflare Pages 等静态托管：页面没有后端，Cloudflare 对静态资源的
//    非 GET 请求会直接回 405，因此必须显式指向用户本机的抓取服务
//    （默认 http://127.0.0.1:8788，由 `npm run serve` 启动）。
//
// 全站所有抓取、规则解析、m3u8 去广告都在这台本机服务里完成，
// 浏览器只负责发一次跨源请求；服务端已放开 CORS 与 Private Network 预检，
// 因此不会出现浏览器直连站点被打 403 的情况。

export interface NativeResponse<T> {
  ok: boolean;
  error?: string;
  [key: string]: any;
}

export class NativeCoreError extends Error {
  readonly offline: boolean;

  constructor(message: string, offline = false) {
    super(message);
    this.name = 'NativeCoreError';
    this.offline = offline;
  }
}

const BASE_KEY = 'duanju_native_core_base_v1';
/**
 * 备选抓取服务地址：只在用户手动填写时使用。
 * 默认走「同源」—— 本地 `npm run serve` 和 Cloudflare Pages Functions 都把 /api 挂在页面同域。
 */
export const DEFAULT_CORE_BASE = 'http://127.0.0.1:8788';

let healthPromise: Promise<boolean> | null = null;
let healthState: { ok: boolean; at: number } | null = null;
const HEALTH_TTL_OK = 15000; // 在线结果缓存较久，避免频繁打扰
const HEALTH_TTL_FAIL = 5000; // 离线结果缓存较短，尽快重试恢复
const HEALTH_TIMEOUT = 10000; // 容忍边缘函数冷启动 / 瞬时抖动（原先 4s 太短）

/** 单次健康检查；超时（冷启动）或网络错误都归为 false，不抛异常。 */
function checkHealth(timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    fetch(coreURL('/api/health'), {
      signal: controller.signal,
      mode: 'cors',
      cache: 'no-store',
    })
      .then((response) => resolve(response.ok))
      .catch(() => resolve(false))
      .finally(() => clearTimeout(timer));
  });
}

function isLocalHostName(host: string): boolean {
  return (
    !host ||
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host === '0.0.0.0' ||
    host === '[::1]' ||
    host === '::1' ||
    host.endsWith('.localhost')
  );
}

/** 当前页面是否就跑在本地（dev / 本机托管）。 */
export function isLocalPage(): boolean {
  if (typeof window === 'undefined') return true;
  return isLocalHostName(window.location.hostname);
}

function readStoredBase(): string | null {
  try {
    return localStorage.getItem(BASE_KEY);
  } catch {
    return null;
  }
}

/**
 * 抓取服务基地址。
 * - 默认空字符串 = 同源相对路径：
 *   · 本地：Vite 中间件 / `npm run serve` 都挂在页面同域
 *   · 云端：Cloudflare Pages Functions 把 /api/* 挂在同一个域名下
 * - 用户手动设置过的地址优先（比如想让页面连另一台机器上的服务）
 */
export function getCoreBase(): string {
  const stored = readStoredBase();
  if (stored !== null) return stored.replace(/\/+$/, '');
  return '';
}

/** 设置抓取服务地址；传空字符串表示「跟随当前站点同源」。 */
export function setCoreBase(base: string): void {
  const value = String(base || '').trim().replace(/\/+$/, '');
  try {
    if (value) localStorage.setItem(BASE_KEY, value);
    else localStorage.removeItem(BASE_KEY);
  } catch {
    /* localStorage 不可用时按默认走 */
  }
  healthPromise = null;
  healthState = null;
}

/** 把 /api/xxx 拼成完整地址（远程部署时必须带上本机服务的前缀）。 */
export function coreURL(path: string): string {
  const base = getCoreBase();
  return `${base}${path.startsWith('/') ? path : `/${path}`}`;
}

function encodeHeaderToken(headers?: Record<string, string>): string {
  if (!headers) return '';
  const entries = Object.entries(headers).filter(([, value]) => value);
  if (!entries.length) return '';
  try {
    const json = JSON.stringify(Object.fromEntries(entries));
    // base64url（与 server/lib/hls.mjs 保持一致）
    return btoa(unescape(encodeURIComponent(json)))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
  } catch {
    return '';
  }
}

function encodePayload(payload: unknown): string {
  const json = JSON.stringify(payload ?? {});
  return btoa(unescape(encodeURIComponent(json)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/** 服务端是否可用（结果缓存，force 时立即重测）。 */
export function isCoreOnline(force = false): Promise<boolean> {
  const now = Date.now();
  if (!force && healthState) {
    const ttl = healthState.ok ? HEALTH_TTL_OK : HEALTH_TTL_FAIL;
    if (now - healthState.at < ttl) return Promise.resolve(healthState.ok);
  }
  if (!force && healthPromise) return healthPromise;
  if (force) {
    healthPromise = null;
    healthState = null;
  }

  // 先测一次；超时（冷启动）才补测一次以吸收边缘函数首次拉起；
  // 若是硬网络错误（连接被拒等）则不再重试，快速判定离线。
  healthPromise = (async () => {
    let ok = await checkHealth(HEALTH_TIMEOUT);
    if (!ok) ok = await checkHealth(Math.min(HEALTH_TIMEOUT, 6000));
    healthState = { ok, at: Date.now() };
    return ok;
  })().finally(() => {
    healthPromise = null;
  });
  return healthPromise;
}

const OFFLINE_HINT = `抓取服务无响应（${coreURL('/api/health')}）。请确认云端 Functions（api/ 或 functions/ 目录）已随前端一起发布，或本地已运行 npm run serve`;

async function post<T = any>(path: string, body: unknown): Promise<T> {
  const url = coreURL(path);
  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      mode: 'cors',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body ?? {}),
    });
  } catch {
    throw new NativeCoreError(OFFLINE_HINT, true);
  }

  // 静态托管（Cloudflare Pages）或某些反代会把 POST 打回 405/404/501，
  // 此时退回 GET + payload 查询串，服务端两种形态都认。
  if (response.status === 405 || response.status === 501 || response.status === 404) {
    const token = encodePayload(body);
    if (token.length < 6000) {
      try {
        const retried = await fetch(`${url}${url.includes('?') ? '&' : '?'}payload=${token}`, {
          method: 'GET',
          mode: 'cors',
          cache: 'no-store',
        });
        if (retried.ok) {
          const payload = (await retried.json()) as NativeResponse<T>;
          if (payload && payload.ok !== false) return payload as unknown as T;
          throw new NativeCoreError(payload?.error || '请求失败');
        }
        response = retried;
      } catch (error) {
        if (error instanceof NativeCoreError) throw error;
        throw new NativeCoreError(OFFLINE_HINT, true);
      }
    }
  }

  if (!response.ok) {
    let detail = '';
    try {
      detail = (await response.text()).slice(0, 120);
    } catch {
      /* 忽略读取失败 */
    }
    throw new NativeCoreError(
      response.status === 404 || response.status === 405
        ? `抓取服务未就绪（HTTP ${response.status}）：云端部署需要 functions/ 目录一起发布（Pages Functions），本地则需要 npm run serve`
        : `服务返回 ${response.status}${detail ? `：${detail}` : ''}`
    );
  }

  const payload = (await response.json()) as NativeResponse<T>;
  if (!payload || payload.ok === false) {
    throw new NativeCoreError(payload?.error || '请求失败');
  }
  return payload as unknown as T;
}

export const nativeCore = {
  post,

  /** 简单 GET（收藏夹读取这类只读接口）。 */
  async get<T = any>(path: string): Promise<T> {
    const url = coreURL(path);
    let response: Response;
    try {
      response = await fetch(url, { mode: 'cors', cache: 'no-store' });
    } catch {
      throw new NativeCoreError(OFFLINE_HINT, true);
    }
    if (!response.ok) throw new NativeCoreError(`服务返回 ${response.status}`);
    const payload = (await response.json()) as NativeResponse<T>;
    if (!payload || payload.ok === false) {
      throw new NativeCoreError(payload?.error || '请求失败');
    }
    return payload as unknown as T;
  },

  /** 当前使用的抓取服务地址（空字符串代表同源）。 */
  get base() {
    return getCoreBase();
  },
  setBase: setCoreBase,
  isLocalPage,

  /** 通过本地服务拉任意文本（订阅 JSON / 网页 HTML），绕过浏览器 CORS。 */
  async fetchText(url: string, referer = ''): Promise<string> {
    const params = new URLSearchParams();
    params.set('u', url);
    if (referer) params.set('r', referer);
    let response: Response;
    try {
      response = await fetch(coreURL(`/api/proxy?${params.toString()}`), {
        mode: 'cors',
        cache: 'no-store',
      });
    } catch {
      throw new NativeCoreError(OFFLINE_HINT, true);
    }
    if (!response.ok) {
      let message = `抓取失败（${response.status}）`;
      try {
        const payload = await response.json();
        if (payload?.error) message = payload.error;
      } catch {
        /* 非 JSON 错误体，用默认文案 */
      }
      throw new NativeCoreError(message);
    }
    return response.text();
  },

  /** 拉取订阅并解析成站源草稿（一次请求完成，避免二次 POST 被拦）。 */
  async subscribe(url: string): Promise<{ drafts: any[]; count: number; finalURL?: string }> {
    return post('/api/source/subscribe', { url });
  },

  /** m3u8 代理地址：服务端改写分片、按开关去广告。 */
  hlsURL(
    url: string,
    options: { referer?: string; headers?: Record<string, string>; adBlock?: boolean } = {}
  ) {
    if (!url) return '';
    const params = new URLSearchParams();
    params.set('u', url);
    if (options.referer) params.set('r', options.referer);
    const token = encodeHeaderToken(options.headers);
    if (token) params.set('h', token);
    if (options.adBlock === false) params.set('ad', '0');
    return coreURL(`/api/hls?${params.toString()}`);
  },

  /** 分片 / mp4 直链代理地址。 */
  mediaURL(url: string, options: { referer?: string; headers?: Record<string, string> } = {}) {
    if (!url) return '';
    const params = new URLSearchParams();
    params.set('u', url);
    if (options.referer) params.set('r', options.referer);
    const token = encodeHeaderToken(options.headers);
    if (token) params.set('h', token);
    return coreURL(`/api/media?${params.toString()}`);
  },

  /** 按媒体类型自动选择代理入口。 */
  playURL(
    url: string,
    options: { referer?: string; headers?: Record<string, string>; adBlock?: boolean } = {}
  ) {
    if (!url) return '';
    return /\.m3u8(\?|#|$)/i.test(url)
      ? this.hlsURL(url, options)
      : this.mediaURL(url, options);
  },
};
