// XBPQ 内置模板：移植 provider_xbpq_template.go
//
// 按「分类url」形态识别 MacCMS / mxone / 接口 JSON / 路径式 四大模板家族，
// 为缺失字段补默认截取 pattern（已写字段一律不覆盖）。家族按「专用 → 通用」
// 依次合并，后面的家族只补还没被覆盖的字段。

import { normalizeKey } from './rule.mjs';
import { hostOrigin } from '../http.mjs';

const FAMILIES = [
  {
    // 苹果CMS新版 mxone 皮肤（/template/mxone/）：分类 index-{cateId}-{catePg}.html、
    // 详情 /{dir}/{id}.html、播放 /{dir}/play-{id}-{线}-{集}.html。
    name: 'MacCMS新版mxone',
    match: /\/index-(?:\{cateId\}|[0-9])[^/"?]*\.html/i,
    fields: {
      数组: '<div class="module-item"&&<div class="module-item"||class="module-item"><div class="module-item-cover"&&</div></div>||<div class="module-item"&&</div></div>||<li&&</li>',
      标题: 'title="&&"',
      副标题: 'class="module-item-text">&&</div>',
      图片: 'data-src="&&"||data-original="&&"',
      链接: 'href="&&"',
      播放数组: 'class="module-list module-player-list tab-list sort-list&&</div>',
      线路数组: 'class="module-list module-player-list tab-list sort-list&&</div>',
      播放列表: '</a>',
      播放标题: '<span>&&</span>',
      播放链接: 'href="&&"',
      搜索数组: '<div class="module-search-item"&&<div class="video-info-main">',
      搜索标题: '<h3>&&</h3>',
      搜索链接: 'video-serial" href="&&"',
      搜索图片: 'data-src="&&"',
    },
  },
  {
    // MacCMS 自带 API（/api.php/provide/vod/?ac=videolist|list）：列表层是 JSON。
    name: 'MacCMS接口(JSON)',
    match: /api\.php\/provide\/vod|\/provide\/vod\/?|ac=videolist/i,
    fields: {
      数组: 'j:list',
      标题: 'j:vod_name',
      图片: 'j:vod_pic',
      副标题: 'j:vod_remarks',
      链接: '/index.php/vod/detail/id/+j:vod_id+.html',
      详情url: '/index.php/vod/detail/id/{id}.html',
      搜索url: '{host}/index.php/vod/search.html?wd={wd}',
      播放数组: '<ul class="stui-content__playlist&&</ul>||<ul class="myui-content__list&&</ul>',
      播放列表: '<a',
      播放标题: '>&&</a>||>&&<',
      播放链接: 'href="&&"',
      跳转播放链接: 'var player_*"url":"&&"',
    },
  },
  {
    // 苹果CMS/MacCMS 家族：/index.php/vod/show|type|art/、/vodshow/、/list/{id}-{pg}.html 等。
    name: 'MacCMS',
    match: /\/index\.php\/(vod|art)\/|\/vod(show|type|play|detail)\/|\/list\/(?:\{cateId\}|[0-9])[^/"]*\.html|vod-(?:list|play)-id-/i,
    fields: {
      数组: '<a class="myui-vodlist__thumb&&</a>||class="myui-vodlist__box&&</a>||class="stui-vodlist__thumb&&</a>||stui-vodlist__box">&&</div></div>||hl-item-thumb hl-lazy"&&</a>||<a &&</a>[包含:module-poster-item module-item]||<li class="col-md-6&&</li>||<li&&</li>',
      标题: 'title="&&"||alt="&&"',
      图片: 'data-original="&&"||data-src="&&"||src="&&"',
      副标题: 'pic-text text-right">&&</span>||class="remark">&&<||module-item-text">&&</div>||class="module-item-note">&&</div>',
      链接: 'href="&&"',
      简介: 'detail-content" style=*>&&</span>||class="stui-content__detail&&</div>||简介：</em>&&||class="module-info-intro-content&&</div>',
      播放数组: '<ul class="stui-content__playlist&&</ul>||<ul class="myui-content__list&&</ul>||id="hl-plays-list"&&</ul>||mod play-list&&</ul||class="play_box&&</div>||class="module-play-list-content&&</div>',
      线路数组: 'class="module-play-list-content&&</div>',
      播放列表: '<a',
      播放标题: '>&&</a>||>&&<||<span>&&</span>',
      播放链接: 'href="&&"',
      线路标题: '<h3 class="title">&&</h3>||<span class="title">&&</span>||play_tit&&</||data-name="&&"',
      跳转播放链接: 'var player_*"url":"&&"||player_aaaa_*"url":"&&"',
      搜索url: '{host}/index.php/vod/search.html?wd={wd}',
      搜索数组: '<div class="module-card-item module-item&&<div class="module-card-item module-item||class="stui-vodlist__thumb&&</a>||<li&&</li>',
      搜索标题: 'title="&&"||<strong>&&</strong>||alt="&&"',
      搜索链接: 'href="&&"',
      搜索图片: 'data-original="&&"||data-src="&&"',
    },
  },
  {
    // 短剧/路径式 CMS：/show/{id}-…-{pg}---{year}.html、/vs/、/vshow/、/type/{slug}/{pg}/ …
    name: '路径式泛型',
    match: /\/(show|vs|vshow|screen|list|type|category|fenlei)\/(?:\{cateId\}|[0-9a-z])/i,
    fields: {
      数组: 'class="stui-vodlist__thumb&&</a>||module-item&&</a>||<li&&</li>',
      标题: 'title="&&"||alt="&&"',
      图片: 'data-original="&&"||data-src="&&"||src="&&"',
      副标题: 'pic-text text-right">&&</span>||module-item-text">&&</div>',
      链接: 'href="&&"',
      简介: 'detail-content" style=*>&&</span>||class="video-info&&</div>',
      播放数组: '<ul class="stui-content__playlist&&</ul>||<ul class="myui-content__list&&</ul>||<ul class="content-list&&</ul>||class="module-play-list&&</div>',
      播放列表: '<li',
      播放标题: '>&&</a>||>&&<',
      播放链接: 'href="&&"',
      线路标题: '<h3 class="title">&&</h3>',
      跳转播放链接: 'var player_*"url":"&&"',
    },
  },
  {
    // 通用高频兜底：对未命中以上特定家族的 HTML 站点补最常见的列表/播放截取 pattern，
    // 让「只写 分类url + 分类」的纯简写规则也能跑通（对齐 guoappxp 的通用模板能力）。
    name: '通用高频',
    match: /./,
    fields: {
      标题: 'title="&&"||alt="&&"',
      链接: 'href="&&"',
      图片: 'data-original="&&"||data-src="&&"||src="&&"',
      副标题: 'class="remark">&&<||class="module-item-text">&&</div>||class="text-ellipsis">&&</',
      数组: '<div class="stui-vodlist__thumb&&</div>||class="module-item"&&</div>||class="myui-vodlist__box&&</a>||<li class="hl-item&&</li>||<a class="myui-vodlist__thumb&&</a>||class="vodlist_item&&</a>||class="item&&</a>||class="pic&&</a>||<li&&</li>',
      搜索数组: '<div class="stui-vodlist__thumb&&</div>||class="module-item"&&</div>||class="myui-vodlist__box&&</a>||class="hl-item&&</li>||<li&&</li>',
      播放数组: '<ul class="stui-content__playlist&&</ul>||<ul class="myui-content__list&&</ul>||id="hl-plays-list"&&</ul>||class="module-play-list-content&&</div>||class="play_box&&</div>||class="content-list&&</ul>||<div class="playlist&&</div>||class="play_list&&</div>',
      线路数组: 'class="module-play-list-content&&</div>||class="play_box&&</div>||class="playlist&&</div>||class="play_list&&</div>',
      播放列表: '<a||<li',
      播放标题: '>&&</a>||>&&<||<span>&&</span>',
      播放链接: 'href="&&"',
      跳转播放链接: 'var player_*"url":"&&"||player_aaaa_*"url":"&&"',
      简介: 'class="detail-content" style="*>&&</span>||class="stui-content__detail&&</div>||class="module-info-intro-content&&</div>||class="video-info&&</div>',
      线路标题: '<h3 class="title">&&</h3>||<span class="title">&&</span>||data-name="&&"',
    },
  },
];

const EMPTY_SEGMENT = /\/[a-zA-Z][a-zA-Z0-9_]*\/\//g;
const EMPTY_TAIL_SEGMENT = /\/[a-zA-Z][a-zA-Z0-9_]*\/(\.[a-zA-Z]{2,5}(?:\?|$))/g;

/** 渲染后的分类 URL 清洗空筛选段（/area//id → /id；?year=&x=1 → ?x=1）。 */
export function cleanEmptySegments(address) {
  let value = String(address || '');
  while (EMPTY_SEGMENT.test(value)) {
    value = value.replace(EMPTY_SEGMENT, '/');
  }
  EMPTY_SEGMENT.lastIndex = 0;
  while (EMPTY_TAIL_SEGMENT.test(value)) {
    value = value.replace(EMPTY_TAIL_SEGMENT, '$1');
  }
  EMPTY_TAIL_SEGMENT.lastIndex = 0;
  const queryIndex = value.indexOf('?');
  if (queryIndex >= 0) {
    const head = value.slice(0, queryIndex);
    const query = value.slice(queryIndex + 1);
    const kept = [];
    let dropped = false;
    for (const pair of query.split('&')) {
      if (!pair) continue;
      const eq = pair.indexOf('=');
      if (eq >= 0 && pair.slice(eq + 1) === '' && !pair.slice(0, eq).includes('{')) {
        dropped = true;
        continue;
      }
      kept.push(pair);
    }
    if (dropped) return kept.length === 0 ? head : head + '?' + kept.join('&');
  }
  return value;
}

/**
 * 按 分类url 形态补齐缺失字段（不覆盖已写字段），幂等。
 * @param {{fields: Map<string,string>, order: string[]}} rule
 */
export function applyTemplate(rule) {
  if (rule.fields.get('模板已套用')) return;
  const category = rule.field('分类url', '分类Url');
  if (!category) return;
  for (const family of FAMILIES) {
    if (!family.match.test(category)) continue;
    const origin = hostOrigin(category);
    for (const [rawKey, rawValue] of Object.entries(family.fields)) {
      let value = rawValue;
      if (value.includes('{host}')) {
        if (!origin) continue;
        value = value.split('{host}').join(origin);
      }
      const key = normalizeKey(rawKey);
      if (!(rule.fields.get(key) || '').trim()) {
        rule.fields.set(key, value);
        rule.order.push(key);
      }
    }
  }
  rule.fields.set('模板已套用', '1');
}

export const TEMPLATE_FAMILY_NAMES = FAMILIES.map((item) => item.name);

export function detectFamilies(categoryURL) {
  if (!categoryURL) return [];
  return FAMILIES.filter((family) => family.match.test(categoryURL)).map((family) => family.name);
}
