/**
 * 多数票标签核验 v4：多轮采样 + 众数投票（全自动批量修复版）
 *
 * 规律（2026-09-04 受控实验,见 docs/ygsf-api-research.md）：
 *   - 服务端标签在真值态/垃圾态间按时间窗切换；垃圾态每次随机生成、永不重复
 *   - 真值态在窗口内稳定重复 → 多轮采样后,同一文件名出现 ≥2 次的标签即真值
 *
 * 自动闭环（apply 模式）：
 *   - verdict=fixed/ok 的帖自动写入 jizi_verified 并刷新集字索引（逐帖放行）
 *   - 只改 front_text，不删帖；报告 /opt/zi2anki/majority-report.json
 *
 * 断点续跑：
 *   --skip-verified       跳过已放行的帖
 *   --list <file.json>    只处理文件内的 zitie id 数组
 *   --remaining-after <f> 把未决帖(采样不足/覆盖不足)的 zitie 写入文件，供下一轮
 *
 * 用法：
 *   npx tsx server/scripts/ygsf-majority-verify.ts --apply [--limit N] [--random] [--skip-verified] [--list f] [--remaining-after f]
 */
import fs from 'node:fs';
import { getDb, waitForDb } from '../db.js';
import { loadYgsfToken, ygsfGet } from '../services/ygsf.js';

const MISMATCH_LIMIT = 5;
const MAX_PAGES = 40;
const ROUNDS = 6;

interface RawGlyph { _id: string; _hanzi?: string; _color_image?: string }
const fileOf = (g: RawGlyph) => (/([a-f0-9]{32})_?\.png/i.exec(g._color_image || '') || [])[1];

async function fetchPage(zid: string, page: number, token: string): Promise<RawGlyph[]> {
  const d = await ygsfGet('/zitie/page/glyphs', { zid, page }, token);
  const list = Array.isArray(d) ? d : d?.list || [];
  return list.filter((g: any) => g?._id && g?._color_image);
}

async function admitVerified(db: any, deckId: string, zitieId: string) {
  await db.query(
    `INSERT INTO jizi_verified (deck_id, zitie_id, verified_at) VALUES ($1, $2, $3)
     ON CONFLICT (deck_id) DO UPDATE SET verified_at = EXCLUDED.verified_at`,
    [deckId, zitieId, new Date().toISOString()]
  );
  const { indexDeck } = await import('../services/jiziIndex.js');
  await indexDeck(db, deckId);
}

function getArg(flag: string): string {
  const i = process.argv.indexOf(flag);
  return i > -1 ? process.argv[i + 1] || '' : '';
}

async function main() {
  const apply = process.argv.includes('--apply');
  const skipVerified = process.argv.includes('--skip-verified');
  const random = process.argv.includes('--random');
  const limit = parseInt(getArg('--limit'), 10) || 0;
  const zitieArg = getArg('--zitie');
  const listFile = getArg('--list');
  const remainFile = getArg('--remaining-after');
  const token = loadYgsfToken();
  if (!token) { console.error('需要 token'); process.exit(1); }

  await waitForDb();
  const db = getDb();

  let decks: Array<{ deck_id: string; name: string; source_key: string }>;
  if (listFile) {
    const zids: string[] = JSON.parse(fs.readFileSync(listFile, 'utf8'));
    if (!zids.length) { console.log('[majority] 清单为空，结束'); process.exit(0); }
    const keys = zids.map((z) => `ygsf:${z}`);
    const { rows } = await db.query(
      `SELECT d.id AS deck_id, d.name, d.source_key FROM decks d WHERE d.source_key = ANY($1)`,
      [keys]
    );
    decks = rows;
    console.log(`[majority] 清单 ${zids.length} 帖，命中 ${decks.length}`);
  } else {
    const order = random ? 'ORDER BY random()' : 'ORDER BY d.created_at ASC';
    const skipCond = skipVerified ? `AND NOT EXISTS (SELECT 1 FROM jizi_verified v WHERE v.deck_id = d.id)` : '';
    const { rows } = await db.query(
      `SELECT d.id AS deck_id, d.name, d.source_key FROM decks d
       WHERE d.source_key LIKE 'ygsf:%' ${zitieArg ? 'AND d.source_key = $1' : ''} ${skipCond} ${order}`,
      zitieArg ? [`ygsf:${zitieArg}`] : []
    );
    decks = rows;
  }
  const list = limit ? decks.slice(0, limit) : decks;
  console.log(`[majority4] 待核验 ${list.length} 帖 mode=${apply ? 'APPLY' : 'DRY-RUN'}`);

  const idRe = /areas\/[a-f0-9]+\/\d+\/([a-f0-9]{32})_\.png/;
  const report: any[] = [];
  const remaining: string[] = [];
  let ok = 0, bad = 0, unresolved = 0, done = 0;

  for (const dk of list) {
    const zitieId = dk.source_key.slice('ygsf:'.length);
    done++;

    // ---- 1. 多轮采样 ----
    const votes = new Map<string, Map<string, number>>();
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
      remaining.push(zitieId);
      console.log(`? ${dk.name}：采样不足（${votes.size} 字）→ 待复验`);
      report.push({ deck: dk.name, zitie: zitieId, verdict: 'thin-sample' });
      continue;
    }

    // ---- 2. 众数即真值 ----
    const truth = new Map<string, string>();
    for (const [f, vm] of votes) {
      let bestLabel = '', bestCount = 0;
      for (const [label, cnt] of vm) if (cnt > bestCount) { bestCount = cnt; bestLabel = label; }
      if (bestCount >= 2) truth.set(f, bestLabel);
    }

    // ---- 3. 与库内比对 ----
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
      remaining.push(zitieId);
      console.log(`· ${dk.name}：覆盖不足（验 ${covered}/${cards.length}）→ 待复验`);
      report.push({ deck: dk.name, zitie: zitieId, verdict: 'low-coverage', covered, cards: cards.length, mismatch, match });
      continue;
    }

    // 众数票即真值：只要算出了 fixes 就必须应用——错字不论多少都不该进集字（宁缺勿错）。
    // MISMATCH_LIMIT 只区分报告口径（fixed=大改，ok=微调）。
    const applyFixes = async (): Promise<boolean> => {
      if (!apply || !fixes.length) return false;
      const CHUNK = 500;
      for (let i = 0; i < fixes.length; i += CHUNK) {
        const chunk = fixes.slice(i, i + CHUNK);
        const values: unknown[] = [];
        const ph = chunk.map((f, j) => { const b = j * 2; values.push(f.to, f.id); return `($${b + 1},$${b + 2})`; }).join(',');
        await db.query(`UPDATE cards SET front_text = v.hanzi, updated_at = now() FROM (VALUES ${ph}) AS v(hanzi, id) WHERE cards.id = v.id`, values);
      }
      return true;
    };

    if (mismatch > MISMATCH_LIMIT) {
      bad++;
      await applyFixes();
      if (apply) await admitVerified(db, dk.deck_id, zitieId);
      console.log(`${apply ? '🔧' : '[dry-修]'} ${dk.name}：错字 ${mismatch}/${cards.length}（对 ${match}）${apply ? '已修并放行' : ''}`);
      report.push({ deck: dk.name, zitie: zitieId, verdict: 'fixed', cards: cards.length, mismatch, match, missing });
    } else {
      ok++;
      const fixedNow = await applyFixes();
      if (apply) await admitVerified(db, dk.deck_id, zitieId);
      console.log(`${apply ? '✅' : '[dry-留]'} ${dk.name}：一致 ${match}/${cards.length}（错 ${mismatch}）${apply ? (fixedNow ? '已微调并放行' : '已放行') : ''}`);
      report.push({ deck: dk.name, zitie: zitieId, verdict: 'ok', cards: cards.length, mismatch, match, fixed: fixes.length });
    }

    if (done % 20 === 0) {
      console.log(`[majority4] 进度 ${done}/${list.length}：OK ${ok} 修 ${bad} 未决 ${unresolved}`);
      fs.writeFileSync('/opt/zi2anki/majority-report.json', JSON.stringify(report, null, 1));
    }
    await new Promise((r) => setTimeout(r, 350));
  }

  fs.writeFileSync('/opt/zi2anki/majority-report.json', JSON.stringify(report, null, 1));
  if (remainFile) fs.writeFileSync(remainFile, JSON.stringify(remaining));
  console.log(`\n[majority4] 完成：共 ${done}，OK ${ok}，有错 ${bad}，未决 ${unresolved}（mode=${apply ? 'APPLY' : 'DRY'}）`);
  process.exit(0);
}

main().catch((e) => { console.error('[majority4] 失败:', e); process.exit(1); });
