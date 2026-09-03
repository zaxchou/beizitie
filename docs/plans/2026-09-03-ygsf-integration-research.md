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

---

## 9. 第二步实测记录（2026-09-03，混合机制 ✅ 已完成）

**交付**：`ygsf_images` 映射表（migrateSchema 幂等建表）+ `ygsf-sync.ts` 三个新命令：

| 命令 | 作用 |
|---|---|
| `--mirror --deck X [--limit N]` | 把远程图下载到 `uploads/ygsf_<glyphId>.png`（断点续传，已缓存自动跳过，250ms 限速） |
| `--to-local --deck X` | 已镜像的字整组切成本地路径（未镜像的保持直链，不影响可用性） |
| `--to-remote --deck X` | 整组切回远程直链 |

**日常形态**：卡片保持远程直链（服务器零图片负载）；`ygsf_images` 表记录 glyph_id → remote_url / local_path 的映射账本。对方若开防盗链 → 先 `--mirror` 补缓存（有 token 就能拉）→ `--to-local` 一键切换；恢复后 `--to-remote` 切回。

**线上实测**（瘦金体千字文）：mirror 3 张 → 3 张切本地（站点访问 200）→ 3 张切回远程 → 终态 1015 remote / 0 local。验证通过。

**踩坑记录**：
1. YGSF 字 id 是 **32 位 hex**（非 Mongo 的 24 位），正则截断会导致 mirror 与卡片关联失败
2. tsx ESM 模式下没有 `__dirname`，脚本里用 `process.cwd()`（约定从项目根运行）
3. token 已存服务器 `/opt/zi2anki/.ygsf-token`（chmod 600，已 gitignore），脚本自动读取，无需每次传参

**剩余事项（第三步前）**：`--apply` 时补登映射表逻辑已具备，但当前瘦金体的 1015 条映射还没登记（apply 是在加表之前跑的）——下次对该帖执行 `--apply`（或补跑镜像）会自动补齐。mirror 命令按卡片 URL 现算 glyph_id，不依赖表内已有记录，所以镜像功能不受影响。

---

## 10. 第三步实测记录（2026-09-03，目录扫描 + 楷书试点建库 ✅）

**接口补全**（本轮逆向成果）：
- `zuopin/query?key=<名>&loaded=<已加载偏移>`：作品目录搜索，120/页带 total（`loaded` 是分页参数；空 key 返回 0，纯搜索型接口）
- `zitie/glyphs/query?zid=<zitie_id>&loaded=<偏移>`：整帖单字分页（120/页带 total），比 page/glyphs 高效，自带 `_font`（书体）与 `_author`
- 书体分类策略：不在目录层枚举（接口无书体字段），**导入时取单字 `_font` 众数**；`--classify` 命令可对候选池做轻量预分类（1 请求/帖）
- 未攻破：zuopin→zitie 版本列表接口（ztlist 参数未中）；当前用 cover_url 内嵌的默认版本 zitie_id，一个作品先收录默认版本

**交付**：`server/services/ygsf.ts`（共享客户端）+ `server/scripts/ygsf-catalog.ts`：
- `--search <关键词>` / `--search-file <文件>`：目录扫描入 `ygsf_zuopin` 表（幂等 upsert）
- `--classify`：候选池书体预分类（轻量，只拉第一页单字）
- `--list [--style 楷]`：目录统计与候选清单
- `--import --zuopin <id> [--publish] [--max-chars N]`：建 deck+cards（source_key=`ygsf:<zitie_id>[:<glyph_id>]` 幂等）+ 登记 ygsf_images + 可选上架 marketplace_decks。**纯元数据 + 直链，零图片下载**

**楷书试点结果**（关键词 39 个 → 目录 3232 作品去重 2729 名）：
| 帖 | 书家 | 卡数 | 状态 |
|---|---|---|---|
| 九成宫醴泉铭 | 欧阳询 | 1093 | 已上架 |
| 玄秘塔碑 | 柳公权 | 1277 | 已上架 |
| 颜家庙碑 | 颜真卿 | 2858 | 已上架 |

市场从 10 帖增至 13 帖，uploads 零增长（磁盘 29%）。市场公开列表/卡片预览/直链 200 均验证通过。

**踩坑补录**：decks/cards 有 NOT NULL 的 created_at/updated_at/next_review（导入需显式赋值）；cards.user_id 列默认是 `''` 不是 NULL，插入必须显式 NULL 否则撞 fk_cards_user。

### 楷书批次放量待办
1. 目录池跑 `--classify`（3232 帖 ≈ 20-30 分钟，限速 300ms）
2. `--list --style 楷` 出候选清单 → 人工过一遍排除教学手稿/临摹指导类杂帖
3. 分批 `--import --publish`（建议每批 20-50 帖，观察市场体验）
4. 行书/草书/隶书/篆书批次：补对应关键词文件重复上述流程

---

## 11. 市场元数据修补（2026-09-03，用户反馈闭环 ✅）

用户验收试点三帖后发现：市场缩略图缺失、简介是占位文案。两处修复：

1. **缩略图缺失 root cause**：市场列表查询 `COALESCE(md.cover_thumb, md.cover_image, ...)`，而新帖 cover_thumb 写的是**空字符串**（非 NULL），COALESCE 直接短路返回空串。修复：`NULLIF()` 包裹（marketplace.ts，已提交待下次部署生效）+ 立即 UPDATE 三帖 cover_thumb = cover_url（数据层先修复，市场即刻显示封面）
2. **简介/元数据丰富**：新发现 `zitie/details?zid=` 返回 `_dynasty`（朝代）/版本全名/每帖专属封面/页数，`zitie/page/text?zid&page=` 逐页返回**碑帖原文**。导入与新增 `--enrich` 命令都会自动：
   - description = 《帖名》，朝代·书家 书体。全帖 N 字、M 页 + 碑帖原文起首 80 字
   - decks.article_text = 全文（前端「文章全文」功能可直接用）
   - cover_image/cover_thumb = 该版本专属封面，dynasty = 朝代

试点三帖已 enrich：九成宫（原文 1355 字）、玄秘塔碑（原文 1549 字）、颜家庙碑（API 无原文，简介降级为纯事实描述）。

**后续放量流程**（每批）：`--search-file 关键词` → `--classify` → `--list --style X` 人工筛帖 → `--import --publish`（自动带全套元数据）→ 市场即见。

---

## 12. 无人值守放量（2026-09-03 夜间，自动运行中）

用户批准全自动过夜建库（楷→行→草→隶→篆增量），约束：镜像保持手动、零图片下载。

**基础设施**：
- 市场列表**分页**：`/api/marketplace/decks?limit=&offset=`（返回 `{total, calligraphers, decks}`；鉴权路由与 index.ts 公开路由两处同步支持；旧无参调用兼容返回全量数组）。MarketPage 改为 60/页 + 「加载更多」+ 服务端筛选（书体/书家/关键词）+ 搜索防抖
- `ygsf-catalog.ts` 批量模式 `--import-batch --style X [--batch 40] [--publish]`，护栏：
  - 拉取不完整（登录墙/token 失效）→ **不入残库**，连续 5 次输出 NEED_TOKEN 停止
  - 杂帖黑名单（教学/手稿/临摹指导/讲座/课件/教程/示范课/视频课）
  - 重名 deck 已在库 → 跳过（保护本地旧图库内容不重复上架）
  - 卡片/ygsf_images 批量 INSERT（200/批），事务包裹
  - 限速：分类 300ms/帖、拉页 120ms/批、导入间隔 300ms
- 无人值守脚本 `server/scripts/ygsf-overnight.sh`（服务器 nohup 脱机运行）：阶段1 第二批关键词扫描（75 个行/草/隶/篆/词作家名）→ 阶段2 全池分类 → 阶段3 按书体顺序循环导入上架。日志 `/opt/zi2anki/ygsf-overnight.log`

**试点再验证**：--import-batch 2 帖成功（上天垂象碑 195 卡、不自弃说 658 卡），市场总数 15，uploads 零增长。

**晨检查看**：`ssh xcx "tail -40 /opt/zi2anki/ygsf-overnight.log"`；市场总数 `curl 'https://beizitie.com/api/marketplace/decks?limit=1' | jq .total`。若日志出现 NEED_TOKEN：重新取 token（书签脚本）写入 `/opt/zi2anki/.ygsf-token` 后重跑 import-batch 循环即可，目录池与分类结果都在，不会重复建库。

### 夜间运行实录（截至 12:35 状态快照）
- 池子最终规模超预期：39+75 关键词扫出 **7500+ 作品**（分类已跑满 15 轮上限，可能有少量尾量未分类，留待晨间补跑 `--classify`）
- 书体分布（分类完成时点）：行 ~1500+、楷 ~800、草 ~300、隶 ~150、篆 ~80、未知 ~1200（无书体元数据，不自动导入）
- 12:30 PHASE3 启动，楷书批次运行中；首轮 40 帙：成功 26、exists 跳过 14（**同一 zitie 被多个作品包装复用**，source_key 去重正确生效——这解释了目录数偏大的原因）
- 预计通宵完成 楷→行→草→隶→篆 主体；若 token 中途失效会自动停并在日志留 NEED_TOKEN 标记
