/**
 * 巡检补缺（轻量版）：市场行缺封面/简介/书家/朝代的已导入帖，只调 zitie/details 接口补元数据。
 * 与 ygsf-catalog --enrich 的区别：不拉碑帖原文（那要每帖 6 次 API，慢一个数量级）；
 * 简介缺失时用模板（作品名/朝代书家/书体/字数页数），已有简介不覆盖。
 *
 * 用法：npx tsx server/scripts/ygsf-enrich-gaps.ts
 * 适合挂 cron 或大批量导入后手动跑；幂等，重复执行只补仍缺的字段。
 */
import { getDb, waitForDb } from '../db.js';
import { fetchZitieDetails, loadYgsfToken } from '../services/ygsf.js';

async function main() {
  const token = loadYgsfToken();
  const db = getDb();
  await waitForDb();

  const { rows } = await db.query(`
    SELECT z.name, z.zitie_id, z.style,
           md.deck_id, md.description, md.dynasty,
           (SELECT COUNT(*)::int FROM cards c WHERE c.deck_id = z.imported_deck_id) AS glyph_count,
           (md.cover_thumb IS NULL OR md.cover_thumb = '') AND COALESCE(md.cover_image,'') = '' AS no_cover
    FROM ygsf_zuopin z
    JOIN marketplace_decks md ON md.deck_id = z.imported_deck_id
    WHERE z.imported_deck_id IS NOT NULL AND (
      ((md.cover_thumb IS NULL OR md.cover_thumb = '') AND COALESCE(md.cover_image,'') = '')
      OR COALESCE(md.description,'') = ''
      OR COALESCE(md.calligrapher,'') = ''
      OR COALESCE(md.dynasty,'') = ''
    )
    ORDER BY no_cover DESC
  `);
  console.log(`待补 ${rows.length} 帖`);
  let ok = 0;
  let fail = 0;
  for (const r of rows) {
    try {
      const det = await fetchZitieDetails(r.zitie_id, token);
      const author = det?.author || '';
      const dynasty = det?.dynasty || '';
      const cover = det?.coverUrl || '';
      let desc = '';
      if (!r.description) {
        const who = [dynasty, author].filter(Boolean).join('·');
        desc = `《${det?.name || r.name}》${who ? `，${who}` : ''} ${r.style || ''}书。全帖 ${r.glyph_count || '?'} 字${det?.pageCount ? `、${det.pageCount} 页` : ''}。`;
      }
      const upd = await db.query(
        `UPDATE marketplace_decks SET
           cover_image = CASE WHEN $2 <> '' THEN $2 ELSE cover_image END,
           cover_thumb = CASE WHEN $2 <> '' THEN $2 ELSE cover_thumb END,
           dynasty = CASE WHEN $3 <> '' THEN $3 ELSE dynasty END,
           calligrapher = CASE WHEN $4 <> '' THEN $4 ELSE calligrapher END,
           description = CASE WHEN $5 <> '' THEN $5 ELSE description END
         WHERE deck_id = $1`,
        [r.deck_id, cover, dynasty, author, desc],
      );
      if (upd.rowCount) ok++;
      console.log(`✓ ${r.name}：${[dynasty, author].filter(Boolean).join('·') || '（源无朝代书家）'} cover=${cover ? '补' : '源无'}`);
      await new Promise((res) => setTimeout(res, 400));
    } catch (e: any) {
      fail++;
      console.log(`✗ ${r.name}: ${e.message}`);
    }
  }
  console.log(`完成 ${ok}/${rows.length}（失败 ${fail}）`);
  process.exit(0);
}

main().catch((e) => {
  console.error('enrich-gaps 失败:', e);
  process.exit(1);
});
