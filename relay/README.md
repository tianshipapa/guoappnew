# 抓取中继（relay）

给「只放行中国大陆 IP」的站源用的一条出口。海外部署（Cloudflare Pages / Vercel）直连被拦时，
把抓取请求交给一台国内机器转发。

## 为什么需要它

agneschoi.com / 51shumai.cn / jennyhow 这类站点按 **IP 归属地**放行：

| 探测点 | www.51shumai.cn | play.hhuus.com（视频 CDN） | hd.kuktxu.com（视频 CDN） |
| --- | --- | --- | --- |
| 德国 / 俄罗斯 | 连接失败 | 403 | 200 |
| 日本 / 印度 / 保加利亚 | 连接失败 | 200 | 200 |
| 巴西 / 匈牙利 / 哈萨克 / 塞尔维亚 | 连接失败 | — | 200 |

结论有两条，决定了中继该怎么做：

1. **站点页面是真地域封锁**（不是 UA / Referer / ASN 黑名单），换 Cloudflare 节点、换 Vercel 区域、
   开 Smart Placement 都不会变——只能让出口 IP 落在中国大陆。
2. **视频 CDN 大多不限地域**，只有极少数按地区拦。所以中继平时只转发几 KB～几百 KB 的 HTML，
   带宽压力极小，家宽都够；需要连分片一起转发时再打开 `GUOAPP_FETCH_RELAY_MEDIA=1`。

## 部署（四种档位，按预算选）

### A. 国内轻量服务器（推荐，最稳）

阿里云 / 腾讯云轻量 2C2G，新用户百元级一年。登录后：

```bash
# 上传 relay.mjs，然后：
RELAY_TOKEN='换成一串随机字符' \
RELAY_ALLOW_HOSTS='agneschoi.com,51shumai.cn,jennyhow.com' \
node relay.mjs
```

长期跑用 systemd（或 `pm2 start relay.mjs`）：

```ini
# /etc/systemd/system/guoapp-relay.service
[Unit]
Description=guoapp fetch relay
After=network.target

[Service]
ExecStart=/usr/bin/node /opt/relay/relay.mjs
Environment=PORT=8787
Environment=RELAY_TOKEN=换成一串随机字符
Environment=RELAY_ALLOW_HOSTS=agneschoi.com,51shumai.cn
Restart=always
User=nobody

[Install]
WantedBy=multi-user.target
```

```bash
systemctl enable --now guoapp-relay
```

> 只跑 HTTP 也能用（Cloudflare 出站允许 `http://`）。想上 HTTPS 就在前面挂 Caddy
> （有域名时自动签证书）：`caddy reverse-proxy --from relay.example.com --to 127.0.0.1:8787`。

### B. Docker（云函数 / 容器平台都能塞）

```bash
docker build -t guoapp-relay ./relay
docker run -d --restart=always -p 8787:8787 \
  -e RELAY_TOKEN=随机字符 \
  -e RELAY_ALLOW_HOSTS=agneschoi.com,51shumai.cn \
  guoapp-relay
```

阿里云函数计算 FC、腾讯云 SCF 都支持 **自定义容器镜像 + HTTP 触发器**，这条路不用改一行代码，
出口 IP 是国内某地域的 NAT 池。注意共享 NAT 可能被站点风控拉黑（爬虫多），先测再定。

### C. 家宽 + Cloudflare Tunnel（零成本，适合自用）

家里有常开的机器（NAS / 软路由 / 旧笔记本）就行，不需要公网 IP，也不怕运营商大内网：

```bash
node relay.mjs &
cloudflared tunnel --url http://127.0.0.1:8787
```

拿到的 `https://xxx.trycloudflare.com` 直接填进 `GUOAPP_FETCH_RELAY`。
临时域名每次重启会变，长期用建一条命名隧道绑自己的域名。

> 家宽出口是住宅 IP，反而比机房 IP 更不容易被风控——做「只抓 HTML」完全够用。
> 但上行带宽小（通常 30～50Mbps 且被限速），别拿它转发视频分片；
> 另外个人宽带协议一般不允许对外提供经营性服务，自用即可。

### D. 整个站点迁到国内边缘（一劳永逸）

腾讯云 EdgeOne Pages / 阿里云 ESA Pages 有中国大陆节点，把这些站源和前端一起放国内，
出口 IP 问题自然消失，国内访问速度也更快。代价是**加速区域含中国大陆时必须用已备案域名**
（未备案只能用 3 小时有效的预览链接），备案要 1～2 周。

## 配置到站点

Cloudflare Pages：项目 → Settings → Environment variables（Production）

```
GUOAPP_FETCH_RELAY      = https://relay.example.com/?url=
GUOAPP_FETCH_RELAY_TOKEN = 与中继的 RELAY_TOKEN 一致
```

Vercel：Project → Settings → Environment Variables，同上。

多个中继用逗号分隔，按顺序故障切换：

```
GUOAPP_FETCH_RELAY=https://a.example.com/?url=,https://b.example.com/?url=
```

占位符形态也支持：`https://relay.example.com/fetch?target={url}`。

可选变量：

| 变量 | 作用 |
| --- | --- |
| `GUOAPP_FETCH_RELAY_FORCE=1` | 所有抓取都先走中继，跳过注定失败的直连（站源被大面积拦时能省十几秒） |
| `GUOAPP_FETCH_RELAY_MEDIA=1` | 视频分片 / 清单也允许走中继（默认关闭，中继带宽会明显上升） |

## 自检

```bash
# 中继本身活着
curl "https://relay.example.com/healthz"

# 真的能抓到那个站（正文第一行应该是 <!DOCTYPE html> 之类）
curl "https://relay.example.com/?url=https%3A%2F%2Fwww.51shumai.cn%2F" \
  -H "x-guopp-token: 你的令牌" | head -c 200

# 站点侧：进「设置 → 站源管理」，点某个源的「测试」，能看到走没走中继
```

站点日志里会出现：

```
[fetch] 抓取中继已启用：1 个出口
```

## 安全红线

- **一定配 `RELAY_TOKEN` 和 `RELAY_ALLOW_HOSTS`**。不配就是一台对公网开放的匿名正向代理，
  云厂商风控会直接封机器，也会被人拿去刷流量。
- 只放行你真正在用的站源域名，不要放 `RELAY_ALLOW_HOSTS=`（空 = 全部放行）。
- 中继只负责「转发页面」，不做缓存、不落盘、不存 cookie。
