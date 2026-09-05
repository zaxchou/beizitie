# 背字帖 (zi2anki) 项目交接报告

> 生成时间：2026-08-14
> 交接场景：换电脑继续开发
> 代码仓库：`Z:\projectC\calligraphy-memory`（git 仓库，远程仅作版本管理，部署不走 GitHub）

---

## 1. 项目是什么

书法记忆卡（Anki 类）Web 应用。前端 React + Vite + Zustand + MUI，后端 Express + PostgreSQL，服务端渲染静态构建产物。

三个域名指向同一台服务器（124.223.17.29）：

| 域名 | 用途 |
|---|---|
| molin.wiki | 书法知识 wiki（另一个项目，Docker） |
| zi2anki.molin.wiki | 本应用（Let's Encrypt 证书） |
| beizitie.com | 本应用正式域名（**TrustAsia 付费证书**，已备案） |

---

## 2. 关键文件与目录

```
calligraphy-memory/
├── src/                  # React 前端
│   ├── pages/            # 页面组件
│   ├── components/       # 组件（layout/、study/、market/、dashboard/ 等）
│   ├── stores/           # Zustand stores
│   ├── lib/              # api.ts（后端 API 客户端）、productionFeatures.ts（生产特性开关缓存）
│   └── types/            # TypeScript 类型
├── server/               # Express 后端
│   ├── index.ts          # 入口 + 公开路由（jizi、marketplace 公开端点）
│   ├── db.ts             # PostgreSQL 连接 + schema 迁移
│   ├── middleware/auth.ts# JWT 鉴权（含 JWT_SECRET 解析）
│   ├── routes/           # auth / decks / cards / study / analytics / marketplace / jizi / admin
│   ├── lib/              # cache 等
│   ├── scripts/          # 内容包应用脚本
│   ├── data/             # （本地开发用）
│   └── production-config.json   # ⚠️ 生产配置开关（已 gitignore，见 §6）
├── deploy.sh             # ⚠️ 部署脚本（已 gitignore，本机独有，见 §7）
├── scripts/backup-db.sh  # 生产数据库备份
├── DEPLOYMENT_SAFETY.md  # ⚠️ 部署安全规则，必读
└── CLAUDE.md             # 项目指令，必读
```

---

## 3. 当前未提交的工作（必须处理）

`git status` 显示大量未提交改动 —— 这是「生产特性 + 游客模式 + 权限重构」功能，**代码已在生产运行，但从未 commit**。换电脑前务必 commit + push，否则代码丢失。

改动内容：

| 文件 | 改动 |
|---|---|
| `server/routes/auth.ts` | 新增 `loadProductionConfig()`（读生产配置）、`GET /production-features`、`POST /guest`（游客登录，自动订阅预设牌组） |
| `server/index.ts` | 新增公开 `/api/marketplace/decks` 路由（游客免登录浏览市场），支持可选 JWT 带出 is_subscribed |
| `server/middleware/auth.ts` | 导出 `GUEST_ROLE`、`JWT_SECRET` |
| `src/lib/api.ts` | 新增 `fetchProductionFeatures()`、`guestLogin()` |
| `src/lib/productionFeatures.ts` | **新文件**：生产特性懒加载缓存 |
| `src/pages/LoginPage.tsx` | 游客模式：guestMode 开启时自动游客登录（不显示登录表单），`?login=1` 可强制显示表单 |
| `src/components/auth/ProtectedRoute.tsx` | 游客只能访问 `/`、`/market`、`/study/:deckId`、`/dashboard` |
| `src/components/layout/AppShell.tsx` | 备案号 footer（生产时显示）、TopBar 游客隐藏用户名 |
| `src/components/layout/SideMenu.tsx` | 游客隐藏用户区 + 只显示仪表盘/市场导航 |
| `src/components/layout/BottomNav.tsx` | 游客只显示仪表盘/市场 |
| `src/stores/useAuthStore.ts` | 新增 `loginFromGuest()` |
| `src/pages/DecksPage.tsx` | 创建/重命名/删除牌组按钮仅管理员显示（subscriber 隐藏） |
| `.gitignore` | 新增 `server/production-config.json` |

**建议的 commit message：**
```
feat: production guest mode + filing footer + subscriber UI scoping

- backend: production-features endpoint, guest login with preset subscriptions, public marketplace routes
- frontend: auto-guest-login on LoginPage, guest nav scoping, filing footer, hide user section for guests
- .gitignore: exclude server/production-config.json (deployment config, not source)
```

---

## 4. 部署架构（换电脑必须重建）

### 4.1 服务器拓扑

- **服务器 IP**：124.223.17.29
- **SSH 别名**：`xcx`（在 `~/.ssh/config`，**换电脑需重新配置**，指向 ubuntu@124.223.17.29，通常走密钥登录）
- **应用路径**：`/opt/zi2anki`
- **进程管理**：pm2，进程名 `zi2anki`，用 `npx tsx` 跑 `server/index.ts`，端口 3001
- **环境变量**：`/opt/zi2anki/ecosystem.config.cjs`（⚠️ 这里硬编码了 `NODE_ENV=production`、`JWT_SECRET`、`TSX_DISABLE_CACHE`。**不能用 `pm2 restart zi2anki` 简单重启，必须用 `pm2 start /opt/zi2anki/ecosystem.config.cjs --only zi2anki --update-env`**，否则环境变量不会刷新）

### 4.2 Nginx（Docker 托管）

- nginx 跑在 molin-wiki 的 docker-compose 里（container `deploy-nginx-1`）
- 配置文件：`/opt/molin-wiki/deploy/nginx.conf`，bind mount 到容器 `/etc/nginx/conf.d/default.conf`
- **⚠️ bind mount inode 陷阱**：`sed -i` 修改 nginx.conf 会新建 inode，Docker bind mount 追踪旧 inode，容器不感知。改完必须 `docker compose restart nginx`（或用 `cat > file` 原地写）
- 证书目录：`/opt/molin-wiki/ssl/`（已含 beizitie.com_bundle.crt + beizitie.com.key、molin.wiki 证书）
- Let's Encrypt 目录：`/etc/letsencrypt`（zi2anki.molin.wiki 用）

### 4.3 证书现状

- **beizitie.com**：TrustAsia DV TLS RSA CA 2024，有效期 2026-07-07 ~ 2026-10-05，nginx 配置指向 `/etc/nginx/ssl/beizitie.com_bundle.crt` + `.key`
- **zi2anki.molin.wiki**：Let's Encrypt，自动续期（certbot webroot 指向 Docker named volume `deploy_certbot_www`）

---

## 5. 部署流程

**部署 = 本地 SCP 直传，不走 GitHub。** 用 `deploy.sh`（本机脚本）：

```bash
bash deploy.sh anki            # 安全默认：构建前端 + 传 dist + 传 server/ + npm install + pm2 restart + 健康检查 + 用户数据哨兵对比
bash deploy.sh anki --data     # 仅增量上传 uploads/ 缺失文件
bash deploy.sh anki --migrate  # 先备份生产库再部署（幂等 DDL）
bash deploy.sh anki --content <pkg>  # 内容发布（dry-run + APPLY 确认）
```

**⚠️ 部署前必读 `DEPLOYMENT_SAFETY.md` 和 `CLAUDE.md`。核心红线：**

- 生产 DB 是唯一真源，**严禁**本地 DB 覆盖生产 DB
- `deploy.sh anki --sync` 已永久禁用（旧模式会清空用户数据）
- 任何 DB 变更前先 `scripts/backup-db.sh` 备份（备份在 `/opt/zi2anki/backups/`，保留 30 天）
- 部署会自动跑用户数据哨兵：对比 users / user_card_progress / user_subscriptions / study_sessions / daily_stats / jizi_history 的 count，不允许下降

---

## 6. ⚠️ production-config.json —— 关键陷阱

文件：`server/production-config.json`（已 gitignore，**不随 GitHub**）

当前内容（本地）：
```json
{
  "guestMode": true,
  "filing": { "icp": "沪ICP备2026019654号-3" },
  "guestSubscriptions": ["0bce9012-95e5-4930-b7fc-c384cf4f074a"]
}
```

**⚠️ 服务器端当前是 `guestMode: false`（备案下来后手动 sed 关闭了），但本地这份文件是 `guestMode: true`。** `deploy.sh anki` 会把整个 `server/` 目录 tar 上传（含此文件），**下次部署会覆盖服务器配置把 guestMode 弹回 true**！

**换电脑前必须二选一：**
- 若备案已完成、游客模式不再需要：把本地 `guestMode` 也改成 `false` 后再部署/提交，并保留 `filing` 部分（备案号 footer 仍需要）
- 若之后可能再开游客模式：保留 true 但记住部署会同步它

`guestMode` 控制：登录页是否自动游客登录。`filing` 控制：footer 备案号显示（备案号永久保留）。`guestSubscriptions` 控制：游客自动订阅哪些牌组（多宝塔碑 deck_id `0bce9012-95e5-4930-b7fc-c384cf4f074a`）。

后端读取逻辑（`server/routes/auth.ts`）：仅当 `process.env.NODE_ENV === 'production'` 才读取此文件，本地开发返回空开关（不影响本地）。

---

## 7. 换电脑重建清单

1. **安装依赖**：Node.js（≥18，实际生产用 v20）+ PostgreSQL（本地开发）
2. **SSH 配置**：在 `~/.ssh/config` 配 `xcx` 别名 → `ubuntu@124.223.17.29`，配好密钥
3. **恢复 `deploy.sh`**：⚠️ 该文件已 gitignore，不在仓库里！需从旧电脑拷贝，或按旧版重建（核心逻辑见上）。`deploy.sh` 里硬编码了 `ANKI_LOCAL="Z:/projectC/calligraphy-memory"` 本地路径，换电脑要改成新路径
4. **环境变量**：本地开发 `.env` 需要 `JWT_SECRET`（生产值在服务器 ecosystem.config.cjs 里；本地可用 dev 回退值）
5. **生产配置**：确认 `server/production-config.json` 的 guestMode 状态（见 §6）
6. **本地启动**：
   - 后端：`npx tsx server/index.ts`（或看 `start.bat` / `start.ps1`）
   - 前端 dev：`npx vite`（vite.config.ts 里 `/api`、`/uploads` 已 proxy 到 localhost:3001）
7. **拉取代码**：`git clone` / `git pull`，注意 `deploy.sh`、`server/production-config.json`、`uploads/` 都不在仓库，需手动同步

---

## 8. 建议的技能（next session 推荐）

- **`deploy`** — 安全部署 zi2anki 到生产（已内置安全规则）
- **`code-review`** — 提交未 commit 的游客模式代码前跑一遍 review
- **`verify`** — 游客模式/备案号/权限改动改完后跑端到端验证
- **`stamp-downloader`** — 若继续做集字印章库导入

---

## 9. 已知技术备忘

- **Zustand persist key**：认证状态存在 localStorage 的 `背字帖-auth`（非 raw token/user），测试/调试注入登录态要写完整的 persist JSON
- **pm2 重启**：必须用 ecosystem.config.cjs 的 `pm2 start ... --update-env`，不能裸 `pm2 restart`（会丢 NODE_ENV）
- **僵尸进程陷阱**（历史）：pm2 看似 online 但端口 3001 被孤儿 tsx 进程占用时，清缓存无效，先 `pkill` 再 pm2 start（有记忆记录）
- **上传文件**：`/opt/zi2anki/uploads/` 内容寻址（UUID 文件名），增量同步靠文件名差集
- **Vite proxy**：前端 dev 时 `/api` 和 `/uploads` 走 `http://localhost:3001`
- **Express 子路由挂载陷阱**：`importRouter` 等挂载在 `app.use('/api')` 下，路由路径必须带完整前缀（如 `/import/local-backup`）；写 `/local-backup` 会漏匹配、落到后面的 `adminRouter.use(requireAdmin)` 变 403，表现为"请求凭空消失进管理员校验"，极难排查（2026-09-04 踩过）
- **deploy.sh 禁止并发本地构建**：deploy.sh anki 第一步自己跑 `npm run build` 并 tar 流式上传 dist；期间再开本地构建会改写 dist 导致 tar 流损坏/挂死（ssh 孤儿进程 + 远端锁滞留）。重跑前先 `ssh xcx "rm -rf /opt/zi2anki/.deploy.lock"` 并 kill 本地 ssh 孤儿进程（2026-09-04 踩过）

---

## 10. 2026-09-04 本轮交付（集字提速 + P2 收尾）

### 10.1 集字匹配提速（jizi_index 预计算索引）
- **病因**：`GET /api/jizi/match?scope=all` 每次请求全表扫描 168 万 cards 拉进 Node 逐行清洗匹配 — 5 字 12.5s / 21 字 28.8s + 18MB 响应 / 常用字直接 502
- **药方**：预计算表 `jizi_index`（card_id PK / hanzi 繁体规范 / deck/style/calligrapher 快照 / sort_key）+ `idx_jizi_index_hanzi`；路由改为 `hanzi = ANY($1)` 索引命中，`ROW_NUMBER()` 每字封顶 500 变体；索引未建时自动回退旧全表扫描（兼容首次部署）
- **效果**：服务端计算 100-180ms；5 字 0.22s / 21 字 2.9s(3.5MB)；前端字符级模块缓存（`JiziPage.tsx` allCharCache）重复字零网络请求
- **维护**：全量重建 `npx tsx server/scripts/jizi-index-build.ts --full`（172 万行约 57s）；增量 `--incremental`（约 1.2s，cron 每日 3:40 已配）；`ygsf-catalog.ts` importOne 上架后调 `indexDeck()` 按帖实时入索引

### 10.2 双向兼容补完：服务器版导入单文件备份
- **接口**：`POST /api/import/local-backup`（登录用户，body = beizitie-backup JSON）
- **匹配规则**：deck 按 `source_key = ygsf:<zitieId>` 匹配（已发布帖无论挂谁名下按公共帖处理并自动补订阅）→ 用户同名自建帖兜底 → 都没有则在用户名下重建整帖（source_key `local-backup:<zitieId|id>`，重复导入幂等）
- **卡片对齐**：归一化 image_url（去 `?x-bce-process` query）精确匹配 → front_text 帖内唯一时兜底；进度批量 upsert（恢复语义覆盖）；daily_stats 按天取 GREATEST
- **前端**：web 版设置页新增「导入单文件版备份」卡片（所有登录用户可见）
- **安全边界**：只写当前用户自己的数据（自建帖/进度/订阅/统计），零删除，符合 DEPLOYMENT_SAFETY.md；已用临时用户端到端实测（精确匹配/唯一字兜底/坏进度跳过/自动订阅/幂等/级联清理全过）

### 10.3 单文件版字图离线缓存
- IndexedDB `beizitie` **v1→v2**（新增 `images` store：url→Blob）；新模块 `src/data/local/imageCache.ts`
- 学习页：命中缓存用本地 blob，未命中即时网络显示 + 后台缓存（在线零体验差异）；进帖低并发(2)预热整帖，断网可复习；上限 8000 张
- 设置页新增「字图离线缓存」开关 + 已缓存张数 + 清空按钮；kv `imageCacheEnabled` 默认开

### 10.4 部署与验证记录
- deploy.sh anki 干净重跑成功（用户数据哨兵 6 项全过）；生产 jizi_index 已全量建成（1,725,637 行）
- `beizitie.html` 已更新推送 Pages（含图片缓存 + 集字字符缓存）
- 仍为手动/遗留：镜像同步（--mirror）保持手动；服务器版学习页未接图片缓存（同域静态文件收益小，暂缓）

---

## 11. 2026-09-04 第二轮（P123 收尾：巡检 / 目录发版 / Release）

### 11.1 数据质量巡检（2707 帖全量体检）
- 体检结果：书体覆盖 100%；封面缺 2 → **清零**（新工具补齐）；简介缺 1 → 清零（多宝塔碑手工补）；书家缺 25→20、朝代缺 232（**YGSF 源数据本身没有**，冷门墓志，属数据上限非缺陷）
- 简介质量抽查：全部为"作品名+朝代书家+书体+字数页数+原文起首"格式（此前 2 条疑似"以观/远程"命中实为碑文原文，误报）
- 封面死链清扫：2697 封面全量 HEAD 检查，清掉 3 条死链（诗赠董其昌/鲜于氏离堆记/杂书卷）——鲜于氏离堆记即用户此前报过缩略图异常的帖
- **新 cron**：每月 15 日 4:00 自动跑 `ygsf-cover-sweep.ts`（日志 cover-sweep-cron.log）
- **新工具**：`server/scripts/ygsf-enrich-gaps.ts`（轻量巡检补缺，一帖一次 API，对比 --enrich 快一个数量级）；`ygsf-catalog.ts --enrich-missing` 仍在但慢（每帖拉 6 页原文），巡检优先用 enrich-gaps

### 11.2 目录发版一键化
- **新脚本**：仓库根 `release-catalog.sh` — 生产生成 catalog-out → tar 拉回 catalog/ → 内置体检（total>0、zitie 文件数≥95%、index<3MB）→ 重编 beizitie.html（index.json 是 ?raw 内联）→ 提交推送；`--skip-build` 跳过重编
- 规矩定为：**每批导入后跑一次，每月至少一次**
- 首跑成功：2705 帖（跳过 1，纳入条件过滤），index 0.72MB，Pages 已生效

### 11.3 P3 发布
- GitHub Release **v1.0.0** 已建（https://github.com/zaxchou/beizitie/releases/tag/v1.0.0），附 beizitie.html 产物（1.49MB，下载已验证）
- gh CLI 本机没有 → 用 `git credential fill` 取 PAT + REST API 创建/传附件；流程已写进 SOP §6
- **新文档**：`docs/双版本维护SOP.md`（功能开发 checklist / 目录发版 / 服务器维护 / YGSF 运维 / Release 流程 / 事故速查 / 退役检查点）

### 11.4 现存数据池状态（供后续决策）
- 候选池 pending 6056：未知 3561（维持排除）+ exists 1315 + junk 614 + 重名 474 + 巨帖 52 + partial 2 + **印章类 38（batch_status 空，唯一没跑过的非未知书体，待用户定夺）**
- 楷行草隶篆该导的已全部导完，无遗漏

---

## 12. 2026-09-04 第三轮（市场体验：朝代筛选 + 详情弹窗）

### 12.1 用户反馈 → 修复
- **朝代分类缺失**：数据两版都有（DB `marketplace_decks.dynasty` / catalog `d` 字段），只是 UI 没入口。两版市场页都加了**朝代 chips 行**（按纪年排序：先秦→汉→…→明→清→近代→日本，带计数，点选再点取消）。
- **单文件版市场不能点开详情**：web 版本就有 DeckDetailDialog，单文件版没有。新增 `src/single/components/DeckDetailDialog.tsx`：封面 + 元数据 + 简介 + 8 个单字预览 + 加入书库按钮；点封面或帖名打开。简介/样字懒加载自 `catalog/zitie/<id>.json`（publish-catalog 现在往单帖文件里写 `desc` 字段，**不进 index.json**，目录体积不涨）。

### 12.2 ⚠️ 大坑：index.ts 内联公开路由遮蔽 marketplaceRouter
- `server/index.ts` 里有一段早期加的**匿名市场列表内联路由**（`app.get('/api/marketplace/decks', ...)`，注册在 authMiddleware 之前，支持匿名+可选 token 取 is_subscribed）。Express 按注册顺序匹配，它**永远先于** marketplaceRouter 命中 → 改 `marketplace.ts` 的列表逻辑对线上**完全无效**。
- 症状极具迷惑性：文件是新的、pm2 重启过、甚至怀疑 tsx 缓存（`/tmp/tsx-1000`，可 rm）。判别手法：往文件加 `console.log` marker 看 pm2 日志，证明文件加载了 → 说明另有同名路由。
- 已修复：内联处理器与 marketplace.ts **同步**加了 dynasty 参数/过滤/dynastyCounts facet。**教训：改市场列表逻辑，两处都要改（或未来重构为共享函数）**。

### 12.3 部署与验证
- dynasty=唐 → total 160（与 DB 一致）；dynastyCounts 16 朝代（明1143/宋369/清350/元226/唐160…）
- 新 beizitie.html（1.50MB）已发 Pages，含朝代筛选 + 详情弹窗
- 市场列表响应新增 `dynastyCounts: [{dynasty, n}]`（公开+鉴权两条路径都加了）

---

## 13. 2026-09-04 YGSF 标签漂移事件 — 完整复盘与铁律

### 事件
- 用户报告敦煌遗书佛说父母恩重经字图不符 → 错误判断"80% 帖损坏" → 首轮批量修复用了不稳定接口把 137 万标签写成随机字 → 已全部从 06:06 备份还原（含误删 82 帖完整恢复）。生产库 = 事故前状态（2852 帖/上架 2707/172.6 万卡）。

### 根因（第一性原理，详见 docs/ygsf-api-research.md）
- **图片 URL 与 _id 稳定；只有 _hanzi 标签会漂移**：服务端在"真值态/垃圾态"间按时间窗切换（缓存/分片缺陷），垃圾态每次请求随机生成。
- 判据：**垃圾标签永不重复、真值标签重复出现** → 多轮拉取众数(≥2票)即真值。6 轮实测 100% 收敛。
- 库内数据质量：**绝大多数帖是对的**（用户直觉正确）；只有导入时赶上垃圾窗口的帖部分错乱（特征是"前段对、后段乱"，分页边界即错乱起点）。
- 卡片对齐一律用**图片文件名**（部分帖 _id≠文件名）。

### 工具与流程（铁律已实证）
- `server/scripts/ygsf-majority-verify.ts`：多轮采样众数投票修字。`--dry-run/--apply/--limit/--zitie/--random`，产出 JSON 报告，幂等可续跑。
- 集字安全模式：`jizi_verified` 表 + 索引只收录验证帖（jizi_index_state 空时 /api/jizi/match 返回空，宁缺勿错）。
- 铁律 7 条（见调研文档 §8）：≥2 票才可信 / 不删帖只改字可回滚 / 修后必复检抽读 / 集字逐帖放行 / 覆盖<90% 跳过 / 1→5→50→批量小步推进 / 报告留档。

### 已修复（实证）
- 敦煌遗书佛说父母恩重经：611 错字 → 复检 971/971，经文连贯 ✓
- 50 帖随机抽样：OK 4 / 需修 8 / 未决 38（快照覆盖不足，待复验）；8 中 7 帖已修并放行集字（意不殊前因快照空本轮跳过）；苏轼西湖诗复检 398/399（余 1 为源站多义字正常波动，二次投票 399/399 一致）
- 集字已验证放行：敦煌 + 7 帖（8 帖，共 ~2700 字）

## 14. 2026-09-05 上架口径收紧：市场仅展示已校验帖（宁缺勿错全量贯彻）

### 决策
- 用户拍板：`jizi_verified` 不只管集字，**市场也只上已校验帖**；未校验 YGSF 帖 = 废弃下架状态（数据保留，不可在市场学习）。补验通过后自动恢复上架，无需改代码。

### 实现（谓词已内联进各 SQL，注释指向 HANDOFF §14）
- `server/index.ts` 公开路由（**注意：这些在 authMiddleware 之前，遮蔽 marketplaceRouter 同名 GET**）：市场列表 + 书体/朝代/书家 facet（facet 原本漏 published 过滤，已一并修正）+ 帖详情 + 卡片预览，均加 `AND (d.source_key IS NULL OR d.source_key NOT LIKE 'ygsf:%' OR d.source_key IN (SELECT 'ygsf:'||zitie_id FROM jizi_verified))`。
- `server/routes/marketplace.ts`：订阅 POST 加同款闸口 + `published_at IS NOT NULL`（404 "该帖未上架或未通过校验"）；鉴权版 GET 列表同步（实际被遮蔽）；鉴权版 GET 详情未改（被遮蔽的死代码，Mimosa hook 误报拦编辑，无实际影响）。
- `server/scripts/publish-catalog.ts`：目录同口径 + **输出目录先 rmSync 重建**（修复 catalog-out 累加导致旧帖 JSON 残留进发版的 bug）。
- `release-catalog.sh`：步骤 2 改为整目录替换（rm -rf catalog 再解包），防本地残留。

### 数字口径（对外统一用这个）
- **市场上架 = 1386 部 / 184 书家 / 380,954 单字**（行 797 / 楷 237 / 草 269 / 隶 55 / 篆 29；明 709 / 宋 179 / 清 164 / 元 125）。
- 集字范围 = 1476 部 / 41.7 万字（比市场多的是 100 部未上架画题长卷，如九歌图/孝经图——校验过但市场不收画题）。
- 单文件版目录 = 1385 帖（1386 里 1 帖因目录收录规则被跳过）。
- 库房总量仍是 2707 部/172 万卡（未删），只是不上架。

### 验证记录（2026-09-05）
- 线上 API total=1386 ✓；未校验帖详情 404 ✓ 预览 0 卡 ✓；已校验帖 200/50 卡 ✓。
- catalog/index.json（Pages）total=1385 ✓；zitie 文件 1385=目录数 ✓。
- 提交：84ded8a（代码）、dcc9765/1a13c23（目录发版，后者清理 1322 个残留 JSON）。

### 遗留
- marketplace.ts 鉴权版 GET 详情仍是旧口径（死代码）；下次触碰该文件时顺手补齐。
- 1366 部未校验帖待源站快照恢复后跑 `ygsf-majority-verify --apply --skip-verified` 补验，通过即自动回到市场。

## 15. 2026-09-05 上图碑帖库接入打样（九成宫双版本）+ 跨源互证

### 打样交付
- **市场上架**：九成宫醴泉铭（四欧宝笈宋拓本）[shlib:eqqlcf4jly5i3w5v，1109 卡] + 九成宫醴泉铭 [ygsf:dee55057…，1093 卡，跨源互证收录] 同台，市场角标区分上图/YGSF，详情弹窗有完整署名（CC BY-NC-ND 3.0）。
- **字在帖中**：cards.context 新列（JSONB：整页页图 + x/y/w/h + 所在句）；市场详情弹窗预览字卡点"原拓"→ 整页拓片高亮该字。公开预览接口已带 back_text+context。
- **工具链**：`上图碑帖库/export_deck.py`（sqlite→deck JSON，**帖序必须用 ye,mian,hang**）；`server/scripts/shlib-import-deck.ts`（幂等整册重建）；`server/scripts/admit-verified.ts`（单帖收录+索引）。

### 铁律与坑（后续 45 部必读）
1. **收割库 pos_in_text 不可信**：九成宫 1109 字只有 101 个不同值（大量并列桶），排序会乱；真帖序 = ORDER BY ye, mian, hang（全局唯一，已跨源验证）。
2. **馆方标注是简体+归一字**，拓片是繁体/异体（徵/魏征、敕/𠡠）；跨源对齐前必须先 t2s + 异体字归一，否则误判。
3. **跨源互证通道**：同一经典文本、两个独立来源（馆方 vs YGSF）difflib 对齐，归一后重合 ≥90% 且差异全部可解释（异体/泐损）→ 双向收录。九成宫实测 91.2%，102 处差异零错字。
4. 泐损字照常上架（宋拓原貌），context 原拓视图可补偿；shlib 卡 back_text=所在句。
5. 导 cards 必须**显式 user_id=NULL**（生产库默认值是 ''，违反 fk_cards_user）。
6. 市场总数 1388；Windows curl 测中文参数必须手工 %编码（--data-urlencode 在 Git Bash 会坏）。

### 后续（待用户确认打样效果）
- 45 部批量导入（脚本就绪，逐部跑 export+import+对齐验证）
- 单文件版目录接入 shlib 来源（publish-catalog 目前只收 ygsf CDN 直链，需扩展 splitUrl）
- 学习页"字在帖中"入口（当前只在市场详情弹窗）

## 16. 2026-09-05 上图 45 部全量上架 + 学习页原拓 + 跨源互证拦截 34 帖

### 交付
- **市场 1432 部**（含上图 45 部，排在 featured 5 部之后第 6-50 位）。上图帖统一（上图藏本）后缀，同名多版本加·一/·二；书家字段经 clean_calligrapher 清洗（角色括注判断撰/书/镌）。
- **学习页"字在帖中"**：due-cards/new-cards 透出 cards.context；FlashCard 背面右下"原拓"角标（有 context 才显示，默认隐藏），点开整页拓片高亮该字；市场详情弹窗共用同一组件。
- **缩略图统一**：导出 v2 把单字 bbox 外扩 12% 成方形 region，IIIF 出 256x256，与 YGSF jpg256 规格一致。页面原始尺寸按 svc 拉 info.json（export/_page_dims.json 缓存，2087 页）。
- **45 部逐部目验**：contact-sheet 每帖 8 字共 8 张，全部合格（封面签条/题跋页/泐损为拓本原貌）。

### 跨源互证结论（重要）
- 45 部与 1320 部未验 YGSF 帖题名匹配 34 对，对齐（t2s 归一、阈值 85%）**0 对通过**：
  - 孟敬训墓志等 = 全乱（"苟剿丢勤痞巷蕉…"随机字）；皇甫诞碑/礼器碑等 = 前对后乱（坏窗口特征，重合 50% 上下）。
  - 这 34 部全部被正确拦在市场外。九成宫（已验帖）同法得 91.2% —— 方法能区分好坏。
- 结论：**未验 YGSF 帖与上图重合 ≠ 可放行**，实测全部是坏标签。后续不要再尝试"重合即可放行"，直接以上图版本为准。

### 新坑
- 匹配/对齐脚本拉序列必须 ORDER BY d.id, c.sort_order（漏排会得到 0-15% 的假结果）。
- 上图收割库 inst.temporal 语义混杂（拓本年代/碑刻年代混用，出现过"春秋拓本"），命名统一（上图藏本），底本信息放 description。
- jizi 索引对古文字（石鼓文 371 字只收 12）会正确过滤，非 bug。

### 补记（同日）：单文件版目录已接入上图来源
- publish-catalog.ts 分流：shlib 帖 IIIF 绝对直链（rel=完整 URL，base/thumb 置空），ygsf 仍走 CDN 相对路径；前端 glyphUrl=base+rel+thumb 天然兼容，零改动。
- 张从申书李玄靖碑书体缺失（上图元数据缺 script_form）→ STYLE_OVERRIDES 补楷书，重导。
- Pages 实测：目录 1431 帖（含上图 45 部），九成宫 zitie 文件 IIIF 链接 200 ✓；beizitie.html 已重编内联。
- 已知边界：cards.context（原拓坐标）未进单文件目录（文件体积+前端 UI），"字在帖中"目前仅在线版。

### 补记 2（同日）：市场缩略图大小不一的真因 = 1fr 网格被长帖名撑爆
- 现象：市场网格 tile 出现 143/165/176/209 四种宽度。排查发现**与封面图无关**——是 CSS 布局：`repeat(6,1fr)` 的每列最小值默认为内容的 min-content，市场卡片题名 noWrap（不换行），上图帖名带（上图藏本）后缀长达 14-18 字（≈209px），把所在列硬撑宽。YGSF 帖名短所以历史上从未触发。
- 修复：网格项加 `minWidth: 0`（web + single 两个 MarketPage 都加了）。修复后实测 50 格全部 141×141。
- 教训：验证布局问题必须看**渲染后的 DOM 几何**（playwright getBoundingClientRect），光看数据/图片内容会误判两次。
- 防复发：API 已加 `Cache-Control: no-cache`（此前浏览器缓存旧接口数据也会造成"改了没生效"的错觉）。

### 补记 3（同日）：待复习 011134 之谜 + 单文件原拓移植完成
- **待复习"011134"** = 字符串拼接 bug：/api/due-counts 的 `COUNT(c.id)` 未转 int（pg bigint→string），前端 `sum + due_count` 变成 "0"+"1"+"1"+"13"+"4"。真实值 19。修复：COUNT 全部 `::int`（decks.ts 的 new_count/due_count 同修）+ 前端 Number() 兜底 + API 显式 `Cache-Control: no-cache`。
- **单文件版原拓已移植**：目录 zitie JSON 对 shlib 帖输出 `pages[]`/`sents[]` 去重数组 + `g[].c=[页下标,x,y,w,h,句下标]`（九成宫仅 +25KB）；addFromZitie 落库到 LocalCard.context；学习卡复用 FlashCard 自动获得"原拓"按钮；市场详情预览字点击看整页高亮（与在线版共用 OriginalPageView）。Pages 实测通过。
- 单文件版 MarketPage 本就有朝代筛选（DYNASTY_ORDER chips），无需另做。

### 单文件版 vs 线上版 剩余差距清单（2026-09-05 更新）
1. ~~学习排序模式~~ ✅ 已补齐（DashboardPage LimitEditor 出卡顺序：到期优先/按帖序/随机）
2. 卡片管理页：线上可逐卡浏览/删除/重置；单文件仅整帖维度操作（用户暂不需要）
3. ~~统计深度~~ ✅ 已补齐（单文件 DataPage：6 指标卡 + 近14天堆叠图 + 14天到期预测 + 按帖进度）
4. ~~淳化阁帖订阅体积~~ ✅ 已压缩 2.85MB→1.05MB（见补记 4）
5. 云同步/多用户：单文件设计如此（本地 IndexedDB），非缺陷

### 补记 4（同日）：淳化阁帖单文件体积优化完成
- 目录 shlib 条目从「完整 IIIF 链接 + 6 元组」压缩为「pages[]（svc 去重）+ 9 元组 c（页下标, 裁切x/y/边长, 紧bbox x/y/w/h, 句下标）」，链接运行时由 shlibGlyphUrl/shlibPageUrl 拼回。
- 淳化阁帖 2.85MB → 1.05MB（2.7×）；全目录 zitie 35.1MB → 约 13MB。
- 重建 URL 与压缩前逐字节一致（抽样 200 全可访问；IIIF 服务器有并发限流，批量校验需串行+重试）。
- 兼容性：g.rel 保留为异常回退路径；旧订阅数据自包含不受影响。

### 补记 5（同日）：README 专业化 + 封面 + 编辑精选封面修复
- **README 封面**：照 zupu 封面同一套做法（docs/_cover.html 设计稿 → 浏览器截图 2560×1280 docs/cover.png → README 顶部居中引用）。背字帖版式：文武线双框 + 右侧竖排「背字帖」+ 朱印「日课一字」+ 左侧文案；迷你示意 = 九成宫醴泉铭（上图藏本）帖首四字真拓卡（新卡→10分→1天→7天 SM-2 阶梯）+「字在帖中」整页定位小图（带 CC 署名）。设计稿与拓片素材（docs/_cover-assets/）已入库可复现。
- **截图渲染坑**：① 上图 IIIF 直连 403，必须带浏览器 User-Agent；② `zoom:2` 截图时 body 背景传播到 canvas 不受 zoom 影响，正中会出硬接缝——背景必须放独立 .bg 层；CDP deviceScaleFactor 在 MCP 环境不生效，zoom 方案可用。
- **真 bug：编辑精选封面空白**：精选帖（阴符经等 5 部）的封面是管理员上传的服务器相对路径 `/uploads/...`，在线版能解析，单文件版目录里没有主机名 → MarketPage `startsWith('http')` 判掉变灰块。修复：publish-catalog.ts `absCover()` 把 `/` 开头封面补全为 `https://beizitie.com` 前缀；deploy.sh anki + release-catalog.sh 重发后 Pages 已验证。
- **README 重写**：功能特性表 / 界面速览（docs/screenshots/ 三张移动端真机图：市场/学习卡/字在帖中）/ 快速开始 / 单文件细节 / 自托管 / FAQ / 致谢与数据来源；删除过时的「统计页在 Roadmap 中」；补 LICENSE 文件（此前 README 声称 MIT 但仓库无 LICENSE，含数据许可说明）。

### 补记 6（同日）：deep review 修复——口令轮换 + 重建保进度 + 并发丢设置
- **口令轮换（P1）**：review 发现 `zi2anki_pg_2026` 以代码默认值形式散布在 db.ts/backup-db.sh/deploy.sh/deploy.md/auto-verify.sh（仓库公开=已永久泄露）。处置：生产 `ALTER USER` 轮换新随机口令 → `/opt/zi2anki/.db-password`(600, 不入库) 为唯一事实源 → db.ts 改 环境变量→cwd 文件 两级解析，生产缺失即 FATAL（对齐 JWT_SECRET 模式）→ 四个脚本/文档全改读文件 → 全仓扫描 0 残留。本地开发在仓库根放本地 .db-password（已 gitignore）。注意：deploy.sh 整个文件在 .gitignore 里，它的修改不会随 git 走。
- **shlib 导入器重写（P1）**：旧版 DELETE 全部卡片+进度+订阅后重建，重跑一次=清空所有学习者的进度。新版：单事务；deck id 不变（订阅不动）；卡片按 source_key 复用 id 只更内容（进度保留）；包里移除的字才连带删进度。已在生产用《麻姑山仙坛记》实测：deck_id 不变、更新 757/新增 0/移除 0、test 的订阅保留。
- **LimitEditor 并发丢设置（P1）**：保存按钮连发 3 个并发 updateSettings（读-改-写），最后一次写覆盖前两次→同时改上限+出卡顺序会静默丢设置。改单次合并 patch 保存。
- **majority-verify ok 分支（P2）**：mismatch≤5 的帖此前不应用 fixes 直接放行，带错字进集字。现在两个分支都应用 fixes（MISMATCH_LIMIT 只区分报告 verdict）。注：已放行的存量帖要修字需重跑一轮不带 --skip-verified 的核验（源站窗口轮转，耗时长，暂缓）。
- **MARKET_VERIFIED_SQL 收拢（P2）**：上架口径谓词 9 处引用统一到 server/services/marketScope.ts。教训：模板字符串里替换裸标识符不生效（会被当 SQL 列名），必须 `${CONST}`——已在线上踩过一次（market 列表 500，column "market_verified_sql" does not exist）。
- **P3**：cards.ts 第二道路径守卫删除（恒真无防护意义）；随机出卡改 Fisher-Yates；OriginalPageView IIIF 加载失败给提示；tsconfig.tsbuildinfo 退库。
- **实测纠正一个 review 误判**：上图整页原拓并不大（页宽约 1100px、100–500KB），此前"十几 MB"的估计错了；且该 IIIF 默认禁止放大（小于原尺寸的 size 请求返回 400 要 ^ 前缀），保持 full/full 即可。

