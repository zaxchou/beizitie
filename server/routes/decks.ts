import { Router, Request, Response } from 'express';
import { getDb, getUploadsDir } from '../db.js';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { requireAdmin } from '../middleware/auth.js';

export const decksRouter = Router();

/** 生成 ISO 8601 时间戳 */
function nowISO(): string {
  return new Date().toISOString();
}

/** 本地日期 YYYY-MM-DD（参考 useDashboardStats 写法） */
function todayLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** 生成 UUID */
function uuid(): string {
  return crypto.randomUUID();
}

// GET /api/decks —— 获取牌组列表
// ?subscribed=1 仅返回已订阅/拥有的牌组（用于仪表盘）；否则管理员看全部，普通用户看自己的 + 已订阅的
decksRouter.get('/decks', async (req: Request, res: Response) => {
  try {
    const db = getDb();
    const userId = req.user!.userId;
    const isAdmin = req.user!.role === 'admin';
    const subscribedOnly = req.query.subscribed === '1';
    const today = todayLocal();
    const now = nowISO();

    // 参数构建辅助：push 一个值并返回其占位符（$N），避免手动维护编号
    const params: unknown[] = [];
    const p = (v: unknown) => `$${params.push(v)}`;

    // 所有每牌组派生字段（new_count / due_count / 今日已学 / 封面回退）
    // 全部用相关子查询在 SQL 端一次性算出，消除原先 Promise.all 中的 2N 次查询。
    const newCountP = p(userId);
    const dueUserP = p(userId);
    const dueNowP = p(now);
    const learnedUserP = p(userId);
    const learnedDateP = p(today);
    const usJoinP = p(userId);

    let whereClause: string;
    if (subscribedOnly) {
      whereClause = `us.user_id = ${p(userId)}`;
    } else {
      const ownerP = p(userId);
      const subP = p(userId);
      const adminP = p(isAdmin);
      whereClause = `(d.user_id = ${ownerP} OR us.user_id = ${subP} OR ${adminP})`;
    }

    const { rows } = await db.query(
      `SELECT DISTINCT d.id, d.name, d.card_count, d.daily_new_card_limit, d.daily_review_limit, d.created_at, d.updated_at,
        d.article_text, d.study_mode, d.paused_at,
        md.published_at,
        COALESCE(md.cover_thumb, md.cover_image, (
          SELECT image_url FROM cards
            WHERE deck_id = d.id AND image_url != '' AND archived_at IS NULL ORDER BY created_at ASC LIMIT 1
        ), '') AS cover_image,
        COALESCE((
          SELECT COUNT(*)::int FROM cards c
            LEFT JOIN user_card_progress ucp ON ucp.user_id = ${newCountP} AND ucp.card_id = c.id
            WHERE c.deck_id = d.id AND c.archived_at IS NULL AND (ucp.card_id IS NULL OR ucp.interval = 0)
        ), 0) AS new_count,
        COALESCE((
          SELECT COUNT(*)::int FROM cards c
            INNER JOIN user_card_progress ucp ON ucp.card_id = c.id AND ucp.user_id = ${dueUserP}
            WHERE c.deck_id = d.id AND c.archived_at IS NULL AND ucp.interval > 0 AND ucp.next_review <= ${dueNowP}
        ), 0) AS due_count,
        COALESCE((
          SELECT new_cards_learned FROM daily_stats
            WHERE user_id = ${learnedUserP} AND date = ${learnedDateP} AND deck_id = d.id
        ), 0) AS learned_today
        FROM decks d
        LEFT JOIN marketplace_decks md ON md.deck_id = d.id
        LEFT JOIN user_subscriptions us ON us.deck_id = d.id AND us.user_id = ${usJoinP}
        WHERE ${whereClause}
        ORDER BY d.created_at DESC`,
      params
    );
    const rawRows = rows as Array<{
      id: string;
      name: string;
      card_count: number;
      daily_new_card_limit: number;
      daily_review_limit: number;
      new_count: number;
      due_count: number;
      learned_today: number;
      cover_image: string | null;
      published_at: string | null;
      created_at: string;
      updated_at: string;
    }>;

    // 今日可学新卡 = min(牌组 new_count, daily_new_card_limit - 今日已学)
    const result = rawRows.map((d) => {
      const remainingByLimit = Math.max(0, d.daily_new_card_limit - (d.learned_today ?? 0));
      const newAvailableToday = Math.min(d.new_count, remainingByLimit);
      return { ...d, new_available_today: newAvailableToday, cover_image: d.cover_image || '' };
    });

    res.json(result);
  } catch (err) {
    console.error('GET /decks error:', err);
    res.status(500).json({ error: 'Failed to fetch decks' });
  }
});

// POST /api/decks —— 创建牌组
decksRouter.post('/decks', requireAdmin, async (req: Request, res: Response) => {
  try {
    const { name } = req.body;
    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      res.status(400).json({ error: 'Name is required' });
      return;
    }

    const db = getDb();
    const id = uuid();
    const now = nowISO();

    await db.query(
      'INSERT INTO decks (id, name, card_count, daily_new_card_limit, daily_review_limit, created_at, updated_at, user_id) VALUES ($1, $2, 0, 20, 200, $3, $4, $5)',
      [id, name.trim(), now, now, req.user!.userId]
    );

    const deckResult = await db.query('SELECT id, name, card_count, daily_new_card_limit, daily_review_limit, created_at, updated_at FROM decks WHERE id = $1', [id]);
    res.status(201).json(deckResult.rows[0]);
  } catch (err) {
    console.error('POST /decks error:', err);
    res.status(500).json({ error: 'Failed to create deck' });
  }
});

// PUT /api/decks/:id —— 更新牌组名称（仅管理员可改内容）
decksRouter.put('/decks/:id', requireAdmin, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { name } = req.body;

    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      res.status(400).json({ error: 'Name is required' });
      return;
    }

    const db = getDb();
    const now = nowISO();
    await db.query('UPDATE decks SET name = $1, updated_at = $2 WHERE id = $3', [name.trim(), now, id]);

    const deckResult = await db.query('SELECT id, name, card_count, daily_new_card_limit, daily_review_limit, created_at, updated_at FROM decks WHERE id = $1', [id]);
    res.json(deckResult.rows[0]);
  } catch (err) {
    console.error('PUT /decks/:id error:', err);
    res.status(500).json({ error: 'Failed to update deck' });
  }
});

// DELETE /api/decks/:id —— 删除牌组（级联删除卡片和图片文件，仅管理员）
decksRouter.delete('/decks/:id', requireAdmin, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const db = getDb();

    const existing = (await db.query('SELECT id FROM decks WHERE id = $1', [id])).rows[0];
    if (!existing) {
      res.status(404).json({ error: 'Deck not found' });
      return;
    }

    const client = await db.connect();
    try {
      await client.query('BEGIN');

      // 删除图片文件
      const cards = (await client.query('SELECT image_url FROM cards WHERE deck_id = $1', [id])).rows as Array<{ image_url: string }>;
      const uploadsDir = getUploadsDir();
      for (const card of cards) {
        if (card.image_url) {
          const filename = card.image_url.replace('/uploads/', '');
          const filePath = path.join(uploadsDir, filename);
          try { fs.unlinkSync(filePath); } catch { /* 文件可能已不存在 */ }
        }
      }

      await client.query('DELETE FROM daily_stats WHERE deck_id = $1', [id]);
      await client.query('DELETE FROM marketplace_decks WHERE deck_id = $1', [id]);
      await client.query('DELETE FROM user_subscriptions WHERE deck_id = $1', [id]);
      await client.query(
        'DELETE FROM user_card_progress WHERE card_id IN (SELECT id FROM cards WHERE deck_id = $1)',
        [id]
      );
      await client.query('DELETE FROM study_sessions WHERE deck_id = $1', [id]);
      await client.query('DELETE FROM cards WHERE deck_id = $1', [id]);
      await client.query('DELETE FROM decks WHERE id = $1', [id]);

      await client.query('COMMIT');

      // 删除后清理孤儿文件（独立 try/catch，不因清理失败导致 500）
      try {
        const allFiles = fs.readdirSync(uploadsDir).filter(f => f !== '.gitkeep');
        const now = Date.now();
        const GRACE_MS = 10_000; // 10 秒内写入的文件跳过（防止与并发导入竞态）
        const usedFiles = new Set(
          (await db.query('SELECT image_url FROM cards WHERE image_url != \'\'')).rows
            .map((r: any) => r.image_url.replace('/uploads/', ''))
        );
        (await db.query('SELECT cover_image, cover_thumb FROM marketplace_decks WHERE cover_image != \'\' OR cover_thumb != \'\'')).rows
          .forEach((r: any) => {
            if (r.cover_image) usedFiles.add(r.cover_image.replace('/uploads/', ''));
            if (r.cover_thumb) usedFiles.add(r.cover_thumb.replace('/uploads/', ''));
          });
        let orphanCount = 0;
        for (const f of allFiles) {
          if (!usedFiles.has(f)) {
            const fp = path.join(uploadsDir, f);
            // 跳过刚写入的文件（并发导入可能尚未 INSERT）
            try {
              const stat = fs.statSync(fp);
              if (now - stat.mtimeMs < GRACE_MS) continue;
            } catch { /* 文件不存在则跳过 */ continue; }
            try { fs.unlinkSync(fp); orphanCount++; } catch { /* ignore */ }
          }
        }
        if (orphanCount > 0) console.log(`[decks] 清理 ${orphanCount} 个孤儿图片文件`);
      } catch (cleanupErr) {
        console.error('[decks] 孤儿文件清理失败（不影响删除操作）:', cleanupErr);
      }
    } catch (txErr) {
      await client.query('ROLLBACK');
      throw txErr;
    } finally {
      client.release();
    }

    res.json({ success: true });
  } catch (err) {
    console.error('DELETE /decks/:id error:', err);
    res.status(500).json({ error: 'Failed to delete deck' });
  }
});

// PUT /api/decks/:id/card-count —— 更新卡片计数
// PUT /api/decks/:id/card-count —— 更新卡片计数（仅管理员可改内容；前端未使用）
decksRouter.put('/decks/:id/card-count', requireAdmin, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { count } = req.body;

    if (typeof count !== 'number' || count < 0) {
      res.status(400).json({ error: 'Valid count is required' });
      return;
    }

    const db = getDb();
    const now = nowISO();
    await db.query('UPDATE decks SET card_count = $1, updated_at = $2 WHERE id = $3', [count, now, id]);

    const deckResult = await db.query('SELECT id, name, card_count, daily_new_card_limit, daily_review_limit, created_at, updated_at FROM decks WHERE id = $1', [id]);
    res.json(deckResult.rows[0]);
  } catch (err) {
    console.error('PUT /decks/:id/card-count error:', err);
    res.status(500).json({ error: 'Failed to update card count' });
  }
});

// PUT /api/decks/:id/reset-progress —— 重置牌组所有卡片到初始状态
// 安全保护：有已学卡片（interval > 0）时必须传 ?force=1 才能执行
decksRouter.put('/decks/:id/reset-progress', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const force = req.query.force === '1';
    const db = getDb();
    const isAdmin = req.user!.role === 'admin';

    const existing = (await db.query(
      'SELECT id FROM decks WHERE id = $1 AND (user_id = $2 OR $3 OR id IN (SELECT deck_id FROM user_subscriptions WHERE user_id = $2))',
      [id, req.user!.userId, isAdmin]
    )).rows[0];
    if (!existing) {
      res.status(404).json({ error: 'Deck not found' });
      return;
    }

    // 安全保护：有已学卡片（interval > 0）则需 force=1 确认
    if (!force) {
      const { rows: hasLearned } = await db.query(
        `SELECT 1 FROM user_card_progress
         WHERE user_id = $1 AND card_id IN (SELECT id FROM cards WHERE deck_id = $2) AND interval > 0
         LIMIT 1`,
        [req.user!.userId, id]
      );
      if (hasLearned.length > 0) {
        res.status(409).json({
          error: '该牌组已有学习进度，如需重置请使用 force=1',
          hint: 'force=true',
        });
        return;
      }
    }

    const now = nowISO();
    const deleteResult = await db.query(
      `DELETE FROM user_card_progress
       WHERE user_id = $1
         AND card_id IN (SELECT id FROM cards WHERE deck_id = $2)`,
      [req.user!.userId, id]
    );

    await db.query(
      `UPDATE cards SET ease = 2.5, interval = 0, repetitions = 0,
                        next_review = $1, last_review = NULL, updated_at = $2
       WHERE deck_id = $3`,
      [now, now, id]
    );

    // 重置 deck 自身的学习上限到默认值（新牌组状态）
    await db.query(
      `UPDATE decks SET daily_new_card_limit = 20, daily_review_limit = 200, updated_at = $1
       WHERE id = $2`,
      [now, id]
    );

    const today = new Date();
    const dateStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    await db.query('DELETE FROM daily_stats WHERE user_id = $1 AND date = $2 AND deck_id = $3', [req.user!.userId, dateStr, id]);

    res.json({ success: true, reset_count: deleteResult.rowCount });
  } catch (err) {
    console.error('PUT /decks/:id/reset-progress error:', err);
    res.status(500).json({ error: 'Failed to reset progress' });
  }
});

// PUT /api/decks/:id/limits —— 更新牌组学习上限
decksRouter.put('/decks/:id/limits', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { daily_new_card_limit, daily_review_limit } = req.body;
    const db = getDb();
    const isAdmin = req.user!.role === 'admin';

    const existing = (await db.query(
      'SELECT id FROM decks WHERE id = $1 AND (user_id = $2 OR $3 OR id IN (SELECT deck_id FROM user_subscriptions WHERE user_id = $2))',
      [id, req.user!.userId, isAdmin]
    )).rows[0];
    if (!existing) { res.status(404).json({ error: 'Deck not found' }); return; }

    const now = nowISO();
    if (typeof daily_new_card_limit === 'number') {
      await db.query('UPDATE decks SET daily_new_card_limit = $1, updated_at = $2 WHERE id = $3',
        [Math.max(1, Math.round(daily_new_card_limit)), now, id]);
    }
    if (typeof daily_review_limit === 'number') {
      await db.query('UPDATE decks SET daily_review_limit = $1, updated_at = $2 WHERE id = $3',
        [Math.max(1, Math.round(daily_review_limit)), now, id]);
    }

    const deckResult = await db.query(
      'SELECT id, name, card_count, daily_new_card_limit, daily_review_limit, created_at, updated_at FROM decks WHERE id = $1',
      [id]
    );
    res.json(deckResult.rows[0]);
  } catch (err) {
    console.error('PUT /decks/:id/limits error:', err);
    res.status(500).json({ error: 'Failed to update limits' });
  }
});

// PUT /api/decks/:id/study-mode —— 更新学习模式
decksRouter.put('/decks/:id/study-mode', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { study_mode } = req.body;
    const validModes = ['default', 'sequential', 'random'];
    if (!validModes.includes(study_mode)) {
      res.status(400).json({ error: `Invalid study_mode: must be one of ${validModes.join(', ')}` });
      return;
    }
    const db = getDb();
    const isAdmin = req.user!.role === 'admin';
    const existing = (await db.query(
      'SELECT id FROM decks WHERE id = $1 AND (user_id = $2 OR $3 OR id IN (SELECT deck_id FROM user_subscriptions WHERE user_id = $2))',
      [id, req.user!.userId, isAdmin]
    )).rows[0];
    if (!existing) { res.status(404).json({ error: 'Deck not found' }); return; }
    const now = nowISO();
    await db.query('UPDATE decks SET study_mode = $1, updated_at = $2 WHERE id = $3', [study_mode, now, id]);
    res.json({ success: true });
  } catch (err) {
    console.error('PUT /decks/:id/study-mode error:', err);
    res.status(500).json({ error: 'Failed to update study mode' });
  }
});

// PUT /api/decks/:id/pause —— 暂停/恢复学习
decksRouter.put('/decks/:id/pause', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { paused } = req.body;
    if (typeof paused !== 'boolean') {
      res.status(400).json({ error: 'paused must be a boolean' });
      return;
    }
    const db = getDb();
    const isAdmin = req.user!.role === 'admin';
    const existing = (await db.query(
      'SELECT id FROM decks WHERE id = $1 AND (user_id = $2 OR $3 OR id IN (SELECT deck_id FROM user_subscriptions WHERE user_id = $2))',
      [id, req.user!.userId, isAdmin]
    )).rows[0];
    if (!existing) { res.status(404).json({ error: 'Deck not found' }); return; }
    const now = nowISO();
    if (paused) {
      await db.query('UPDATE decks SET paused_at = $1, updated_at = $2 WHERE id = $3', [now, now, id]);
    } else {
      await db.query('UPDATE decks SET paused_at = NULL, updated_at = $1 WHERE id = $2', [now, id]);
    }
    const { rows } = await db.query('SELECT paused_at FROM decks WHERE id = $1', [id]);
    res.json({ success: true, paused_at: rows[0].paused_at });
  } catch (err) {
    console.error('PUT /decks/:id/pause error:', err);
    res.status(500).json({ error: 'Failed to toggle pause' });
  }
});

// GET /api/decks/:id/has-studied —— 检查牌组是否有学习记录
decksRouter.get('/decks/:id/has-studied', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const db = getDb();
    const userId = req.user!.userId;
    const isAdmin = req.user!.role === 'admin';

    // 鉴权：必须是所有者、订阅者或 admin
    if (!isAdmin) {
      const isOwner = (await db.query('SELECT id FROM decks WHERE id = $1 AND user_id = $2', [id, userId])).rows[0];
      const isSubscribed = (await db.query(
        'SELECT 1 FROM user_subscriptions WHERE user_id = $1 AND deck_id = $2',
        [userId, id]
      )).rows[0];
      if (!isOwner && !isSubscribed) {
        res.status(404).json({ error: 'Deck not found' });
        return;
      }
    }

    const { rows } = await db.query(
      `SELECT EXISTS(
        SELECT 1 FROM user_card_progress ucp
          JOIN cards c ON c.id = ucp.card_id
          WHERE c.deck_id = $1 AND ucp.user_id = $2
      ) AS has_studied`,
      [id, userId]
    );
    res.json(rows[0]);
  } catch (err) {
    console.error('GET /decks/:id/has-studied error:', err);
    res.status(500).json({ error: 'Failed to check study progress' });
  }
});

