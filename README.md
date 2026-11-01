# 短剧视界 (HongGuoJian / ZhenGuoJian) - React Web Edition

跨平台多端独立短剧与影视聚合播放器，由原 Flutter 架构 + Go 原生核心完整重构为 React + TypeScript + Vite + Tailwind CSS 应用，核心抓取能力（XBPQ 规则引擎、直播、去广告、A123、爱看机器人、自定义源、跨源聚合搜索）已 1:1 移植到本地 Node 抓取服务。

## ✨ 核心特性与业务逻辑

1. **多站源聚合与切换 (Multi-Source Hub)**：
   - 原生实现的站源：**A123**（a123tv）、**爱看机器人**（ikanbot，含令牌签名）、**鬼片**（guipianwu）、**韩小圈**（jennyhow）、**XBPQ 网页规则源**（远程订阅）、任意 **自定义源**（XBPQ / MacCMS 接口）。
   - 内置站源收敛为 5 个：`网页`（XBPQ 聚合）/ `A123` / `爱看机器人` / `韩小圈` / `鬼片`。红果、黄果、野果、黄豆等**需要 CENC 解密、浏览器无法播放**的源已全部移除，不再出现在源列表里。
   - 源显示列表：可按需显示或隐藏任意内置与自定义站源。

2. **XBPQ 规则体系（TVBox / CatVod csp_XBPQ 兼容）**：
   - 截取语法：`start&&end` 截取、`||` 多组备选、`\` 转义、`*` 惰性通配锚点、`+` 顶层拼接、`Base64` / `Base64(a&&b)` 二次解码。
   - 修饰符：`[包含:x,y]` `[不包含:x,y]` `[替换:a>>b#c>>d]` `[序号:n]` `[排序:a>b>c]`。
   - 选择器子集：`p:标签.类#id[attr=val]`，支持后代链、`[html]` 取源码。
   - JSON 路径：`j:data.list[0].name`，支持切片 `[0,]` / `[a-b]` / 负数下标、键名大小写不敏感。
   - **模板家族自动补全**：MacCMS 新版 mxone / MacCMS 接口(JSON) / MacCMS / 路径式泛型 / 通用高频，五族按「专用→通用」合并且不覆盖已写字段——用户只写 `分类url + 分类` 即可跑起来。
   - 头部集合语法 `Key$Value#Key$Value`，支持请求头与播放请求头（防防盗链）。

3. **分类浏览与智能排序筛选**：
   - 分类来自站源真实结构（A123 / 爱看 / 自定义源各自解析）。
   - 排序与筛选：默认排序、热度最高、播放量最多、最新上线、连载中 / 已完结。

4. **全源并发聚合搜索 (Cross-Source Aggregate Search)**：
   - 服务端 **会话式并发抓取**：`/api/search/start` 立即返回会话号，前端轮询 `/api/search/poll` 增量刷新，先出的源先展示，不用等最慢的源。
   - 归一合并：标题 NFKC + 去标点空白 + 年份分组，集数差异 >25% 视为不同版本；每组挑完整度最高的作主条目，其它源放进 `peers`，详情页可一键切源。
   - 进度可视化：已完成源数 / 抓取中 / 失败源数，失败不阻塞整体结果。
   - **拼音首字母检索**：`BDZC` → 「霸道总裁」，内置 20,000+ 汉字拼音首字母映射。
   - **电视端软键盘**：A-Z / 0-9 虚拟键盘。

5. **专业短剧播放器 (Professional Video Player)**：
   - HTML5 + HLS (hls.js) 双模；**多线路切换**：服务端取流时并发探测备选线路，播放器可手动切换。
   - 自动连播、快捷键切集、0.5x~3.0x 倍速、画面锐化。
   - **真全屏**：容器级 `requestFullscreen({ navigationUI: 'hide' })`，带 `webkit/moz/ms` 前缀兜底；iOS Safari 的 `div` 不支持全屏时自动降级为 `<video>.webkitEnterFullscreen()`，再不行提示 F11。全屏态下由 `.player-shell:fullscreen` 覆写宽高与圆角，铺满整屏不留边。
   - 弹幕图层已移除（对齐移动端播放器体验，避免长按/双击误触遮挡画面）。

6. **去广告 (Ad Filter)**：
   - m3u8 媒体清单按「host + 目录」算来源指纹，剔除异源插播分片（主指纹占比 <40% 时放弃，避免误伤）。
   - master 清单放行；只回收分片级标签（`#EXTINF` / `BYTERANGE` / `KEY` / `DISCONTINUITY`），播放列表级头部标签完整保留。
   - 设置页可开关；关闭后清单走 `ad=0` 直通。

7. **自定义源及管理**（对齐 guoappxp 的自定义源页）：
   - 四种类型：自动探测 / 网页采集 / MacCMS 接口(JSON) / MacCMS 接口(XML)，并可单独开启 XBPQ 规则模式。
   - **新增 / 编辑 / 启停 / 删除**：点任意条目即可编辑，规则 JSON 失焦时自动嗅出 `name` 与 `主页url`。
   - **在线测试与校验**：返回模板家族识别结果、分类数、真实连通耗时与解析条数。
   - **导入三通道**：本地 `.json` / `.txt` 文件、订阅地址（含两个默认加速地址、自动 `blob` → `raw`）、直接粘贴 TVBox `sites` JSON。
   - **导入去重**：按 id → 站址 → 名称三级匹配，命中即更新，导入后回报「新增 N / 更新 M」明细。
   - **导出**：下载 `duanju-custom-sources-日期.json`（可一键复制 JSON），导入同一文件可原样还原启用状态。
   - **恢复默认源**：二次确认后清空全部自定义源，仅保留内置源，并自动切回默认站源。

8. **电视与网络直播 (Live TV)**：
   - 内置公开源：iptv-org 国内频道 / 港澳台 / 全球新闻；**秀果**（`pingtai` 面板协议，主播秀场）。
   - **自定义直播源**：支持 m3u / txt（`#genre#`、`#EXTINF`、`#EXTVLCOPT`、`#EXTHTTP` 标签）与 **API 面板源**（`json.txt` + 分类接口，多镜像自动合并）。
   - 源 → 分类 → 频道 → 取流四层，取流后经 `/api/hls` 代理并套用去广告。
   - **FLV 直播**：秀果这类面板源全是 `.flv` 长连接，浏览器 `<video>` 不认，自动切 **mpegts.js**（MSE + `liveBufferLatencyChasing`）低延迟播放；HLS 与直链仍走原路径。判断类型前会先 `decodeURIComponent`，因为播放地址被 `/api/media?u=<urlencode>` 代理过，`.flv?` 会变成 `.flv%3F`。
   - **绿色模式**：默认关闭。开启后按 `卫视 / 央视 / CCTV / 电视直播 / 新闻 / 体育 / 财经 / 少儿 / 纪录 / 地方台 / 剧场 / 电影 / 电视剧` 白名单过滤分类，纯成人源（如秀果）整源隐藏；被挡时可一键「关闭绿色模式，显示全部内容」。开关状态存 `localStorage`。

9. **剧集选集与剧目详情**：
   - 50 集分组标签、正序/倒序、精准集数跳转；海报、热度、播放量、完结状态、全网其它源副本切换。

10. **收藏夹与续播 (Library / Resume)**：
    - 移植 guoappxp `native/server/library.go` 的本地服务版收藏夹：数据落在服务端 `server/data/library.json`，**换浏览器、换设备访问同一台机器都是同一份收藏夹**；`localStorage` 只作离线镜像，服务不可用时照常可读可写。
    - 键为 `source|id` 复合键（同一部剧在不同源算两条），`put` 语义是「同剧只留一条并置顶」，收藏上限 600、历史上限 300。
    - **一键续播**：收藏卡片直接显示「看到第 N 集」徽章与进度条，点卡片即以记录的集数与秒数回到播放器；另有「重看」按钮从头开始。
    - 收藏状态分「想看 / 在看 / 已看」，支持批量删除与整体清空。
    - 前端写入采用**乐观更新**：本地立即生效 → 异步同步服务端 → 失败只 warn，不打断操作。

11. **偏好设置与存储管理**：
    - 自动连播、去广告、默认倍速、锐化强度、主题配色、电视键盘、本地缓存清理。

## 🛠️ 技术栈

- **框架**：React 18 + TypeScript + Vite 6
- **样式**：Tailwind CSS + Lucide React
- **播放引擎**：Hls.js（m3u8）+ mpegts.js（FLV 直播）+ HTML5 Media API
- **抓取核心**：零依赖 Node 服务（`server/`，Node 22+ 原生 `fetch`）
- **数据持久化**：服务端 `server/data/library.json`（收藏夹 / 播放记录，跨端共享）+ LocalStorage 本地镜像

## 🚀 开发与运行

```bash
npm install
npm run dev      # 前端 + 抓取服务（Vite 中间件同源挂载，推荐）
npm run serve    # 仅抓取服务，独立跑在 8788 端口（生产静态托管时用）
npm run build    # tsc + vite build
npm test         # 规则引擎 + 收藏夹语义冒烟测试（37 项，不联网）
```

> **为什么必须有本地抓取服务**：站点抓取、GBK 转码、m3u8 去广告、清单改写、跨源并发都受浏览器同源策略与防盗链限制，只能在服务端完成。`npm run dev` 时它以 Vite 插件中间件形式挂载在同一端口，前端只发同源 `/api/*`，开箱即用。

### 部署到 Cloudflare Pages（跨源 + 本地抓取）

静态托管上**没有后端**：Cloudflare Pages 对静态资源的非 GET 请求会直接回 `405`，所以前端不能再把数据接口当同源接口用。本项目已内置这条链路：

- 页面在**远程域名**（如 `https://xxx.pages.dev`）上运行时，前端自动把全部 `/api/*` 请求指向 **`http://127.0.0.1:8788`**（用户本机抓取服务）；在 `localhost` 下则仍走同源，无需配置。
- 抓取服务对 `/api/*` 全量返回 CORS 头，并对预检请求回 `204`：`Access-Control-Allow-Origin: *`、`Access-Control-Allow-Private-Network: true`（Chrome 的 Public → Private 网络访问要求）、`Access-Control-Max-Age` 一天。
- 万一中间层仍把 POST 拦成 `405/404/501`，客户端会**自动降级为 `GET ?payload=<base64url JSON>`**，服务端两种形态都接受。
- m3u8 清单改写后输出的是**绝对地址** `http://127.0.0.1:8788/api/media?…`，因此跨源播放、分片、密钥全都回到本机代理，不会去请求 Pages 域名而拿到 405。

使用步骤：

```bash
# 1) 在自己电脑上常驻抓取服务（页面在哪个域名都行）
npm run serve          # 默认 http://127.0.0.1:8788

# 2) Cloudflare Pages 构建配置
#    Build command:  npm run build
#    Output dir:     dist
```

打开 Pages 站点后，右上角若出现「本机服务未连接」，点它即可跳到自定义源面板填写实际地址（默认 `http://127.0.0.1:8788`），地址保存在浏览器本地。

> 浏览器要求：Chrome / Edge 允许 HTTPS 页面访问 `http://127.0.0.1`；若被全局代理或安全软件拦截，可把 `127.0.0.1` 加入直连白名单。抓取服务本身会无视 `HTTP_PROXY`，避免本地代理未开启时全军覆没。

### 接口一览

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/health` | 服务探活 |
| POST | `/api/catalog` | 目录（站源 / 分类 / 翻页） |
| POST | `/api/categories` | 分类列表 |
| POST | `/api/search` | 单源搜索 |
| POST | `/api/search/start` | 跨源聚合搜索（立即返回会话号） |
| POST | `/api/search/poll` | 轮询聚合快照 |
| POST | `/api/search/cancel` | 结束会话 |
| POST | `/api/detail` | 详情 + 分集 |
| POST | `/api/resolve` | 取播放直链（多线路备选） |
| POST | `/api/source/test` | 规则校验 + 在线连通探测 |
| POST | `/api/source/import` | 订阅 / JSON 文本导入 → 站源草稿 |
| POST | `/api/source/subscribe` | 远程订阅：抓取 + 解析一次完成 |
| GET | `/api/live/sources` | 直播源列表 |
| POST | `/api/live/platforms` | 直播分类 |
| POST | `/api/live/channels` | 直播频道 |
| POST | `/api/live/play` | 直播取流 |
| GET | `/api/proxy` | 原始抓取（调试 / 订阅导入） |
| GET | `/api/hls` | m3u8 改写 + 去广告 |
| GET | `/api/media` | 分片 / 直链转发（保留 Range） |
| GET | `/api/library` | 读收藏夹与播放记录（服务端共享库） |
| POST | `/api/library` | 写收藏夹：`{list, op, item, keys}` |

> 除 `GET` 接口外，所有 `POST` 接口都可用 `GET /api/xxx?payload=<base64url(JSON)>` 等价调用，方便在只放行 GET 的托管 / 反代下工作。

### `/api/library` 写接口语义

```jsonc
POST /api/library
{
  "list": "favorites",       // favorites | history
  "op":   "put",             // put | remove | clear | toggle
  "item": { "id": "77964", "source": "guipian", "title": "碟仙怪谈",
            "index": 2, "position": 888, "status": "watching" },
  "keys": ["guipian|77964"]  // remove 专用，可批量
}
```

- `put`：同 `source|id` 只留一条并置顶，`index` / `position` 覆盖为最新值——续播就靠它。
- `toggle`：存在则删、不存在则加（收藏按钮用）。
- 写入走「临时文件 + `rename`」原子落盘，并发请求用 Promise 串行化，中途退出不会写坏收藏夹。
- 存储位置默认 `server/data/library.json`（已在 `.gitignore` 中忽略）。

### 网络环境说明

- 服务端默认 **直连**，并会清空继承来的 `HTTP_PROXY` / `HTTPS_PROXY`：桌面端常见的本地代理（如 `127.0.0.1:3240`）若未开启，会让所有抓取报 `os error 10061` 而整站瘫痪。
- 确实需要走系统代理时，用 `GUOAPP_USE_ENV_PROXY=1 npm run dev` 显式开启。
- GBK / GB2312 页面按前 8KB 的 `charset=` 探测后用 `TextDecoder('gbk')` 解码，与 Go 版本行为一致。
