/**
 * 市场封面死链巡检：HEAD 检查所有 ygsf 远程封面，把 404 的置空（市场查询自动回退首字图）。
 * 用法: npx tsx server/scripts/ygsf-cover-sweep.ts
 */
import { getDb, waitForDb } from '../db.js';

async function head(url: string): Promise<boolean> {
  try {
    const r = await fetch(url, { method: 'HEAD', headers: { 'User-Agent': 'Mozilla/5.0' } });
    return r.ok;
  } catch {
    return false;
  }
}

async function main() {
  await waitForDb();
  const db = getDb();
  const { rows } = await db.query(
    `SELECT m.deck_id, d.name, m.cover_thumb, m.cover_image
     FROM marketplace_decks m JOIN decks d ON d.id = m.deck_id
     WHERE m.cover_image LIKE 'https://ygsf%' OR m.cover_thumb LIKE 'https://ygsf%'`,
  );
  console.log(`待巡检 ${rows.length} 帖`);
  const dead: { deck_id: string; name: string; cover_image: string }[] = [];
  const CONCURRENCY = 12;
  for (let i = 0; i < rows.length; i += CONCURRENCY) {
    const batch = rows.slice(i, i + CONCURRENCY);
    await Promise.all(
      batch.map(async (r: any) => {
        const url = r.cover_thumb || r.cover_image;
        const ok = await head(url);
        if (!ok) dead.push(r);
      }),
    );
    process.stdout.write(`\r已检 ${Math.min(i + CONCURRENCY, rows.length)}/${rows.length}，死链 ${dead.length}`);
    await new Promise((r) => setTimeout(r, 150));
  }
  console.log();
  for (const r of dead) {
    await db.query(`UPDATE marketplace_decks SET cover_image = '', cover_thumb = '' WHERE deck_id = $1`, [r.deck_id]);
    console.log(`已清空死链封面: ${r.name}`);
  }
  console.log(`完成：巡检 ${rows.length}，清理死链 ${dead.length}`);
  process.exit(0);
}

main().catch((e) => {
  console.error('失败:', e.message);
  process.exit(1);
});
