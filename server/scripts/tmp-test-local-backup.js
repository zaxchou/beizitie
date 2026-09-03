/* local-backup 导入接口端到端自测（服务器上跑，用完即删）
 * 1. 取一个已有 ygsf 帖 → 构造备份 JSON（3 卡：2 精确 URL 匹配 + 1 唯一 front_text 兜底；4 条进度含 1 条无效；1 天统计）
 * 2. 注册临时用户 zz_test_import → 登录拿 token → POST /api/import/local-backup
 * 3. 校验 report 与 DB 落点 → 打印结果（清理由外部删用户级联完成）
 */
const BASE = 'http://localhost:3001';
const { Pool } = require('/opt/zi2anki/node_modules/pg');

(async () => {
  const pool = new Pool({
    host: 'localhost', port: 5432, database: 'zi2anki', user: 'zi2anki', password: 'zi2anki_pg_2026',
  });

  // 找一个已上架 ygsf 帖：3 张卡且第 3 张 front_text 帖内唯一（供兜底匹配）
  const candRes = await pool.query(
    `SELECT d.id, d.name, d.source_key, md.style FROM decks d
     JOIN marketplace_decks md ON md.deck_id = d.id
     WHERE d.source_key LIKE 'ygsf:%'
     ORDER BY d.card_count DESC LIMIT 30`
  );
  let deck = null, cards = null;
  for (const cand of candRes.rows) {
    const cs = (await pool.query(
      `SELECT id, front_text, image_url FROM cards WHERE deck_id = $1 ORDER BY sort_order LIMIT 3`,
      [cand.id]
    )).rows;
    if (cs.length < 3) continue;
    const uniq = (await pool.query(
      `SELECT COUNT(*)::int AS n FROM cards WHERE deck_id = $1 AND front_text = $2`,
      [cand.id, cs[2].front_text]
    )).rows[0].n;
    if (uniq === 1) { deck = cand; cards = cs; break; }
  }
  if (!deck) throw new Error('候选 30 帖中没找到满足条件的样例');

  const zitieId = deck.source_key.slice('ygsf:'.length);
  const payload = {
    format: 'beizitie-backup',
    version: 1,
    exportedAt: new Date().toISOString(),
    decks: [{
      id: 'local-d1', name: deck.name, zitieId,
      calligrapher: '', dynasty: '', style: deck.style || '',
      created_at: new Date().toISOString(),
      settings: { dailyNewLimit: 20, dailyReviewLimit: 200, paused: false },
    }],
    cards: [
      { id: 'lc-1', deck_id: 'local-d1', front_text: cards[0].front_text, image_url: cards[0].image_url, sort_order: 0 },
      { id: 'lc-2', deck_id: 'local-d1', front_text: cards[1].front_text, image_url: cards[1].image_url, sort_order: 1 },
      { id: 'lc-3', deck_id: 'local-d1', front_text: cards[2].front_text, image_url: '', sort_order: 2 },
    ],
    progress: [
      { card_id: 'lc-1', deck_id: 'local-d1', ease: 2.5, interval: 3, repetitions: 2, next_review: '2026-09-07T00:00:00.000Z', last_review: '2026-09-03T00:00:00.000Z' },
      { card_id: 'lc-2', deck_id: 'local-d1', ease: 2.6, interval: 1, repetitions: 1, next_review: '2026-09-05T00:00:00.000Z', last_review: '2026-09-04T00:00:00.000Z' },
      { card_id: 'lc-3', deck_id: 'local-d1', ease: 2.5, interval: 0, repetitions: 0, next_review: '2026-09-04T00:00:00.000Z', last_review: null },
      { card_id: 'lc-404', deck_id: 'local-d1', ease: 2.5, interval: 0, repetitions: 0, next_review: '2026-09-04T00:00:00.000Z', last_review: null },
    ],
    stats: [{ date: '2026-09-04', studied: 7, newLearned: 3 }],
  };

  // 注册 + 登录（重复运行时注册会 400，直接登录）
  await fetch(`${BASE}/api/auth/register`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'zz_test_import', password: 'Zz-test-2026-x' }),
  });
  const login = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'zz_test_import', password: 'Zz-test-2026-x' }),
  });
  const loginBody = await login.json();
  if (!loginBody.token) throw new Error('登录失败: ' + JSON.stringify(loginBody).slice(0, 200));
  const token = loginBody.token;

  const imp = await fetch(`${BASE}/api/import/local-backup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(payload),
  });
  console.log('import status', imp.status);
  console.log('import body', JSON.stringify(await imp.json()));

  // DB 落点校验
  const uid = (await pool.query(`SELECT id FROM users WHERE username='zz_test_import'`)).rows[0].id;
  const prog = await pool.query(
    `SELECT COUNT(*)::int AS n FROM user_card_progress WHERE user_id=$1`, [uid]);
  const subs = await pool.query(
    `SELECT COUNT(*)::int AS n FROM user_subscriptions WHERE user_id=$1 AND deck_id=$2`, [uid, deck.id]);
  const stats = await pool.query(
    `SELECT cards_studied, new_cards_learned FROM daily_stats WHERE user_id=$1 AND date='2026-09-04' AND deck_id=''`, [uid]);
  const intervalSum = await pool.query(
    `SELECT SUM(interval)::int AS s FROM user_card_progress WHERE user_id=$1`, [uid]);
  console.log(JSON.stringify({
    user_id: uid,
    progress_rows: prog.rows[0].n,
    subscribed: subs.rows[0].n,
    stats_row: stats.rows[0] || null,
    interval_sum: intervalSum.rows[0].s,
  }));

  await pool.end();
})().catch((e) => { console.error('TEST FAIL:', e.message); process.exit(1); });
