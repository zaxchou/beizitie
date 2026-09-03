# 调研：直连以观书法（YGSF）字库可行性报告

> 日期：2026-09-03 | 结论：**技术可行，建议采用「目录镜像 + 图片直链 + lazy-cache」混合模式**
> 状态：仅调研，未做任何实施。所有结论均来自当日实测。

---

## 0. 背景与目标

现状：用 `ygsf-downloader` skill 从以观书法批量**下载**单字图 → 打包 apkg → 上传自建图库（单帖可达数百 MB，uploads 已 1.6GB 级），服务器存储/带宽压力大，每帖都是手动重活。

设想：不自建图库，**直接锚点（hotlink）YGSF 的字库**，甚至直接对接其全部字帖目录。两大收益：省掉图库存储与带宽；字库规模直接放大到对方全库（几千作品）。

## 1. 实测结论速览

| 问题 | 结论 |
|---|---|
| 图片 CDN 有防盗链吗 | **无**。裸 curl / 伪造站外 Referer / 无 Cookie 全部 200 |
| 图片链接是永久有效的吗 | **是**。URL 无签名参数，Last-Modified 停在 2023 年，ETag 稳定 |
| 需要登录吗 | **免费内容不需要**。API 与图片均匿名可用（`_free:0` 付费帖未验证，疑似需登录） |
| API 能程序化调用吗 | **能**。响应是 AES-128-ECB 加密，密钥硬编码在其公开前端代码里，已实现端到端解密 |
| 能拿到整个字帖目录吗 | **能**。作品目录、单字清单接口均已匿名调通（见 §3） |
| 链接里的 VNK 参数 | 无鉴权意义，前端生成 `VNK:Date.now()`，只是防缓存时间戳 |

## 2. 图片层（重负载部分）——全部利好

- 存储与 CDN：百度 BOS（`ygsf.cdn.bcebos.com`），公开读
- URL 格式：`https://ygsf.cdn.bcebos.com/autogen/areas/<区域id>/<序号>/<字id>.png`
  - API 直接返回完整 URL（`_color_image` 字段），**不需要自己拼**
  - `<字id>` 即单字 `_id`（MongoDB ObjectId hex）
- 服务端缩放：URL 加 `?x-bce-process=style/jpg256|jpg512|jpg300x` 可取缩略图（API 默认给的就是 jpg512）。实测同一张：原图 82KB ↔ jpg256 45KB。**学习场景用 jpg512 足够，流量可省一半以上**
- 响应头：`Expires` 3 天、支持 Range —— 浏览器缓存友好
- **CORS 全开**：`Access-Control-Allow-Origin` 回显任意 Origin（含 credentials）→ 任意网站/本地页面可直接 `<img>` 引用，Canvas `crossOrigin="anonymous"` 不污染（**集字导出 PNG 功能可直接适配**）

## 3. API 层（目录/清单数据，轻量）

- Base：`https://api.ygsf.com/v2.4`，公共参数 `_plat=web`
- 响应体整体加密：AES-128-ECB + Pkcs7，Base64 变体（`+`→`-`、`/`→`_`、`=`→`!`）
  - 密钥 `PkT!ihpN^QkQ62k%` **硬编码在其公开的 app.js 里**（随页面下发给每个访客，无保密性可言）
  - 解密后结构：`{stat:0, data:..., showad}` / `{stat:1, error:{title, code}}`
- **已匿名调通的端点**（当日实测）：
  - `GET /zitie/hot` → 热门作品目录：`_id`（=字帖 zid）、`_name`、`_free`（免费标志）、`_cover_url`
  - `GET /zitie/page/glyphs?zid=<字帖id>&page=1` → **单字清单**：`_id`、`_hanzi`、`_font`（书体）、`_author`、`_color_image`（完整 CDN 直链）、`_annotation`/`_position`（**字的包围盒数据**）、`_video_count`
- 尚需在实施时摸清（都属于「翻 SPA 的 chunk 找正确参数名」的体力活）：
  - 完整作品列表与分类筛选（`/zuopin/ztlist`、`/zuopin/query`、`/zuopin/query` 存在，参数名未对上，返回 total:0）
  - 「版本选择」的 zuopin→zitie 关联关系
- **CORS 白名单**：API 只回 `Access-Control-Allow-Origin: https://web.ygsf.com`，其他 Origin 拿不到 ACAO → **浏览器端第三方应用无法直接读 API**（图片 CDN 不受限）。服务端调用完全不受影响

## 4. 可行性判断

### 第一步「对接字库」：✅ 可行，推荐混合模式

**核心思路：元数据自己同步（轻），图片直链对方（重的不背）+ lazy-cache 兜底。**

1. 后端（无 CORS 限制）做一个 **YGSF 目录同步器**：按需/定期把作品目录和所选字帖的单字清单同步成本地表（一份字帖的元数据仅几 KB~几十 KB，对比现在一帖几百 MB 图片，缩减 1000 倍以上）
2. 卡片 `image_url` 存 YGSF 直链（新增支持绝对 URL），前端 `<img>` 直挂；学习场景统一加 `?x-bce-process=style/jpg512`
3. **lazy-cache 兜底**：图片首次被访问时由后端拉回存入 uploads（或前端拉入 IndexedDB），此后走自己的存储。这样：不烧对方带宽、不怕对方日后加防盗链，同时保持「零导入成本」
4. 架构上抽象出 **image source provider** 接口（`ygsf` 只是第一个实现），将来可接官方合作源或自有扫描源

### 第二步「本地单文件开源 App」：✅ 可行，且本调研直接扫清障碍

- 图片：CDN CORS 全开 → 纯前端直连显示、Canvas 导出都没问题
- 目录数据：因 API CORS 白名单，纯前端**不能**直调 api.ygsf.com → 解法：由社区/脚本定期把目录同步成**静态 JSON**（发布到 GitHub Pages 等静态托管），App 拉清单、直链图片。目录数据很轻，完全静态化可行
- 学习进度：localStorage / IndexedDB / sqlite-wasm，天然隐私本地化
- 零服务器成立：重字节全在对方 CDN，我方只分发轻量目录 + 代码

## 5. 风险与对策（必须正视）

| 风险 | 说明 | 对策 |
|---|---|---|
| **无授权/无 SLA**（最大风险） | 「没锁门」≠「请我们进」。他们可随时加防盗链（BOS 后台一行配置）、换密钥、改接口、下架字帖（调研中已见「字帖已删除」响应） | lazy-cache 自存兜底；provider 抽象可换源；产品逻辑不依赖对方永远可用 |
| **带宽礼貌/社区观感** | hotlink = 让对方 CDN 替我们扛用户流量，开源后可能被质疑 | 默认 lazy-cache 或缩略图 + 客户端缓存；文档注明来源与说明；限流 |
| **版权** | 碑帖为公有领域，但其扫描/抠字加工成果有劳动投入；其 ToS 未查到公开版本 | 保留来源标注；不二次分发其图片资产；开源仓库中不含其图片，只有直链/缓存机制 |
| **付费内容边界** | `_free:0` 字帖匿名是否可读未验证（大概率需要登录） | 首期只接 `_free:1` 目录 |
| **前端加密属灰色手段** | AES 密钥逆向自其公开前端代码，仅应用在后端同步工具 | 同步器代码不开源内置该逻辑；若未来谈合作可平滑替换为官方接口 |

## 6. 对现有系统的改造点（估）

| 位置 | 改动 | 量级 |
|---|---|---|
| `server/` | 新增 ygsf 同步器（service + route：搜索目录/导入字帖=建 deck+卡片元数据） | 中 |
| `cards.image_url` | 支持绝对 URL；`getImageUrl()` 对 http(s) 开头直通 | 小 |
| 新表或复用 | ygsf 字帖→deck 映射、同步状态、zid/source_key | 小 |
| jizi 集字 | `match` 范围扩展到 ygsf 目录（字库瞬间全量化） | 中 |
| 前端 | 市场/DecksPage 增加「从 YGSF 导入」入口；学习页图片加缩放参数 | 小 |
| 部署 | 无（不再传大图，`--data` 压力反而骤减） | — |

## 7. 建议的推进顺序

1. **P0**：后端同步器 MVP——输入 zid → 拉 `zitie/page/glyphs` 全页 → 建 deck（卡片存 `_hanzi` + 直链）→ 前端直显（先不做 lazy-cache，用 jpg512）
2. **P1**：作品目录浏览 + 搜索接入市场页（补齐 zuopin 列表参数）
3. **P2**：lazy-cache（首访回源自存）+ 全库静态目录快照（为第二步做准备）
4. **P3**：抽出 image-source provider 接口；评估付费帖/官方合作

> 备选对照：若想完全不依赖 YGSF，也可以继续现在的「下载→自建图库」模式，或改用中华珍宝馆等其它源——provider 抽象后可并存。纯自建的成本就是存储与每帖手动导入。

---

## 8. 第一步实测记录（2026-09-03，已完成 ✅）

按「小步快走」策略，第一步模块化测试当天完成：

- **工具**：`server/scripts/ygsf-sync.ts`（commit `457928d`）。子命令：`--info`（看字帖概况）/ `--dry-run` / `--apply` / `--restore <备份json>`；`--token` 传登录态（也可用环境变量 `YGSF_TOKEN`）
- **匹配**：`cleanFrontText`（与 jizi.ts 同规则）清洗 front_text 后按汉字精确匹配；同字多变体按顺序轮转分配。异体字（㑹㓗㔫等）因两边都用帖内原字命名而全部命中
- **实测对象**：线上「瘦金体千字文」（宋徽宗楷书，zid `972a636d21fd02389f518f2d286a8863`），deck `a3a31bc9-6ee9-486a-94ac-902804a66ac9`
- **结果**：1015/1015 卡片 100% 匹配并切换为 CDN 直链（jpg512），线上 preview API 确认已下发绝对 URL；抽样直链全部 HTTP 200
- **发现的新限制**：`zitie/page/glyphs` **匿名只能翻前 4 页（约 233 字）**，之后返回「登录提示」；带登录 token 后可拉全。token 从已登录浏览器的 Vuex 取：`document.querySelector('#app').__vue__.$store.state.user._token`（该站有 DevTools 反调试，开 F12 会被跳 about:blank，用书签脚本取）
- **回滚**：备份在服务器 `backups/ygsf-image-urls-瘦金体千字文-20260903014322.json`（本地留副本 `server/backups-local/`），`npx tsx server/scripts/ygsf-sync.ts --restore <该文件>` 一键还原
- **前端零改动**：`getImageUrl()` 本就直通 http(s) 绝对 URL，本次未部署任何前端/服务变更

### 下一步（第二步：混合机制）

1. lazy-cache：图片首次被访问时回源自存 uploads（或浏览器 IndexedDB），此后不依赖对方
2. provider 抽象：image source 可切换（ygsf / 本地 / 其他源），防盗链开启时自动降级本地缓存
3. 目录同步器泛化：支持批量拉取 zuopin 列表（需补齐 `/zuopin/ztlist`、`/zuopin/query` 参数名），为第三步「全库上架市场」做准备
