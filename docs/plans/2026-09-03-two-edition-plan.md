# 背字帖双版本改造计划（一码两态）

> 版本: 1.0 | 日期: 2026-09-03 | 状态: 已获批准，待执行
> 背景: 背字帖（zi2anki，已在线 https://beizitie.com）从「单一服务器产品」演进为「双版本」：
> **单文件开源版**（主角，GitHub 分发）+ **服务器平台版**（现存产品，维护模式）。
> 前置调研: [ygsf-integration-research.md](2026-09-03-ygsf-integration-research.md)（远程图片直链可行性已验证）

---

## 0. 已批准的决策记录

| # | 决策点 | 结论 |
|---|---|---|
| D1 | 架构 | **一码两态**：同一仓库同一条主干，两套构建目标（`build:web` / `build:single`）。不做 git 分支 |
| D2 | 仓库 | 原仓库 `zaxchou/zi2anki` **改名**为 `zaxchou/beizitie`（GitHub 自动重定向旧链接），README 重写：单文件版为主角 |
| D3 | 单文件版功能 | 市场/订阅/学习 + **集字**（首版即含）+ 导出/导入 JSON + 暗色模式。无登录、无 Anki |
| D4 | 服务器版 | **功能冻结，维护模式**（只修 bug/安全/证书）。6 个月后设退役检查点 |
| D5 | 进度格式 | 单文件版导出 JSON 与服务器版**双向兼容**（可导回网站版） |
| D6 | 目录更新 | 事件驱动：导入批次后手动 `publish-catalog` 发版，无定时任务 |
| D7 | 老字库 | 10 套本地图片的老帖**切换为远程直链**（本地图保留作备份，暂不删除）——同时是单文件版目录的前置条件 |
| D8 | 内容策略 | 未知书体暂不收录；画题/碎片（<10 字）/杂帖黑名单排除；>6000 字巨帖默认排除（可个案放开） |

## 1. 目标与非目标

### 目标
- G1 用户双击一个 HTML（或访问 GitHub Pages）即可使用完整背字帖：浏览市场 → 订阅 → 学习 → 集字 → 导出备份
- G2 学习记录只存用户本地（IndexedDB），隐私零上传（唯一网络请求是拉取公开字帖图片与静态目录）
- G3 服务器版零回归：现有用户无感，所有现有功能照常
- G4 新功能只写一次（core/features 层），两个版本同时获得

### 非目标
- 不做账号系统、不做在线同步（导出/导入 JSON 替代）
- 不做多人协作、不做评论/社区功能
- 不在单文件版实现 APKG（服务器版保留）
- 不删除服务器（维护模式下继续服务存量用户）

## 2. 架构设计

### 2.1 目录结构（一码两态分层）

```
/
├── index.html                 # web 版入口（现有）
├── single.html                # single 版入口（新增）
├── src/
│   ├── core/                  # ★ 纯逻辑，零环境依赖（两版 100% 共享）
│   │   ├── sm2.ts             #   SM-2（从 lib/sm2.ts 迁入）
│   │   ├── types.ts           #   Card/Deck/Progress/CatalogTypes
│   │   └── catalog/           #   静态目录客户端（fetch index/zitie JSON、URL 拼装）
│   ├── features/              # ★ 功能模块（两版共享 UI + 逻辑）
│   │   ├── study/             #   FlashCard/RatingButtons/useStudySession
│   │   ├── market/            #   目录浏览/订阅（数据经 adapter）
│   │   ├── jizi/              #   集字（本就是纯前端 Canvas，迁移成本低）
│   │   └── analytics/         #   统计（web=API，single=本地聚合）
│   ├── data/
│   │   ├── adapter.ts         # ★ DataAdapter 接口（见 2.2）
│   │   ├── server/            #   现有 api.ts/useXxxStore 演化（登录版）
│   │   └── local/             #   IndexedDB 实现（单文件版）
│   ├── platforms/
│   │   ├── web/               #   web 版 App 装配（登录、路由守卫、admin、备案）
│   │   └── single/            #   single 版 App 装配（无登录、导出导入、设置）
│   └── ...                    # 其余现有文件逐步归位（保持可运行状态渐进迁移）
├── server/                    # 服务器后端（维护模式，仅修 bug）
├── catalog/                   # 目录 JSON 发布产物（GitHub Pages 直出）
│   ├── index.json             #   全量目录（帖名/书家/书体/封面/字数）
│   └── zitie/<zitieId>.json   #   单帖单字清单（订阅时按需拉取）
└── vite.config.single.ts      # single 构建配置（vite-plugin-singlefile）
```

### 2.2 DataAdapter 接口（草案）

```ts
interface DataAdapter {
  catalog: {
    list(opts: { style?, keyword?, calligrapher?, offset, limit }): Promise<{ total, zuopins, styleCounts, calligraphers }>;
    zitieGlyphs(zitieId: string): Promise<ZitieGlyphList>;   // 带本地缓存
  };
  library: {                       // 用户的牌组（= 已订阅帖的本地实例）
    list(): Promise<LibraryDeck[]>;
    add(zitieId: string, glyphs: ZitieGlyphList): Promise<void>;
    remove(deckId: string): Promise<void>;
    updateSettings(deckId, s: { dailyNewLimit?, dailyReviewLimit?, paused?, mode? }): Promise<void>;
  };
  progress: {                      // 每卡片 SRS 状态（SM-2 的持久化侧）
    get(cardId): Promise<Progress | null>;
    apply(cardId, rating: Rating, now: number): Promise<Progress>;
    dueQueue(deckId, opts: { newLimit, reviewLimit, mode }): Promise<QueueItem[]>;
    dailyStats(date): Promise<DailyStats>;
  };
  studySessions: { start/update/finish };   // 会话（统计用）
  settings: { get(): Promise<Settings>; set(patch): Promise<void> };
  backup: {
    exportAll(): Promise<BackupJSON>;        // P2 双向兼容格式
    importAll(json: BackupJSON, mode: 'merge' | 'replace'): Promise<ImportReport>;
  };
}
```

- **web 版**：`ServerAdapter`（现 api.ts + 相关 store 的逻辑收拢）
- **single 版**：`LocalAdapter`（IndexedDB：库 `cards/progress/decks/settings` 四个 object store；目录缓存独立 store）
- 迁移原则：现有页面组件改为只依赖 adapter 注入，**业务逻辑不动**

### 2.3 目录 JSON Schema

```jsonc
// catalog/index.json —— 目标 < 3MB（gzip 后 <800KB），每次 publish-catalog 重新生成
{
  "v": 1,
  "updatedAt": "2026-09-04T00:00:00Z",
  "total": 2300,
  "zuopins": [{
    "id": "f999444bab048b9e6f5625b5e3b15647",       // ygsf zuopin id
    "n": "九成宫醴泉铭",                              // 名
    "a": "欧阳询",                                    // 书家
    "d": "唐",                                        // 朝代
    "s": ["楷"],                                      // 书体（多值）
    "z": "dee55057ae32e442a011f1a7f8718fb7",         // 默认版本 zitie id
    "c": "zitie/dee55057.../covers/4.jpg?x-bce-process=style/jpg300x",  // 封面路径（宿主前缀拼接）
    "g": 1093,                                        // 字数
    "p": 51                                           // 页数
  }]
}

// catalog/zitie/<zitieId>.json —— 每帖一份（订阅时拉取，~40KB）
{
  "z": "dee55057ae32e442a011f1a7f8718fb7",
  "base": "https://ygsf.cdn.bcebos.com/autogen/areas/dee55057ae32e442a011f1a7f8718fb7/",
  "g": [["1", "875f345a9d1dcdd252fa161cce0c149a_.png", "成"], ["2", "cef...png", "宫"]]
  //      ↑ 目录序号   ↑ 相对路径（完整拼 = base + 相对路径 + ?x-bce-process=style/jpg512）  ↑ 汉字
}
```

- 生成器 `npm run publish-catalog`：从生产库导出（排除未知书体/黑名单/巨帖，与 D8 一致）→ 写 `catalog/` → git push → GitHub Pages 生效
- 分发：GitHub Pages（`beizitie.github.io`域名自适应）+ jsDelivr CDN 兜底加速

### 2.4 单文件构建

- `vite-plugin-singlefile`：`build:single` 产出单个 `beizitie.html`（内联 JS/CSS，约 1-1.5MB）
- 双入口配置：`index.html`（web）与 `single.html`（single）共享 `src/`
- 单文件版无任何服务器 API 调用：`import.meta.env.MODE === 'single'` 时装配 LocalAdapter
- 兼容底线：Chrome/Edge/Safari 近两年版本 + 移动端浏览器

## 3. 实施阶段

### P0 前置任务（不动单文件代码）
| 任务 | 说明 | 验收 |
|---|---|---|
| P0.1 仓库改名 ✅ | zi2anki → **beizitie**（2026-09-03 经 GitHub API 完成，旧链接自动重定向，本地 remote 已更新，push 验证通过） | 旧链接重定向可达；push 正常 |
| P0.2 老 10 帖切直链 ✅ | 2026-09-03 完成。雁塔圣教序 1461/1461、多宝塔碑 2003/2023、阴符经 404/570、三门记 332/505、峄山碑 146/219、德忱帖 88/155、真草千字文 1069/1800、草书千字文 0/1187（ygsf 该帖已清空，全本地）。未匹配卡保留本地图（deck 内混合源，功能无影响）；春江花月夜按用户决定保持全本地且不进单文件目录。全部备份 JSON 在服务器 backups/ | 抽样直链 200 ✓ |
| P0.3 README 重写 | 单文件版为主角；服务器版降级为「平台版」小节 | - |
| P0.4 publish-catalog 工具 | 从生产库生成 catalog/*.json（含 D8 过滤） | index.json < 3MB；抽样帖可解析 |

### P1 数据层抽象 + 单文件 MVP（核心里程碑）
1. DataAdapter 接口落地；现有 api.ts 收拢为 ServerAdapter（**本阶段纯重构，web 行为零变化**，回归标准：SM-2 测试全绿 + 手工冒烟学习流程）
2. LocalAdapter（IndexedDB）实现
3. `build:single` 跑通：市场浏览（静态目录）→ 订阅（拉单字清单）→ 学习（SM-2 + 每日上限 + 暂停）→ 暗色模式
4. 产出 `beizitie.html` 并人工双击验收

### P2 完整能力对齐
- 导出/导入 JSON：`BackupJSON` 格式（**与服务器版双向兼容**，服务器版新增导入接口承接）
- 集字移植（features/jizi 复用，数据源切换为本地目录）
- 学习统计页（本地聚合 daily stats）
- IndexedDB 图片懒缓存（首视缓存，离线复习可用）

### P3 发布与双版本 SOP
- GitHub Pages 上线（`zaxchou.github.io/beizitie/`）+ Releases 附 beizitie.html
- 开源发布：MIT License、README 定稿
- 《双版本维护 SOP》：功能开发走 features 层 checklist、目录发版流程、服务器版维护清单（证书/备份/哨兵）
- 服务器退役检查点（2027-03）：评估活跃用户数，决定保留/导流退役

## 4. 风险与对策

| 风险 | 对策 |
|---|---|
| YGSF 防盗链/改版（影响所有远程图） | 老帖本地图备份保留；单文件版 IndexedDB 懒缓存；服务器版 mirror 通道；极端情况换图源（provider 抽象） |
| 重构期引入回归 | P1 第一步是纯重构 + SM-2 测试 + 冒烟清单；两套构建各自 CI 校验 |
| 浏览器清存储丢进度 | IndexedDB 优先 + 定期导出提醒；导出 JSON 兼容服务器版可迁移 |
| 目录膨胀（池子 7500+） | index.json 控制在已发布范围（~2300 帖起步）；catalog 生成器带 D8 过滤 |
| jsDelivr/Pages 国内可达性波动 | 主域 GitHub Pages + jsDelivr 双源 fallback |
| 单人维护带宽 | 两版本 90% 共享代码；服务器冻结；每阶段有独立验收，可随时暂停不烂尾 |

## 5. 明确的执行顺序（严格按此执行）

1. P0.1 → P0.2 → P0.3 → P0.4（每项独立验收）
2. P1.1 重构（单独提交，可独立回滚）
3. P1.2 → P1.3 → P1.4
4. P2 各项（顺序可调，互不阻塞）
5. P3 发布
