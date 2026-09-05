import { Router, Request, Response } from 'express';
import { getDb, getUploadsDir } from '../db.js';
import { requireAdmin } from '../middleware/auth.js';
import multer from 'multer';
import crypto from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs';
import sharp from 'sharp';

export const marketplaceRouter = Router();

/** 上传封面图的 Multer 配置 */
const coverUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      cb(null, getUploadsDir());
    },
    filename: (_req, _file, cb) => {
      const uniqueName = `${crypto.randomUUID()}.jpg`;
      cb(null, uniqueName);
    },
  }),
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB
  // 不限制 MIME 类型 —— sharp 会做最终的格式检测
});

/** 生成 ISO 8601 时间戳 */
function nowISO(): string {
  return new Date().toISOString();
}

/** 本地日期 YYYY-MM-DD */
function todayLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// GET /api/marketplace/decks —— 列出市场牌组
// Query: ?style=&calligrapher=&search=
marketplaceRouter.get('/marketplace/decks', async (req: Request, res: Response) => {
  try {
    const db = getDb();
    const userId = req.user!.userId;
    const style = (req.query.style as string | undefined) || '';
    const calligrapher = (req.query.calligrapher as string | undefined) || '';
    const dynasty = (req.query.dynasty as string | undefined) || '';
    const search = (req.query.search as string | undefined) || '';

    let sql = `
      SELECT md.deck_id, md.calligrapher, md.dynasty, md.style, md.description,
             COALESCE(NULLIF(md.cover_thumb, ''), NULLIF(md.cover_image, ''), (
               SELECT image_url FROM cards
                 WHERE deck_id = md.deck_id AND image_url != '' ORDER BY created_at ASC LIMIT 1
             ), '') AS cover_image,
             md.featured, md.sort_order, md.published_at, md.created_at,
             d.name, d.card_count, d.daily_new_card_limit, d.daily_review_limit,
             EXISTS(SELECT 1 FROM user_subscriptions us WHERE us.user_id = $1 AND us.deck_id = md.deck_id) AS is_subscribed
      FROM marketplace_decks md
      JOIN decks d ON d.id = md.deck_id
      WHERE 1=1
      -- 上架口径（宁缺勿错）：YGSF 帖必须已通过 jizi 字图校验，未校验不在市场可见
      AND (d.source_key IS NULL OR d.source_key NOT LIKE 'ygsf:%' OR d.source_key IN (SELECT 'ygsf:' || zitie_id FROM jizi_verified))
    `;
    const params: unknown[] = [userId];
    let paramIndex = 1;

    if (style) {
      paramIndex = params.length + 1;
      sql += ` AND md.style LIKE '%' || $${paramIndex} || '%'`;
      params.push(style);
    }
    if (calligrapher) {
      paramIndex = params.length + 1;
      sql += ` AND md.calligrapher = $${paramIndex}`;
      params.push(calligrapher);
    }
    if (dynasty) {
      paramIndex = params.length + 1;
      sql += ` AND md.dynasty = $${paramIndex}`;
      params.push(dynasty);
    }
    if (search) {
      paramIndex = params.length + 1;
      sql += ` AND (d.name LIKE $${paramIndex} OR md.description LIKE $${paramIndex + 1} OR md.calligrapher LIKE $${paramIndex + 2})`;
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
         WHERE md.style <> '' GROUP BY 1 ORDER BY 2 DESC`,
      );
      const dynastyCounts = await db.query(
        `SELECT dynasty, COUNT(*)::int AS n
         FROM marketplace_decks WHERE dynasty <> '' GROUP BY 1 ORDER BY 2 DESC`,
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
    console.error('GET /marketplace/decks error:', err);
    res.status(500).json({ error: 'Failed to fetch marketplace decks' });
  }
});

// GET /api/marketplace/decks/:deckId —— 单个市场牌组详情
marketplaceRouter.get('/marketplace/decks/:deckId', async (req: Request, res: Response) => {
  try {
    const { deckId } = req.params;
    const db = getDb();
    const userId = req.user!.userId;

    const { rows } = await db.query(
      `SELECT md.deck_id, md.calligrapher, md.dynasty, md.style, md.description, md.cover_image, md.cover_thumb,
              md.featured, md.sort_order, md.published_at, md.created_at,
              d.name, d.card_count, d.daily_new_card_limit, d.daily_review_limit,
              EXISTS(SELECT 1 FROM user_subscriptions us WHERE us.user_id = $1 AND us.deck_id = md.deck_id) AS is_subscribed
       FROM marketplace_decks md
       JOIN decks d ON d.id = md.deck_id
       WHERE md.deck_id = $2`,
      [userId, deckId]
    );
    let row = rows[0] as Record<string, unknown> | undefined;

    if (!row) {
      res.status(404).json({ error: 'Marketplace deck not found' });
      return;
    }

    // 封面回退
    if (!row.cover_image) {
      const imgResult = await db.query(
        `SELECT image_url FROM cards WHERE deck_id = $1 AND image_url != '' AND archived_at IS NULL ORDER BY created_at ASC LIMIT 1`,
        [deckId]
      );
      if (imgResult.rows.length > 0) {
        row.cover_image = imgResult.rows[0].image_url;
      }
    }

    res.json(row);
  } catch (err) {
    console.error('GET /marketplace/decks/:deckId error:', err);
    res.status(500).json({ error: 'Failed to fetch marketplace deck' });
  }
});

// POST /api/marketplace/decks/:deckId/subscribe —— 订阅
marketplaceRouter.post('/marketplace/decks/:deckId/subscribe', async (req: Request, res: Response) => {
  try {
    const { deckId } = req.params;
    const db = getDb();
    const userId = req.user!.userId;

    // 验证牌组在市场中存在，且已通过上架校验（宁缺勿错：YGSF 帖必须已过 jizi 字图校验）
    const { rows: existsRows } = await db.query(
      `SELECT md.deck_id FROM marketplace_decks md
       JOIN decks d ON d.id = md.deck_id
       WHERE md.deck_id = $1 AND md.published_at IS NOT NULL
       AND (d.source_key IS NULL OR d.source_key NOT LIKE 'ygsf:%' OR d.source_key IN (SELECT 'ygsf:' || zitie_id FROM jizi_verified))`,
      [deckId]
    );
    if (existsRows.length === 0) {
      res.status(404).json({ error: '该帖未上架或未通过校验' });
      return;
    }

    await db.query(
      'INSERT INTO user_subscriptions (user_id, deck_id, subscribed_at) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
      [userId, deckId, nowISO()]
    );

    res.json({ success: true, deck_id: deckId });
  } catch (err) {
    console.error('POST /marketplace/decks/:deckId/subscribe error:', err);
    res.status(500).json({ error: 'Failed to subscribe' });
  }
});

// DELETE /api/marketplace/decks/:deckId/subscribe —— 退订（同时清理进度）
marketplaceRouter.delete('/marketplace/decks/:deckId/subscribe', async (req: Request, res: Response) => {
  try {
    const { deckId } = req.params;
    const db = getDb();
    const userId = req.user!.userId;

    const client = await db.connect();
    try {
      await client.query('BEGIN');
      await client.query('DELETE FROM user_subscriptions WHERE user_id = $1 AND deck_id = $2', [userId, deckId]);
      await client.query(
        `DELETE FROM user_card_progress WHERE user_id = $1
          AND card_id IN (SELECT id FROM cards WHERE deck_id = $2)`,
        [userId, deckId]
      );
      await client.query('COMMIT');
    } catch (txErr) {
      await client.query('ROLLBACK');
      throw txErr;
    } finally {
      client.release();
    }

    res.json({ success: true, deck_id: deckId });
  } catch (err) {
    console.error('DELETE /marketplace/decks/:deckId/subscribe error:', err);
    res.status(500).json({ error: 'Failed to unsubscribe' });
  }
});

// GET /api/marketplace/subscriptions —— 当前用户已订阅的市场牌组列表
marketplaceRouter.get('/marketplace/subscriptions', async (req: Request, res: Response) => {
  try {
    const db = getDb();
    const userId = req.user!.userId;
    const today = todayLocal();

    const { rows } = await db.query(
      `SELECT d.id, d.name, d.card_count, d.daily_new_card_limit, d.daily_review_limit,
              d.created_at, d.updated_at,
              md.calligrapher, md.dynasty, md.style, md.description, COALESCE(NULLIF(md.cover_thumb, ''), NULLIF(md.cover_image, '')) AS cover_image,
              us.subscribed_at,
              COALESCE((
                SELECT COUNT(*) FROM cards c
                  LEFT JOIN user_card_progress ucp ON ucp.user_id = $1 AND ucp.card_id = c.id
                  WHERE c.deck_id = d.id AND c.archived_at IS NULL AND (ucp.card_id IS NULL OR ucp.interval = 0)
              ), 0) AS new_count,
              COALESCE((
                SELECT new_cards_learned FROM daily_stats
                  WHERE user_id = $2 AND date = $3 AND deck_id = d.id
              ), 0) AS learned_today
       FROM user_subscriptions us
       JOIN decks d ON d.id = us.deck_id
       LEFT JOIN marketplace_decks md ON md.deck_id = us.deck_id
       WHERE us.user_id = $4
       ORDER BY us.subscribed_at DESC`,
      [userId, userId, today, userId]
    ) as { rows: Array<{
      id: string;
      name: string;
      card_count: number;
      daily_new_card_limit: number;
      daily_review_limit: number;
      created_at: string;
      updated_at: string;
      new_count: number;
      learned_today: number;
    }> };

    // 计算 new_available_today（与 GET /decks 一致的逻辑）
    const result = rows.map((d) => {
      const remainingByLimit = Math.max(0, d.daily_new_card_limit - (d.learned_today ?? 0));
      const newAvailableToday = Math.min(d.new_count, remainingByLimit);
      return { ...d, new_available_today: newAvailableToday };
    });

    res.json(result);
  } catch (err) {
    console.error('GET /marketplace/subscriptions error:', err);
    res.status(500).json({ error: 'Failed to fetch subscriptions' });
  }
});

// POST /api/marketplace/decks/:deckId/publish —— Admin 发布牌组到市场
marketplaceRouter.post('/marketplace/decks/:deckId/publish', requireAdmin, async (req: Request, res: Response) => {
  try {
    const { deckId } = req.params;
    const db = getDb();

    // 验证牌组存在
    const { rows: deckRows } = await db.query('SELECT id FROM decks WHERE id = $1', [deckId]);
    if (deckRows.length === 0) {
      res.status(404).json({ error: 'Deck not found' });
      return;
    }

    const {
      calligrapher = '',
      dynasty = '',
      style = '',
      description = '',
      cover_image = '',
      featured = 0,
    } = req.body;

    const now = nowISO();
    await db.query(
      `INSERT INTO marketplace_decks
        (deck_id, calligrapher, dynasty, style, description, cover_image, featured, sort_order, published_at, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 0, $8, $9)
       ON CONFLICT (deck_id) DO UPDATE SET
         calligrapher = COALESCE(NULLIF(EXCLUDED.calligrapher, ''), marketplace_decks.calligrapher),
         dynasty = COALESCE(NULLIF(EXCLUDED.dynasty, ''), marketplace_decks.dynasty),
         style = COALESCE(NULLIF(EXCLUDED.style, ''), marketplace_decks.style),
         description = COALESCE(NULLIF(EXCLUDED.description, ''), marketplace_decks.description),
         cover_image = COALESCE(NULLIF(EXCLUDED.cover_image, ''), marketplace_decks.cover_image),
         featured = EXCLUDED.featured,
         sort_order = EXCLUDED.sort_order,
         published_at = EXCLUDED.published_at,
         created_at = EXCLUDED.created_at`,
      [
        deckId,
        typeof calligrapher === 'string' ? calligrapher : '',
        typeof dynasty === 'string' ? dynasty : '',
        typeof style === 'string' ? style : '',
        typeof description === 'string' ? description : '',
        typeof cover_image === 'string' ? cover_image : '',
        typeof featured === 'boolean' ? (featured ? 1 : 0) : (typeof featured === 'number' ? (featured ? 1 : 0) : 0),
        now,
        now
      ]
    );

    const { rows } = await db.query('SELECT * FROM marketplace_decks WHERE deck_id = $1', [deckId]);
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error('POST /marketplace/decks/:deckId/publish error:', err);
    res.status(500).json({ error: 'Failed to publish deck' });
  }
});

// PUT /api/marketplace/decks/:deckId —— Admin 编辑市场元数据
marketplaceRouter.put('/marketplace/decks/:deckId', requireAdmin, async (req: Request, res: Response) => {
  try {
    const { deckId } = req.params;
    const db = getDb();

    const { rows: existingRows } = await db.query('SELECT deck_id FROM marketplace_decks WHERE deck_id = $1', [deckId]);
    if (existingRows.length === 0) {
      res.status(404).json({ error: 'Marketplace deck not found' });
      return;
    }

    const {
      calligrapher,
      dynasty,
      style,
      description,
      cover_image,
      featured,
      sort_order,
    } = req.body;

    const updates: string[] = [];
    const values: unknown[] = [];

    if (calligrapher !== undefined) {
      updates.push(`calligrapher = $${values.length + 1}`);
      values.push(typeof calligrapher === 'string' ? calligrapher : '');
    }
    if (dynasty !== undefined) {
      updates.push(`dynasty = $${values.length + 1}`);
      values.push(typeof dynasty === 'string' ? dynasty : '');
    }
    if (style !== undefined) {
      updates.push(`style = $${values.length + 1}`);
      values.push(typeof style === 'string' ? style : '');
    }
    if (description !== undefined) {
      updates.push(`description = $${values.length + 1}`);
      values.push(typeof description === 'string' ? description : '');
    }
    if (cover_image !== undefined) {
      updates.push(`cover_image = $${values.length + 1}`);
      values.push(typeof cover_image === 'string' ? cover_image : '');
    }
    if (featured !== undefined) {
      updates.push(`featured = $${values.length + 1}`);
      values.push(featured ? 1 : 0);
    }
    if (sort_order !== undefined) {
      updates.push(`sort_order = $${values.length + 1}`);
      values.push(typeof sort_order === 'number' ? sort_order : 0);
    }

    if (updates.length > 0) {
      const deckIdPlaceholder = `$${values.length + 1}`;
      values.push(deckId);
      await db.query(`UPDATE marketplace_decks SET ${updates.join(', ')} WHERE deck_id = ${deckIdPlaceholder}`, values);
    }

    const { rows } = await db.query('SELECT * FROM marketplace_decks WHERE deck_id = $1', [deckId]);
    res.json(rows[0]);
  } catch (err) {
    console.error('PUT /marketplace/decks/:deckId error:', err);
    res.status(500).json({ error: 'Failed to update marketplace deck' });
  }
});

// DELETE /api/marketplace/decks/:deckId/publish —— Admin 下架（软删除：仅清除发布时间，保留元数据）
marketplaceRouter.delete('/marketplace/decks/:deckId/publish', requireAdmin, async (req: Request, res: Response) => {
  try {
    const { deckId } = req.params;
    const db = getDb();

    const result = await db.query('UPDATE marketplace_decks SET published_at = NULL WHERE deck_id = $1', [deckId]);
    if (result.rowCount === 0) {
      res.status(404).json({ error: 'Marketplace deck not found' });
      return;
    }

    res.json({ success: true, deck_id: deckId });
  } catch (err) {
    console.error('DELETE /marketplace/decks/:deckId/publish error:', err);
    res.status(500).json({ error: 'Failed to unpublish deck' });
  }
});

// POST /api/marketplace/decks/:deckId/cover —— Admin 上传封面图（自动生成缩略图）
marketplaceRouter.post('/marketplace/decks/:deckId/cover', requireAdmin, (req: Request, res: Response, next: Function) => {
  // 手动调用 multer 以捕获错误
  coverUpload.single('cover')(req, res, (uploadErr: any) => {
    if (uploadErr) {
      if (uploadErr.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({ error: '图片大小不能超过 50MB' });
      }
      return res.status(400).json({ error: uploadErr.message || '上传失败' });
    }
    next();
  });
}, async (req: Request, res: Response) => {
  try {
    const { deckId } = req.params;
    if (!req.file) {
      res.status(400).json({ error: '请选择图片文件' });
      return;
    }

    // 用 sharp 生成封面图（最大宽度 400px，质量 80），输出到新文件
    const inputPath = path.join(getUploadsDir(), req.file.filename);
    const coverName = `${crypto.randomUUID()}.jpg`;
    const coverPath = path.join(getUploadsDir(), coverName);

    await sharp(inputPath)
      .resize(400, undefined, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 80 })
      .toFile(coverPath);

    // 生成缩略图（最大宽度 120px，质量 70）
    const thumbName = `${crypto.randomUUID()}.jpg`;
    const thumbPath = path.join(getUploadsDir(), thumbName);

    await sharp(inputPath)
      .resize(120, undefined, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 70 })
      .toFile(thumbPath);

    // 删除原始上传文件（Windows 可能锁文件，失败不阻塞）
    try { fs.unlinkSync(inputPath); } catch { /* ignore */ }

    const db = getDb();
    const coverImagePath = `/uploads/${coverName}`;
    const coverThumbPath = `/uploads/${thumbName}`;
    await db.query(
      'UPDATE marketplace_decks SET cover_image = $1, cover_thumb = $2 WHERE deck_id = $3',
      [coverImagePath, coverThumbPath, deckId]
    );

    res.json({ success: true, cover_image: coverImagePath });
  } catch (err: any) {
    console.error('POST /marketplace/decks/:deckId/cover error:', err?.message || err);
    console.error('POST /marketplace/decks/:deckId/cover file:', req.file?.originalname, 'size:', req.file?.size);
    res.status(500).json({ error: 'Failed to upload cover' });
  }
});
