// 封面地址处理。
//
// 豆瓣图床（爱看机器人的海报全部来自 img1/2/3/9.doubanio.com）按 Referer 防盗链：
// 浏览器里 <img src> 会带本站页面的 Referer，豆瓣实测回 HTTP 418（0 字节），
// 所以列表页会出现大片空封面。这类地址统一改走本地服务的 /api/cover，
// 由服务端补上 movie.douban.com 的 Referer 并缓存到磁盘。

import { coreURL } from '../services/nativeCore';

/** 需要服务端代抓的图片域名（目前只有豆瓣图床有防盗链）。 */
const PROXY_HOSTS = [/(?:^|\.)doubanio\.com$/i, /(?:^|\.)douban\.com$/i];

function hostOf(address: string): string {
  try {
    return new URL(address).hostname;
  } catch {
    return '';
  }
}

/** 该封面是否必须走服务端代理。 */
export function needsCoverProxy(address: string): boolean {
  if (!address || !/^https?:\/\//i.test(address)) return false;
  const host = hostOf(address);
  return Boolean(host) && PROXY_HOSTS.some((pattern) => pattern.test(host));
}

/** 封面代理地址（带 source，便于服务端按源决定 Referer）。 */
export function coverProxyURL(address: string, source = ''): string {
  if (!address) return '';
  const params = new URLSearchParams();
  params.set('u', address);
  if (source) params.set('s', source);
  return coreURL(`/api/cover?${params.toString()}`);
}

/**
 * 页面里直接用的封面地址。
 * 需要 Referer 的图床走代理，其余直连（少一次中转，加载更快）。
 */
export function coverURL(address: string, source = ''): string {
  const value = String(address || '').trim();
  if (!value) return '';
  // 已经是本地服务地址（例如收藏夹里存的快照）就原样用
  if (value.startsWith('/api/')) return coreURL(value);
  if (!/^https?:\/\//i.test(value)) return value;
  return needsCoverProxy(value) ? coverProxyURL(value, source) : value;
}
