# 短剧视界 (HongGuoJian / ZhenGuoJian) - React Web Edition

跨平台多端独立短剧与影视聚合播放器，由原 Flutter 架构 + Go 原生核心完整重构为 React + TypeScript + Vite + Tailwind CSS 应用，核心抓取能力（XBPQ 规则引擎、直播、去广告、A123、爱看机器人、自定义源、跨源聚合搜索）已 1:1 移植到本地 Node 抓取服务。

## ✨ 核心特性与业务逻辑

1. **多站源聚合与切换 (Multi-Source Hub)**：
   - 原生实现的站源：**A123**（a123tv）、**爱看机器人**（ikanbot，含令牌签名）、**XBPQ 网页规则源**（远程订阅）、任意 **自定义源**（XBPQ / MacCMS 接口）。
   - 内置红果（短剧/漫剧/AI剧）、红果新、剧果、野果、帝果、黄豆、韩小圈、鬼片、青空及短剧家族系列源（芽果、猫果、饭果、观果、河果、星果、花果等）。
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
   - 自动连播、快捷键切集、0.5x~3.0x 倍速、画面锐化、弹幕图层。

6. **去广告 (Ad Filter)**：
   - m3u8 媒体清单按「host + 目录」算来源指纹，剔除异源插播分片（主指纹占比 <40% 时放弃，避免误伤）。
   - master 清单放行；只回收分片级标签（`#EXTINF` / `BYTERANGE` / `KEY` / `DISCONTINUITY`），播放列表级头部标签完整保留。
   - 设置页可开关；关闭后清单走 `ad=0` 直通。

7. **自定义源及管理**：
   - 四种类型：XBPQ 爬虫规则 / MacCMS 接口(JSON) / MacCMS 接口(XML) / 网页采集。
   - **在线测试与校验**：返回模板家族识别结果、分类数、真实连通耗时与解析条数。
   - **订阅导入**：粘贴 TVBox / guoappxp 的 `sites` JSON，或直接填 GitHub 订阅地址（自动 `blob` → `raw`），由服务端抓取，不受跨域限制。
   - 导出全部自定义源为 JSON、单源启停、删除。

8. **电视与网络直播 (Live TV)**：
   - 内置公开源：iptv-org 国内频道 / 港澳台 / 全球新闻。
   - **自定义直播源**：支持 m3u / txt（`#genre#`、`#EXTINF`、`#EXTVLCOPT`、`#EXTHTTP` 标签）与 **API 面板源**（`json.txt` + 分类接口，多镜像自动合并）。
   - 源 → 分类 → 频道 → 取流四层，取流后经 `/api/hls` 代理并套用去广告。

9. **剧集选集与剧目详情**：
   - 50 集分组标签、正序/倒序、精准集数跳转；海报、热度、播放量、完结状态、全网其它源副本切换。

10. **追剧与播放记录**：
    - 精确进度（第几集 + 秒 + 百分比条）、一键续播、批量删除；追剧按「在看 / 想看 / 已看」分类。

11. **偏好设置与存储管理**：
    - 自动连播、去广告、默认倍速、锐化强度、主题配色、电视键盘、本地缓存清理。

## 🛠️ 技术栈

- **框架**：React 18 + TypeScript + Vite 6
- **样式**：Tailwind CSS + Lucide React
- **播放引擎**：Hls.js + HTML5 Media API
- **抓取核心**：零依赖 Node 服务（`server/`，Node 22+ 原生 `fetch`）
- **数据持久化**：LocalStorage 本地响应式存储

## 🚀 开发与运行

```bash
npm install
npm run dev      # 前端 + 抓取服务（Vite 中间件同源挂载，推荐）
npm run serve    # 仅抓取服务，独立跑在 8788 端口（生产静态托管时用）
npm run build    # tsc + vite build
npm test         # 规则引擎冒烟测试（29 项，不联网）
```

> **为什么必须有本地抓取服务**：站点抓取、GBK 转码、m3u8 去广告、清单改写、跨源并发都受浏览器同源策略与防盗链限制，只能在服务端完成。`npm run dev` 时它以 Vite 插件中间件形式挂载在同一端口，前端只发同源 `/api/*`，开箱即用。

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
| GET | `/api/live/sources` | 直播源列表 |
| POST | `/api/live/platforms` | 直播分类 |
| POST | `/api/live/channels` | 直播频道 |
| POST | `/api/live/play` | 直播取流 |
| GET | `/api/proxy` | 原始抓取（调试 / 订阅导入） |
| GET | `/api/hls` | m3u8 改写 + 去广告 |
| GET | `/api/media` | 分片 / 直链转发（保留 Range） |

### 网络环境说明

- 服务端默认 **直连**，并会清空继承来的 `HTTP_PROXY` / `HTTPS_PROXY`：桌面端常见的本地代理（如 `127.0.0.1:3240`）若未开启，会让所有抓取报 `os error 10061` 而整站瘫痪。
- 确实需要走系统代理时，用 `GUOAPP_USE_ENV_PROXY=1 npm run dev` 显式开启。
- GBK / GB2312 页面按前 8KB 的 `charset=` 探测后用 `TextDecoder('gbk')` 解码，与 Go 版本行为一致。
