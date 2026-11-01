// XBPQ 规则示例（真实爬虫 JSON 字段形态，可直接录入自定义源）。
//
// 这些规则只给出「分类url + 分类」，其余字段（数组/标题/链接/播放数组…）
// 由服务端按 分类url 形态自动套用内置模板补齐（对齐 XBPQ.jar 的简写能力），
// 用户改域名即可用于同类站点。

export interface XbpqSample {
  name: string;
  url: string;
  rule: Record<string, string>;
}

export const SAMPLE_XBPQ_RULES: XbpqSample[] = [
  {
    name: '苹果CMS 站点',
    url: 'https://www.example.com',
    rule: {
      '主页url': 'https://www.example.com',
      '分类url': 'https://www.example.com/index.php/vod/show/id/{cateId}/page/{catePg}.html',
      '分类': '电影$1#连续剧$2#综艺$3#动漫$4',
      '搜索url': 'https://www.example.com/index.php/vod/search/page/{catePg}/wd/{wd}.html',
    },
  },
  {
    name: 'MacCMS 接口源',
    url: 'https://api.example.com',
    rule: {
      '主页url': 'https://api.example.com',
      '分类url': 'https://api.example.com/api.php/provide/vod/?ac=list&t={cateId}&pg={catePg}',
      '分类': '电影$1#剧集$2#综艺$3',
    },
  },
  {
    name: 'mxone 皮肤站',
    url: 'https://www.example.com',
    rule: {
      '分类url': 'https://www.example.com/vodshow/index-{cateId}-{catePg}.html',
      '分类': '电影$1#剧集$2',
      '请求头':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    },
  },
];

/** GitHub blob 网页链接 → raw 直链（订阅导入常贴网页地址）。 */
export function normalizeGitHubUrl(url: string): string {
  const value = String(url || '').trim();
  if (!value) return '';
  try {
    const parsed = new URL(value);
    if (parsed.hostname === 'github.com' && parsed.pathname.includes('/blob/')) {
      const parts = parsed.pathname.split('/').filter(Boolean);
      // [user, repo, 'blob', branch, ...path]
      if (parts.length >= 5 && parts[2] === 'blob') {
        const [user, repo, , branch, ...rest] = parts;
        return `https://raw.githubusercontent.com/${user}/${repo}/${branch}/${rest.join('/')}`;
      }
    }
  } catch {
    /* 非法 URL 原样返回 */
  }
  return value;
}
