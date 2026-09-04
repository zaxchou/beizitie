/**
 * 字图对应校验工具：对比 DB 卡片标签与 YGSF 快照(page/glyphs,稳定真源)。
 * 匹配键 = 图片文件名（_id 与文件名在部分帖上不同命名空间，不可作键）。
 * 用法: npx tsx server/scripts/ygsf-verify-deck.ts <zitieId> [deckId]
 */
import { getDb, waitForDb } from '../db.js';
import { fetchZitieGlyphsSnapshot, loadYgsfToken } from '../services/ygsf.js';

async function main() {
  const zitieId = process.argv[2];
  const deckIdArg = process.argv[3] || '';
  const token = loadYgsfToken();

  // 1. 快照字形（文件名 → hanzi）
  const { glyphs } = await fetchZitieGlyphsSnapshot(zitieId, token);
  const fresh = new Map<string, { hanzi: string; idx: number }>();
  glyphs.forEach((g, i) => {
    const m = /([a-f0-9]{32})_?\.png/i.exec(g.colorImage || '');
    if (m) fresh.set(m[1], { hanzi: (g.hanzi || '').trim(), idx: i });
  });
  console.log(`[ygsf] 快照 ${fresh.size} 字形，前20: ${glyphs.slice(0, 20).map((g) => g.hanzi).join('')}`);

  // 2. 库内卡片
  await waitForDb();
  const db = getDb();
  const where = deckIdArg ? `c.deck_id = $1` : `d.source_key = $1`;
  const { rows } = await db.query(
    `SELECT c.front_text, c.image_url, c.sort_order
     FROM cards c JOIN decks d ON d.id = c.deck_id
     WHERE ${where} AND c.image_url LIKE '%areas/%' AND c.archived_at IS NULL
     ORDER BY c.sort_order`,
    [deckIdArg || `ygsf:${zitieId}`]
  );
  console.log(`[db] 卡片 ${rows.length} 张`);

  // 3. 文件名 → 双方标签比对
  const idRe = /areas\/[a-f0-9]+\/\d+\/([a-f0-9]{32})_\.png/;
  let missing = 0, mismatch = 0, match = 0;
  const samples: string[] = [];
  for (const r of rows) {
    const m = idRe.exec(r.image_url);
    if (!m) continue;
    const f = fresh.get(m[1]);
    if (!f) {
      missing++;
      if (samples.length < 15) samples.push(`缺失 sort=${r.sort_order} db=${r.front_text}`);
      continue;
    }
    if (f.hanzi !== r.front_text) {
      mismatch++;
      if (samples.length < 15) samples.push(`不符 sort=${r.sort_order} db=${r.front_text} 快照=${f.hanzi}`);
    } else match++;
  }
  console.log(`[比对] 一致=${match} 不符=${mismatch} 源缺失=${missing}`);
  for (const s of samples) console.log('  ' + s);

  // 4. 顺序比对（前 20）
  const dbOrder = rows.slice(0, 20).map((r) => r.front_text).join('');
  const ygsfOrder = [...fresh.entries()].sort((a, b) => a[1].idx - b[1].idx).slice(0, 20).map(([, v]) => v.hanzi).join('');
  console.log(`[顺序] db 前20:   ${dbOrder}`);
  console.log(`[顺序] 快照前20: ${ygsfOrder}`);

  process.exit(0);
}

main().catch((e) => {
  console.error('诊断失败:', e.message || e);
  process.exit(1);
});
