/**
 * 上图碑帖库 deck 导入器（馆方来源打样）
 *
 * 用法（在 /opt/zi2anki 运行）：
 *   npx tsx server/scripts/shlib-import-deck.ts <deck.json 路径>
 *
 * 幂等：按 decks.source_key = 'shlib:<zitie_id>' 查找旧帖，存在则整册内容更新。
 * 重建保留用户数据：deck id 不变（订阅不动），卡片按 source_key（shlib:<zitie_id>:<pos>）
 * 复用旧 id（学习进度跟着卡走），只更新内容字段；包里已移除的字才连带进度一起删。
 * 全程单事务，失败整体回滚，不留半册脏数据。
 *
 * 上架口径：shlib 来源图片为馆方 IIIF 直链，官方单字标注；导入即视为已校验
 * （打样前已经 12 字人工目验 + 帖序原文连贯性核对），写入 jizi_verified 并建集字索引。
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import { getDb, waitForDb } from '../db.js';
import { indexDeck } from '../services/jiziIndex.js';

interface ShlibCard {
  char: string;
  crop_url: string;
  pos: number;
  sentence: string;
  page_url: string;
  x: number; y: number; w: number; h: number;
}
interface ShlibPackage {
  source: string;
  zitie_id: string;
  name: string;
  calligrapher: string;
  dynasty: string;
  styles: string[];
  description: string;
  attribution: string;
  cover_image: string;
  cards: ShlibCard[];
}

const CHUNK = 200;
const ctxOf = (c: ShlibCard) => JSON.stringify({ p: c.page_url, x: c.x, y: c.y, w: c.w, h: c.h, s: c.sentence || '' });

async function main() {
  const file = process.argv[2];
  if (!file) throw new Error('用法: tsx shlib-import-deck.ts <deck.json>');
  const pkg = JSON.parse(fs.readFileSync(file, 'utf-8')) as ShlibPackage;
  if (pkg.source !== 'shlib' || !pkg.zitie_id || !pkg.cards?.length) {
    throw new Error('JSON 包缺少 source/zitie_id/cards');
  }
  await waitForDb();
  const db = getDb();
  const sourceKey = `shlib:${pkg.zitie_id}`;
  const now = new Date().toISOString();
  const client = await db.connect();

  try {
    await client.query('BEGIN');

    // 找旧帖（幂等重建：deck id 保持不变，订阅关系不受影响）
    const old = await client.query('SELECT id FROM decks WHERE source_key = $1', [sourceKey]);
    let deckId: string;
    if (old.rows.length > 0) {
      deckId = old.rows[0].id as string;
      console.log(`发现旧帖 ${deckId}，内容更新（deck id 与用户进度/订阅保持不变）…`);
      await client.query(
        'UPDATE decks SET name = $2, card_count = $3, updated_at = $4 WHERE id = $1',
        [deckId, pkg.name, pkg.cards.length, now],
      );
    } else {
      // 归属到管理员名下（与 ygsf 帖一致）
      const admin = await client.query(`SELECT id FROM users WHERE role = 'admin' ORDER BY created_at LIMIT 1`);
      const ownerId = admin.rows[0]?.id ?? null;
      deckId = crypto.randomUUID();
      await client.query(
        `INSERT INTO decks (id, name, card_count, daily_new_card_limit, daily_review_limit, user_id, created_at, updated_at, source_key, content_version)
         VALUES ($1, $2, $3, 20, 200, $4, $5, $5, $6, 1)`,
        [deckId, pkg.name, pkg.cards.length, ownerId, now, sourceKey],
      );
    }

    // 卡片按 source_key 对账：已有卡复用 id 只更内容（进度保留），新卡插入
    const want = new Map<string, ShlibCard>();
    for (const c of pkg.cards) want.set(`${sourceKey}:${c.pos}`, c);
    const existing = await client.query(
      'SELECT id, source_key FROM cards WHERE deck_id = $1 AND source_key IS NOT NULL',
      [deckId],
    );
    const existingId = new Map<string, string>();
    for (const r of existing.rows) existingId.set(r.source_key as string, r.id as string);

    const updates: Array<{ id: string; c: ShlibCard }> = [];
    const inserts: Array<{ id: string; key: string; c: ShlibCard }> = [];
    for (const [key, c] of want) {
      const cardId = existingId.get(key);
      if (cardId) updates.push({ id: cardId, c });
      else inserts.push({ id: crypto.randomUUID(), key, c });
    }

    // 已有卡：批量 UPDATE（进度跟着 id 保留）
    for (let i = 0; i < updates.length; i += CHUNK) {
      const chunk = updates.slice(i, i + CHUNK);
      const values: unknown[] = [];
      const tuples = chunk.map((u, j) => {
        const b = j * 6;
        values.push(u.c.char, u.c.sentence || '', u.c.crop_url, ctxOf(u.c), now, u.id);
        return `($${b + 1}, $${b + 2}, $${b + 3}, $${b + 4}::jsonb, $${b + 5}, $${b + 6})`;
      }).join(',');
      await client.query(
        `UPDATE cards SET front_text = v.f, back_text = v.b, image_url = v.i, context = v.c, updated_at = v.t
         FROM (VALUES ${tuples}) AS v(f, b, i, c, t, id)
         WHERE cards.id = v.id::text`,
        values,
      );
    }

    // 新卡：分批插入（生产库 cards.user_id 默认 '' 违反 fk_cards_user，必须显式 NULL）
    for (let i = 0; i < inserts.length; i += CHUNK) {
      const chunk = inserts.slice(i, i + CHUNK);
      const values: unknown[] = [];
      const tuples = chunk.map((u, j) => {
        const b = j * 10;
        values.push(u.id, deckId, u.c.char, u.c.sentence || '', u.c.crop_url, u.key, u.c.pos, ctxOf(u.c), now, now);
        return `($${b + 1}, $${b + 2}, NULL, $${b + 3}, $${b + 4}, $${b + 5}, $${b + 6}, $${b + 7}, $${b + 8}::jsonb, 2.5, 0, 0, $${b + 9}, $${b + 10}, $${b + 10})`;
      }).join(',');
      await client.query(
        `INSERT INTO cards (id, deck_id, user_id, front_text, back_text, image_url, source_key, sort_order, context, ease, interval, repetitions, next_review, created_at, updated_at)
         VALUES ${tuples.join(',')}`,
        values,
      );
    }

    // 包里已移除的字：连带进度一起删（订阅不动）
    const wantKeys = new Set(want.keys());
    const staleIds = [...existingId.entries()].filter(([k]) => !wantKeys.has(k)).map(([, id]) => id);
    for (let i = 0; i < staleIds.length; i += CHUNK) {
      const chunk = staleIds.slice(i, i + CHUNK);
      await client.query('DELETE FROM user_card_progress WHERE card_id = ANY($1)', [chunk]);
      await client.query('DELETE FROM cards WHERE id = ANY($1)', [chunk]);
    }

    await client.query(
      `INSERT INTO marketplace_decks (deck_id, calligrapher, dynasty, style, description, cover_image, featured, sort_order, published_at, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, 0, 0, $7, $7)
       ON CONFLICT (deck_id) DO UPDATE SET
         calligrapher = EXCLUDED.calligrapher, dynasty = EXCLUDED.dynasty, style = EXCLUDED.style,
         description = EXCLUDED.description, cover_image = EXCLUDED.cover_image`,
      [deckId, pkg.calligrapher || '', pkg.dynasty || '', (pkg.styles || []).join(','), pkg.description || '', pkg.cover_image || '', now],
    );

    // 官方标注 + 人工目验通过 → 直接记入已校验，收录集字
    await client.query(
      `INSERT INTO jizi_verified (deck_id, zitie_id, verified_at) VALUES ($1, $2, $3)
       ON CONFLICT (deck_id) DO UPDATE SET zitie_id = EXCLUDED.zitie_id, verified_at = EXCLUDED.verified_at`,
      [deckId, pkg.zitie_id, now],
    );
    await indexDeck(client, deckId);

    await client.query('COMMIT');
    console.log(`✅ 导入完成：${pkg.name}`);
    console.log(`   deck_id = ${deckId}`);
    console.log(`   卡片 ${pkg.cards.length}（更新 ${updates.length} / 新增 ${inserts.length} / 移除 ${staleIds.length}），集字索引已刷新`);
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
  process.exit(0);
}

main().catch((e) => {
  console.error('失败:', e.message);
  process.exit(1);
});
