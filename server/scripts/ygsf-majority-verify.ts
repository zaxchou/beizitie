/**
 * 多数票标签核验 v3：多轮采样 + 众数投票（不依赖库内/原文先验）
 *
 * 规律（2026-09-04 受控实验,见 docs/ygsf-api-research.md）：
 *   - 服务端标签在真值态/垃圾态间按时间窗切换；垃圾态每次随机生成、永不重复
 *   - 真值态在窗口内稳定重复 → 多轮采样后,同一文件名出现 ≥2 次的标签即真值
 *   - 6 轮投票实测收敛：100% 字形可获可信标签
 *
 * 用法：
 *   npx tsx server/scripts/ygsf-majority-verify.ts --dry-run [--limit N] [--zitie <id>]
 *   npx tsx server/scripts/ygsf-majority-verify.ts --apply [--limit N] [--zitie <id>]
 */
import fs from 'node:fs';
import { getDb, waitForDb } from '../db.js';
import { loadYgsfToken, ygsfGet } from '../services/ygsf.js';

const PROBE_GAP_MS = 2500;   // 探测间隔
const ROUNDS = 3;            // 窗口内采样轮数
const PAGE_GAP_MS = 250;     // 窗口内页间隔
const MISMATCH_LIMIT = 5;
const MAX_PAGES = 40;

interface RawGlyph { _id: string; _hanzi?: string; _color_image?: string }
const fileOf = (g: RawGlyph) => (/([a-f0-9]{32})_?\.png/i.exec(g._color_image || '') || [])[1];

async function fetchPage(zid: string, page: number, token: string): Promise<RawGlyph[]> {
  const d = await ygsfGet('/zitie/page/glyphs', { zid, page }, token);
  const list = Array.isArray(d) ? d : d?.list || [];
  return list.filter((g: any) => g?._id && g?._color_image);
}

async function main() {
  const apply = process.argv.includes('--apply');
  const limitIdx = process.argv.indexOf('--limit');
  const limit = limitIdx > -1 ? parseInt(process.argv[limitIdx + 1], 10) || 0 : 0;
  const zitieIdx = process.argv.indexOf('--zitie');
  const zitieArg = zitieIdx > -1 ? process.argv[zitieIdx + 1] : '';
  const token = loadYgsfToken();
  if (!token) { console.error('需要 token'); process.exit(1); }

  await waitForDb();
  const db = getDb();
  const { rows: decks } = await db.query(
    `SELECT d.id AS deck_id, d.name, d.source_key FROM decks d
     WHERE d.source_key LIKE 'ygsf:%' ${zitieArg ? 'AND d.source_key = $1' : ''}
     ORDER BY d.created_at ASC`,
    zitieArg ? [`ygsf:${zitieArg}`] : []
  );
  const list = limit ? decks.slice(0, limit) : decks;
  console.log(`[majority2] 待核验 ${list.length} 帖 mode=${apply ? 'APPLY' : 'DRY-RUN'}`);

  const idRe = /areas\/[a-f0-9]+\/\d+\/([a-f0-9]{32})_\.png/;
  const report: any[] = [];
  let ok = 0, bad = 0, unresolved = 0, done = 0;

  for (const dk of list) {
    const zitieId = dk.source_key.slice('ygsf:'.length);
    done++;

    // ---- 1. 多轮采样（跨越窗口切换周期）----
    const votes = new Map<string, Map<string, number>>();
    const ROUNDS = 6;
    for (let r = 0; r < ROUNDS; r++) {
      for (let page = 1; page <= MAX_PAGES; page++) {
        try {
          const listG = await fetchPage(zitieId, page, token);
          if (listG.length === 0) break;
          for (const g of listG) {
            const f = fileOf(g);
            const label = (g._hanzi || '').trim();
            if (!f || !label) continue;
            let vm = votes.get(f);
            if (!vm) { vm = new Map(); votes.set(f, vm); }
            vm.set(label, (vm.get(label) || 0) + 1);
          }
          if (listG.length < 100) break;
          await new Promise((res) => setTimeout(res, 300));
        } catch { break; }
      }
      if (r < ROUNDS - 1) await new Promise((res) => setTimeout(res, 1500));
    }

    if (votes.size < 10) {
      unresolved++;
      console.log(`? ${dk.name}：采样不足（${votes.size} 字）→ 保留待复验`);
      report.push({ deck: dk.name, zitie: zitieId, verdict: 'thin-sample' });
      continue;
    }

    // ---- 3. 众数即真值（出现 ≥2 次才可信）----
    const truth = new Map<string, string>();
    for (const [f, vm] of votes) {
      let bestLabel = '', bestCount = 0;
      for (const [label, cnt] of vm) if (cnt > bestCount) { bestCount = cnt; bestLabel = label; }
      if (bestCount >= 2) truth.set(f, bestLabel);
    }

    // ---- 4. 与库内比对 ----
    const { rows: cards } = await db.query(
      `SELECT c.id, c.front_text, c.image_url FROM cards c
       WHERE c.deck_id = $1 AND c.image_url LIKE '%areas/%' AND c.archived_at IS NULL`,
      [dk.deck_id]
    );
    let match = 0, mismatch = 0, missing = 0;
    const fixes: Array<{ id: string; to: string }> = [];
    for (const c of cards) {
      const m = idRe.exec(c.image_url);
      if (!m) continue;
      const t = truth.get(m[1]);
      if (t === undefined) { missing++; continue; }
      if (t === c.front_text) match++;
      else { mismatch++; fixes.push({ id: c.id, to: t }); }
    }

    const covered = match + mismatch;
    if (covered < cards.length * 0.9) {
      unresolved++;
      console.log(`· ${dk.name}：覆盖不足（验 ${covered}/${cards.length}）→ 保留待复验`);
      report.push({ deck: dk.name, zitie: zitieId, verdict: 'low-coverage', covered, cards: cards.length, mismatch, match });
      continue;
    }

    if (mismatch > MISMATCH_LIMIT) {
      bad++;
      console.log(`${apply ? '🔧' : '[dry-修]'} ${dk.name}：错字 ${mismatch}/${cards.length}（对 ${match}）${apply ? '已修' : ''}`);
      if (apply && fixes.length) {
        const CHUNK = 500;
        for (let i = 0; i < fixes.length; i += CHUNK) {
          const chunk = fixes.slice(i, i + CHUNK);
          const values: unknown[] = [];
          const ph = chunk.map((f, j) => { const b = j * 2; values.push(f.to, f.id); return `($${b + 1},$${b + 2})`; }).join(',');
          await db.query(`UPDATE cards SET front_text = v.hanzi, updated_at = now() FROM (VALUES ${ph}) AS v(hanzi, id) WHERE cards.id = v.id`, values);
        }
      }
      report.push({ deck: dk.name, zitie: zitieId, verdict: 'fixed', cards: cards.length, mismatch, match, missing });
    } else {
      ok++;
      console.log(`✅ ${dk.name}：一致 ${match}/${cards.length}（错 ${mismatch}）`);
      report.push({ deck: dk.name, zitie: zitieId, verdict: 'ok', cards: cards.length, mismatch, match });
    }

    if (done % 20 === 0) {
      console.log(`[majority2] 进度 ${done}/${list.length}：OK ${ok} 修 ${bad} 未决 ${unresolved}`);
      fs.writeFileSync('/opt/zi2anki/majority-report.json', JSON.stringify(report, null, 1));
    }
    await new Promise((r) => setTimeout(r, 400));
  }

  fs.writeFileSync('/opt/zi2anki/majority-report.json', JSON.stringify(report, null, 1));
  console.log(`\n[majority2] 完成：共 ${done}，OK ${ok}，有错 ${bad}，未决 ${unresolved}（mode=${apply ? 'APPLY' : 'DRY'}）`);
  process.exit(0);
}

main().catch((e) => { console.error('[majority2] 失败:', e); process.exit(1); });
