# 背字帖双版本维护 SOP

> 一码两态：一套代码（`features/` + `core/` + `data/`），两个构建目标。
> 服务器版 = beizitie.com（登录 + PostgreSQL）；单文件版 = beizitie.html（免登录 + IndexedDB）。
> 本文是日常维护的操作手册；生产红线见 `DEPLOYMENT_SAFETY.md`，项目记忆见 `HANDOFF.md`。

---

## 1. 架构速览

```
src/
├── core/            共享类型 + 纯逻辑（SM-2 等）
├── features/        共享业务逻辑（学习队列、统计聚合…）
├── data/
│   ├── adapter.ts   LocalDataSource 接口（数据层契约）
│   ├── local/       IndexedDB 实现（单文件版）
│   └── (api.ts)     REST 实现（服务器版，src/lib/api.ts）
├── components/      共享 UI（FlashCard、RatingButtons…）
├── pages/           服务器版页面
└── single/          单文件版页面（Dashboard/Market/Jizi/Settings/Study + App）
```

构建：
- `npm run build` → `dist/`（服务器版前端，由 deploy.sh 上传）
- `npm run build:single` → `dist-single/single.html` → **拷贝为仓库根 `beizitie.html`**（GitHub Pages 服务）

---

## 2. 功能开发 Checklist（每个功能过一遍）

1. [ ] 业务逻辑放 `features/`/`core/`，不写死在某个 pages 目录
2. [ ] 动了 `data/adapter.ts` 接口 → **两个实现都要改**（`local/localAdapter.ts` + `lib/api.ts` 及对应 server 路由）
3. [ ] `npm run build` 通过（tsc + vite）
4. [ ] `npm run build:single` 通过 → `cp dist-single/single.html beizitie.html`
5. [ ] 单文件版本地验收：`npx serve dist-single` 双击打开 + Pages 线上验收
6. [ ] 服务器版改动 → `git push` + `bash deploy.sh anki`（见 §4）
7. [ ] 涉及目录/市场数据 → 跑 §3 目录发版

## 3. 目录发版流程（单文件版市场数据）

**何时发**：每批 YGSF 导入完成后；每月至少一次。

```bash
bash release-catalog.sh            # 全流程：生成→拉回→体检→重编→推送
bash release-catalog.sh --skip-build  # 只更新 catalog JSON（重编 beizitie.html 时才需要）
```

脚本内置体检阈值：`total > 0`、zitie 文件数 ≥ 目录 95%、index.json < 3MB。
发布后 1-2 分钟生效于：
- `https://zaxchou.github.io/beizitie/catalog/index.json`
- jsDelivr 兜底 `cdn.jsdelivr.net/gh/zaxchou/beizitie@main/catalog/`（随 main 自动）

单文件版目录获取为多源 fallback（同源 → Pages 绝对地址 → jsDelivr），用户可在设置里覆盖 `zitieBase`。

## 4. 服务器版部署与维护

### 部署
```bash
git push && bash deploy.sh anki     # 只部署代码/前端，不碰 DB
```
- ⛔ 永远不要并发跑本地 `npm run build`（deploy.sh 第一步自己会跑，并发会打坏它的 tar 流）
- 部署锁残留清理：`ssh xcx "rm -rf /opt/zi2anki/.deploy.lock"`
- 部署末尾自动跑用户数据哨兵（users/进度/订阅等 6 项 count 不许下降）

### 证书（certbot，Let's Encrypt）
- 覆盖 beizitie.com + www.beizitie.com，到期 2026-12-02，自动续期
- 手动检查：`ssh xcx "sudo certbot certificates"` / 续期 dry-run：`sudo certbot renew --dry-run`
- nginx 跑在 Docker（deploy-nginx-1），改配置必须 `docker restart deploy-nginx-1`（bind-mount inode 陷阱）

### 备份
- 每日 3:00 自动 `pg_dump` → `/opt/zi2anki/backups/`，保留 30 天
- 月度抽查：`ssh xcx "ls -lt /opt/zi2anki/backups | head -5 && zcat <最新备份> | head -20"`

### 定时任务一览（crontab -l @xcx）
| 时间 | 任务 |
|---|---|
| 每天 3:00 | 数据库备份 |
| 每天 3:40 | 集字索引增量（`jizi-index-build.ts --incremental`） |
| 每月 15 日 4:00 | 封面死链清扫（`ygsf-cover-sweep.ts`） |
| acme.sh 自带 | 证书续期 |

### 集字索引（jizi_index）维护
- 匹配接口走索引：正常 <200ms；若变慢先查索引行数：
  `psql ... -tAc "SELECT built_at, card_count FROM jizi_index_state"`
- 全量重建（172 万行约 1 分钟）：`npx tsx server/scripts/jizi-index-build.ts --full`
- 大批量导入/下架后建议手动跑一次 `--incremental`

## 5. YGSF（以观书法）数据源运维

- token：服务器 `/opt/zi2anki/.ygsf-token`（失效特征：接口返回 stat:1 + 登录墙，导入脚本 exit 3 NEED_TOKEN）
- 图片走对方 CDN 直链（`ygsf.cdn.bcebos.com`），服务器零图片存储；镜像下载保持**手动**（`ygsf-sync.ts --mirror`）
- 常用命令：
  ```bash
  npx tsx server/scripts/ygsf-catalog.ts --list [--style 楷]     # 池子统计
  npx tsx server/scripts/ygsf-catalog.ts --import --zuopin <id> --publish
  npx tsx server/scripts/ygsf-catalog.ts --import-batch --style 行 --batch 40 --publish
  npx tsx server/scripts/ygsf-catalog.ts --enrich-missing        # 巡检：补缺失封面/简介/书家/朝代
  npx tsx server/scripts/ygsf-cover-sweep.ts                     # 封面死链清扫
  ```
- 改版风险监测：`curl -sI "https://ygsf.cdn.bcebos.com/autogen/areas/<任一 zitie>/<n>/<glyph>.png"` 200 = 图链健在
- 候选池排除规则（勿轻易放开）：未知书体（用户决策）、教程/讲座类 junk 名、超 6000 字巨帖、重名帖

## 6. 单文件版发布流程（Release）

```bash
cp dist-single/single.html beizitie.html   # build:single 后
git add beizitie.html && git commit -m "chore(single): ..." && git push
# GitHub Release（附产物，便于离线分发）：
TOKEN=<github PAT>  # 见 git credential fill
curl -s -X POST -H "Authorization: Bearer $TOKEN" \
  https://api.github.com/repos/zaxchou/beizitie/releases \
  -d '{"tag_name":"vX.Y.Z","target_commitish":"main","name":"背字帖 vX.Y.Z","body":"..."}'
curl -s -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: text/html" \
  --data-binary @beizitie.html \
  "https://uploads.github.com/repos/zaxchou/beizitie/releases/<release_id>/assets?name=beizitie.html"
```

## 7. 事故预案速查

| 症状 | 处置 |
|---|---|
| beizitie.com 跳到 molin.wiki | nginx 配置被覆盖（历史事故）→ 从 git 仓库 `deploy/nginx/` 恢复 + `docker restart deploy-nginx-1`，并提醒 molin-wiki 窗口 |
| 站点 502/无响应 | `ssh xcx "pm2 describe zi2anki && sudo ss -tlnp | grep 3001"`；僵尸 tsx 占端口 → `pkill -f tsx` 后 `pm2 restart zi2anki` |
| 部署卡死 | 远端锁：`rm -rf /opt/zi2anki/.deploy.lock`；本地杀 ssh 孤儿进程 |
| 集字匹配突然超时 | 索引被清？查 `jizi_index_state`，空则 `--full` 重建（回退路径：无索引会自动全表扫描，慢但不错） |
| 集字索引 upsert 参数数不匹配 | 占位符 stride 数错（8 列必须 j*8），看 `server/services/jiziIndex.ts` |
| IndexedDB 数据丢失 | 用户侧：定期导出 JSON；导入接口可回服务器版（双向兼容已上线） |

## 8. 服务器退役检查点（2027-03）

- [ ] 统计活跃用户（近 90 天 study_sessions）
- [ ] 决策：保留 / 仅维护模式 / 导流单文件版后退役
- [ ] 退役前：全量备份 + 市场数据导出为 catalog 快照 + 公告期
