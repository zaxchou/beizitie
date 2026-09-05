# deploy — 安全部署 zi2anki 到生产

当用户输入 `/deploy`、`/deploy content`、`/deploy migrate` 时，以下是指令。

## 模式识别

- 用户只说 `/deploy` → 执行「场景一：代码部署」
- 用户说 `/deploy content` 或提到「内容包」「字帖上线」→ 执行「场景二：内容包部署」
- 用户说 `/deploy migrate` 或提到「迁移」「加字段」「改 schema」→ 执行「场景三：迁移部署」

> **兼容性说明**：`migrateSchema()` 是幂等 DDL，每次服务启动都会执行。所以日常 `/deploy` 也能把新字段带到生产，`/deploy migrate` 只多了一步"部署前备份生产 DB"。不需要让用户判断用哪个——90% 用 `/deploy`，只有改建表/CREATE TABLE/加 FK 时才用 `/deploy migrate`。

---

## 场景一：代码部署 `/deploy`

```
步骤 1/5  TypeScript 类型检查
步骤 2/5  Vite 构建前端
步骤 3/5  Git 暂存 + 提交（如未提更改）
步骤 4/5  git push origin main
步骤 5/5  bash deploy.sh anki
```

### 详细执行指令

1. **类型检查**
   ```bash
   cd Z:/BaiduNetdiskWorkspace/myagent-work/zcode/projectC/calligraphy-memory && npx tsc --noEmit
   ```
   如果失败，停止并报告错误。

2. **构建前端**
   ```bash
   cd Z:/BaiduNetdiskWorkspace/myagent-work/zcode/projectC/calligraphy-memory && npm run build
   ```

3. **暂存 + 提交**（仅在 `git status --porcelain` 有输出时执行）
   ```bash
   cd Z:/BaiduNetdiskWorkspace/myagent-work/zcode/projectC/calligraphy-memory && git add -A && git commit -m "<简短描述改动>"
   ```
   提交信息用英文，简洁描述本次改动。

4. **推送**
   ```bash
   cd Z:/BaiduNetdiskWorkspace/myagent-work/zcode/projectC/calligraphy-memory && git push origin main
   ```

5. **部署到生产** — `bash deploy.sh anki` 自动：
   - 获取部署锁
   - 构建前端 + SCP 到生产
   - pm2 restart 重启服务（触发 migrateSchema 幂等 DDL）
   - 健康检查 `/` 200 + `/api/jizi/match` 200

6. **报告结果** — 告诉用户部署状态和健康检查结果。

---

## 场景二：内容包部署 `/deploy content`

用于将本地已整理好的牌组安全发布到生产市场。

### 详细执行指令

1. **导出内容包**
   ```bash
   cd Z:/BaiduNetdiskWorkspace/myagent-work/zcode/projectC/calligraphy-memory && npx tsx server/scripts/export-local-deck.ts
   ```
   提取输出中的文件路径（如 `/tmp/瘦金体千字文.content.zip`）。

2. **上传到生产**
   ```bash
   scp <导出的zip路径> xcx:/opt/zi2anki/content-packages/
   ```

3. **Apply（直接 ssh，绕过 deploy.sh 的交互式确认）**
   > ⚠️ 不要用 `echo "APPLY" | bash deploy.sh`，Git Bash 下管道穿不透 `read`。
   ```bash
   ssh xcx "cd /opt/zi2anki && npx tsx server/scripts/apply-content-package.ts --apply content-packages/<zip文件名>"
   ```
   输出会显示 JSON，包含 deck/cards/marketplace/uploads 的变更统计。

4. **验证用户数据完整性**
   ```bash
   ssh xcx "PGPASSWORD="$(cat /opt/zi2anki/.db-password)" psql -h localhost -U zi2anki -d zi2anki -At <<'SQL'
   SELECT 'users=' || COUNT(*) FROM users;
   SELECT 'user_card_progress=' || COUNT(*) FROM user_card_progress;
   SELECT 'user_subscriptions=' || COUNT(*) FROM user_subscriptions;
   SELECT 'study_sessions=' || COUNT(*) FROM study_sessions;
   SELECT 'daily_stats=' || COUNT(*) FROM daily_stats;
   SQL"
   ```
   如果任何 count 下降，报告用户。

5. **验证封面图可访问**
   从 apply 输出的 marketplace 数据中找到 cover_image 路径，curl 确认 200：
   ```bash
   ssh xcx "curl -s -o /dev/null -w '%{http_code}' localhost:3001/uploads/<cover-file>.jpg"
   ```
   如果 404，手动 scp 封面文件上来：
   ```bash
   scp Z:/BaiduNetdiskWorkspace/myagent-work/zcode/projectC/calligraphy-memory/uploads/<cover-file>.jpg xcx:/opt/zi2anki/uploads/
   ```

6. **清理临时文件**
   ```bash
   rm <本地zip路径>
   ssh xcx "rm /opt/zi2anki/content-packages/<zip文件名>"
   ```

---

## 场景三：迁移部署 `/deploy migrate`

用于修改了 `server/db.ts` 的 schema——尤其是 CREATE TABLE、加 FK 约束等高危操作。

### 详细执行指令

1. **类型检查**
   ```bash
   cd Z:/BaiduNetdiskWorkspace/myagent-work/zcode/projectC/calligraphy-memory && npx tsc --noEmit
   ```
   如果失败，停止并报告错误。

2. **构建前端**
   ```bash
   cd Z:/BaiduNetdiskWorkspace/myagent-work/zcode/projectC/calligraphy-memory && npm run build
   ```

3. **暂存 + 提交**（仅在 `git status --porcelain` 有输出时执行）
   ```bash
   cd Z:/BaiduNetdiskWorkspace/myagent-work/zcode/projectC/calligraphy-memory && git add -A && git commit -m "<简短描述改动>"
   ```

4. **推送**
   ```bash
   cd Z:/BaiduNetdiskWorkspace/myagent-work/zcode/projectC/calligraphy-memory && git push origin main
   ```

5. **迁移部署** — `bash deploy.sh anki --migrate` 自动：
   1. 获取部署锁
   2. 捕获用户数据哨兵（部署前 counts）
   3. **备份生产 DB**（`pre-migrate`）
   4. 部署代码到生产
   5. pm2 restart → 服务启动时 `migrateSchema()` 执行幂等 DDL
   6. 捕获部署后 counts，禁止下降
   7. 健康检查 `/` 200 + `/api/jizi/match` 200

6. **报告结果** — 哪些 DDL 被执行了、备份状态、用户数据 counts、健康检查。

### DDL 书写规则（提醒 AI 写代码时遵守）

- 所有变更写在 `migrateSchema()` 里
- 用 `ALTER TABLE ADD COLUMN IF NOT EXISTS` / `CREATE INDEX IF NOT EXISTS`
- **列必须在前，索引在后**（错误顺序会导致 PG 42703 崩溃）

---

## 故障恢复指令

### 部署锁残留（部署被拒绝 "另一个部署正在进行"）
```bash
ssh xcx "rm -rf /opt/zi2anki/.deploy.lock"
```

### PM2 僵尸进程（端口 3001 被旧进程占用）
```bash
ssh xcx "sudo pkill -f 'tsx.*server/index'; sleep 2; pm2 restart zi2anki"
```

### 生产 DB 崩溃（服务起不来，PG 错误）
排查 DDL 顺序：
```bash
ssh xcx "PGPASSWORD="$(cat /opt/zi2anki/.db-password)" psql -h localhost -U zi2anki -d zi2anki -c 'SELECT * FROM pg_indexes WHERE tablename IN (''decks'',''cards'')'"
```

---

## 严禁操作

- ❌ `bash deploy.sh anki --sync` — 已禁用
- ❌ 本地 `pg_dump` 后恢复到生产
- ❌ 任何生产 `TRUNCATE`、批量删用户数据
- ❌ 不备份就执行 DB 写入
- ❌ 用 APKG 导入代替内容包部署
