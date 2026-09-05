import { Router, Request, Response } from 'express';
import { getDb } from '../db.js';
import { cache } from '../lib/cache.js';
import crypto from 'node:crypto';

export const studyRouter = Router();

/** 生成 UUID */
function uuid(): string {
  return crypto.randomUUID();
}

/** 生成 ISO 8601 时间戳 */
function nowISO(): string {
  return new Date().toISOString();
}

/** 将数据库行转换为前端 StudySession 格式 */
function rowToSession(row: {
  id: string;
  deck_id: string;
  started_at: string;
  ended_at: string | null;
  cards_studied: number;
  ratings_again: number;
  ratings_hard: number;
  ratings_good: number;
  ratings_easy: number;
}) {
  return {
    id: row.id,
    deck_id: row.deck_id,
    started_at: row.started_at,
    ended_at: row.ended_at,
    cards_studied: row.cards_studied,
    ratings: {
      again: row.ratings_again,
      hard: row.ratings_hard,
      good: row.ratings_good,
      easy: row.ratings_easy,
    },
  };
}

// POST /api/study-sessions —— 创建学习会话
studyRouter.post('/study-sessions', async (req: Request, res: Response) => {
  try {
    const { deck_id } = req.body;

    if (!deck_id || typeof deck_id !== 'string') {
      res.status(400).json({ error: 'deck_id is required' });
      return;
    }

    const db = getDb();
    const isAdmin = req.user!.role === 'admin';

    // 验证牌组存在且当前用户有权访问（通过订阅或所有权）
    const isOwner = isAdmin ? true : (await db.query('SELECT id FROM decks WHERE id = $1 AND user_id = $2', [deck_id, req.user!.userId])).rows[0];
    const isSubscribed = isAdmin ? true : (await db.query(
      'SELECT 1 FROM user_subscriptions WHERE user_id = $1 AND deck_id = $2',
      [req.user!.userId, deck_id]
    )).rows[0];
    if (!isOwner && !isSubscribed) {
      res.status(404).json({ error: 'Deck not found' });
      return;
    }

    const id = uuid();
    const startedAt = req.body.started_at || nowISO();

    await db.query(
      `INSERT INTO study_sessions (id, deck_id, started_at, ended_at, cards_studied,
                                   ratings_again, ratings_hard, ratings_good, ratings_easy, user_id)
       VALUES ($1, $2, $3, NULL, 0, 0, 0, 0, 0, $4)`,
      [id, deck_id, startedAt, req.user!.userId]
    );

    const { rows } = await db.query('SELECT * FROM study_sessions WHERE id = $1', [id]);
    const row = rows[0] as {
      id: string;
      deck_id: string;
      started_at: string;
      ended_at: string | null;
      cards_studied: number;
      ratings_again: number;
      ratings_hard: number;
      ratings_good: number;
      ratings_easy: number;
    };

    res.status(201).json(rowToSession(row));
  } catch (err) {
    console.error('POST /study-sessions error:', err);
    res.status(500).json({ error: 'Failed to create study session' });
  }
});

// PUT /api/study-sessions/:id —— 结束学习会话
studyRouter.put('/study-sessions/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const db = getDb();

    const existing = (await db.query('SELECT id FROM study_sessions WHERE id = $1 AND user_id = $2', [id, req.user!.userId])).rows[0];
    if (!existing) {
      res.status(404).json({ error: 'Study session not found' });
      return;
    }

    const { ended_at, cards_studied, ratings } = req.body;

    const setClauses: string[] = [];
    const values: unknown[] = [];
    let paramIdx = 0;

    if (ended_at !== undefined) {
      paramIdx++;
      setClauses.push(`ended_at = $${paramIdx}`);
      values.push(ended_at);
    }
    if (cards_studied !== undefined) {
      paramIdx++;
      setClauses.push(`cards_studied = $${paramIdx}`);
      values.push(cards_studied);
    }
    if (ratings !== undefined) {
      if (ratings.again !== undefined) {
        paramIdx++;
        setClauses.push(`ratings_again = $${paramIdx}`);
        values.push(ratings.again);
      }
      if (ratings.hard !== undefined) {
        paramIdx++;
        setClauses.push(`ratings_hard = $${paramIdx}`);
        values.push(ratings.hard);
      }
      if (ratings.good !== undefined) {
        paramIdx++;
        setClauses.push(`ratings_good = $${paramIdx}`);
        values.push(ratings.good);
      }
      if (ratings.easy !== undefined) {
        paramIdx++;
        setClauses.push(`ratings_easy = $${paramIdx}`);
        values.push(ratings.easy);
      }
    }

    if (setClauses.length > 0) {
      paramIdx++;
      values.push(id);
      await db.query(`UPDATE study_sessions SET ${setClauses.join(', ')} WHERE id = $${paramIdx}`, values);
    }

    const { rows } = await db.query('SELECT * FROM study_sessions WHERE id = $1', [id]);
    const row = rows[0] as {
      id: string;
      deck_id: string;
      started_at: string;
      ended_at: string | null;
      cards_studied: number;
      ratings_again: number;
      ratings_hard: number;
      ratings_good: number;
      ratings_easy: number;
    };

    res.json(rowToSession(row));
  } catch (err) {
    console.error('PUT /study-sessions/:id error:', err);
    res.status(500).json({ error: 'Failed to update study session' });
  }
});

// GET /api/daily-stats/range —— 获取日期范围统计（必须在 /:date 之前注册）
studyRouter.get('/daily-stats/range', async (req: Request, res: Response) => {
  try {
    const { from, to } = req.query;
    if (!from || !to || typeof from !== 'string' || typeof to !== 'string') {
      res.status(400).json({ error: 'from and to query params required (YYYY-MM-DD)' });
      return;
    }
    const db = getDb();
    // 跨牌组聚合（用户级查询）
    const { rows } = await db.query(
      `SELECT date,
              SUM(cards_studied) as cards_studied,
              SUM(new_cards_learned) as new_cards_learned
       FROM daily_stats WHERE user_id = $1 AND date >= $2 AND date <= $3
       GROUP BY date ORDER BY date DESC`,
      [req.user!.userId, from, to]
    );

    // 填充缺失日期（补 0）
    const statsMap = new Map((rows as { date: string; cards_studied: number; new_cards_learned: number }[]).map((r) => [r.date, r]));
    const filled: { date: string; cards_studied: number; new_cards_learned: number }[] = [];
    const start = new Date(from);
    const end = new Date(to);
    const cur = new Date(start);
    while (cur <= end) {
      const y = cur.getFullYear();
      const m = String(cur.getMonth() + 1).padStart(2, '0');
      const d = String(cur.getDate()).padStart(2, '0');
      const dateStr = `${y}-${m}-${d}`;
      const row = statsMap.get(dateStr);
      filled.push({
        date: dateStr,
        cards_studied: row?.cards_studied ?? 0,
        new_cards_learned: row?.new_cards_learned ?? 0,
      });
      cur.setDate(cur.getDate() + 1);
    }
    res.json(filled);
  } catch (err) {
    console.error('GET /daily-stats/range error:', err);
    res.status(500).json({ error: 'Failed to fetch stats range' });
  }
});

// GET /api/daily-stats/:date —— 获取指定日期的统计
// 可选 query: ?deck_id=xxx（查具体牌组）；缺省则 SUM 跨牌组
studyRouter.get('/daily-stats/:date', async (req: Request, res: Response) => {
  try {
    const { date } = req.params;
    const db = getDb();
    const deckId = (req.query.deck_id as string | undefined) || '';

    let row: { cards_studied: number; new_cards_learned: number };
    if (deckId) {
      const r = await db.query(
        `SELECT cards_studied, new_cards_learned
         FROM daily_stats WHERE date = $1 AND user_id = $2 AND deck_id = $3`,
        [date, req.user!.userId, deckId]
      );
      row = r.rows[0] as any;
    } else {
      // 查全部牌组 SUM（旧行为，用于 useDashboardStats）
      const r = await db.query(
        `SELECT
           COALESCE(SUM(cards_studied), 0) as cards_studied,
           COALESCE(SUM(new_cards_learned), 0) as new_cards_learned
         FROM daily_stats WHERE date = $1 AND user_id = $2`,
        [date, req.user!.userId]
      );
      row = r.rows[0] as any;
    }

    res.json({ date, cards_studied: row?.cards_studied ?? 0, new_cards_learned: row?.new_cards_learned ?? 0 });
  } catch (err) {
    console.error('GET /daily-stats/:date error:', err);
    res.status(500).json({ error: 'Failed to fetch daily stats' });
  }
});

// PUT /api/daily-stats/:date —— 更新/创建每日统计
studyRouter.put('/daily-stats/:date', async (req: Request, res: Response) => {
  try {
    const { date } = req.params;
    const { cards_studied, new_cards_learned } = req.body;

    const db = getDb();

    // upsert：按 (date, user_id, deck_id) 三元 PK
    const deckId = (req.body.deck_id as string | undefined) || '';
    const existing = (await db.query(
      'SELECT date FROM daily_stats WHERE date = $1 AND user_id = $2 AND deck_id = $3',
      [date, req.user!.userId, deckId]
    )).rows[0];

    if (existing) {
      await db.query(
        'UPDATE daily_stats SET cards_studied = $1, new_cards_learned = $2 WHERE date = $3 AND user_id = $4 AND deck_id = $5',
        [cards_studied ?? 0, new_cards_learned ?? 0, date, req.user!.userId, deckId]
      );
    } else {
      await db.query(
        'INSERT INTO daily_stats (date, user_id, deck_id, cards_studied, new_cards_learned) VALUES ($1, $2, $3, $4, $5)',
        [date, req.user!.userId, deckId, cards_studied ?? 0, new_cards_learned ?? 0]
      );
    }

    const { rows } = await db.query(
      'SELECT date, cards_studied, new_cards_learned FROM daily_stats WHERE date = $1 AND user_id = $2 AND deck_id = $3',
      [date, req.user!.userId, deckId]
    );

    res.json(rows[0]);
  } catch (err) {
    console.error('PUT /daily-stats/:date error:', err);
    res.status(500).json({ error: 'Failed to update daily stats' });
  }
});

// POST /api/daily-stats/:date/increment —— 原子增量更新每日统计
// 用 INSERT ... ON CONFLICT DO UPDATE 在 SQL 端做累加，避免"读后写"竞态
// （连续快速评分时多个请求并发，读取到的旧值会互相覆盖导致计数偏小）。
studyRouter.post('/daily-stats/:date/increment', async (req: Request, res: Response) => {
  try {
    const { date } = req.params;
    const cardsDelta = Number(req.body.cards_studied) || 0;
    const newDelta = Number(req.body.new_cards_learned) || 0;
    const deckId = (req.body.deck_id as string | undefined) || '';

    const db = getDb();
    const { rows } = await db.query(
      `INSERT INTO daily_stats (date, user_id, deck_id, cards_studied, new_cards_learned)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (date, user_id, deck_id) DO UPDATE SET
         cards_studied = daily_stats.cards_studied + EXCLUDED.cards_studied,
         new_cards_learned = daily_stats.new_cards_learned + EXCLUDED.new_cards_learned
       RETURNING date, cards_studied, new_cards_learned`,
      [date, req.user!.userId, deckId, cardsDelta, newDelta]
    );

    res.json(rows[0]);
  } catch (err) {
    console.error('POST /daily-stats/:date/increment error:', err);
    res.status(500).json({ error: 'Failed to increment daily stats' });
  }
});

// GET /api/due-counts —— 获取所有牌组的到期卡片计数（30s 内存缓存）
studyRouter.get('/due-counts', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;
    const now = nowISO();
    const cacheKey = `due-counts:${userId}`;

    let rows: { id: string; name: string; due_count: number }[];
    const entry = cache.get(cacheKey);
    if (entry && Date.now() < entry.expiresAt) {
      rows = entry.data as typeof rows;
    } else {
      const db = getDb();
      const isAdmin = req.user!.role === 'admin';
      const r = await db.query(
        `SELECT d.id, d.name, COUNT(c.id)::int as due_count
         FROM decks d
         INNER JOIN cards c ON c.deck_id = d.id
         INNER JOIN user_card_progress ucp ON ucp.card_id = c.id AND ucp.user_id = $1
         LEFT JOIN user_subscriptions us ON us.deck_id = d.id AND us.user_id = $2
         WHERE (d.user_id = $3 OR us.user_id = $4 OR $5)
           AND ucp.interval > 0 AND ucp.next_review <= $6
           AND d.paused_at IS NULL
         GROUP BY d.id, d.name ORDER BY d.created_at DESC`,
        [userId, userId, userId, userId, isAdmin, now]
      );
      rows = r.rows as typeof rows;
      cache.set(cacheKey, { data: rows, expiresAt: Date.now() + 30_000 });
    }
    res.json(rows);
  } catch (err) {
    console.error('GET /due-counts error:', err);
    res.status(500).json({ error: 'Failed to fetch due counts' });
  }
});

// GET /api/study-sessions/total —— 累计学习总时长与总会话数
studyRouter.get('/study-sessions/total', async (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { rows } = await db.query(
      `SELECT COUNT(*)::int as total_sessions,
              COALESCE(SUM(EXTRACT(EPOCH FROM (ended_at::timestamp - started_at::timestamp)) / 60.0), 0) as total_minutes
       FROM study_sessions
       WHERE user_id = $1 AND ended_at IS NOT NULL`,
      [req.user!.userId]
    );
    const row = rows[0] as { total_sessions: number; total_minutes: number };
    res.json(row);
  } catch (err) {
    console.error('GET /study-sessions/total error:', err);
    res.status(500).json({ error: 'Failed to fetch study total' });
  }
});
