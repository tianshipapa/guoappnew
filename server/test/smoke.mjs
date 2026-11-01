// 规则引擎冒烟测试：node server/test/smoke.mjs
// 覆盖截取 / 选择器 / JSON 路径 / Base64 / 模板家族 / 去广告，不联网。

import assert from 'node:assert/strict';
import { parseRule } from '../lib/xbpq/rule.mjs';
import { cutOnce, list } from '../lib/xbpq/cut.mjs';
import { selectorFirstString, selectorStrings } from '../lib/xbpq/selector.mjs';
import { jsonPathValue, decodeBase64Segment } from '../lib/xbpq/json.mjs';
import { filterAdSegments } from '../lib/adfilter.mjs';
import { rewriteManifest } from '../lib/hls.mjs';
import { parseEpisodes } from '../lib/xbpq/provider.mjs';
import { parseImport } from '../index.mjs';
import { parseLive } from '../lib/live/parse.mjs';

let passed = 0;
const check = (name, fn) => {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (error) {
    console.error(`  ✗ ${name}\n    ${error.message}`);
    process.exitCode = 1;
  }
};

console.log('截取引擎');
check('单组 start&&end', () => {
  assert.equal(cutOnce('<div class="a">hello</div>', 'class="a">&&</div>'), 'hello');
});
check('多组 || 备选', () => {
  assert.equal(cutOnce('<p id="x">v</p>', 'class="none">&&<||id="x">&&<'), 'v');
});
check('* 通配锚点', () => {
  assert.equal(cutOnce('var player_aaaa={"url":"http://a/b.m3u8"}', 'var player_*"url":"&&"'), 'http://a/b.m3u8');
});
check('修饰符 [包含] 命中/拒绝', () => {
  assert.equal(cutOnce('前<p>高清正片</p>后', '<p>&&</p>[包含:高清]'), '高清正片');
  assert.equal(cutOnce('前<p>预告</p>后', '<p>&&</p>[包含:高清]'), '');
});
check('修饰符 [替换]', () => {
  assert.equal(cutOnce('<i>第1集</i>', '<i>&&</i>[替换:第>>]'), '1集');
});
check('+ 拼接（含字面量）', () => {
  assert.equal(
    cutOnce('<div class="x">77</div>', 'class="x">&&<+/index.php/vod/detail/id/+class="x">&&<+.html'),
    '77/index.php/vod/detail/id/77.html'
  );
});
check('Base64 段解码', () => {
  const encoded = Buffer.from('https://a.test/x.m3u8').toString('base64');
  assert.equal(cutOnce(encoded, 'Base64'), 'https://a.test/x.m3u8');
});
check('固定字符串字段', () => {
  assert.equal(cutOnce('<html></html>', '线路一'), '线路一');
});
check('数组迭代', () => {
  // 分隔符写 `<li` 时，段内容以 `>` 起头，与模板库一致（后续 播放标题 再截）
  assert.deepEqual(list('<li>A</li><li>B</li><li>C</li>', '<li&&</li>'), ['>A', '>B', '>C']);
});
check('数组 [排序]', () => {
  assert.deepEqual(list('<li>备用</li><li>高清</li>', '<li&&</li>[排序:高清>备用]'), ['>高清', '>备用']);
});

console.log('选择器（p: 语法）');
check('标签 + 类 + 后代', () => {
  const html = '<div class="list"><a href="/v/1.html" title="剧一"><img data-src="//cdn/a.jpg"></a></div>';
  assert.equal(selectorFirstString(html, 'p:div.list > a[href]'), '/v/1.html');
});
check('[attr=value] 等值过滤', () => {
  const html = '<ul><li data-id="1">A</li><li data-id="2">B</li></ul>';
  assert.deepEqual(selectorStrings(html, 'p:li[data-id=2]'), ['B']);
});
check('文本包含过滤', () => {
  const html = '<ul><li>广告位</li><li>正片 1080P</li></ul>';
  assert.deepEqual(selectorStrings(html, 'p:li[包含:1080P]'), ['正片 1080P']);
});
check('单页多元素取值', () => {
  const html = '<a class="item" href="/1">甲</a><a class="item" href="/2">乙</a>';
  assert.deepEqual(selectorStrings(html, 'p:a.item[href]'), ['/1', '/2']);
});

console.log('JSON 路径');
check('嵌套路径 + 下标', () => {
  const payload = JSON.stringify({ data: { list: [{ name: '第一' }, { name: '第二' }] } });
  assert.equal(jsonPathValue(payload, 'j:data.list[1].name').value, '第二');
});
check('数组切片 [0,]', () => {
  const payload = JSON.stringify({ list: [1, 2, 3] });
  assert.deepEqual(jsonPathValue(payload, 'j:list[1,]').value, [2, 3]);
});
check('大小写不敏感键', () => {
  const payload = JSON.stringify({ Vod_Name: '剧名' });
  assert.equal(jsonPathValue(payload, 'j:vod_name').value, '剧名');
});
check('Base64 严格校验（非法输入原样返回）', () => {
  assert.equal(decodeBase64Segment('不是base64!!'), '不是base64!!');
});

console.log('规则解析与模板补齐');
check('解析 + MacCMS 模板家族', () => {
  const rule = parseRule(
    JSON.stringify({
      分类url: 'https://demo.test/index.php/vod/show/id/{cateId}/page/{catePg}.html',
      分类: '电影$1#剧集$2',
    })
  );
  assert.ok(rule, '规则应解析成功');
  assert.equal(rule.categories.length, 2);
  assert.ok(rule.field('数组').includes('myui'), '应补 数组 默认值');
  assert.ok(rule.field('搜索url').includes('/index.php/vod/search.html'), '应补 搜索url');
  assert.equal(rule.homeURL, 'https://demo.test');
});
check('接口 JSON 模板家族', () => {
  const rule = parseRule(
    JSON.stringify({ 分类url: 'https://demo.test/api.php/provide/vod/?ac=list&t={cateId}' })
  );
  assert.equal(rule.field('数组'), 'j:list');
  assert.equal(rule.field('标题'), 'j:vod_name');
});
check('尾逗号容错 + 全角方括号', () => {
  const rule = parseRule('{"分类url":"https://a.test/list/{cateId}.html","分类":"剧$1",}');
  assert.ok(rule);
  assert.equal(rule.categories[0].name, '剧');
});
check('头部集合解析', () => {
  const rule = parseRule(
    JSON.stringify({
      分类url: 'https://demo.test/list/{cateId}.html',
      头部集合: 'Authorization$Bearer abc#Referer=https://demo.test/',
      播放请求头: 'Referer：https://play.test/',
    })
  );
  assert.equal(rule.headerSet.Authorization, 'Bearer abc');
  assert.equal(rule.playHeaderSet.Referer, 'https://play.test/');
});

console.log('播放串解析');
check('$$$ 多线路 + # 分集', () => {
  const rule = parseRule(
    JSON.stringify({
      分类url: 'https://demo.test/list/{cateId}.html',
      播放数组: 'class="playlist"&&</ul>',
      播放链接: 'href="&&"',
    })
  );
  const html =
    '<ul class="playlist">' +
    '<a href="/play/1-1-1.html">第1集</a><a href="/play/1-1-2.html">第2集</a>' +
    '</ul>';
  const { best, routes } = parseEpisodes(html, 'https://demo.test/v/1.html', rule);
  assert.equal(best.length, 2, '应解析出 2 集');
  assert.equal(best[0].url, 'https://demo.test/play/1-1-1.html');
  assert.equal(routes.length, 1);
});

console.log('m3u8 去广告');
check('剔除异源插播分片', () => {
  const manifest = [
    '#EXTM3U',
    '#EXT-X-VERSION:3',
    '#EXT-X-TARGETDURATION:6',
    '#EXTINF:6.0,',
    'https://main.test/seg/1.ts',
    '#EXTINF:6.0,',
    'https://main.test/seg/2.ts',
    '#EXTINF:6.0,',
    'https://ad.other.test/x/3.ts',
    '#EXTINF:6.0,',
    'https://main.test/seg/4.ts',
  ].join('\n');
  const result = filterAdSegments(manifest, 'https://main.test/seg/index.m3u8');
  assert.equal(result.removed, 1);
  assert.ok(!result.text.includes('ad.other.test'), '广告分片应被删除');
  assert.ok(result.text.includes('#EXT-X-VERSION:3'), '播放列表头部标签必须保留');
});
check('master 清单放行', () => {
  const master = '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=800000\nhd/index.m3u8';
  assert.equal(filterAdSegments(master, 'https://a.test/x.m3u8').removed, 0);
});

console.log('清单改写');
check('分片与密钥都走代理', () => {
  const manifest = '#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="key.bin"\n#EXTINF:6,\nseg1.ts';
  const output = rewriteManifest(manifest, 'https://cdn.test/hls/index.m3u8', 'http://127.0.0.1:3000', {
    referer: 'https://site.test/',
  });
  assert.ok(output.includes('/api/media?u=https%3A%2F%2Fcdn.test%2Fhls%2Fkey.bin'), '密钥应改写');
  assert.ok(output.includes('/api/media?u=https%3A%2F%2Fcdn.test%2Fhls%2Fseg1.ts'), '分片应改写');
});

console.log('导入解析');
check('TVBox sites 数组', () => {
  const drafts = parseImport(
    JSON.stringify({
      sites: [
        {
          name: '演示源',
          type: 3,
          api: 'csp_XBPQ',
          ext: { 分类url: 'https://demo.test/list/{cateId}.html', 分类: '剧$1' },
        },
      ],
    })
  );
  assert.equal(drafts.length, 1);
  assert.equal(drafts[0].name, '演示源');
  assert.equal(drafts[0].kind, 'xbpq');
});

console.log('直播源解析');
check('m3u 分组', () => {
  const m3u = [
    '#EXTM3U',
    '#EXTINF:-1 tvg-logo="http://a/logo.png" group-title="央视",CCTV-1 综合',
    'http://live.test/cctv1.m3u8',
    '#EXTINF:-1 group-title="卫视",湖南卫视',
    'http://live.test/hn.m3u8',
  ].join('\n');
  const result = parseLive(m3u, { source: 'demo' });
  assert.equal(result.format, 'm3u');
  assert.equal(result.count, 2);
  assert.equal(result.groups[0].name, '央视');
  assert.equal(result.groups[0].channels[0].logo, 'http://a/logo.png');
});
check('txt #genre# 分组', () => {
  const txt = '#genre#央视\nCCTV1,http://live.test/1.m3u8\n#genre#卫视\n湖南卫视,http://live.test/2.m3u8';
  const result = parseLive(txt, { source: 'demo' });
  assert.equal(result.format, 'text');
  assert.deepEqual(result.groups.map((group) => group.name), ['央视', '卫视']);
});

console.log(`\n通过 ${passed} 项${process.exitCode ? '（有失败）' : '，全部正常'}`);
