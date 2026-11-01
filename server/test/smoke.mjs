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

// ---------------------------------------------------------------- 收藏夹共享库
// 异步用例单独跑，写到系统临时目录，不碰 server/data/library.json
const checkAsync = async (name, fn) => {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (error) {
    console.error(`  ✗ ${name}\n    ${error.message}`);
    process.exitCode = 1;
  }
};

console.log('收藏夹共享库');
{
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { rm } = await import('node:fs/promises');
  const { setLibraryPath, applyLibrary, readLibrary, entryKey } = await import('../lib/library-node.mjs');

  const libPath = join(tmpdir(), `guoappnew-library-${Date.now()}.json`);
  setLibraryPath(libPath);
  await rm(libPath, { force: true });

  const drama = (id, source, extra = {}) => ({ id, source, title: `剧 ${id}`, ...extra });

  await checkAsync('首次读取返回空库', async () => {
    const data = await readLibrary();
    assert.deepEqual(data, { favorites: [], history: [] });
  });

  await checkAsync('put 同剧去重并置顶，续播位置随之更新', async () => {
    await applyLibrary({ list: 'history', op: 'put', item: drama('1', 'a123', { index: 0, position: 12 }) });
    await applyLibrary({ list: 'history', op: 'put', item: drama('2', 'a123', { index: 3, position: 300 }) });
    const data = await applyLibrary({
      list: 'history',
      op: 'put',
      item: drama('1', 'a123', { index: 2, position: 888 }),
    });
    assert.equal(data.history.length, 2);
    assert.equal(data.history[0].id, '1', '最近观看应置顶');
    assert.equal(data.history[0].index, 2);
    assert.equal(data.history[0].position, 888);
  });

  await checkAsync('复合键按 source|id 区分同 id 不同源', async () => {
    assert.equal(entryKey({ source: 'a123', id: 'x' }), 'a123|x');
    await applyLibrary({ list: 'favorites', op: 'put', item: drama('9', 'a123') });
    const data = await applyLibrary({ list: 'favorites', op: 'put', item: drama('9', 'guipian') });
    assert.equal(data.favorites.length, 2);
  });

  await checkAsync('toggle 两次等于加了再删', async () => {
    const once = await applyLibrary({ list: 'favorites', op: 'toggle', item: drama('t1', 'ikanbot') });
    assert.equal(once.favorites.filter((item) => item.id === 't1').length, 1);
    const twice = await applyLibrary({ list: 'favorites', op: 'toggle', item: drama('t1', 'ikanbot') });
    assert.equal(twice.favorites.filter((item) => item.id === 't1').length, 0);
  });

  await checkAsync('remove 按 keys 批量删除', async () => {
    await applyLibrary({ list: 'favorites', op: 'put', item: drama('r1', 'a123') });
    await applyLibrary({ list: 'favorites', op: 'put', item: drama('r2', 'a123') });
    const data = await applyLibrary({ list: 'favorites', op: 'remove', keys: ['a123|r1', 'a123|r2'] });
    assert.equal(data.favorites.filter((item) => item.id.startsWith('r')).length, 0);
  });

  await checkAsync('clear 清空指定列表，另一列表不受影响', async () => {
    const data = await applyLibrary({ list: 'favorites', op: 'clear' });
    assert.equal(data.favorites.length, 0);
    assert.ok(data.history.length > 0, '历史不应被一起清掉');
  });

  await checkAsync('脏数据清洗：缺 id 报错、超长标题截断、状态兜底', async () => {
    await assert.rejects(() => applyLibrary({ list: 'favorites', op: 'put', item: { source: 'a123' } }));
    const data = await applyLibrary({
      list: 'favorites',
      op: 'put',
      item: { id: 'long', source: 'a123', title: '剧'.repeat(400) },
    });
    const entry = data.favorites.find((item) => item.id === 'long');
    assert.equal([...entry.title].length, 256);
    assert.equal(entry.status, 'watching');
  });

  await checkAsync('写盘后可重新读回（模拟重启进程）', async () => {
    setLibraryPath(libPath); // 清掉内存缓存，强制回读磁盘
    const data = await readLibrary();
    assert.ok(data.history.some((item) => item.id === '1'));
    await rm(libPath, { force: true });
  });
}

// ---------------------------------------------------------------- 封面处理
console.log('封面处理');
{
  const { imageMime, decodeCover, coverReferer, needsCoverProxy, encryptForTest } = await import(
    '../lib/covers.mjs'
  );

  // 构造一个足够长的假 JPEG 头（真实图床返回的字节会更多，但识别只看头部）
  const fakeJpeg = Buffer.concat([
    Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]),
    Buffer.alloc(48, 0x20),
  ]);

  check('识别 jpeg / png / webp / svg', () => {
    assert.equal(imageMime(fakeJpeg), 'image/jpeg');
    assert.equal(imageMime(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])), 'image/png');
    const webp = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP'), Buffer.alloc(8)]);
    assert.equal(imageMime(webp), 'image/webp');
    assert.equal(imageMime(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>')), 'image/svg+xml');
    assert.equal(imageMime(Buffer.from('not an image at all')), '');
  });

  check('明文图片直通，不做多余解码', () => {
    assert.deepEqual(decodeCover(fakeJpeg), fakeJpeg);
  });

  check('AES-CBC 加密的封面能还原', () => {
    const encrypted = encryptForTest(fakeJpeg);
    assert.equal(imageMime(encrypted), '', '密文不应被认成图片');
    assert.equal(imageMime(decodeCover(encrypted)), 'image/jpeg');
  });

  check('Salted__ 前缀的密文也能还原', () => {
    const encrypted = Buffer.concat([Buffer.from('Salted__'), Buffer.alloc(8), encryptForTest(fakeJpeg)]);
    assert.equal(imageMime(decodeCover(encrypted)), 'image/jpeg');
  });

  check('XOR 混淆的封面能还原', () => {
    const key = Buffer.from('2019ysapp7527');
    const xored = Buffer.from(fakeJpeg);
    for (let i = 0; i < Math.min(100, xored.length); i += 1) xored[i] ^= key[i % key.length];
    assert.equal(imageMime(decodeCover(xored)), 'image/jpeg');
  });

  check('豆瓣图床补 movie.douban.com 的 Referer', () => {
    assert.equal(coverReferer('https://img9.doubanio.com/view/photo/x.jpg'), 'https://movie.douban.com/');
    assert.equal(coverReferer('https://img1.douban.com/x.jpg'), 'https://movie.douban.com/');
    // 其他源不设 Referer，乱设会被部分 CDN 拒绝
    assert.equal(coverReferer('https://i1.a123tv.com/d/hk/34r6.jpg'), '');
    assert.equal(coverReferer('https://img9.doubanio.com/x.jpg', 'https://custom/'), 'https://custom/');
  });

  check('只有豆瓣图床需要走服务端代理', () => {
    assert.equal(needsCoverProxy('https://img9.doubanio.com/view/photo/x.jpg'), true);
    assert.equal(needsCoverProxy('https://i1.a123tv.com/d/hk/34r6.jpg'), false);
    assert.equal(needsCoverProxy('https://snzypic.vip/upload/vod/a.jpg'), false);
    assert.equal(needsCoverProxy('/relative/path.jpg'), false);
    assert.equal(needsCoverProxy(''), false);
  });
}

// ---------------------------------------------------------------- 边缘适配层
// Cloudflare Pages Functions 里没有 req / res，全靠 functions/_lib/bridge.mjs 翻译；
// 这里用 Node 22 内置的 Request / Response / TransformStream 直接验适配契约。
console.log('边缘适配层（Web Request ↔ req/res）');
{
  const { createBridge } = await import('../../functions/_lib/bridge.mjs');
  const { handleRequest } = await import('../router.mjs');

  const call = async (path, init) => {
    const request = new Request(`http://edge.local${path}`, init);
    const url = new URL(request.url);
    const { req, res, response } = createBridge(request);
    handleRequest(req, res, url).catch((error) => {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: false, error: error.message }));
    });
    return response();
  };

  await checkAsync('GET /api/health 经适配层返回 JSON', async () => {
    const res = await call('/api/health');
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.service, 'guoappnew-native-core');
  });

  await checkAsync('POST 的 JSON body 能被路由读到', async () => {
    const res = await call('/api/library', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ list: 'nope' }),
    });
    const body = await res.json();
    assert.equal(body.ok, false);
    assert.match(body.error, /list/);
  });

  await checkAsync('多次 write 按顺序拼成完整响应体', async () => {
    const { res, response } = createBridge(new Request('http://edge.local/x'));
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.write('a');
    res.write('b');
    res.end('c');
    const out = await response();
    assert.equal(out.status, 200);
    assert.equal(await out.text(), 'abc');
  });

  await checkAsync('304 响应不带 body', async () => {
    const { res, response } = createBridge(new Request('http://edge.local/x'));
    res.writeHead(304, { ETag: '"abc"' });
    res.end();
    const out = await response();
    assert.equal(out.status, 304);
    assert.equal(out.body, null);
    assert.equal(out.headers.get('etag'), '"abc"');
  });
}

// ---------------------------------------------------------------- 边缘端口限制（仅 Cloudflare）
// 端口限制必须是「Cloudflare 专属」开关，不能靠 runtime==='edge' 判断——
// Vercel 也设 runtime='edge'，但 Vercel 出站不限制端口，秀果 :81 在 Vercel 上应当可用。
// 这里验 setLivePortRestricted 独立于 runtime，且默认关闭（不误伤 Vercel）。
console.log('边缘端口限制（仅 Cloudflare，不误伤 Vercel）');
{
  const { BUILTIN_LIVE_SOURCES, edgeBlockedEndpoints, isLivePortRestricted, setLivePortRestricted } =
    await import('../lib/live/index.mjs');
  const xiuguo = BUILTIN_LIVE_SOURCES.find((source) => source.id === 'xiuguo');

  check('秀果面板端点在 :81，被端口限制逻辑识别', () => {
    const blocked = edgeBlockedEndpoints(xiuguo);
    assert.equal(blocked.length, xiuguo.endpoints.length, '两个 :81 端点都应被识别为受限');
  });

  check('端口限制默认关闭（Vercel 不误伤）', () => {
    setLivePortRestricted(false);
    assert.equal(isLivePortRestricted(), false);
  });

  check('端口限制可单独开启（Cloudflare 入口调用）且可复位', () => {
    setLivePortRestricted(true);
    assert.equal(isLivePortRestricted(), true);
    setLivePortRestricted(false); // 复位，避免影响后续 Vercel 小节
    assert.equal(isLivePortRestricted(), false);
  });
}

// ---------------------------------------------------------------- Vercel 兼容层
// Vercel 的 Node.js 运行时原生就是 Node 的 req/res（http.IncomingMessage /
// http.ServerResponse），api/index.mjs 直接把 req/res 喂给 handleRequest，
// 没有 Cloudflare 那种 Web Request ↔ Node 的翻译桥。这里用 mock 的 Node req/res
// 直接驱动该入口，验「免桥接」契约与 POST body 兜底（adaptReq 把 req.body 归一为 Buffer）。
console.log('Vercel 兼容层（Node req/res 免桥接）');
{
  const { pathToFileURL } = await import('node:url');
  const { fileURLToPath } = await import('node:url');
  const { dirname, join } = await import('node:path');

  // 文件名含 [...]，Node 的 import() 会把 [ 当成 IPv6 分隔符，先把方括号 percent-encode。
  const here = dirname(fileURLToPath(import.meta.url));
  const vercelPath = join(here, '..', '..', 'api', 'index.mjs');
  const vercelURL = pathToFileURL(vercelPath).href.replace(/\[/g, '%5B').replace(/\]/g, '%5D');
  const { default: vercelHandler } = await import(vercelURL);

  // 复位收藏夹后端为内存（前面的「收藏夹共享库」小节把库后端改成了临时磁盘文件，
  // 会污染全局状态；Vercel 入口本就不注入 store，默认就是 memory）。
  const { setLibraryStore } = await import('../lib/library.mjs');
  setLibraryStore();

  // 最小 Node-like req：host / x-forwarded-proto 拼完整 URL，body 直接摆在 req.body
  // （Vercel 在某些配置下会提前解析请求体），必要时带一个空的异步迭代器避免裸迭代报错。
  const makeReq = ({ method = 'GET', path = '/api/health', headers = {}, body } = {}) => {
    const req = {
      method,
      url: path,
      headers: { host: 'guoappnew.vercel.app', 'x-forwarded-proto': 'https', ...headers },
    };
    if (body !== undefined) req.body = body;
    req[Symbol.asyncIterator] = async function* () {};
    return req;
  };

  // 最小 Node-like res：收集 status / headers / body，end() 时 resolve。
  const makeRes = () => {
    let status = 200;
    const headers = {};
    const chunks = [];
    let resolveEnd;
    const finished = new Promise((resolve) => (resolveEnd = resolve));
    const res = {
      headersSent: false,
      setHeader(key, value) {
        headers[key.toLowerCase()] = value;
      },
      writeHead(s, h) {
        status = s;
        if (h) for (const k of Object.keys(h)) headers[k.toLowerCase()] = h[k];
        this.headersSent = true;
      },
      write(chunk) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
        this.headersSent = true;
        return true;
      },
      end(chunk) {
        if (chunk != null) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
        this.headersSent = true;
        resolveEnd();
        return true;
      },
      once() {
        return res;
      },
      on() {
        return res;
      },
    };
    return {
      res,
      finished,
      snapshot: () => ({
        status,
        headers,
        body: Buffer.concat(chunks).toString('utf-8'),
      }),
    };
  };

  const call = async ({ method, path, headers, body } = {}) => {
    const req = makeReq({ method, path, headers, body });
    const { res, finished, snapshot } = makeRes();
    await vercelHandler(req, res);
    await finished;
    return snapshot();
  };

  await checkAsync('GET /api/health 经 Vercel 入口返回 edge 运行时 + memory 库', async () => {
    const out = await call({ method: 'GET', path: '/api/health' });
    assert.equal(out.status, 200);
    const body = JSON.parse(out.body);
    assert.equal(body.ok, true);
    assert.equal(body.service, 'guoappnew-native-core');
    assert.equal(body.runtime, 'edge', 'Vercel 入口应 setRuntime("edge")');
    assert.equal(body.library, 'memory', 'Vercel 无磁盘/KV，库后端应为 memory');
  });

  // 模拟 vercel.json 的 rewrite：/api/<x> 被转发到 /api/index?upstreamPath=<x>。
  // 这同时验证「单级 + 多级路径都能正确还原」——正是 catch-all 文件名在 Vercel 上会 404 的坑。
  await checkAsync('rewrite 形态 /api/index?upstreamPath=health 等价 /api/health', async () => {
    const out = await call({ method: 'GET', path: '/api/index?upstreamPath=health' });
    assert.equal(out.status, 200);
    const body = JSON.parse(out.body);
    assert.equal(body.ok, true);
    assert.equal(body.service, 'guoappnew-native-core');
  });

  await checkAsync('rewrite 形态多级路径 /api/index?upstreamPath=live/sources 能到达路由', async () => {
    const out = await call({ method: 'GET', path: '/api/index?upstreamPath=live/sources' });
    assert.equal(out.status, 200);
    const body = JSON.parse(out.body);
    assert.equal(body.ok, true);
    assert.ok(Array.isArray(body.sources), 'live/sources 应返回 sources 数组（多级路径未被 Vercel 层拦截）');
  });

  await checkAsync('OPTIONS 预检返回 204 且带 CORS 头', async () => {
    const out = await call({ method: 'OPTIONS', path: '/api/health' });
    assert.equal(out.status, 204);
    assert.equal(out.headers['access-control-allow-origin'], '*');
    assert.equal(out.body, '', '204 不应带 body');
  });

  await checkAsync('POST 的 JSON body（字符串）能被路由读到', async () => {
    const out = await call({
      method: 'POST',
      path: '/api/library',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ list: 'nope' }),
    });
    const body = JSON.parse(out.body);
    assert.equal(body.ok, false);
    assert.match(body.error, /list/, '应到达 applyLibrary 并识别出非法 list 字段');
  });

  await checkAsync('POST 的 JSON body（Buffer）也能被路由读到', async () => {
    const out = await call({
      method: 'POST',
      path: '/api/library',
      headers: { 'Content-Type': 'application/json' },
      body: Buffer.from(JSON.stringify({ list: 'nope' })),
    });
    const body = JSON.parse(out.body);
    assert.equal(body.ok, false);
    assert.match(body.error, /list/);
  });

  await checkAsync('GET /api/library 返回内存库快照', async () => {
    const out = await call({ method: 'GET', path: '/api/library' });
    const body = JSON.parse(out.body);
    assert.equal(body.ok, true);
    assert.equal(body.backend, 'memory');
    assert.ok(Array.isArray(body.data.favorites));
  });

  await checkAsync('未知 /api 路径返回 404', async () => {
    const out = await call({ method: 'GET', path: '/api/whatever' });
    assert.equal(out.status, 404);
    const body = JSON.parse(out.body);
    assert.equal(body.ok, false);
  });
}

console.log(`\n通过 ${passed} 项${process.exitCode ? '（有失败）' : '，全部正常'}`);