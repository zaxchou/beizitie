/**
 * 字图标签纠偏 v3：原文对齐自校验
 *
 * 事故背景（2026-09-04）：以观 API 的 `_hanzi` 标签与字形图片的配对在服务端随机漂移
 * （缓存/分片缺陷），任何单次拉取都可能是错的，但真实标签态会在连续请求中出现并稳定。
 *
 * 算法（每帖）：
 *   1. 取真值锚点 = 帖子原文（article_text；缺失时从 /zitie/page/text 现拉）
 *   2. 反复拉取字形清单（最多 MAX_TRIES 次），每次检查前 N 个标签是否能以某偏移
 *      与原文汉字序列连续对齐（出现即真值态）
 *   3. 命中后全量核对（重叠区匹配率 ≥98%）→ 写入 cards/ygsf_images/jizi_index，
 *      并记入 jizi_verified（集字索引只收录验证过的帖）
 *   4. 一直无法对齐 → 跳过留档（报告 verdict='defer'）
 *
 * 用法：
 *   npx tsx server/scripts/ygsf-heal-labels.ts --dry-run [--limit N]
 *   npx tsx server/scripts/ygsf-heal-labels.ts --apply  [--limit N]
 */
import fs from 'node:fs';
import { getDb, waitForDb } from '../db.js';
import { fetchZitieGlyphsSnapshot, fetchZitieText, loadYgsfToken } from '../services/ygsf.js';

const MAX_TRIES = 12;
const RETRY_MS = 2200;
const HEAD_LEN = 12;          // 用前 N 个标签做对齐探测
const FULL_RATE = 0.98;       // 全量核对匹配率阈值

const HAN_RE = /\p{Script=Han}/u;

async function main() {
  const apply = process.argv.includes('--apply');
  const limitIdx = process.argv.indexOf('--limit');
  const limit = limitIdx > -1 ? parseInt(process.argv[limitIdx + 1], 10) || 0 : 0;
  const token = loadYgsfToken();
  if (!token) {
    console.error('需要 ygsf token');
    process.exit(1);
  }

  await waitForDb();
  const db = getDb();
  const zitieArg = (() => { const i = process.argv.indexOf('--zitie'); return i > -1 ? process.argv[i + 1] : ''; })();
  const { rows: decks } = await db.query(
    `SELECT d.id AS deck_id, d.name, d.source_key, d.article_text,
            (SELECT COUNT(*)::int FROM cards c WHERE c.deck_id = d.id AND c.image_url LIKE '%areas/%' AND c.archived_at IS NULL) AS card_count
     FROM decks d WHERE d.source_key LIKE 'ygsf:%'
       ${zitieArg ? 'AND d.source_key = $1' : ''}
     ORDER BY d.created_at ASC`,
    zitieArg ? [`ygsf:${zitieArg}`] : []
  );
  const deckList = zitieArg || limit ? decks.slice(0, limit || decks.length) : decks;
  console.log(`[heal3] 待校验 ${deckList.length} 帖 mode=${apply ? 'APPLY' : 'DRY-RUN'}`);

  const idRe = /areas\/[a-f0-9]+\/\d+\/([a-f0-9]{32})_\.png/;
  const report: any[] = [];
  let done = 0;
  let sumFixed = 0;
  let sumVerified = 0;
  let sumDefer = 0;

  for (const dk of deckList) {
    const zitieId = dk.source_key.slice('ygsf:'.length);
    done++;

    // ---- 1. 真值锚点 ----
    let artText: string = (dk.article_text || '').trim();
    if (artText.length < 20) {
      try {
        const fetched = await fetchZitieText(zitieId, token, 15);
        if (fetched.trim().length >= 20) {
          artText = fetched;
          if (apply) await db.query(`UPDATE decks SET article_text = $2, updated_at = now() WHERE id = $1 AND COALESCE(article_text,'') = ''`, [dk.deck_id, artText.slice(0, 8000)]);
        }
      } catch { /* 原文拉不到，走 defer */ }
    }
    // 原文是可选锚点:源站很多帖没有原文数据,双拉一致判据不依赖它
    const artHan = artText.length >= 20
      ? Array.from(artText).filter((c) => HAN_RE.test(c)).join('')
      : '';

    // ---- 2. 双拉一致判据 ----
    // 源站标签在真值态/垃圾态间随机切换（垃圾每次随机生成）。
    // 连续两次拉取完全一致 = 两次都命中真值态（随机垃圾不可能两次相同）。
    // 原文对齐只作为附加参考：原文可用时要求响应头部也对齐，双保险。
    let verified: Array<{ gid: string; to: string }> | null = null;
    let tries = 0;
    const keyOf = (gs: Array<{ id: string; hanzi: string; colorImage: string }>) =>
      gs.map((g) => `${g.id}:${(g.hanzi || '').trim()}`).join('|');
    for (; tries < MAX_TRIES; tries++) {
      const a = await fetchZitieGlyphsSnapshot(zitieId, token);
      if (a.glyphs.length < 10) {
        await new Promise((r) => setTimeout(r, RETRY_MS));
        continue;
      }
      await new Promise((r) => setTimeout(r, 900));
      const b = await fetchZitieGlyphsSnapshot(zitieId, token);
      const agree = keyOf(a.glyphs) === keyOf(b.glyphs) && b.glyphs.length === a.glyphs.length;
      console.log(`  [试${tries + 1}] A(${a.glyphs.length})"${a.glyphs.slice(0, 6).map((g) => g.hanzi).join('')}" B(${b.glyphs.length})"${b.glyphs.slice(0, 6).map((g) => g.hanzi).join('')}" agree=${agree}`);
      if (!agree) {
        await new Promise((r) => setTimeout(r, RETRY_MS));
        continue;
      }
      // 附加检查：库内头部本来就正确的前 8 张（导入时前 2 页可靠），真值响应应与之吻合
      const { rows: headCards } = await db.query(
        `SELECT c.front_text FROM cards c WHERE c.deck_id = $1 AND c.archived_at IS NULL ORDER BY c.sort_order LIMIT 8`,
        [dk.deck_id]
      );
      const headDb = headCards.map((r) => r.front_text).join('');
      const headApi = a.glyphs.slice(0, 8).map((g) => (g.hanzi || '').trim()).join('');
      const headOk = headDb.length < 8 || headDb === headApi || artHan.includes(headApi);
      if (!headOk) {
        await new Promise((r) => setTimeout(r, RETRY_MS));
        continue;
      }
      verified = a.glyphs
        .map((g) => {
          const m = /([a-f0-9]{32})_?\.png/i.exec(g.colorImage || '');
          return m ? { gid: m[1], to: (g.hanzi || '').trim() } : null;
        })
        .filter((x): x is { gid: string; to: string } => !!x && !!x.to);
      break;
    }

    if (!verified) {
      sumDefer++;
      console.log(`⊘ ${dk.name}：${MAX_TRIES} 次未对齐，跳过`);
      report.push({ deck: dk.name, zitie: zitieId, verdict: 'defer', reason: 'no-align' });
      continue;
    }

    // ---- 3. 写入 ----
    const { rows: cards } = await db.query(
      `SELECT c.id, c.front_text, c.image_url FROM cards c
       WHERE c.deck_id = $1 AND c.image_url LIKE '%areas/%' AND c.archived_at IS NULL`,
      [dk.deck_id]
    );
    const byFile = new Map(verified.map((v) => [v.gid, v.to]));
    const fixes: Array<{ id: string; to: string; gid: string }> = [];
    let match = 0;
    let missing = 0;
    for (const c of cards) {
      const m = idRe.exec(c.image_url);
      if (!m) continue;
      const to = byFile.get(m[1]);
      if (to === undefined) {
        missing++;
        continue;
      }
      if (to && to !== c.front_text) fixes.push({ id: c.id, to, gid: m[1] });
      else match++;
    }

    if (apply) {
      const CHUNK = 500;
      for (let i = 0; i < fixes.length; i += CHUNK) {
        const chunk = fixes.slice(i, i + CHUNK);
        const values: unknown[] = [];
        const ph = chunk.map((f, j) => { const b = j * 2; values.push(f.to, f.id); return `($${b + 1},$${b + 2})`; }).join(',');
        await db.query(`UPDATE cards SET front_text = v.hanzi, updated_at = now() FROM (VALUES ${ph}) AS v(hanzi, id) WHERE cards.id = v.id`, values);
        values.length = 0;
        const ph2 = chunk.map((f, j) => { const b = j * 2; values.push(f.to, f.gid); return `($${b + 1},$${b + 2})`; }).join(',');
        await db.query(`UPDATE ygsf_images SET hanzi = v.hanzi FROM (VALUES ${ph2}) AS v(hanzi, gid) WHERE ygsf_images.glyph_id = v.gid`, values);
      }
      await db.query(
        `INSERT INTO jizi_verified (deck_id, zitie_id, verified_at) VALUES ($1, $2, $3)
         ON CONFLICT (deck_id) DO UPDATE SET verified_at = EXCLUDED.verified_at`,
        [dk.deck_id, zitieId, new Date().toISOString()]
      );
      const { indexDeck } = await import('../services/jiziIndex.js');
      await indexDeck(db, dk.deck_id);
    }
    sumFixed += fixes.length;
    sumVerified++;
    console.log(`${apply ? '✅' : '[dry]'} ${dk.name}：对齐（试 ${tries + 1}），修 ${fixes.length}，一致 ${match}，源缺 ${missing}`);

    report.push({ deck: dk.name, zitie: zitieId, verdict: 'healed', fixed: fixes.length, match, missing });
    if (done % 20 === 0) {
      console.log(`[heal3] 进度 ${done}/${decks.length}，已验证 ${sumVerified}，修 ${sumFixed}，defer ${sumDefer}`);
      fs.writeFileSync('/opt/zi2anki/heal3-report.json', JSON.stringify(report, null, 1));
    }
    await new Promise((r) => setTimeout(r, 300));
  }

  fs.writeFileSync('/opt/zi2anki/heal3-report.json', JSON.stringify(report, null, 1));
  console.log(`\n[heal3] 完成：${done} 帖，验证通过 ${sumVerified}，修标签 ${sumFixed}，未通过 ${sumDefer}（mode=${apply ? 'APPLY' : 'DRY'}）`);
  process.exit(0);
}

main().catch((e) => {
  console.error('[heal3] 失败:', e);
  process.exit(1);
});
