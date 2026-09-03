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
