import pkg from 'pg';
const { Pool } = pkg;
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let pool: pkg.Pool | null = null;
let initPromise: Promise<void> | null = null;

/** 获取 PG 连接池（单例），首次调用时触发异步初始化 */
export function getDb(): pkg.Pool {
  if (pool) return pool;

  pool = new Pool({
    host: process.env.PG_HOST || 'localhost',
    port: parseInt(process.env.PG_PORT || '5432', 10),
    database: process.env.PG_DATABASE || 'zi2anki',
    user: process.env.PG_USER || 'zi2anki',
    password: process.env.PG_PASSWORD || 'zi2anki_pg_2026',
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
  });

  initPromise = initDb().catch((err) => {
    console.error('[db] 数据库初始化失败:', err);
    throw err;
  });

  return pool;
}

/** 等待数据库初始化完成（服务启动时调用） */
export async function waitForDb(): Promise<void> {
  getDb();
  if (initPromise) await initPromise;
}

/** 异步数据库初始化：建表 + 迁移 + 创建管理员 */
async function initDb(): Promise<void> {
  const db = pool!;

  // 建表
  // 注意：建表语句在单条 query 内按顺序执行，被 REFERENCES 引用的表必须先创建。
  // users 被几乎所有表引用，必须最先建；decks 次之；cards 再次。
  await db.query(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT DEFAULT 'user',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS decks (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      card_count INTEGER DEFAULT 0,
      daily_new_card_limit INTEGER DEFAULT 20,
      daily_review_limit INTEGER DEFAULT 200,
      user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      article_text TEXT DEFAULT '',
      study_mode TEXT DEFAULT 'default',
      source_key TEXT DEFAULT '',
      content_version INTEGER DEFAULT 1,
      paused_at TEXT DEFAULT NULL
    );

    CREATE TABLE IF NOT EXISTS cards (
      id TEXT PRIMARY KEY,
      deck_id TEXT NOT NULL REFERENCES decks(id) ON DELETE CASCADE,
      front_text TEXT NOT NULL,
      back_text TEXT DEFAULT '',
      image_url TEXT DEFAULT '',
      ease REAL DEFAULT 2.5,
      interval INTEGER DEFAULT 0,
      repetitions INTEGER DEFAULT 0,
      next_review TEXT NOT NULL,
      last_review TEXT,
      user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      sort_order INTEGER DEFAULT 0,
      source_key TEXT DEFAULT '',
      archived_at TEXT DEFAULT NULL
    );

    CREATE TABLE IF NOT EXISTS study_sessions (
      id TEXT PRIMARY KEY,
      deck_id TEXT NOT NULL REFERENCES decks(id) ON DELETE CASCADE,
      user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      started_at TEXT NOT NULL,
      ended_at TEXT,
      cards_studied INTEGER DEFAULT 0,
      ratings_again INTEGER DEFAULT 0,
      ratings_hard INTEGER DEFAULT 0,
      ratings_good INTEGER DEFAULT 0,
      ratings_easy INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS daily_stats (
      date TEXT NOT NULL,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      deck_id TEXT NOT NULL DEFAULT '',
      cards_studied INTEGER DEFAULT 0,
      new_cards_learned INTEGER DEFAULT 0,
      PRIMARY KEY (date, user_id, deck_id)
    );

    CREATE TABLE IF NOT EXISTS marketplace_decks (
      deck_id TEXT PRIMARY KEY REFERENCES decks(id) ON DELETE CASCADE,
      calligrapher TEXT DEFAULT '',
      dynasty TEXT DEFAULT '',
      style TEXT DEFAULT '',
      description TEXT DEFAULT '',
      cover_image TEXT DEFAULT '',
      featured INTEGER DEFAULT 0,
      sort_order INTEGER DEFAULT 0,
      published_at TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS user_card_progress (
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      card_id TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
      ease REAL DEFAULT 2.5,
      interval INTEGER DEFAULT 0,
      repetitions INTEGER DEFAULT 0,
      next_review TEXT NOT NULL,
      last_review TEXT,
      PRIMARY KEY (user_id, card_id)
    );

    CREATE TABLE IF NOT EXISTS user_subscriptions (
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      deck_id TEXT NOT NULL REFERENCES decks(id) ON DELETE CASCADE,
      subscribed_at TEXT NOT NULL,
      PRIMARY KEY (user_id, deck_id)
    );

    CREATE TABLE IF NOT EXISTS jizi_history (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      text TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);

  // 索引
  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_cards_deck ON cards(deck_id);
    CREATE INDEX IF NOT EXISTS idx_cards_created ON cards(created_at);
    CREATE INDEX IF NOT EXISTS idx_ucp_user_due ON user_card_progress(user_id, next_review, interval);
    CREATE INDEX IF NOT EXISTS idx_ucp_user_card ON user_card_progress(card_id);
    CREATE INDEX IF NOT EXISTS idx_daily_stats_user_date ON daily_stats(user_id, date);
    CREATE INDEX IF NOT EXISTS idx_sessions_user_started ON study_sessions(user_id, started_at);
    CREATE INDEX IF NOT EXISTS idx_sessions_deck ON study_sessions(deck_id);
    CREATE INDEX IF NOT EXISTS idx_subs_user ON user_subscriptions(user_id);
    CREATE INDEX IF NOT EXISTS idx_subs_deck ON user_subscriptions(deck_id);
    CREATE INDEX IF NOT EXISTS idx_jizi_history_user_created ON jizi_history(user_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_market_featured ON marketplace_decks(featured, sort_order);
    CREATE INDEX IF NOT EXISTS idx_decks_user ON decks(user_id);
    CREATE UNIQUE INDEX IF NOT EXISTS one_admin ON users ((role)) WHERE role = 'admin';
  `);

  // 数据字典迁移：如果本地新增了列，这里用 IF NOT EXISTS 同步到线上
  // 规则：只同步结构（DDL），不同步数据（DML）。数据永远以线上为准。
  await migrateSchema(db);

  console.log('[db] 数据库初始化完成');
}

/**
 * 数据字典迁移。
 * 本地改了表结构（新增列等）后，通过这里同步到线上。
 * 使用 ALTER TABLE ADD COLUMN IF NOT EXISTS 确保幂等。
 * 只改 DDL，不改 DML —— 数据永远以线上为准。
 */
async function migrateSchema(db: pkg.Pool): Promise<void> {
  // 为已有数据库（旧建表语句无 FK）补充外键约束
  // 新部署的建表语句已自带 REFERENCES，CREATE TABLE IF NOT EXISTS 对已存在的表无效
  const fkMigrations = [
    `ALTER TABLE decks ADD CONSTRAINT fk_decks_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL`,
    `ALTER TABLE cards ADD CONSTRAINT fk_cards_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL`,
    `ALTER TABLE study_sessions ADD CONSTRAINT fk_sessions_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL`,
    `ALTER TABLE daily_stats ADD CONSTRAINT fk_dailystats_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE`,
    `ALTER TABLE user_card_progress ADD CONSTRAINT fk_ucp_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE`,
    `ALTER TABLE user_subscriptions ADD CONSTRAINT fk_subs_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE`,
    `ALTER TABLE user_subscriptions ADD CONSTRAINT fk_subs_deck FOREIGN KEY (deck_id) REFERENCES decks(id) ON DELETE CASCADE`,
  ];
  for (const sql of fkMigrations) {
    try { await db.query(sql); } catch { /* 已存在则忽略 */ }
  }

  // 列迁移：decks.article_text + cards.sort_order + decks.study_mode + marketplace_decks.cover_thumb
  try { await db.query(`ALTER TABLE decks ADD COLUMN IF NOT EXISTS article_text TEXT DEFAULT ''`); } catch { /* ignore */ }
  try { await db.query(`ALTER TABLE cards ADD COLUMN IF NOT EXISTS sort_order INTEGER DEFAULT 0`); } catch { /* ignore */ }
  try { await db.query(`ALTER TABLE decks ADD COLUMN IF NOT EXISTS study_mode TEXT DEFAULT 'default'`); } catch { /* ignore */ }
  try { await db.query(`ALTER TABLE decks ADD COLUMN IF NOT EXISTS source_key TEXT DEFAULT ''`); } catch { /* ignore */ }
  try { await db.query(`ALTER TABLE decks ADD COLUMN IF NOT EXISTS content_version INTEGER DEFAULT 1`); } catch { /* ignore */ }
  try { await db.query(`ALTER TABLE cards ADD COLUMN IF NOT EXISTS source_key TEXT DEFAULT ''`); } catch { /* ignore */ }
  try { await db.query(`ALTER TABLE cards ADD COLUMN IF NOT EXISTS archived_at TEXT DEFAULT NULL`); } catch { /* ignore */ }
  try { await db.query(`ALTER TABLE decks ADD COLUMN IF NOT EXISTS paused_at TEXT DEFAULT NULL`); } catch { /* ignore */ }
  try { await db.query(`CREATE INDEX IF NOT EXISTS idx_cards_sort_order ON cards(deck_id, sort_order)`); } catch { /* ignore */ }
  try { await db.query(`CREATE INDEX IF NOT EXISTS idx_decks_source_key ON decks(source_key)`); } catch { /* ignore */ }
  try { await db.query(`CREATE INDEX IF NOT EXISTS idx_cards_source_key ON cards(source_key)`); } catch { /* ignore */ }
  try { await db.query(`CREATE INDEX IF NOT EXISTS idx_cards_archived ON cards(archived_at)`); } catch { /* ignore */ }
  try { await db.query(`ALTER TABLE marketplace_decks ADD COLUMN IF NOT EXISTS cover_thumb TEXT DEFAULT ''`); } catch { /* ignore */ }

  // YGSF 远程字库映射表（glyph_id → 远程直链 + 本地缓存路径），供 ygsf-sync.ts 混合机制使用
  try {
    await db.query(`CREATE TABLE IF NOT EXISTS ygsf_images (
      glyph_id TEXT PRIMARY KEY,
      zitie_id TEXT DEFAULT '',
      hanzi TEXT DEFAULT '',
      remote_url TEXT DEFAULT '',
      local_path TEXT DEFAULT NULL,
      cached_at TEXT DEFAULT NULL
    )`);
  } catch { /* ignore */ }
  try { await db.query(`CREATE INDEX IF NOT EXISTS idx_ygsf_images_zitie ON ygsf_images(zitie_id)`); } catch { /* ignore */ }

  // YGSF 作品目录表（扫描候选池，imported_deck_id 标记已建库，batch_status 标记批量导入跳过原因）
  try {
    await db.query(`CREATE TABLE IF NOT EXISTS ygsf_zuopin (
      zuopin_id TEXT PRIMARY KEY,
      name TEXT DEFAULT '',
      author TEXT DEFAULT '',
      cover_url TEXT DEFAULT '',
      zitie_id TEXT DEFAULT '',
      style TEXT DEFAULT '',
      imported_deck_id TEXT DEFAULT NULL,
      scanned_at TEXT DEFAULT NULL,
      batch_status TEXT DEFAULT ''
    )`);
  } catch { /* ignore */ }
  try { await db.query(`ALTER TABLE ygsf_zuopin ADD COLUMN IF NOT EXISTS batch_status TEXT DEFAULT ''`); } catch { /* ignore */ }
}

/** 上传目录的绝对路径（项目根目录下的 uploads/） */
export function getUploadsDir(): string {
  return path.join(__dirname, '..', 'uploads');
}
