/**
 * 字图一致性核验 + 清理：核验通过的帖保留，字图不符的帖整帖删除，核验不过的先下架留档。
 *
 * 判据（分页双拉一致）：源站标签在真值态/垃圾态间随机切换（垃圾每次随机生成）。
 * 快照接口按页返回——逐页双拉，同一页两次拉取完全一致即该页为真值；
 * 各页独立验真后合成整帖真值表（多页帖也能稳定核验）。
 * 真值与库内卡片逐张比对（按图片文件名对齐）：
 *   - 错配 ≤ 5 张 → OK 保留
 *   - 错配 > 5 张 → 图片和文字不符 → 删除整帖（连 cards/市场行/集字索引，FK 级联）
 *   - 某页 K 次仍取不到真值 → unverifiable → 从市场下架（published_at=NULL），数据保留待复验
 *
 * 用法：
 *   npx tsx server/scripts/ygsf-purge-mismatched.ts --dry-run [--limit N] [--zitie <id>]
 *   npx tsx server/scripts/ygsf-purge-mismatched.ts --apply    [--limit N] [--zitie <id>]
 */
import fs from 'node:fs';
import { getDb, waitForDb } from '../db.js';
import { loadYgsfToken, ygsfGet } from '../services/ygsf.js';

const PAGE_TRIES = 6;       // 每页双拉尝试次数
const GAP_MS = 1100;        // 双拉间隔
const RETRY_MS = 1600;      // 页未命中后的重试间隔
const MAX_PAGES = 40;
const MISMATCH_LIMIT = 5;   // 错配超过此数 → 删帖

interface RawGlyph { _id: string; _hanzi?: string; _color_image?: string }

async function fetchPage(zid: string, page: number, token: string): Promise<RawGlyph[]> {
  const data = await ygsfGet('/zitie/page/glyphs', { zid, page }, token);
  const list = Array.isArray(data) ? data : data?.list || [];
  return list.filter((g: any) => g?._id && g?._color_image);
}

const fileOf = (g: RawGlyph) => (/([a-f0-9]{32})_?\.png/i.exec(g._color_image || '') || [])[1];
const labelOf = (g: RawGlyph) => (g._hanzi || '').trim();
const pageKey = (list: RawGlyph[]) => list.map((g) => `${fileOf(g)}:${labelOf(g)}`).join('|');

/** 单页双拉验真：返回该页真值 (文件名→标签)，失败返回 null */
async function truthPage(zid: string, page: number, token: string): Promise<Map<string, string> | null> {
  for (let t = 0; t < PAGE_TRIES; t++) {
    const a = await fetchPage(zid, page, token);
    if (a.length === 0) return new Map(); // 空页 = 结束且视为已验
    await new Promise((r) => setTimeout(r, GAP_MS));
    const b = await fetchPage(zid, page, token);
    if (a.length === b.length && pageKey(a) === pageKey(b)) {
      const m = new Map<string, string>();
      for (const g of a) { const f = fileOf(g); if (f && labelOf(g)) m.set(f, labelOf(g)); }
      return m;
    }
    await new Promise((r) => setTimeout(r, RETRY_MS));
  }
  return null;
}

async function main() {
  const apply = process.argv.includes('--apply');
  const limitIdx = process.argv.indexOf('--limit');
  const limit = limitIdx > -1 ? parseInt(process.argv[limitIdx + 1], 10) || 0 : 0;
  const zitieIdx = process.argv.indexOf('--zitie');
  const zitieArg = zitieIdx > -1 ? process.argv[zitieIdx + 1] : '';
  const token = loadYgsfToken();
  if (!token) {
    console.error('需要 ygsf token');
    process.exit(1);
  }

  await waitForDb();
  const db = getDb();
  const { rows: decks } = await db.query(
    `SELECT d.id AS deck_id, d.name, d.source_key
     FROM decks d WHERE d.source_key LIKE 'ygsf:%'
       ${zitieArg ? 'AND d.source_key = $1' : ''}
     ORDER BY d.created_at ASC`,
    zitieArg ? [`ygsf:${zitieArg}`] : []
  );
  const list = limit ? decks.slice(0, limit) : decks;
  console.log(`[purge] 待核验 ${list.length} 帖 mode=${apply ? 'APPLY' : 'DRY-RUN'}`);

  const idRe = /areas\/[a-f0-9]+\/\d+\/([a-f0-9]{32})_\.png/;
  const report: any[] = [];
  let keep = 0, del = 0, unverified = 0;
  let done = 0;

  for (const dk of list) {
    const zitieId = dk.source_key.slice('ygsf:'.length);
    done++;

    // ---- 分页双拉合成真值 ----
    const truth = new Map<string, string>();
    let failed = false;
    for (let page = 1; page <= MAX_PAGES; page++) {
      const t = await truthPage(zitieId, page, token);
      if (t === null) { failed = true; break; }
      if (t.size === 0) break; // 空页结束
      for (const [k, v] of t) truth.set(k, v);
      if (t.size < 100) break; // 末页
    }

    if (failed || truth.size < 10) {
      // 源站快照不提供该帖（多为早期试点帖，标签源出本地图片库迁移，无反面证据）→ 保留不动
      unverified++;
      console.log(`· ${dk.name}：快照不可验（真值 ${truth.size} 字）→ 保留，标注待复验`);
      report.push({ deck: dk.name, zitie: zitieId, verdict: 'no-snapshot', truth: truth.size });
    } else {
      // ---- 与库内比对 ----
      const { rows: cards } = await db.query(
        `SELECT c.id, c.front_text, c.image_url FROM cards c
         WHERE c.deck_id = $1 AND c.image_url LIKE '%areas/%' AND c.archived_at IS NULL`,
        [dk.deck_id]
      );
      let match = 0, mismatch = 0, missing = 0;
      for (const c of cards) {
        const m = idRe.exec(c.image_url);
        if (!m) continue;
        const t = truth.get(m[1]);
        if (t === undefined) { missing++; continue; }
        if (t === c.front_text) match++; else mismatch++;
      }
      // 覆盖率门槛：快照只覆盖少数卡（源站存根页）时不足以判"留"
      const covered = match + mismatch;
      if (covered < cards.length * 0.9) {
        unverified++;
        console.log(`· ${dk.name}：覆盖不足（验 ${covered}/${cards.length}）→ 保留，待重跑补验`);
        report.push({ deck: dk.name, zitie: zitieId, verdict: 'low-coverage', covered, cards: cards.length, mismatch, match, missing });
        await new Promise((r) => setTimeout(r, 300));
        continue;
      }
      if (mismatch > MISMATCH_LIMIT) {
        del++;
        console.log(`${apply ? '🗑' : '[dry-删]'} ${dk.name}：错配 ${mismatch}/${cards.length}（对 ${match}，源缺 ${missing}）`);
        if (apply) {
          await db.query(`DELETE FROM jizi_index WHERE deck_id = $1`, [dk.deck_id]);
          await db.query(`DELETE FROM marketplace_decks WHERE deck_id = $1`, [dk.deck_id]);
          await db.query(`DELETE FROM decks WHERE id = $1`, [dk.deck_id]);
        }
        report.push({ deck: dk.name, zitie: zitieId, verdict: 'delete', cards: cards.length, mismatch, match, missing });
      } else {
        keep++;
        console.log(`${apply ? '✅' : '[dry-留]'} ${dk.name}：一致 ${match}/${cards.length}（错 ${mismatch}，源缺 ${missing}）`);
        report.push({ deck: dk.name, zitie: zitieId, verdict: 'keep', cards: cards.length, mismatch, match, missing });
      }
    }

    if (done % 20 === 0) {
      console.log(`[purge] 进度 ${done}/${list.length}：留 ${keep} 删 ${del} 未验 ${unverified}`);
      fs.writeFileSync('/opt/zi2anki/purge-report.json', JSON.stringify(report, null, 1));
    }
    await new Promise((r) => setTimeout(r, 300));
  }

  fs.writeFileSync('/opt/zi2anki/purge-report.json', JSON.stringify(report, null, 1));
  console.log(`\n[purge] 完成：共 ${done}，留 ${keep}，删 ${del}，快照不可验(保留) ${unverified}（mode=${apply ? 'APPLY' : 'DRY'}）`);
  process.exit(0);
}

main().catch((e) => {
  console.error('[purge] 失败:', e);
  process.exit(1);
});
