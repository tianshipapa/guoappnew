// 本地抓取服务的客户端封装。
//
// 所有跨域抓取、规则解析、m3u8 去广告都在 server/ 里完成，前端只发同源请求。
// 统一在这里处理「服务不可用」的提示，避免每个调用点各写一遍。

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

let healthPromise: Promise<boolean> | null = null;

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

/** 服务端是否可用（首次探测后缓存，失败 10 秒后允许重试）。 */
export function isCoreOnline(force = false): Promise<boolean> {
  if (force) healthPromise = null;
  if (!healthPromise) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4000);
    healthPromise = fetch('/api/health', { signal: controller.signal })
      .then((response) => response.ok)
      .catch(() => false)
      .finally(() => clearTimeout(timer));
    healthPromise.then((ok) => {
      if (!ok) {
        healthPromise = null;
      }
    });
  }
  return healthPromise;
}

async function post<T = any>(path: string, body: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body ?? {}),
    });
  } catch (error: any) {
    throw new NativeCoreError(
      '本地抓取服务未启动，请运行 npm run dev 或 npm run serve',
      true
    );
  }
  if (!response.ok) throw new NativeCoreError(`服务返回 ${response.status}`);
  const payload = (await response.json()) as NativeResponse<T>;
  if (!payload || payload.ok === false) {
    throw new NativeCoreError(payload?.error || '请求失败');
  }
  return payload as unknown as T;
}

export const nativeCore = {
  post,

  /** m3u8 代理地址：服务端改写分片、按开关去广告。 */
  hlsURL(url: string, options: { referer?: string; headers?: Record<string, string>; adBlock?: boolean } = {}) {
    if (!url) return '';
    const params = new URLSearchParams();
    params.set('u', url);
    if (options.referer) params.set('r', options.referer);
    const token = encodeHeaderToken(options.headers);
    if (token) params.set('h', token);
    if (options.adBlock === false) params.set('ad', '0');
    return `/api/hls?${params.toString()}`;
  },

  /** 分片 / mp4 直链代理地址。 */
  mediaURL(url: string, options: { referer?: string; headers?: Record<string, string> } = {}) {
    if (!url) return '';
    const params = new URLSearchParams();
    params.set('u', url);
    if (options.referer) params.set('r', options.referer);
    const token = encodeHeaderToken(options.headers);
    if (token) params.set('h', token);
    return `/api/media?${params.toString()}`;
  },

  /** 按媒体类型自动选择代理入口。 */
  playURL(url: string, options: { referer?: string; headers?: Record<string, string>; adBlock?: boolean } = {}) {
    if (!url) return '';
    return /\.m3u8(\?|#|$)/i.test(url)
      ? this.hlsURL(url, options)
      : this.mediaURL(url, options);
  },

  /**
   * 经服务端抓任意文本（订阅 JSON / 页面 HTML）。
   * 浏览器直连会被 CORS 拦、拿不到真正 Content-Type，统一走 /api/proxy。
   */
  async fetchText(url: string, referer = ''): Promise<string> {
    const params = new URLSearchParams();
    params.set('u', url);
    if (referer) params.set('r', referer);
    let response: Response;
    try {
      response = await fetch(`/api/proxy?${params.toString()}`);
    } catch {
      throw new NativeCoreError('本地抓取服务未启动，请运行 npm run dev 或 npm run serve', true);
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
};
