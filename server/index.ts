import express from 'express';
import cors from 'cors';
import compression from 'compression';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { getDb, waitForDb } from './db.js';
import { authRouter } from './routes/auth.js';
import { authMiddleware, JWT_SECRET } from './middleware/auth.js';
import jwt from 'jsonwebtoken';
import { decksRouter } from './routes/decks.js';
import { cardsRouter } from './routes/cards.js';
import { studyRouter } from './routes/study.js';
import { analyticsRouter } from './routes/analytics.js';
import { exportRouter } from './routes/export.js';
import { importRouter } from './routes/import.js';
import { marketplaceRouter } from './routes/marketplace.js';
import { jiziRouter } from './routes/jizi.js';
import { adminRouter } from './routes/admin.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
const PORT = process.env.PORT || 3001;

// 中间件
app.use(cors());
app.use(compression()); // gzip 压缩所有 JSON 响应
app.use(express.json({ limit: '50mb' }));

// 静态文件服务 —— uploads 目录（项目根目录）
// 启用浏览器缓存：图片不可变，缓存 7 天，immutable 标记
app.use('/uploads', express.static(path.join(__dirname, '..', 'uploads'), {
  maxAge: '7d',
  immutable: true,
  etag: true,
  lastModified: true,
}));

// 挂载 auth 路由（不需要鉴权）
app.use('/api/auth', authRouter);

// 公开预览端点（市场牌组卡片预览，无需登录）
// 仅暴露已发布到市场的牌组，避免泄露私有/未发布牌组内容。
app.get('/api/decks/:deckId/cards/preview', async (req, res) => {
  try {
    const { deckId } = req.params;
    const db = getDb();
    const { rows } = await db.query(
      `SELECT c.front_text, c.image_url
       FROM cards c
       JOIN marketplace_decks md ON md.deck_id = c.deck_id
       WHERE c.deck_id = $1 AND md.published_at IS NOT NULL AND c.archived_at IS NULL
       ORDER BY c.created_at ASC
       LIMIT 50`,
      [deckId]
    );
    res.json({ cards: rows });
  } catch (err) {
    console.error('GET /decks/:deckId/cards/preview error:', err);
    res.status(500).json({ error: 'Failed to fetch card previews' });
  }
});

// 公开路由：集字（无需登录，必须在 authMiddleware 之前注册）
app.use('/api/jizi', jiziRouter);

// 公开路由：市场牌组列表（无需登录，可选已登录态用于 is_subscribed）
app.get('/api/marketplace/decks', async (req, res) => {
  try {
    const db = getDb();
    const style = (req.query.style as string | undefined) || '';
    const calligrapher = (req.query.calligrapher as string | undefined) || '';
    const dynasty = (req.query.dynasty as string | undefined) || '';
    const search = (req.query.search as string | undefined) || '';

    // 尝试从 Authorization header 获取用户信息（不强制）
    let userId: string | null = null;
    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith('Bearer ')) {
      try {
        const payload = jwt.verify(authHeader.slice(7), JWT_SECRET) as { userId: string };
        userId = payload.userId;
      } catch { /* 静默忽略无效 token */ }
    }

    let sql = `
      SELECT md.deck_id, md.calligrapher, md.dynasty, md.style, md.description,
             COALESCE(NULLIF(md.cover_thumb, ''), NULLIF(md.cover_image, ''), (
               SELECT image_url FROM cards
                 WHERE deck_id = md.deck_id AND image_url != '' ORDER BY created_at ASC LIMIT 1
             ), '') AS cover_image,
             md.featured, md.sort_order, md.published_at, md.created_at,
             d.name, d.card_count, d.daily_new_card_limit, d.daily_review_limit
    `;
    if (userId) {
      sql += `, EXISTS(SELECT 1 FROM user_subscriptions us WHERE us.user_id = $1 AND us.deck_id = md.deck_id) AS is_subscribed`;
    } else {
      sql += `, false AS is_subscribed`;
    }
    sql += `
      FROM marketplace_decks md
      JOIN decks d ON d.id = md.deck_id
      WHERE md.published_at IS NOT NULL
    `;
    const params: unknown[] = userId ? [userId] : [];

    if (style) {
      sql += ` AND md.style LIKE '%' || $${params.length + 1} || '%'`;
      params.push(style);
    }
    if (calligrapher) {
      sql += ` AND md.calligrapher = $${params.length + 1}`;
      params.push(calligrapher);
    }
    if (dynasty) {
      sql += ` AND md.dynasty = $${params.length + 1}`;
      params.push(dynasty);
    }
    if (search) {
      sql += ` AND (d.name LIKE $${params.length + 1} OR md.description LIKE $${params.length + 2} OR md.calligrapher LIKE $${params.length + 3})`;
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }
    sql += ' ORDER BY md.featured DESC, md.sort_order ASC, md.published_at DESC';

    // 分页：?limit=&offset= 时返回 { total, calligraphers, decks }，否则兼容旧的全量数组
    const limitRaw = req.query.limit ? parseInt(req.query.limit as string, 10) || 0 : 0;
    if (limitRaw > 0) {
      const offset = parseInt(req.query.offset as string, 10) || 0;
      const countRes = await db.query(`SELECT COUNT(*)::int AS n FROM (${sql}) t`, params);
      const facets = await db.query(
        `SELECT DISTINCT calligrapher FROM marketplace_decks WHERE calligrapher <> '' ORDER BY calligrapher`,
      );
      const styleCounts = await db.query(
        `SELECT trim(s.s) AS style, COUNT(*)::int AS n
         FROM marketplace_decks md, unnest(string_to_array(md.style, ',')) AS s(s)
         WHERE md.published_at IS NOT NULL AND md.style <> '' GROUP BY 1 ORDER BY 2 DESC`,
      );
      const dynastyCounts = await db.query(
        `SELECT dynasty, COUNT(*)::int AS n
         FROM marketplace_decks WHERE published_at IS NOT NULL AND dynasty <> '' GROUP BY 1 ORDER BY 2 DESC`,
      );
      const paged = `${sql} LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
      const { rows } = await db.query(paged, [...params, limitRaw, offset]);
      res.json({
        total: countRes.rows[0]?.n ?? rows.length,
        calligraphers: facets.rows.map((r: any) => r.calligrapher),
        styleCounts: styleCounts.rows,
        dynastyCounts: dynastyCounts.rows,
        decks: rows,
      });
      return;
    }

    const { rows } = await db.query(sql, params);
    res.json(rows);
  } catch (err) {
    console.error('GET /marketplace/decks (public) error:', err);
    res.status(500).json({ error: 'Failed to fetch marketplace decks' });
  }
});

app.get('/api/marketplace/decks/:deckId', async (req, res) => {
  try {
    const { deckId } = req.params;
    const db = getDb();

    let userId: string | null = null;
    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith('Bearer ')) {
      try {
        const payload = jwt.verify(authHeader.slice(7), JWT_SECRET) as { userId: string };
        userId = payload.userId;
      } catch { /* 静默忽略 */ }
    }

    const sql = `SELECT md.deck_id, md.calligrapher, md.dynasty, md.style, md.description, md.cover_image, md.cover_thumb,
              md.featured, md.sort_order, md.published_at, md.created_at,
              d.name, d.card_count, d.daily_new_card_limit, d.daily_review_limit
              ${userId ? `, EXISTS(SELECT 1 FROM user_subscriptions us WHERE us.user_id = $1 AND us.deck_id = md.deck_id) AS is_subscribed` : ', false AS is_subscribed'}
       FROM marketplace_decks md
       JOIN decks d ON d.id = md.deck_id
       WHERE md.deck_id = ${userId ? '$2' : '$1'} AND md.published_at IS NOT NULL`;

    const params = userId ? [userId, deckId] : [deckId];
    const { rows } = await db.query(sql, params);
    if (rows.length === 0) {
      res.status(404).json({ error: 'Marketplace deck not found' });
      return;
    }
    res.json(rows[0]);
  } catch (err) {
    console.error('GET /marketplace/decks/:deckId (public) error:', err);
    res.status(500).json({ error: 'Failed to fetch marketplace deck' });
  }
});

// JWT 鉴权中间件（之后的所有 /api/* 都需要鉴权）
app.use('/api', authMiddleware);

// 挂载业务路由（已经在中间件之后）
app.use('/api', decksRouter);
app.use('/api', cardsRouter);
app.use('/api', studyRouter);
app.use('/api', analyticsRouter);
app.use('/api', exportRouter);
app.use('/api', importRouter);
app.use('/api', marketplaceRouter);
app.use('/api', adminRouter);

// 生产模式：托管前端构建产物
const distDir = path.join(__dirname, '..', 'dist');
if (fs.existsSync(distDir)) {
  // hashed 资源文件（带内容 hash，永久缓存）
  app.use('/assets', express.static(path.join(distDir, 'assets'), {
    maxAge: '1y',
    immutable: true,
    etag: true,
    lastModified: true,
  }));
  // 其他静态文件（不含 hash，走 ETag 协商缓存）
  // index.html 设置 no-cache：确保浏览器总是获取最新版本，避免旧 index.html
  // 引用已不存在的 hash 文件导致白屏。
  app.use(express.static(distDir, {
    setHeaders: (res, filePath) => {
      if (path.basename(filePath) === 'index.html') {
        res.setHeader('Cache-Control', 'no-cache');
      }
    },
  }));
  // SPA fallback：所有非 /api 路由返回 index.html
  app.get(/^\/(?!api|uploads|assets)/, (_req, res) => {
    res.sendFile(path.join(distDir, 'index.html'));
  });
  console.log(`[生产模式] 前端托管于 ${distDir}`);
} else {
  console.log('[开发模式] 前端请用 npx vite 启动');
}

// 全局错误处理
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: err.message || 'Internal server error' });
});

// 启动
app.listen(PORT, async () => {
  try {
    await waitForDb();
    console.log(`[数据库] PostgreSQL 初始化完成`);
  } catch (err) {
    console.error('[数据库] 启动失败:', err);
    process.exit(1);
  }
  console.log(`Server running on http://localhost:${PORT}`);
});

export default app;
