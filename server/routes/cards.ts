import { Router, Request, Response } from 'express';
import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { getDb, getUploadsDir } from '../db.js';
import { requireAdmin } from '../middleware/auth.js';

export const cardsRouter = Router();

/** 生成 ISO 8601 时间戳 */
function nowISO(): string {
  return new Date().toISOString();
}

/** 生成 UUID */
function uuid(): string {
  return crypto.randomUUID();
}

/** 判断是否为 base64 data URL */
function isBase64DataUrl(value: string): boolean {
  return value.startsWith('data:');
}

/** 从 base64 data URL 提取扩展名，如 "png" */
function getExtFromDataUrl(dataUrl: string): string {
  const match = dataUrl.match(/^data:image\/([a-zA-Z0-9+]+);base64,/);
  return match ? match[1].replace('+', '') : 'png';
}

/** 将 base64 data URL 保存为文件，返回 /uploads/filename */
function saveBase64Image(dataUrl: string): string {
  const uploadsDir = getUploadsDir();
  const ext = getExtFromDataUrl(dataUrl);
  const filename = `${uuid()}.${ext}`;
  const filePath = path.join(uploadsDir, filename);

  // 提取 base64 数据部分
  const base64Data = dataUrl.replace(/^data:image\/[a-zA-Z0-9+]+;base64,/, '');
  const buffer = Buffer.from(base64Data, 'base64');
  fs.writeFileSync(filePath, buffer);

  return `/uploads/${filename}`;
}

/** 删除卡片关联的图片文件（如果 image_url 不为空） */
function deleteImageFile(imageUrl: string): void {
  if (!imageUrl || imageUrl.trim() === '') return;
  const uploadsDir = getUploadsDir();
  const filename = imageUrl.replace(/^\/uploads\//, '');
  const filePath = path.resolve(uploadsDir, filename);
  if (!filePath.startsWith(path.resolve(uploadsDir) + path.sep)) return; // 防路径穿越
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch {
    // 文件不存在或无法删除，忽略
  }
}

// ---- Multer 配置（批量导入用） ----
const batchUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      cb(null, getUploadsDir());
    },
    filename: (_req, file, cb) => {
      const originalName = Buffer.from(file.originalname, 'latin1').toString('utf8');
      const uniqueName = `${uuid()}-${originalName}`;
      cb(null, uniqueName);
    },
  }),
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB per file
});

// GET /api/decks/:deckId/cards —— 获取牌组下所有卡片
cardsRouter.get('/decks/:deckId/cards', async (req: Request, res: Response) => {
  try {
    const { deckId } = req.params;
    const db = getDb();

    // 验证牌组存在且当前用户有权访问（通过订阅或所有权）
    const isAdmin = req.user!.role === 'admin';
    const isOwner = isAdmin ? true : (await db.query('SELECT id FROM decks WHERE id = $1 AND user_id = $2', [deckId, req.user!.userId])).rows[0];
    const isSubscribed = isAdmin ? true : (await db.query(
      'SELECT 1 FROM user_subscriptions WHERE user_id = $1 AND deck_id = $2',
      [req.user!.userId, deckId]
    )).rows[0];
    if (!isOwner && !isSubscribed) {
      res.status(404).json({ error: 'Deck not found' });
      return;
    }

    const cards = (await db.query(
      `SELECT id, deck_id, front_text, back_text, image_url, ease, interval, repetitions,
              next_review, last_review, created_at, updated_at
       FROM cards WHERE deck_id = $1 AND archived_at IS NULL ORDER BY created_at DESC`,
      [deckId]
    )).rows;

    res.json(cards);
  } catch (err) {
    console.error('GET /decks/:deckId/cards error:', err);
    res.status(500).json({ error: 'Failed to fetch cards' });
  }
});

// POST /api/decks/:deckId/cards —— 创建单张卡片（仅管理员）
cardsRouter.post('/decks/:deckId/cards', requireAdmin, async (req: Request, res: Response) => {
  try {
    const { deckId } = req.params;
    const { front_text, back_text, image_url } = req.body;

    if (!front_text || typeof front_text !== 'string' || front_text.trim().length === 0) {
      res.status(400).json({ error: 'front_text is required' });
      return;
    }

    const db = getDb();

    // 处理图片：base64 data URL → 文件
    let finalImageUrl = '';
    if (image_url && typeof image_url === 'string' && image_url.trim() !== '') {
      if (isBase64DataUrl(image_url)) {
        finalImageUrl = saveBase64Image(image_url);
      } else {
        finalImageUrl = image_url; // 已经是 URL 路径
      }
    }

    const id = uuid();
    const now = nowISO();
    const nextReview = now; // 新卡片立即到期

    // 事务：创建卡片 + 更新计数
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO cards (id, deck_id, front_text, back_text, image_url, ease, interval, repetitions,
                            next_review, last_review, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, 2.5, 0, 0, $6, NULL, $7, $8)`,
        [id, deckId, front_text.trim(), (back_text || '').trim(), finalImageUrl, nextReview, now, now]
      );

      // 更新牌组卡片计数
      const countResult = await client.query('SELECT COUNT(*) as cnt FROM cards WHERE deck_id = $1 AND archived_at IS NULL', [deckId]);
      const cnt = countResult.rows[0].cnt;
      await client.query('UPDATE decks SET card_count = $1, updated_at = $2 WHERE id = $3', [cnt, now, deckId]);
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }

    const card = (await db.query(
      `SELECT id, deck_id, front_text, back_text, image_url, ease, interval, repetitions,
              next_review, last_review, created_at, updated_at
       FROM cards WHERE id = $1`,
      [id]
    )).rows[0];

    res.status(201).json(card);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? err.stack : '';
    console.error('POST /decks/:deckId/cards error:', msg, stack);
    res.status(500).json({ error: `Failed to create card: ${msg}` });
  }
});

// POST /api/decks/:deckId/cards/batch —— 批量导入卡片（仅管理员）
cardsRouter.post(
  '/decks/:deckId/cards/batch',
  requireAdmin,
  batchUpload.array('images', 500),
  async (req: Request, res: Response) => {
    try {
      const { deckId } = req.params as { deckId: string };
      const db = getDb();

      // 验证牌组存在
      const deck = (await db.query('SELECT id FROM decks WHERE id = $1', [deckId])).rows[0];
      if (!deck) {
        // 清理已上传的文件
        const files = req.files as Express.Multer.File[] | undefined;
        if (files) {
          for (const f of files) {
            try { fs.unlinkSync(f.path); } catch { /* ignore */ }
          }
        }
        res.status(404).json({ error: 'Deck not found' });
        return;
      }

      const files = req.files as Express.Multer.File[] | undefined;
      if (!files || files.length === 0) {
        res.status(400).json({ error: 'No images uploaded. Use field name "images".' });
        return;
      }

      const now = nowISO();
      const nextReview = now;
      const createdCards: Array<{
        id: string;
        deck_id: string;
        front_text: string;
        image_url: string;
        ease: number;
        interval: number;
        repetitions: number;
        next_review: string;
        last_review: string | null;
        created_at: string;
        updated_at: string;
      }> = [];

      // 在事务中批量创建
      const client = await db.connect();
      try {
        await client.query('BEGIN');

        const insertSQL = `INSERT INTO cards (id, deck_id, front_text, back_text, image_url, ease, interval, repetitions,
                                                next_review, last_review, created_at, updated_at)
                           VALUES ($1, $2, $3, $4, $5, 2.5, 0, 0, $6, NULL, $7, $8)`;

        for (const file of files) {
          // 文件名去扩展名 → front_text
          const originalName = Buffer.from(file.originalname, 'latin1').toString('utf8');
          const ext = path.extname(originalName);
          const frontText = originalName.slice(0, -ext.length) || originalName;
          const filename = path.basename(file.path);
          const imageUrl = `/uploads/${filename}`;

          const cardId = uuid();
          await client.query(insertSQL, [cardId, deckId, frontText, imageUrl, nextReview, now, now]);

          createdCards.push({
            id: cardId,
            deck_id: deckId,
            front_text: frontText,
            image_url: imageUrl,
            ease: 2.5,
            interval: 0,
            repetitions: 0,
            next_review: nextReview,
            last_review: null,
            created_at: now,
            updated_at: now,
          });
        }

        // 更新牌组卡片计数
        const countResult = await client.query('SELECT COUNT(*) as cnt FROM cards WHERE deck_id = $1 AND archived_at IS NULL', [deckId]);
        const cnt = countResult.rows[0].cnt;
        await client.query('UPDATE decks SET card_count = $1, updated_at = $2 WHERE id = $3', [cnt, now, deckId]);
        await client.query('COMMIT');
      } catch (e) {
        await client.query('ROLLBACK');
        throw e;
      } finally {
        client.release();
      }

      res.status(201).json({ created: createdCards.length, cards: createdCards });
    } catch (err) {
      console.error('POST /decks/:deckId/cards/batch error:', err);
      res.status(500).json({ error: 'Failed to import cards' });
    }
  }
);

// POST /api/decks/:deckId/cards/batch-text —— 文字批量导入
// 格式：每两行为一张卡片（正面 / 背面），空行分隔
cardsRouter.post('/decks/:deckId/cards/batch-text', requireAdmin, async (req: Request, res: Response) => {
  try {
    const { deckId } = req.params;
    const { text } = req.body;

    if (!text || typeof text !== 'string' || text.trim().length === 0) {
      res.status(400).json({ error: 'text is required' });
      return;
    }

    const db = getDb();
    const deck = (await db.query('SELECT id FROM decks WHERE id = $1', [deckId])).rows[0];
    if (!deck) {
      res.status(404).json({ error: 'Deck not found' });
      return;
    }

    // 解析文本：按行分割，过滤空行，每两行为一组
    const lines = text.split('\n').map((l: string) => l.trim()).filter((l: string) => l.length > 0);
    const created: Array<{ front: string; back: string }> = [];
    const now = nowISO();
    const nextReview = now;

    // 事务：批量创建 + 更新计数
    const client = await db.connect();
    try {
      await client.query('BEGIN');

      const insertSQL = `INSERT INTO cards (id, deck_id, front_text, back_text, image_url, ease, interval, repetitions,
                                              next_review, last_review, created_at, updated_at)
                         VALUES ($1, $2, $3, $4, '', 2.5, 0, 0, $5, NULL, $6, $7)`;

      for (let i = 0; i < lines.length - 1; i += 2) {
        const front = lines[i];
        const back = lines[i + 1];
        if (!front) continue;
        await client.query(insertSQL, [uuid(), deckId, front, back || '', nextReview, now, now]);
        created.push({ front, back: back || '' });
      }

      // 更新计数
      const countResult = await client.query('SELECT COUNT(*) as cnt FROM cards WHERE deck_id = $1 AND archived_at IS NULL', [deckId]);
      const cnt = countResult.rows[0].cnt;
      await client.query('UPDATE decks SET card_count = $1, updated_at = $2 WHERE id = $3', [cnt, now, deckId]);
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }

    res.status(201).json({ created: created.length, cards: created });
  } catch (err) {
    console.error('POST /decks/:deckId/cards/batch-text error:', err);
    res.status(500).json({ error: 'Failed to import text cards' });
  }
});

// PUT /api/cards/:id —— 更新卡片内容字段（仅管理员）
cardsRouter.put('/cards/:id', requireAdmin, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const db = getDb();
    const existing = (await db.query(
      'SELECT c.id, c.image_url FROM cards c WHERE c.id = $1',
      [id]
    )).rows[0] as { id: string; image_url: string } | undefined;

    if (!existing) {
      res.status(404).json({ error: 'Card not found' });
      return;
    }

    const { front_text, back_text, image_url } = req.body;
    const setClauses: string[] = [];
    const values: unknown[] = [];
    let paramIdx = 1;

    if (front_text !== undefined) {
      setClauses.push(`front_text = $${paramIdx++}`);
      values.push(front_text);
    }
    if (back_text !== undefined) {
      setClauses.push(`back_text = $${paramIdx++}`);
      values.push(back_text);
    }
    if (image_url !== undefined) {
      if (typeof image_url === 'string' && image_url.trim() !== '') {
        if (isBase64DataUrl(image_url)) {
          deleteImageFile(existing.image_url);
          const newUrl = saveBase64Image(image_url);
          setClauses.push(`image_url = $${paramIdx++}`);
          values.push(newUrl);
        } else if (image_url !== existing.image_url) {
          deleteImageFile(existing.image_url);
          setClauses.push(`image_url = $${paramIdx++}`);
          values.push(image_url);
        }
      } else if (image_url === '' || image_url === null) {
        deleteImageFile(existing.image_url);
        setClauses.push(`image_url = $${paramIdx++}`);
        values.push('');
      }
    }

    if (setClauses.length > 0) {
      const now = nowISO();
      setClauses.push(`updated_at = $${paramIdx++}`);
      values.push(now);
      const idParam = paramIdx++;
      values.push(id);
      await db.query(`UPDATE cards SET ${setClauses.join(', ')} WHERE id = $${idParam}`, values);
    }

    const card = (await db.query('SELECT * FROM cards WHERE id = $1', [id])).rows[0];
    res.json(card);
  } catch (err) {
    console.error('PUT /cards/:id error:', err);
    res.status(500).json({ error: 'Failed to update card' });
  }
});

// PUT /api/cards/:id/progress —— 记录自己的 SM-2 学习进度（admin + subscriber）
// 写入 user_card_progress，不动 cards 表内容
cardsRouter.put('/cards/:id/progress', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const userId = req.user!.userId;
    const isAdmin = req.user!.role === 'admin';

    const db = getDb();
    const card = (await db.query('SELECT id, deck_id FROM cards WHERE id = $1', [id])).rows[0] as { id: string; deck_id: string } | undefined;
    if (!card) {
      res.status(404).json({ error: 'Card not found' });
      return;
    }

    // 非 admin 必须是订阅者才能记录进度
    if (!isAdmin) {
      const isSubscribed = (await db.query(
        'SELECT 1 FROM user_subscriptions WHERE user_id = $1 AND deck_id = $2',
        [userId, card.deck_id]
      )).rows[0];
      if (!isSubscribed) {
        res.status(404).json({ error: 'Card not found' });
        return;
      }
    }

    const { ease, interval, repetitions, next_review, last_review } = req.body;
    const hasAny = ease !== undefined || interval !== undefined || repetitions !== undefined || next_review !== undefined || last_review !== undefined;
    if (!hasAny) {
      res.status(400).json({ error: 'No progress fields provided' });
      return;
    }

    await db.query(
      `INSERT INTO user_card_progress (user_id, card_id, ease, interval, repetitions, next_review, last_review)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT(user_id, card_id) DO UPDATE SET
         ease = COALESCE(excluded.ease, user_card_progress.ease),
         interval = COALESCE(excluded.interval, user_card_progress.interval),
         repetitions = COALESCE(excluded.repetitions, user_card_progress.repetitions),
         next_review = COALESCE(excluded.next_review, user_card_progress.next_review),
         last_review = COALESCE(excluded.last_review, user_card_progress.last_review)`,
      [userId, id, ease ?? null, interval ?? null, repetitions ?? null, next_review ?? null, last_review ?? null]
    );

    res.json({ success: true });
  } catch (err) {
    console.error('PUT /cards/:id/progress error:', err);
    res.status(500).json({ error: 'Failed to record progress' });
  }
});

// DELETE /api/cards/:id —— 删除卡片（仅管理员）
cardsRouter.delete('/cards/:id', requireAdmin, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const db = getDb();

    const cardRow = (await db.query(
      'SELECT c.id, c.image_url, c.deck_id FROM cards c WHERE c.id = $1',
      [id]
    )).rows[0] as {
      id: string;
      image_url: string;
      deck_id: string;
    } | undefined;

    if (!cardRow) {
      res.status(404).json({ error: 'Card not found' });
      return;
    }

    // 事务：删除图片 → 删除卡片记录 → 更新计数
    const client = await db.connect();
    try {
      await client.query('BEGIN');

      // 删除图片文件
      deleteImageFile(cardRow.image_url);

      // 删除卡片记录
      await client.query('DELETE FROM cards WHERE id = $1', [id]);

      // 更新牌组卡片计数
      const countResult = await client.query('SELECT COUNT(*) as cnt FROM cards WHERE deck_id = $1', [cardRow.deck_id]);
      const cnt = countResult.rows[0].cnt;
      const now = nowISO();
      await client.query('UPDATE decks SET card_count = $1, updated_at = $2 WHERE id = $3', [cnt, now, cardRow.deck_id]);
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }

    res.json({ success: true });
  } catch (err) {
    console.error('DELETE /cards/:id error:', err);
    res.status(500).json({ error: 'Failed to delete card' });
  }
});

// POST /api/decks/:deckId/set-article-text —— 设置碑帖文本并计算卡片位置
cardsRouter.post('/decks/:deckId/set-article-text', requireAdmin, async (req: Request, res: Response) => {
  try {
    const { deckId } = req.params;
    const { article_text } = req.body;

    if (!article_text || typeof article_text !== 'string' || article_text.trim().length === 0) {
      res.status(400).json({ error: 'article_text is required' });
      return;
    }

    const MAX_CHARS = 50000;
    if (article_text.length > MAX_CHARS) {
      res.status(400).json({ error: `article_text exceeds ${MAX_CHARS} character limit` });
      return;
    }

    const db = getDb();

    const { rows: cards } = await db.query(
      'SELECT id, front_text FROM cards WHERE deck_id = $1 ORDER BY created_at ASC',
      [deckId]
    ) as { rows: Array<{ id: string; front_text: string }> };

    function resolveBase(frontText: string): string {
      return frontText.replace(/\s*\(?\d+\)?\s*$/, '').replace(/_\d+$/, '').trim();
    }

    // 去掉标点符号，只保留汉字用于匹配
    const text = article_text.trim().replace(/[　-〿＀-￯.,!?;:，。！？；：、""''（）《》【】\[\]{}·…—\-~·\s]/g, '');

    const charPositions = new Map<string, number[]>();
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (!charPositions.has(ch)) charPositions.set(ch, []);
      charPositions.get(ch)!.push(i + 1);
    }

    // 两轮匹配：多字短语优先，单字次之
    const updates: Array<{ id: string; sortOrder: number }> = [];
    const usedIds = new Set<string>();
    const usedPositions = new Set<number>();

    for (const card of cards) {
      const base = resolveBase(card.front_text);
      if (base.length <= 1) continue;
      for (let i = 0; i <= text.length - base.length; i++) {
        let match = true;
        for (let j = 0; j < base.length; j++) {
          if (text[i + j] !== base[j] || usedPositions.has(i + j + 1)) { match = false; break; }
        }
        if (match) {
          updates.push({ id: card.id, sortOrder: i + 1 });
          for (let j = 0; j < base.length; j++) usedPositions.add(i + j + 1);
          usedIds.add(card.id);
          break;
        }
      }
    }

    for (const card of cards) {
      if (usedIds.has(card.id)) continue;
      const base = resolveBase(card.front_text);
      const key = base[0] || base;
      const positions = charPositions.get(key);
      if (!positions || positions.length === 0) continue;
      const nextPos = positions.find(p => !usedPositions.has(p));
      if (nextPos) {
        updates.push({ id: card.id, sortOrder: nextPos });
        usedPositions.add(nextPos);
        usedIds.add(card.id);
      }
    }

    // 事务：统一写入 article_text + sort_order（避免部分成功部分失败）
    const client = await db.connect();
    const now = nowISO();
    try {
      await client.query('BEGIN');

      await client.query('UPDATE decks SET article_text = $1, updated_at = $2 WHERE id = $3',
        [article_text.trim(), now, deckId]);

      // 批量更新已匹配的卡片
      if (updates.length > 0) {
        const ids = updates.map((_, i) => `$${i * 2 + 1}`);
        const vals: unknown[] = [];
        for (const u of updates) { vals.push(u.id, u.sortOrder); }
        await client.query(
          `UPDATE cards SET sort_order = v.sort_order, updated_at = $${updates.length * 2 + 1}
           FROM (VALUES ${updates.map((_, i) => `($${i * 2 + 1}::text, $${i * 2 + 2}::int)`).join(',')}) AS v(id, sort_order)
           WHERE cards.id = v.id`,
          [...vals, now]
        );
      }

      // 未匹配的设 0
      if (cards.length > updates.length) {
        const unmatchedIds = cards.filter(c => !usedIds.has(c.id)).map((_, i) => `$${i + 1}`);
        const unmatchedVals = cards.filter(c => !usedIds.has(c.id)).map(c => c.id);
        if (unmatchedVals.length > 0) {
          await client.query(
            `UPDATE cards SET sort_order = 0, updated_at = $${unmatchedVals.length + 1}
             WHERE id IN (${unmatchedIds.join(',')})`,
            [...unmatchedVals, now]
          );
        }
      }

      await client.query('COMMIT');
    } catch (txErr) {
      await client.query('ROLLBACK');
      throw txErr;
    } finally {
      client.release();
    }

    res.json({ matched: updates.length, unmatched: cards.length - updates.length, total_cards: cards.length });
  } catch (err) {
    console.error('POST /decks/:deckId/set-article-text error:', err);
    res.status(500).json({ error: 'Failed to set article text' });
  }
});

// GET /api/decks/:deckId/due-cards —— 获取到期卡片
// ?mode=default|sequential|random （默认 default）
cardsRouter.get('/decks/:deckId/due-cards', async (req: Request, res: Response) => {
  try {
    const { deckId } = req.params;
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : undefined;
    const mode = (req.query.mode as string) || 'default';

    const db = getDb();
    const userId = req.user!.userId;

    // 验证牌组存在且当前用户已订阅（或 admin 直接放行）
    const isOwner = (await db.query('SELECT id FROM decks WHERE id = $1 AND user_id = $2', [deckId, userId])).rows[0];
    const isSubscribed = (await db.query(
      'SELECT 1 FROM user_subscriptions WHERE user_id = $1 AND deck_id = $2',
      [userId, deckId]
    )).rows[0];
    if (!isOwner && !isSubscribed && req.user!.role !== 'admin') {
      res.status(404).json({ error: 'Deck not found or not subscribed' });
      return;
    }

    const now = nowISO();
    let sql = `SELECT c.id, c.deck_id, c.front_text, c.back_text, c.image_url, c.context,
                      COALESCE(ucp.ease, 2.5) AS ease,
                      ucp.interval AS interval,
                      ucp.repetitions AS repetitions,
                      ucp.next_review AS next_review,
                      ucp.last_review AS last_review,
                      c.created_at, c.updated_at
               FROM cards c
               INNER JOIN user_card_progress ucp
                  ON ucp.user_id = $1 AND ucp.card_id = c.id
               WHERE c.deck_id = $2 AND c.archived_at IS NULL AND ucp.interval > 0 AND ucp.next_review <= $3`;

    // 排序模式
    if (mode === 'random') {
      sql += ' ORDER BY RANDOM()';
    } else if (mode === 'sequential') {
      sql += ' ORDER BY NULLIF(c.sort_order, 0) ASC NULLS LAST, ucp.next_review ASC';
    } else {
      sql += ' ORDER BY ucp.next_review ASC';
    }

    const params: unknown[] = [userId, deckId, now];

    if (limit && limit > 0) {
      sql += ` LIMIT $${params.length + 1}`;
      params.push(limit);
    }

    const cards = (await db.query(sql, params)).rows;
    res.json(cards);
  } catch (err) {
    console.error('GET /decks/:deckId/due-cards error:', err);
    res.status(500).json({ error: 'Failed to fetch due cards' });
  }
});

// GET /api/decks/:deckId/new-cards —— 获取新卡片
// ?mode=default|sequential|random （默认 default）
cardsRouter.get('/decks/:deckId/new-cards', async (req: Request, res: Response) => {
  try {
    const { deckId } = req.params;
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : undefined;
    const mode = (req.query.mode as string) || 'default';

    const db = getDb();
    const userId = req.user!.userId;

    // 验证牌组存在且当前用户已订阅（或 admin 直接放行）
    const isOwner = (await db.query('SELECT id FROM decks WHERE id = $1 AND user_id = $2', [deckId, userId])).rows[0];
    const isSubscribed = (await db.query(
      'SELECT 1 FROM user_subscriptions WHERE user_id = $1 AND deck_id = $2',
      [userId, deckId]
    )).rows[0];
    if (!isOwner && !isSubscribed && req.user!.role !== 'admin') {
      res.status(404).json({ error: 'Deck not found or not subscribed' });
      return;
    }

    let sql = `SELECT c.id, c.deck_id, c.front_text, c.back_text, c.image_url, c.context,
                      COALESCE(ucp.ease, 2.5) AS ease,
                      COALESCE(ucp.interval, 0) AS interval,
                      COALESCE(ucp.repetitions, 0) AS repetitions,
                      COALESCE(ucp.next_review, c.next_review) AS next_review,
                      ucp.last_review AS last_review,
                      c.created_at, c.updated_at
               FROM cards c
               LEFT JOIN user_card_progress ucp
                  ON ucp.user_id = $1 AND ucp.card_id = c.id
               WHERE c.deck_id = $2 AND c.archived_at IS NULL AND (ucp.card_id IS NULL OR ucp.interval = 0)`;

    // 排序模式
    if (mode === 'random') {
      sql += ' ORDER BY RANDOM()';
    } else if (mode === 'sequential') {
      sql += ' ORDER BY NULLIF(c.sort_order, 0) ASC NULLS LAST, c.created_at ASC';
    } else {
      sql += ' ORDER BY c.created_at ASC';
    }

    const params: unknown[] = [userId, deckId];

    if (limit && limit > 0) {
      sql += ` LIMIT $${params.length + 1}`;
      params.push(limit);
    }

    const cards = (await db.query(sql, params)).rows;
    res.json(cards);
  } catch (err) {
    console.error('GET /decks/:deckId/new-cards error:', err);
    res.status(500).json({ error: 'Failed to fetch new cards' });
  }
});
