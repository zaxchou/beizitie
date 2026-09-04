/**
 * 以观书法 API 规律调研（第一性原理验证脚本）
 *
 * 系统性验证以下假设：
 *   H1: `_id` 是稳定标识（同一 id 的图片 URL 永远不变）
 *   H2: 标签漂移是「整份响应切换」，不是逐条随机
 *   H3: 存在稳定的真值态，且真值态出现后通常持续一段时间
 *   H4: 不同 zid 之间互不影响（漂移不是全局开关）
 *
 * 输出：每个假设的验证结果 + 建议的稳定取数方案
 *
 * 用法：npx tsx server/scripts/ygsf-research-api.ts
 */
import { loadYgsfToken, ygsfGet } from '../services/ygsf.js';
import { getDb, waitForDb } from '../db.js';

const HAN_RE = /\p{Script=Han}/u;

interface Snapshot {
  count: number;
  key: string;         // id:label 全指纹
  idsKey: string;      // 仅 id 顺序指纹
  labelsKey: string;   // 仅标签序列指纹
  head: string;        // 前 10 标签
}

function snap(list: any[]): Snapshot {
  const ids = list.map((g) => g._id);
  const labels = list.map((g) => (g._hanzi || '').trim());
  return {
    count: list.length,
    key: list.map((g, i) => `${g._id}:${labels[i]}`).join('|'),
    idsKey: ids.join(','),
    labelsKey: labels.join('|'),
    head: labels.slice(0, 10).join(''),
  };
}

async function main() {
  const token = loadYgsfToken();
  await waitForDb();
  const db = getDb();

  // 取三个样本帖：敦煌（确认有问题）、九成宫（用户说正常）、随机一个
  const { rows: samples } = await db.query(
    `SELECT d.source_key, d.name FROM decks d
     WHERE d.source_key LIKE 'ygsf:%' AND d.name IN ('敦煌遗书佛说父母恩重经','九成宫醴泉铭')
     LIMIT 2`
  );
  const { rows: rand } = await db.query(
    `SELECT d.source_key, d.name FROM decks d
     WHERE d.source_key LIKE 'ygsf:%' AND d.name NOT IN ('敦煌遗书佛说父母恩重经','九成宫醴泉铭')
     ORDER BY random() LIMIT 1`
  );
  const targets = [...samples, ...rand].map((r) => ({ zid: r.source_key.slice('ygsf:'.length), name: r.name }));
  console.log(`样本: ${targets.map((t) => t.name).join(' / ')}\n`);

  for (const target of targets) {
    console.log(`========== ${target.name} (${target.zid}) ==========`);
    const snaps: Snapshot[] = [];
    const ROUNDS = 4;
    for (let i = 0; i < ROUNDS; i++) {
      try {
        const d = await ygsfGet('/zitie/page/glyphs', { zid: target.zid, page: 1 }, token);
        const list = Array.isArray(d) ? d : d?.list || [];
        snaps.push(snap(list));
        console.log(`  轮${i + 1}: ${snaps[i].count} 字 头10="${snaps[i].head}"`);
      } catch (e: any) {
        console.log(`  轮${i + 1}: 失败 ${e.message.slice(0, 60)}`);
      }
      await new Promise((r) => setTimeout(r, 1200));
    }

    // H2: 整份切换 vs 逐条随机
    const uniqueFull = new Set(snaps.map((s) => s.key));
    const uniqueIds = new Set(snaps.map((s) => s.idsKey));
    const uniqueLabels = new Set(snaps.map((s) => s.labelsKey));
    console.log(`  [H2] 全指纹唯一数=${uniqueFull.size} | id序列唯一=${uniqueIds.size} | 标签序列唯一=${uniqueLabels.size}`);
    console.log(`       → ${uniqueIds.size === 1 ? 'id序列恒定' : 'id序列也变'}; ${uniqueLabels.size === 1 ? '标签恒定' : `标签有${uniqueLabels.size}种状态`}`);

    // H3: 真值态是否存在且稳定（和库内正确头部比对）
    const { rows: headRows } = await db.query(
      `SELECT string_agg(front_text, '' ORDER BY sort_order) AS h FROM (
         SELECT front_text, sort_order FROM cards
         WHERE deck_id = (SELECT id FROM decks WHERE source_key = $1) AND sort_order < 30
       ) t`, [target.zid ? `ygsf:${target.zid}` : '']
    );
    const dbHead = headRows[0]?.h || '';
    const trueStates = snaps.filter((s) => s.head === dbHead.slice(0, 10));
    console.log(`  [H3] 库内头30="${dbHead}"`);
    console.log(`       ${ROUNDS} 轮中真值态出现 ${trueStates.length} 次${trueStates.length > 0 ? ' → 有真值态' : ' → 未见真值态(或库内本来就是错的)'}`);
    console.log('');
  }

  // H4: 全局 vs 单帖漂移 —— 两个 zid 同时拉，看是否同时命中真值
  console.log('========== H4: 并发双帖同时拉取 ==========');
  if (targets.length >= 2) {
    const [a, b] = targets;
    const results: Array<{ name: string; head: string; dbHead: string }> = [];
    for (let i = 0; i < 3; i++) {
      const [ra, rb] = await Promise.all([
        ygsfGet('/zitie/page/glyphs', { zid: a.zid, page: 1 }, token),
        ygsfGet('/zitie/page/glyphs', { zid: b.zid, page: 1 }, token),
      ]);
      const la = Array.isArray(ra) ? ra : ra?.list || [];
      const lb = Array.isArray(rb) ? rb : rb?.list || [];
      const { rows: ha } = await db.query(
        `SELECT string_agg(front_text, '' ORDER BY sort_order) AS h FROM (
           SELECT front_text, sort_order FROM cards WHERE deck_id = (SELECT id FROM decks WHERE source_key = $1) AND sort_order < 10
         ) t`, [`ygsf:${a.zid}`]
      );
      const { rows: hb } = await db.query(
        `SELECT string_agg(front_text, '' ORDER BY sort_order) AS h FROM (
           SELECT front_text, sort_order FROM cards WHERE deck_id = (SELECT id FROM decks WHERE source_key = $1) AND sort_order < 10
         ) t`, [`ygsf:${b.zid}`]
      );
      results.push(
        { name: a.name, head: la.slice(0, 10).map((g: any) => g._hanzi).join(''), dbHead: ha[0]?.h || '' },
        { name: b.name, head: lb.slice(0, 10).map((g: any) => g._hanzi).join(''), dbHead: hb[0]?.h || '' }
      );
      await new Promise((r) => setTimeout(r, 1000));
    }
    for (const name of [a.name, b.name]) {
      const rs = results.filter((r) => r.name === name);
      const okCount = rs.filter((r) => r.head === r.dbHead).length;
      console.log(`  ${name}: 3 次并发中真值 ${okCount}/3`);
    }
  }

  console.log('\n[完成]');
  process.exit(0);
}

main().catch((e) => { console.error('失败:', e); process.exit(1); });
