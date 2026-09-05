import type pkg from 'pg';
import { Converter } from 'opencc-js';

// 简→繁规范化器（与 jizi 路由保持同一转换目标）
const toTraditional = Converter({ from: 'cn', to: 'tw' });

/** 清洗 front_text：去括号后缀、下划线数字、尾部纯数字，返回核心汉字 */
export function cleanFrontText(raw: string): string {
  if (!raw) return '';
  let s = raw.trim();
  s = s.replace(/\s*[(\[【（][^)\]】]*[)\]】]?$/u, '');
  s = s.replace(/[_\-]\d+$/u, '');
  s = s.replace(/(\p{Script=Han})\d{1,3}$/u, '$1');
  s = s.replace(/\s+/g, '');
  return s;
}

/** front_text 规范化后必须恰好是一个汉字才进入索引 */
function coreHanzi(raw: string): string | null {
  const cleaned = cleanFrontText(raw);
  if (!cleaned) return null;
  const chars = Array.from(cleaned).filter((c) => /\p{Script=Han}/u.test(c));
  if (chars.length !== 1) return null;
  return toTraditional(chars[0]);
}

interface IndexRow {
  card_id: string;
  hanzi: string;
  image_url: string;
  deck_id: string;
  deck_name: string;
  style: string;
  calligrapher: string;
  sort_key: number;
}

const BATCH = 2000;

async function upsertRows(db: pkg.Pool, rows: IndexRow[]): Promise<number> {
  let n = 0;
  for (let i = 0; i < rows.length; i += BATCH) {
    const chunk = rows.slice(i, i + BATCH);
    const values: unknown[] = [];
    const placeholders = chunk.map((r, j) => {
      const b = j * 8;
      values.push(r.card_id, r.hanzi, r.image_url, r.deck_id, r.deck_name, r.style, r.calligrapher, r.sort_key);
      return `($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5},$${b + 6},$${b + 7},$${b + 8})`;
    });
    await db.query(
      `INSERT INTO jizi_index (card_id, hanzi, image_url, deck_id, deck_name, style, calligrapher, sort_key)
       VALUES ${placeholders.join(',')}
       ON CONFLICT (card_id) DO UPDATE SET
         hanzi = EXCLUDED.hanzi,
         image_url = EXCLUDED.image_url,
         deck_id = EXCLUDED.deck_id,
         deck_name = EXCLUDED.deck_name,
         style = EXCLUDED.style,
         calligrapher = EXCLUDED.calligrapher,
         sort_key = EXCLUDED.sort_key`,
      values
    );
    n += chunk.length;
  }
  return n;
}

/** 将一批 cards 查询结果转换为索引行并 upsert */
export async function indexCardRows(
  db: pkg.Pool,
  rows: Array<{
    id: string;
    deck_id: string;
    front_text: string;
    image_url: string;
    created_at: string | null;
    deck_name: string;
    style: string | null;
    calligrapher: string | null;
  }>
): Promise<number> {
  const out: IndexRow[] = [];
  for (const r of rows) {
    if (!r.image_url) continue;
    const hanzi = coreHanzi(r.front_text);
    if (!hanzi) continue;
    out.push({
      card_id: r.id,
      hanzi,
      image_url: r.image_url,
      deck_id: r.deck_id,
      deck_name: r.deck_name || '',
      style: r.style || '',
      calligrapher: r.calligrapher || '',
      sort_key: r.created_at ? new Date(r.created_at).getTime() : 0,
    });
  }
  return upsertRows(db, out);
}

/** 全量重建（幂等，内容缓存表，不影响用户数据）。verifiedOnly: 只收录非 ygsf 帖 + 原文对齐校验过的帖 */
export async function buildFull(db: pkg.Pool, verifiedOnly = false): Promise<{ indexed: number; ms: number }> {
  const t0 = Date.now();
  let indexed = 0;
  const vFilter = verifiedOnly
    ? ` AND (d.source_key NOT LIKE 'ygsf:%' OR d.source_key IN (SELECT 'ygsf:' || zitie_id FROM jizi_verified))`
    : '';
  await db.query('BEGIN');
  try {
    await db.query('DELETE FROM jizi_index');
    let cursor = '';
    for (;;) {
      const { rows } = await db.query(
        `SELECT c.id, c.deck_id, c.front_text, c.image_url, c.created_at,
                d.name AS deck_name, md.style, md.calligrapher
         FROM cards c
         JOIN decks d ON d.id = c.deck_id
         LEFT JOIN marketplace_decks md ON md.deck_id = c.deck_id
         WHERE c.id > $1 AND c.image_url != '' AND c.archived_at IS NULL${vFilter}
         ORDER BY c.id ASC LIMIT 20000`,
        [cursor]
      );
      if (rows.length === 0) break;
      cursor = rows[rows.length - 1].id;
      indexed += await indexCardRows(db, rows as never);
    }
    await db.query('COMMIT');
  } catch (err) {
    await db.query('ROLLBACK');
    throw err;
  }
  await saveState(db);
  return { indexed, ms: Date.now() - t0 };
}

/** 增量：只处理上次构建之后新增/修改的卡片，并刷新市场元数据（style/calligrapher） */
export async function buildIncremental(db: pkg.Pool): Promise<{ indexed: number; ms: number }> {
  const t0 = Date.now();
  const state = await getState(db);
  const since = state?.built_at ?? new Date(0).toISOString();

  let indexed = 0;
  let cursor = '';
  for (;;) {
    const { rows } = await db.query(
      `SELECT c.id, c.deck_id, c.front_text, c.image_url, c.created_at,
              d.name AS deck_name, md.style, md.calligrapher
       FROM cards c
       JOIN decks d ON d.id = c.deck_id
       LEFT JOIN marketplace_decks md ON md.deck_id = c.deck_id
       WHERE c.id > $1 AND c.image_url != '' AND c.archived_at IS NULL
         AND (c.created_at > $2 OR c.updated_at > $2)
       ORDER BY c.id ASC LIMIT 20000`,
      [cursor, since]
    );
    if (rows.length === 0) break;
    cursor = rows[rows.length - 1].id;
    indexed += await indexCardRows(db, rows as never);
  }

  // 市场元数据变化（改风格/书家）不触发 cards.updated_at，这里对账刷新
  await db.query(
    `UPDATE jizi_index ji SET style = md.style, calligrapher = md.calligrapher
     FROM marketplace_decks md
     WHERE md.deck_id = ji.deck_id
       AND (ji.style IS DISTINCT FROM COALESCE(md.style, '')
         OR ji.calligrapher IS DISTINCT FROM COALESCE(md.calligrapher, ''))`
  );

  await saveState(db);
  return { indexed, ms: Date.now() - t0 };
}

/** 按牌组索引（导入单帖后调用，行数有限，开销可忽略） */
export async function indexDeck(db: pkg.Pool | pkg.PoolClient, deckId: string): Promise<number> {
  const { rows } = await db.query(
    `SELECT c.id, c.deck_id, c.front_text, c.image_url, c.created_at,
            d.name AS deck_name, md.style, md.calligrapher
     FROM cards c
     JOIN decks d ON d.id = c.deck_id
     LEFT JOIN marketplace_decks md ON md.deck_id = c.deck_id
     WHERE c.deck_id = $1 AND c.image_url != '' AND c.archived_at IS NULL`,
    [deckId]
  );
  const n = await indexCardRows(db, rows as never);
  await saveState(db);
  return n;
}

async function getState(db: pkg.Pool): Promise<{ built_at: string; card_count: number } | null> {
  const { rows } = await db.query(
    `SELECT built_at, card_count FROM jizi_index_state WHERE id = 1`
  );
  return rows[0] ?? null;
}

async function saveState(db: pkg.Pool): Promise<void> {
  const { rows } = await db.query(`SELECT COUNT(*)::bigint AS n FROM jizi_index`);
  await db.query(
    `INSERT INTO jizi_index_state (id, built_at, card_count) VALUES (1, $1, $2)
     ON CONFLICT (id) DO UPDATE SET built_at = EXCLUDED.built_at, card_count = EXCLUDED.card_count`,
    [new Date().toISOString(), Number(rows[0].n)]
  );
}

/** 索引是否已构建过（match 路由据此决定走索引还是回退全表扫描） */
export async function isIndexReady(db: pkg.Pool): Promise<boolean> {
  const s = await getState(db);
  return !!s && s.card_count > 0;
}
