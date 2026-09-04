/**
 * 以观 API 规律受控实验（第一性原理研究，产物：/opt/zi2anki/research-log.txt）
 *
 * 实验设计：
 *   样本：敦煌遗书佛说父母恩重经（已知部分错）/ 九成宫醴泉铭（已知正确）/ 永嘉马居士（已知错）
 *   每帖 12 轮 × 20s，每轮：
 *     - query 端点 page1 双拉 → 状态判定（rotating / stable-true / stable-wrong）
 *     - page/glyphs 端点 page1 双拉 → 同上（验证两端点窗口是否同步）
 *   结束后：多数票收敛性统计（N 轮投票后有多少字标签可信）
 *
 * 状态判定规则：
 *   双拉不一致 → rotating（垃圾态，随机生成）
 *   双拉一致 + 头部 == 库内正确前缀 → stable-true
 *   双拉一致 + 头部 != 库内前缀 → stable-wrong（极少见，需关注）
 */
import fs from 'node:fs';
import { getDb, waitForDb } from '../db.js';
import { loadYgsfToken, ygsfGet } from '../services/ygsf.js';

const ROUNDS = 12;
const ROUND_GAP_MS = 20000;
const INNER_GAP_MS = 1200;

interface RawGlyph { _id: string; _hanzi?: string; _color_image?: string }
const fileOf = (g: RawGlyph) => (/([a-f0-9]{32})_?\.png/i.exec(g._color_image || '') || [])[1];

const logLines: string[] = [];
function log(s: string) {
  console.log(s);
  logLines.push(s);
}

async function fetchPaged(zid: string, endpoint: 'query' | 'page', token: string): Promise<RawGlyph[]> {
  if (endpoint === 'page') {
    const d = await ygsfGet('/zitie/page/glyphs', { zid, page: 1 }, token);
    return (Array.isArray(d) ? d : d?.list || []).filter((g: any) => g?._id && g?._color_image);
  }
  const d = await ygsfGet('/zitie/glyphs/query', { zid, loaded: 0 }, token);
  return (Array.isArray(d) ? d : d?.list || []).filter((g: any) => g?._id && g?._color_image);
}

async function probeState(zid: string, endpoint: 'query' | 'page', dbHead: string, token: string) {
  const a = await fetchPaged(zid, endpoint, token);
  await new Promise((r) => setTimeout(r, INNER_GAP_MS));
  const b = await fetchPaged(zid, endpoint, token);
  const sig = (gs: RawGlyph[]) => gs.map((g) => `${fileOf(g)}:${(g._hanzi || '').trim()}`).join('|');
  if (a.length < 10) return { state: 'empty' as const, glyphs: a, head: '' };
  if (sig(a) !== sig(b)) return { state: 'rotating' as const, glyphs: a, head: a.slice(0, 10).map((g) => (g._hanzi || '').trim()).join('') };
  const head = a.slice(0, Math.min(10, dbHead.length)).map((g) => (g._hanzi || '').trim()).join('');
  if (dbHead.length >= 8 && head === dbHead.slice(0, head.length)) return { state: 'stable-true' as const, glyphs: a, head };
  return { state: 'stable-wrong' as const, glyphs: a, head };
}

async function main() {
  const token = loadYgsfToken();
  await waitForDb();
  const db = getDb();

  const targets = [
    { name: '敦煌遗书佛说父母恩重经', zid: 'd895261aa020117fc2e9b45d7e1580a2' },
    { name: '九成宫醴泉铭', zid: 'dee55057ae32e442a011f1a7f8718fb7' },
    { name: '永嘉马居士', zid: 'd1f292d2e69eeb09fd896edd57e85470' },
  ];

  for (const t of targets) {
    log(`\n===== ${t.name} (${t.zid}) =====`);
    const { rows: hr } = await db.query(
      `SELECT string_agg(front_text, '' ORDER BY sort_order) AS h FROM (
         SELECT front_text, sort_order FROM cards WHERE deck_id = (SELECT id FROM decks WHERE source_key = $1) AND sort_order < 10 AND archived_at IS NULL
       ) x`, [`ygsf:${t.zid}`]
    );
    const dbHead = hr[0]?.h || '';
    log(`库内头10: "${dbHead}"`);

    const stateSeq: string[] = [];
    for (let i = 0; i < ROUNDS; i++) {
      const ts = new Date().toISOString().slice(11, 19);
      const q = await probeState(t.zid, 'query', dbHead, token);
      const p = await probeState(t.zid, 'page', dbHead, token);
      stateSeq.push(`q:${q.state} p:${p.state}`);
      log(`  轮${i + 1} [${ts}] query=${q.state}("${q.head}") page=${p.state}("${p.head}")`);
      if (i < ROUNDS - 1) await new Promise((r) => setTimeout(r, ROUND_GAP_MS));
    }

    // 状态转移摘要
    const qTrue = stateSeq.filter((s) => s.includes('q:stable-true')).length;
    const pTrue = stateSeq.filter((s) => s.includes('p:stable-true')).length;
    log(`  [摘要] query真值 ${qTrue}/${ROUNDS}，page真值 ${pTrue}/${ROUNDS}`);
    log(`  [同步性] q与p同轮同态的轮数: ${stateSeq.filter((s) => { const [q, p] = s.split(' '); return q.slice(2) === p.slice(2); }).length}/${ROUNDS}`);

    // 多数票收敛性（用本实验所有 query 拉取做投票）
    // （重拉 ROUNDS 次成本高，复用上面对 query 端点的拉取不够 — 这里补充快速投票实验）
    const votes = new Map<string, Map<string, number>>();
    const VOTE_ROUNDS = 6;
    for (let v = 0; v < VOTE_ROUNDS; v++) {
      try {
        const gs = await fetchPaged(t.zid, 'query', token);
        for (const g of gs) {
          const f = fileOf(g);
          const label = (g._hanzi || '').trim();
          if (!f || !label) continue;
          const vm = votes.get(f) || new Map<string, number>();
          vm.set(label, (vm.get(label) || 0) + 1);
          votes.set(f, vm);
        }
      } catch { /* ignore */ }
      await new Promise((r) => setTimeout(r, 1500));
    }
    let resolved2 = 0, resolved3 = 0;
    for (const [, vm] of votes) {
      const max = Math.max(...vm.values());
      if (max >= 2) resolved2++;
      if (max >= 3) resolved3++;
    }
    log(`  [投票] 共 ${votes.size} 字；${VOTE_ROUNDS} 轮后 ≥2票可信 ${resolved2} 字（${Math.round(resolved2 / Math.max(votes.size, 1) * 100)}%），≥3票可信 ${resolved3} 字`);
  }

  fs.writeFileSync('/opt/zi2anki/research-log.txt', logLines.join('\n'));
  log('\n[实验完成] 日志: /opt/zi2anki/research-log.txt');
  process.exit(0);
}

main().catch((e) => { console.error('失败:', e); process.exit(1); });
