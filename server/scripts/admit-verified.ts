/**
 * 将一个 deck 记入 jizi_verified 并（重）建其集字索引。
 * 用于跨源互证等特殊校验通道的收录（正常批量通道走 ygsf-majority-verify）。
 *
 * 用法: npx tsx server/scripts/admit-verified.ts <deckId> <zitieId>
 */
import { getDb, waitForDb } from '../db.js';
import { indexDeck } from '../services/jiziIndex.js';

async function main() {
  const [deckId, zitieId] = process.argv.slice(2);
  if (!deckId || !zitieId) throw new Error('用法: tsx admit-verified.ts <deckId> <zitieId>');
  await waitForDb();
  const db = getDb();
  const name = await db.query('SELECT name, source_key FROM decks WHERE id = $1', [deckId]);
  if (name.rows.length === 0) throw new Error(`deck 不存在: ${deckId}`);
  await db.query(
    `INSERT INTO jizi_verified (deck_id, zitie_id, verified_at) VALUES ($1, $2, $3)
     ON CONFLICT (deck_id) DO UPDATE SET zitie_id = EXCLUDED.zitie_id, verified_at = EXCLUDED.verified_at`,
    [deckId, zitieId, new Date().toISOString()],
  );
  const n = await indexDeck(db, deckId);
  console.log(`✅ 已收录: ${name.rows[0].name} (${name.rows[0].source_key}) → 集字索引 ${n} 字`);
  process.exit(0);
}

main().catch((e) => {
  console.error('失败:', e.message);
  process.exit(1);
});
