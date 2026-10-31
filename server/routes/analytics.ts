import { Router, Request, Response } from 'express';
import { getDb } from '../db.js';

export const analyticsRouter = Router();

// GET /api/analytics/:deckId/card-status —— 卡片状态分布（从 user_card_progress 读取真实 SM-2 数据）
analyticsRouter.get('/analytics/:deckId/card-status', async (req: Request, res: Response) => {
  try {
    const { deckId } = req.params;
    const db = getDb();
    const isAdmin = req.user!.role === 'admin';

    // 验证牌组存在且当前用户有权访问（owner、订阅者、admin）
    const deck = (await db.query(
      'SELECT id FROM decks WHERE id = $1 AND (user_id = $2 OR id IN (SELECT deck_id FROM user_subscriptions WHERE user_id = $2))',
      [deckId, req.user!.userId]
    )).rows[0];
    if (!deck) {
      res.status(404).json({ error: 'Deck not found' });
      return;
    }

    // 从 user_card_progress 读取真实 SM-2 状态；无进度记录的卡片算 New
    const { rows } = await db.query(
      `SELECT
         COUNT(*) FILTER (WHERE ucp.card_id IS NULL OR ucp.interval = 0) AS "new",
         COUNT(*) FILTER (WHERE ucp.interval > 0 AND ucp.interval <= 10) AS learning,
         COUNT(*) FILTER (WHERE ucp.interval > 10 AND ucp.interval < 30240) AS young,
         COUNT(*) FILTER (WHERE ucp.interval >= 30240) AS mature
       FROM cards c
       LEFT JOIN user_card_progress ucp ON ucp.card_id = c.id AND ucp.user_id = $1
       WHERE c.deck_id = $2`,
      [req.user!.userId, deckId]
    );

    res.json(rows[0]);
  } catch (err) {
    console.error('GET /analytics/:deckId/card-status error:', err);
    res.status(500).json({ error: 'Failed to fetch card status' });
  }
});

// GET /api/analytics/:deckId/difficulty —— 难度分布（从 user_card_progress 读取真实 ease 因子）
analyticsRouter.get('/analytics/:deckId/difficulty', async (req: Request, res: Response) => {
  try {
    const { deckId } = req.params;
    const db = getDb();
    const isAdmin = req.user!.role === 'admin';

    // 验证牌组存在且当前用户有权访问（owner、订阅者、admin）
    const deck = (await db.query(
      'SELECT id FROM decks WHERE id = $1 AND (user_id = $2 OR id IN (SELECT deck_id FROM user_subscriptions WHERE user_id = $2))',
      [deckId, req.user!.userId]
    )).rows[0];
    if (!deck) {
      res.status(404).json({ error: 'Deck not found' });
      return;
    }

    // 从 user_card_progress 读取 ease 分布；无进度记录算 unreviewed
    const { rows } = await db.query(
      `SELECT
         COUNT(*) FILTER (WHERE ucp.card_id IS NOT NULL AND ucp.interval > 0 AND ucp.ease <= 1.8) AS hard,
         COUNT(*) FILTER (WHERE ucp.card_id IS NOT NULL AND ucp.interval > 0 AND ucp.ease > 1.8 AND ucp.ease < 2.3) AS medium,
         COUNT(*) FILTER (WHERE ucp.card_id IS NOT NULL AND ucp.interval > 0 AND ucp.ease >= 2.3) AS easy,
         COUNT(*) FILTER (WHERE ucp.card_id IS NULL OR ucp.interval = 0) AS unreviewed
       FROM cards c
       LEFT JOIN user_card_progress ucp ON ucp.card_id = c.id AND ucp.user_id = $1
       WHERE c.deck_id = $2`,
      [req.user!.userId, deckId]
    );

    res.json(rows[0]);
  } catch (err) {
    console.error('GET /analytics/:deckId/difficulty error:', err);
    res.status(500).json({ error: 'Failed to fetch difficulty' });
  }
});

// GET /api/analytics/:deckId/ratings —— 评分分布
analyticsRouter.get('/analytics/:deckId/ratings', async (req: Request, res: Response) => {
  try {
    const { deckId } = req.params;
    const db = getDb();

    // 验证牌组存在且当前用户有权访问（owner、订阅者、admin）
    const deck = (await db.query(
      'SELECT id FROM decks WHERE id = $1 AND (user_id = $2 OR id IN (SELECT deck_id FROM user_subscriptions WHERE user_id = $2))',
      [deckId, req.user!.userId]
    )).rows[0];
    if (!deck) {
      res.status(404).json({ error: 'Deck not found' });
      return;
    }

    const row = (await db.query(
      `SELECT
         COALESCE(SUM(ratings_again), 0) as again,
         COALESCE(SUM(ratings_hard), 0) as hard,
         COALESCE(SUM(ratings_good), 0) as good,
         COALESCE(SUM(ratings_easy), 0) as easy,
         COALESCE(SUM(cards_studied), 0) as total
       FROM study_sessions WHERE deck_id = $1 AND user_id = $2`,
      [deckId, req.user!.userId]
    )).rows[0] as {
      again: number; hard: number; good: number; easy: number; total: number;
    };

    res.json(row);
  } catch (err) {
    console.error('GET /analytics/:deckId/ratings error:', err);
    res.status(500).json({ error: 'Failed to fetch ratings' });
  }
});

// GET /api/analytics/daily-trend —— 每日复习趋势（最近 N 天）
analyticsRouter.get('/analytics/daily-trend', async (req: Request, res: Response) => {
  try {
    const days = parseInt(req.query.days as string, 10) || 14;
    const db = getDb();

    // 生成最近 N 天的日期列表
    const dates: string[] = [];
    const today = new Date();
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      dates.push(`${y}-${m}-${day}`);
    }

    // 查询这些天的统计
    const rows = (await db.query(
      `SELECT date,
              SUM(cards_studied)::int AS cards_studied,
              SUM(new_cards_learned)::int AS new_cards_learned
       FROM daily_stats
       WHERE user_id = $1 AND date >= $2 AND date <= $3
       GROUP BY date ORDER BY date ASC`,
      [req.user!.userId, dates[0], dates[dates.length - 1]]
    )).rows as {
      date: string; cards_studied: number; new_cards_learned: number;
    }[];

    // 填充缺失日期（0 值）
    const statsMap = new Map(rows.map((r) => [r.date, r]));
    const filled = dates.map((date) => {
      const row = statsMap.get(date);
      return {
        date,
        cards_studied: row?.cards_studied ?? 0,
        new_cards_learned: row?.new_cards_learned ?? 0,
      };
    });

    res.json(filled);
  } catch (err) {
    console.error('GET /analytics/daily-trend error:', err);
    res.status(500).json({ error: 'Failed to fetch daily trend' });
  }
});

// GET /api/analytics/daily-extra —— 每日扩展统计（新学/复习 + 评分分布 + 学时）
// Query: days（默认 11）/ from+to（覆盖 days）/ deckId（可选；缺省=全部牌组）
// 字段：date, new_learned, reviewed, hard, medium, easy, minutes
analyticsRouter.get('/analytics/daily-extra', async (req: Request, res: Response) => {
  try {
    const db = getDb();
    const userId = req.user!.userId;
    const deckId = (req.query.deckId as string | undefined) || '';

    // 日期范围
    let dates: string[];
    if (req.query.from && req.query.to) {
      const from = String(req.query.from);
      const to = String(req.query.to);
      const start = new Date(from);
      const end = new Date(to);
      dates = [];
      const cur = new Date(start);
      while (cur <= end) {
        const y = cur.getFullYear();
        const m = String(cur.getMonth() + 1).padStart(2, '0');
        const d = String(cur.getDate()).padStart(2, '0');
        dates.push(`${y}-${m}-${d}`);
        cur.setDate(cur.getDate() + 1);
      }
    } else {
      const days = parseInt(req.query.days as string, 10) || 11;
      dates = [];
      const today = new Date();
      for (let i = days - 1; i >= 0; i--) {
        const d = new Date(today);
        d.setDate(d.getDate() - i);
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        dates.push(`${y}-${m}-${day}`);
      }
    }

    const from = dates[0];
    const to = dates[dates.length - 1];

    // 1) new_learned / reviewed 来自 daily_stats（PK: date+user_id+deck_id）
    //    - 无 deckId：跨牌组 SUM
    //    - 有 deckId：按该牌组查
    const dailyRows = deckId
      ? ((await db.query(
          `SELECT date, cards_studied, new_cards_learned
           FROM daily_stats
           WHERE user_id = $1 AND date >= $2 AND date <= $3 AND deck_id = $4`,
          [userId, from, to, deckId]
        )).rows as {
          date: string; cards_studied: number; new_cards_learned: number;
        }[])
      : ((await db.query(
          `SELECT date,
                  SUM(cards_studied)::int as cards_studied,
                  SUM(new_cards_learned)::int as new_cards_learned
           FROM daily_stats
           WHERE user_id = $1 AND date >= $2 AND date <= $3
           GROUP BY date`,
          [userId, from, to]
        )).rows as {
          date: string; cards_studied: number; new_cards_learned: number;
        }[]);

    // 2) 评分按日分布 + 学时 —— 全部在 SQL 端聚合（避免 N+1）
    //    用 AT TIME ZONE 提取本地日期键
    const sessionParams: unknown[] = [userId, from, to];
    const sessionWhere = deckId
      ? `AND deck_id = $${sessionParams.length + 1}`
      : '';
    if (deckId) {
      sessionParams.push(deckId);
    }

    const sessionAgg = (await db.query(
      `SELECT to_char((started_at::timestamptz AT TIME ZONE 'Asia/Shanghai')::date, 'YYYY-MM-DD') as date_key,
              SUM(ratings_again + ratings_hard)::int as hard,
              SUM(ratings_good)::int as medium,
              SUM(ratings_easy)::int as easy,
              SUM(CASE WHEN ended_at IS NOT NULL
                       THEN EXTRACT(EPOCH FROM (ended_at::timestamptz - started_at::timestamptz)) / 60.0
                       ELSE 0 END) as minutes
       FROM study_sessions
       WHERE user_id = $1
         AND (started_at::timestamptz AT TIME ZONE 'Asia/Shanghai')::date >= $2::date
         AND (started_at::timestamptz AT TIME ZONE 'Asia/Shanghai')::date <= $3::date
         AND ended_at IS NOT NULL
         ${sessionWhere}
       GROUP BY date_key`,
      sessionParams
    )).rows as {
      date_key: string;
      hard: number | null;
      medium: number | null;
      easy: number | null;
      minutes: number | null;
    }[];

    // 聚合：daily_stats + session 聚合结果合并到 dailyMap
    const dailyMap = new Map<string, { new_learned: number; reviewed: number; hard: number; medium: number; easy: number; minutes: number }>();
    for (const date of dates) {
      dailyMap.set(date, { new_learned: 0, reviewed: 0, hard: 0, medium: 0, easy: 0, minutes: 0 });
    }
    for (const r of dailyRows) {
      const bucket = dailyMap.get(r.date);
      if (!bucket) continue;
      const studied = Number(r.cards_studied) || 0;
      const fresh = Number(r.new_cards_learned) || 0;
      bucket.new_learned += fresh;
      bucket.reviewed += Math.max(0, studied - fresh);
    }
    for (const s of sessionAgg) {
      const bucket = dailyMap.get(s.date_key);
      if (!bucket) continue;
      bucket.hard += s.hard || 0;
      bucket.medium += s.medium || 0;
      bucket.easy += s.easy || 0;
      bucket.minutes += s.minutes || 0;
    }

    const filled = dates.map((date) => {
      const b = dailyMap.get(date)!;
      return {
        date,
        new_learned: b.new_learned,
        reviewed: b.reviewed,
        hard: b.hard,
        medium: b.medium,
        easy: b.easy,
        minutes: Math.round(b.minutes),
      };
    });

    res.json(filled);
  } catch (err) {
    console.error('GET /analytics/daily-extra error:', err);
    res.status(500).json({ error: 'Failed to fetch daily extra' });
  }
});
