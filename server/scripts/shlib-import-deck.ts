/**
 * 上图碑帖库 deck 导入器（馆方来源打样）
 *
 * 用法（在 /opt/zi2anki 运行）：
 *   npx tsx server/scripts/shlib-import-deck.ts <deck.json 路径>
 *
 * 幂等：按 decks.source_key = 'shlib:<zitie_id>' 查找旧帖，存在则整册重建
 * （卡片、进度、市场行、集字索引全部清掉重来），可反复执行。
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

  // 找旧帖（幂等重建）
  const old = await db.query('SELECT id FROM decks WHERE source_key = $1', [sourceKey]);
  if (old.rows.length > 0) {
    const oldId = old.rows[0].id as string;
    console.log(`发现旧帖 ${oldId}，整册重建…`);
    await db.query('DELETE FROM user_card_progress WHERE card_id IN (SELECT id FROM cards WHERE deck_id = $1)', [oldId]);
    await db.query('DELETE FROM user_subscriptions WHERE deck_id = $1', [oldId]);
    await db.query('DELETE FROM jizi_index WHERE deck_id = $1', [oldId]);
    await db.query('DELETE FROM jizi_verified WHERE deck_id = $1', [oldId]);
    await db.query('DELETE FROM marketplace_decks WHERE deck_id = $1', [oldId]);
    await db.query('DELETE FROM cards WHERE deck_id = $1', [oldId]);
    await db.query('DELETE FROM decks WHERE id = $1', [oldId]);
  }

  // 归属到管理员名下（与 ygsf 帖一致）
  const admin = await db.query(`SELECT id FROM users WHERE role = 'admin' ORDER BY created_at LIMIT 1`);
  const ownerId = admin.rows[0]?.id ?? null;
  const deckId = crypto.randomUUID();

  await db.query(
    `INSERT INTO decks (id, name, card_count, daily_new_card_limit, daily_review_limit, user_id, created_at, updated_at, source_key, content_version)
     VALUES ($1, $2, $3, 20, 200, $4, $5, $5, $6, 1)`,
    [deckId, pkg.name, pkg.cards.length, ownerId, now, sourceKey],
  );

  for (let i = 0; i < pkg.cards.length; i += CHUNK) {
    const batch = pkg.cards.slice(i, i + CHUNK);
    const values: unknown[] = [];
    const tuples = batch.map((c, j) => {
      const b = j * 10;
      values.push(
        crypto.randomUUID(), deckId, c.char, c.sentence || '', c.crop_url,
        `${sourceKey}:${c.pos}`, c.pos,
        JSON.stringify({ p: c.page_url, x: c.x, y: c.y, w: c.w, h: c.h, s: c.sentence || '' }),
        now, now,
      );
      return `($${b + 1}, $${b + 2}, NULL, $${b + 3}, $${b + 4}, $${b + 5}, $${b + 6}, $${b + 7}, $${b + 8}, 2.5, 0, 0, $${b + 9}, $${b + 10}, $${b + 10})`;
    });
    await db.query(
      `INSERT INTO cards (id, deck_id, front_text, back_text, image_url, source_key, sort_order, context, ease, interval, repetitions, next_review, created_at, updated_at)
       VALUES ${tuples.join(',')}`,
      values,
    );
  }

  await db.query(
    `INSERT INTO marketplace_decks (deck_id, calligrapher, dynasty, style, description, cover_image, featured, sort_order, published_at, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, 0, 0, $7, $7)
     ON CONFLICT (deck_id) DO UPDATE SET
       calligrapher = EXCLUDED.calligrapher, dynasty = EXCLUDED.dynasty, style = EXCLUDED.style,
       description = EXCLUDED.description, cover_image = EXCLUDED.cover_image, published_at = EXCLUDED.published_at`,
    [deckId, pkg.calligrapher || '', pkg.dynasty || '', (pkg.styles || []).join(','), pkg.description || '', pkg.cover_image || '', now],
  );

  // 官方标注 + 人工目验通过 → 直接记入已校验，收录集字
  await db.query(
    `INSERT INTO jizi_verified (deck_id, zitie_id, verified_at) VALUES ($1, $2, $3)
     ON CONFLICT (deck_id) DO UPDATE SET zitie_id = EXCLUDED.zitie_id, verified_at = EXCLUDED.verified_at`,
    [deckId, pkg.zitie_id, now],
  );
  const n = await indexDeck(db, deckId);

  console.log(`✅ 导入完成：${pkg.name}`);
  console.log(`   deck_id = ${deckId}`);
  console.log(`   卡片 ${pkg.cards.length}，集字索引 ${n} 字`);
  process.exit(0);
}

main().catch((e) => {
  console.error('失败:', e.message);
  process.exit(1);
});
