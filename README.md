<div align="center">

<img src="docs/cover.png" alt="背字帖 Beizitie" width="100%">

# 背字帖 Beizitie

**书法碑帖单字记忆 · SM-2 间隔重复 · 开源 · 隐私优先**

[![License](https://img.shields.io/badge/license-MIT-8a7d68)](#license)
[![在线版](https://img.shields.io/badge/在线版-beizitie.com-b03a2e)](https://beizitie.com)
[![单文件版](https://img.shields.io/badge/单文件版-在线试用-3c7a4e)](https://zaxchou.github.io/beizitie/beizitie.html)

*把背帖这件事，放回每个练字人的口袋里。*

</div>

---

**背字帖**把历代碑帖拆成单字高清卡，用 SM-2 间隔重复算法帮你高效背记字形。上架 **184 位书家、1386 部碑帖、38 万张单字**（行 797 / 楷 237 / 草 269 / 隶 55 / 篆 29），覆盖楷行草隶篆。所有上架碑帖均经**字图一致性核验**——宁缺勿错，字与图对不上的帖一律不上架；核验通过的帖同时构成集字的取字范围（1476 部 / 41.7 万单字，含未上架的画作长卷）。

## 三种使用方式

| 方式 | 适合谁 | 状态 |
|---|---|---|
| 🌐 **在线版** [beizitie.com](https://beizitie.com) | 打开就用，注册即学，数据云端保存 | ✅ 运营中 |
| 📄 **单文件版**（开源主打） | 无账号，学习记录只存你自己的设备，一键导出备份 | ✅ **[在线试用](https://zaxchou.github.io/beizitie/beizitie.html)** · [下载 beizitie.html](https://github.com/zaxchou/beizitie/raw/main/beizitie.html)（1.1MB，双击即用） |
| 🛠 **自托管平台版** | 学校/书院/团队自建，多用户管理 | ✅ 见下文 |

## 功能亮点

- **市场订阅**：1386 部经核验碑帖免费用，按书体/朝代/书家筛选，一键订阅开始学习
- **SM-2 间隔重复**：经典算法排复习计划（学习阶梯 1min → 3min → 10min → 毕业）
- **集字**：输入任意诗文，从 1476 部已核验碑帖（41.7 万单字，宁缺勿错）自动匹配单字，拼成书法作品导出高清 PNG
- **多端适配**：PC 双栏布局，移动端底部导航
- **隐私优先**：单文件版学习记录永不出设备；在线版数据可随时导出

---

## 📄 单文件开源版

> **一个 HTML 文件就是全部。** 无账号、无服务器、无追踪。

- 浏览器直接打开，数据保存在本机 IndexedDB
- 字库目录与单字图由静态 JSON + CDN 直链提供，应用自动保持最新
- 一键导出/导入 JSON：备份、换机、分享进度
- 与在线版进度格式互通（可导回 beizitie.com 继续）

**当前能力**：市场浏览（1385 帖，离线目录）→ 订阅 → SM-2 学习 → 集字（1476 部已核验帖）→ 深色模式 → 字图离线缓存（断网可复习）→ 导出/导入 JSON 备份（与在线版互通）。
在线试用与下载是同一份文件，学习进度存浏览器 IndexedDB（在线版和本地文件版互不共享，可用导出/导入迁移）。
需要联网加载字帖图片；统计页在 Roadmap 中（[双版本计划](docs/plans/2026-09-03-two-edition-plan.md)）。

> 使用提示：下载后双击打开即可（Chrome/Edge/Safari）。市场数据已内联，订阅和学习时需联网拉取字帖图片。

---

## 🛠 自托管平台版

多用户在线平台（JWT 账号体系、管理员内容后台、市场运营、数据统计）。

### 技术栈

| 层 | 技术 |
|---|------|
| 前端 | React 18 + TypeScript + MUI v5 + Zustand + Vite |
| 后端 | Express 5 + TypeScript (tsx) |
| 数据库 | PostgreSQL（连接参数见环境变量） |
| 算法 | SM-2 纯函数实现 |
| 进程 | PM2 + Nginx 反代 |

### 快速开始

```bash
git clone https://github.com/zaxchou/beizitie.git
cd beizitie
npm install
mkdir -p uploads

# 启动后端（默认端口 3001；数据库连接见环境变量）
npx tsx server/index.ts

# 新终端，启动前端（端口 3000）
npx vite --port 3000
```

打开 `http://localhost:3000`，**第一个注册的账号自动成为管理员**。

### 环境变量（生产必须覆盖）

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `PORT` | `3001` | 后端端口 |
| `JWT_SECRET` | 开发默认值 | 生产**必须设置**，否则拒绝启动 |
| `PG_HOST` / `PG_PORT` / `PG_DATABASE` / `PG_USER` / `PG_PASSWORD` | localhost / 5432 / zi2anki / zi2anki / — | PostgreSQL 连接 |

### 项目结构

```
├── src/            # React 前端（13 个页面：市场/学习/集字/统计/管理…）
│   ├── core/       # 纯逻辑（SM-2、类型）—— 两版本共享
│   ├── data/       # 数据层（服务器/本地双实现，见双版本计划）
│   └── platforms/  # web / single 双入口装配
├── server/         # Express 后端（10 个路由模块 + 内容包/目录工具脚本）
├── catalog/        # 单文件版静态目录（GitHub Pages 分发）
└── docs/plans/     # 产品与架构计划文档
```

### API 概览（节选）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/marketplace/decks` | 市场（支持分页/书体/书家/关键词） |
| GET | `/api/decks/:id/due-cards` | 到期复习队列 |
| POST | `/api/auth/login` | 登录（JWT） |
| GET | `/api/jizi/match` | 集字匹配 |
| GET | `/api/export/:deckId` | 导出 Anki apkg |

---

## 相关项目

- **[molin-wiki](https://molin.wiki)** — 中国书画 AI 分析与知识平台
- **[zupu](https://github.com/zaxchou/zupu)** — 单文件开源族谱工具（本仓库单文件版的架构灵感来源）

## License

MIT
