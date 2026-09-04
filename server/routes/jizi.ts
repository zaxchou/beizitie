import { Router, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { Converter } from 'opencc-js';
import { getDb } from '../db.js';
import { JWT_SECRET } from '../middleware/auth.js';
import { isIndexReady } from '../services/jiziIndex.js';

export const jiziRouter = Router();

// 每个字最多返回的变体数：常用字在全部字库里可能有几千条命中，
// 全量返回会让响应膨胀到十几 MB，500 个变体对用户已不可枚举
const MAX_HITS_PER_CHAR = 500;

// 简→繁规范化器
const toTraditional = Converter({ from: 'cn', to: 'tw' });

/** 解析请求中的用户 token（如果有） */
function resolveUser(req: Request): { userId?: string } {
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith('Bearer ')) {
    try {
      const payload = jwt.verify(authHeader.slice(7), JWT_SECRET) as { userId: string };
      return { userId: payload.userId };
    } catch { /* 静默忽略 */ }
  }
  return {};
}

/** 清洗 front_text：去括号后缀、下划线数字、尾部纯数字，返回核心汉字 */
function cleanFrontText(raw: string): string {
  if (!raw) return '';
  let s = raw.trim();
  s = s.replace(/\s*[(\[【（][^)\]】]*[)\]】]?$/u, '');
  s = s.replace(/[_\-]\d+$/u, '');
  s = s.replace(/(\p{Script=Han})\d{1,3}$/u, '$1');
  s = s.replace(/\s+/g, '');
  return s;
}

interface CharHit {
  card_id: string;
  image_url: string;
  deck_id: string;
  deck_name: string;
  style: string;
  calligrapher: string;
  front_text_raw: string;
  sort_key: number;
}

interface JiziMatchResult {
  char: string;
  hits: CharHit[];
}

// GET /api/jizi/match?text=春江花月夜&scope=all
jiziRouter.get('/match', async (req: Request, res: Response) => {
  try {
    const text = (req.query.text as string || '').trim();
    const scope = (req.query.scope as string || '').trim() === 'all' ? 'all' : 'mine';
    const { userId } = resolveUser(req);
    // 未登录用户自动使用全部公开字库
    const effectiveScope = !userId ? 'all' : scope;

    if (!text) {
      res.json({ results: [], meta: { scanned: 0, ms: 0, unique_chars: 0 } });
      return;
    }

    const chars = Array.from(text).filter((c) => /\p{Script=Han}/u.test(c));
    if (chars.length === 0) {
      res.json({ results: [], meta: { scanned: 0, ms: 0, unique_chars: 0 } });
      return;
    }
    if (chars.length > 500) {
      res.status(400).json({ error: '单次最多 500 字' });
      return;
    }

    const db = getDb();
    const t0 = Date.now();

    const uniqueChars = [...new Set(chars.map((c) => toTraditional(c)))];

    const groupRows = (
      rows: Array<{
        card_id: string;
        hanzi: string;
        image_url: string;
        deck_id: string;
        deck_name: string;
        style: string;
        calligrapher: string;
        sort_key: string | number;
      }>
    ) => {
      const map = new Map<string, CharHit[]>();
      for (const r of rows) {
        let arr = map.get(r.hanzi);
        if (!arr) {
          arr = [];
          map.set(r.hanzi, arr);
        }
        arr.push({
          card_id: r.card_id,
          image_url: r.image_url,
          deck_id: r.deck_id,
          deck_name: r.deck_name,
          style: r.style || '',
          calligrapher: r.calligrapher || '',
          front_text_raw: '',
          sort_key: Number(r.sort_key),
        });
      }
      return map;
    };

    let map: Map<string, CharHit[]> = new Map();
    let scanned = 0;

    // 索引已构建 → hanzi 索引命中（毫秒级）。
    // 未构建时默认返回空（宁可缺字不可错字）：回退全表扫描已被证实会吐出
    // 以观源站随机漂移的错误标签，仅显式设 JIZI_FALLBACK_SCAN=true 才启用。
    if (await isIndexReady(db)) {
      const capSql = `SELECT * FROM (
         SELECT ji.hanzi, ji.card_id, ji.image_url, ji.deck_id, ji.deck_name,
                ji.style, ji.calligrapher, ji.sort_key,
                ROW_NUMBER() OVER (PARTITION BY ji.hanzi ORDER BY ji.sort_key ASC) AS rn
         FROM jizi_index ji
         JOIN decks d0 ON d0.id = ji.deck_id
         WHERE ji.hanzi = ANY($1)`;
      if (effectiveScope === 'all') {
        const { rows } = await db.query(
          `${capSql}
           ) ranked WHERE rn <= ${MAX_HITS_PER_CHAR}`,
          [uniqueChars]
        );
        map = groupRows(rows as never);
        scanned = rows.length;
      } else {
        const { rows } = await db.query(
          `${capSql}
             AND (
               d0.user_id = $2
               OR EXISTS (
                 SELECT 1 FROM user_subscriptions us
                 WHERE us.user_id = $2 AND us.deck_id = ji.deck_id
               )
             )
           ) ranked WHERE rn <= ${MAX_HITS_PER_CHAR}`,
          [uniqueChars, userId]
        );
        map = groupRows(rows as never);
        scanned = rows.length;
      }
    } else if (process.env.JIZI_FALLBACK_SCAN === 'true') {
      let rows: Array<{
        id: string;
        deck_id: string;
        front_text: string;
        image_url: string;
        created_at: string;
        deck_name: string;
        style: string | null;
        calligrapher: string | null;
      }>;

      if (effectiveScope === 'all') {
        rows = (await db.query(
          `SELECT c.id, c.deck_id, c.front_text, c.image_url, c.created_at,
                  d.name AS deck_name,
                  md.style, md.calligrapher
           FROM cards c
           JOIN decks d ON d.id = c.deck_id
           JOIN marketplace_decks md ON md.deck_id = c.deck_id
           WHERE c.image_url != ''
           ORDER BY c.created_at ASC`
        )).rows as typeof rows;
      } else {
        rows = (await db.query(
          `SELECT c.id, c.deck_id, c.front_text, c.image_url, c.created_at,
                  d.name AS deck_name,
                  md.style, md.calligrapher
           FROM cards c
           JOIN decks d ON d.id = c.deck_id
           LEFT JOIN marketplace_decks md ON md.deck_id = c.deck_id
           WHERE c.image_url != ''
             AND (
               d.user_id = $1
               OR EXISTS (
                 SELECT 1 FROM user_subscriptions us
                 WHERE us.user_id = $2 AND us.deck_id = c.deck_id
               )
             )
           ORDER BY c.created_at ASC`,
          [userId, userId]
        )).rows as typeof rows;
      }

      scanned = rows.length;
      map = new Map<string, CharHit[]>();
      for (const r of rows) {
        const cleaned = cleanFrontText(r.front_text);
        if (!cleaned) continue;
        const singleChars = Array.from(cleaned).filter((c) => /\p{Script=Han}/u.test(c));
        if (singleChars.length !== 1) continue;
        const ch = toTraditional(singleChars[0]);
        let arr = map.get(ch);
        if (!arr) {
          arr = [];
          map.set(ch, arr);
        }
        arr.push({
          card_id: r.id,
          image_url: r.image_url,
          deck_id: r.deck_id,
          deck_name: r.deck_name,
          style: r.style || '',
          calligrapher: r.calligrapher || '',
          front_text_raw: r.front_text,
          sort_key: new Date(r.created_at).getTime(),
        });
      }
    }

    const results: JiziMatchResult[] = chars.map((ch) => ({
      char: ch,
      hits: (map.get(toTraditional(ch)) || []).sort((a, b) => a.sort_key - b.sort_key),
    }));
    // 回退被禁用时索引里也没有数据 → 结果为空（前端显示缺字），符合"宁缺勿错"
    res.setHeader('X-Jizi-Mode', process.env.JIZI_FALLBACK_SCAN === 'true' ? 'scan' : 'verified-only');

    res.json({
      results,
      meta: {
        scanned,
        ms: Date.now() - t0,
        unique_chars: map.size,
      },
    });
  } catch (err) {
    console.error('GET /api/jizi/match error:', err);
    res.status(500).json({ error: 'Failed to match chars' });
  }
});

// GET /api/jizi/history — 获取最近 20 条搜索记录
jiziRouter.get('/history', async (req: Request, res: Response) => {
  try {
    const { userId } = resolveUser(req);
    if (!userId) {
      res.status(401).json({ error: '请先登录' });
      return;
    }
    const db = getDb();
    const { rows } = await db.query(
      `SELECT id, text, created_at
       FROM jizi_history
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT 20`,
      [userId]
    );
    res.json({ items: rows });
  } catch (err) {
    console.error('GET /api/jizi/history error:', err);
    res.status(500).json({ error: '获取历史失败' });
  }
});

// POST /api/jizi/history — 保存搜索记录（自动去重最近一条）
jiziRouter.post('/history', async (req: Request, res: Response) => {
  try {
    const { userId } = resolveUser(req);
    if (!userId) {
      res.status(401).json({ error: '请先登录' });
      return;
    }
    const { text } = req.body as { text?: string };
    if (!text || typeof text !== 'string' || !text.trim()) {
      res.status(400).json({ error: '文本不能为空' });
      return;
    }
    const trimmed = text.trim();
    const db = getDb();

    // 去重：如果最近一条相同则跳过
    const { rows: recent } = await db.query(
      `SELECT text FROM jizi_history
       WHERE user_id = $1
       ORDER BY created_at DESC LIMIT 1`,
      [userId]
    );
    if (recent.length > 0 && recent[0].text === trimmed) {
      res.json({ saved: false, reason: 'duplicate' });
      return;
    }

    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    await db.query(
      `INSERT INTO jizi_history (id, user_id, text, created_at) VALUES ($1, $2, $3, $4)`,
      [id, userId, trimmed, now]
    );
    res.json({ saved: true, id, created_at: now });
  } catch (err) {
    console.error('POST /api/jizi/history error:', err);
    res.status(500).json({ error: '保存历史失败' });
  }
});

// DELETE /api/jizi/history/:id — 删除一条搜索记录
jiziRouter.delete('/history/:id', async (req: Request, res: Response) => {
  try {
    const { userId } = resolveUser(req);
    if (!userId) {
      res.status(401).json({ error: '请先登录' });
      return;
    }
    const { id } = req.params;
    const db = getDb();
    const { rowCount } = await db.query(
      `DELETE FROM jizi_history WHERE id = $1 AND user_id = $2`,
      [id, userId]
    );
    if (rowCount === 0) {
      res.status(404).json({ error: '记录不存在' });
      return;
    }
    res.json({ success: true });
  } catch (err) {
    console.error('DELETE /api/jizi/history/:id error:', err);
    res.status(500).json({ error: '删除失败' });
  }
});
