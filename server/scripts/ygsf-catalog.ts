/**
 * YGSF 目录扫描与批量建库（第三步：市场化引入）
 *
 * 只存元数据和图片直链，不下载图片（镜像请用 ygsf-sync.ts --mirror，手动执行）。
 *
 * 用法：
 *   npx tsx server/scripts/ygsf-catalog.ts --search <关键词>          # 按名称搜作品，入目录表
 *   npx tsx server/scripts/ygsf-catalog.ts --search-file <文件>       # 批量关键词（每行一个）
 *   npx tsx server/scripts/ygsf-catalog.ts --list [--style 楷]        # 目录统计 / 候选清单
 *   npx tsx server/scripts/ygsf-catalog.ts --import --zuopin <id> [--publish] [--max-chars N]
 *   npx tsx server/scripts/ygsf-catalog.ts --import --zitie <id> --name "帖名" [--author X] [--publish]
 *
 * 建库逻辑：
 *   - 每个字帖版本（zitie）建一个 deck，卡片 image_url 直接用对方 CDN 直链（零图片存储）
 *   - source_key = ygsf:<zitie_id>（deck）/ ygsf:<zitie_id>:<glyph_id>（卡片），重复执行自动跳过
 *   - 书体取该帖单字 _font 的众数；--publish 额外写入 marketplace_decks 上架市场
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import { getDb, waitForDb } from '../db.js';
import {
  fetchZitieGlyphs,
  loadYgsfToken,
  searchZuopin,
  ygsfGet,
} from '../services/ygsf.js';

interface Args {
  search?: string;
  searchFile?: string;
  list?: boolean;
  style?: string;
  importFlag?: boolean;
  zuopin?: string;
  zitie?: string;
  name?: string;
  author?: string;
  publish: boolean;
  maxChars: number;
}

function parseArgs(): Args {
  const args = process.argv.slice(2);
  const get = (flag: string) => {
    const i = args.indexOf(flag);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const has = (flag: string) => args.includes(flag);
  return {
    search: get('--search'),
    searchFile: get('--search-file'),
    list: has('--list'),
    classify: has('--classify'),
    style: get('--style'),
    importFlag: has('--import'),
    zuopin: get('--zuopin'),
    zitie: get('--zitie'),
    name: get('--name'),
    author: get('--author'),
    publish: has('--publish'),
    maxChars: parseInt(get('--max-chars') || '0', 10) || 0,
  };
}

/** 与 jizi.ts 的清洗规则保持一致 */
function cleanFrontText(raw: string): string {
  if (!raw) return '';
  let s = raw.trim();
  s = s.replace(/\s*[(\[【（][^)\]】]*[)\]】]?$/u, '');
  s = s.replace(/[_\-]\d+$/u, '');
  s = s.replace(/(\p{Script=Han})\d{1,3}$/u, '$1');
  s = s.replace(/\s+/g, '');
  return s;
}

async function doSearch(db: any, keyword: string, token: string) {
  process.stdout.write(`搜索「${keyword}」`);
  const { total, items } = await searchZuopin(keyword, token);
  for (const z of items) {
    await db.query(
      `INSERT INTO ygsf_zuopin (zuopin_id, name, author, cover_url, zitie_id, scanned_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (zuopin_id) DO UPDATE SET
         name = EXCLUDED.name, author = EXCLUDED.author,
         cover_url = EXCLUDED.cover_url, zitie_id = COALESCE(NULLIF(EXCLUDED.zitie_id, ''), ygsf_zuopin.zitie_id)`,
      [z.zuopinId, z.name, z.author, z.coverUrl, z.zitieId, new Date().toISOString()],
    );
  }
  console.log(`：total=${total}，新收录/更新 ${items.length} 条`);
}

async function doImport(db: any, opts: Args, token: string) {
  let zitieId = opts.zitie || '';
  let deckName = opts.name || '';
  let author = opts.author || '';
  let coverUrl = '';

  if (opts.zuopin) {
    const r = await db.query('SELECT * FROM ygsf_zuopin WHERE zuopin_id = $1', [opts.zuopin]);
    if (r.rows.length === 0) throw new Error(`目录表中没有该作品: ${opts.zuopin}（先 --search 收录）`);
    const z = r.rows[0];
    zitieId = zitieId || z.zitie_id;
    deckName = deckName || z.name;
    author = author || z.author;
    coverUrl = z.cover_url;
    if (!zitieId) throw new Error(`作品「${z.name}」没有可用的字帖版本 id`);
  }
  if (!zitieId || !deckName) throw new Error('--import 需要 --zuopin <id> 或 --zitie <id> --name "帖名"');

  // 幂等：source_key 已存在则跳过
  const deckKey = `ygsf:${zitieId}`;
  const existing = await db.query('SELECT id, name FROM decks WHERE source_key = $1', [deckKey]);
  if (existing.rows.length > 0) {
    console.log(`已存在（${existing.rows[0].name}），跳过。如需重导请先删除该 deck。`);
    process.exit(0);
  }

  process.stdout.write(`拉取字帖 ${zitieId} 单字清单`);
  const { glyphs, style, total, limited } = await fetchZitieGlyphs(zitieId, token);
  console.log(`：${glyphs.length}/${total} 个单字，书体=${style || '未知'}${limited ? ' ⚠️ 匿名受限未拉全' : ''}`);
  if (glyphs.length === 0) throw new Error('没有拉到任何单字，中止');
  if (opts.maxChars > 0 && glyphs.length > opts.maxChars) {
    console.log(`单字数 ${glyphs.length} 超过 --max-chars ${opts.maxChars}，中止（可用 --max-chars 放行）`);
    process.exit(1);
  }

  // 管理员为内容归属
  const admin = await db.query("SELECT id FROM users WHERE role = 'admin' ORDER BY created_at LIMIT 1");
  const adminId = admin.rows[0]?.id || null;

  const deckId = crypto.randomUUID();
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO decks (id, name, card_count, user_id, source_key, daily_new_card_limit, daily_review_limit)
       VALUES ($1, $2, $3, $4, $5, 20, 200)`,
      [deckId, deckName, glyphs.length, adminId, deckKey],
    );
    let inserted = 0;
    for (let i = 0; i < glyphs.length; i++) {
      const g = glyphs[i];
      await client.query(
        `INSERT INTO cards (id, deck_id, front_text, image_url, source_key, sort_order, ease, interval, repetitions)
         VALUES ($1, $2, $3, $4, $5, $6, 2.5, 0, 0)`,
        [crypto.randomUUID(), deckId, g.hanzi, g.colorImage, `ygsf:${zitieId}:${g.id}`, i],
      );
      await client.query(
        `INSERT INTO ygsf_images (glyph_id, zitie_id, hanzi, remote_url)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (glyph_id) DO UPDATE SET zitie_id = EXCLUDED.zitie_id, hanzi = EXCLUDED.hanzi, remote_url = EXCLUDED.remote_url`,
        [g.id, zitieId, g.hanzi, g.colorImage],
      );
      inserted++;
    }
    if (opts.publish) {
      await client.query(
        `INSERT INTO marketplace_decks (deck_id, calligrapher, dynasty, style, description, cover_image, cover_thumb, featured, sort_order, published_at, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, '', 0, 9999, $7, $7)
         ON CONFLICT (deck_id) DO NOTHING`,
        [deckId, author, '', style, '以观书法远程字库', coverUrl, new Date().toISOString()],
      );
    }
    await client.query(
      `UPDATE ygsf_zuopin SET imported_deck_id = $1, style = $2 WHERE zuopin_id = $3`,
      [deckId, style, opts.zuopin || ''],
    );
    await client.query('COMMIT');
    console.log(`已建牌组「${deckName}」（${inserted} 卡，书体 ${style || '?'}${opts.publish ? '，已上架市场' : ''}）：${deckId}`);
    if (opts.publish && !coverUrl) console.log('⚠️ 无封面（--zuopin 方式才有），市场卡片封面为空');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

/** 轻量书体分类：每个未分类候选拉第一页单字读 _font 众数（约 1 请求/帖） */
async function doClassify(db: any, token: string) {
  const rows = await db.query(
    "SELECT zuopin_id, name, zitie_id FROM ygsf_zuopin WHERE style = '' AND zitie_id <> '' ORDER BY scanned_at LIMIT 500",
  );
  console.log(`待分类候选 ${rows.rows.length} 个`);
  let done = 0;
  for (const z of rows.rows) {
    try {
      const data = await ygsfGet('/zitie/glyphs/query', { zid: z.zitie_id, loaded: 0 }, token);
      const list: any[] = Array.isArray(data) ? data : data?.list || [];
      const fontCount = new Map<string, number>();
      for (const g of list) {
        const f = (g?._font || '').trim();
        if (f) fontCount.set(f, (fontCount.get(f) || 0) + 1);
      }
      const style = [...fontCount.entries()].sort((x, y) => y[1] - x[1])[0]?.[0] || '未知';
      await db.query('UPDATE ygsf_zuopin SET style = $1 WHERE zuopin_id = $2', [style, z.zuopin_id]);
      done++;
      process.stdout.write(`\r已分类 ${done}：${z.name}=${style}    `);
      await new Promise((r) => setTimeout(r, 300));
    } catch (e: any) {
      console.error(`\n分类失败 ${z.name}: ${e.message}`);
    }
  }
  console.log(`\n分类完成 ${done} 个。`);
}

async function main() {
  const a = parseArgs();
  if (!a.search && !a.searchFile && !a.list && !a.importFlag && !a.classify) {
    console.log('用 --search <关键词> / --search-file <文件> / --classify / --list / --import。详见文件头注释。');
    process.exit(0);
  }
  const token = loadYgsfToken();
  await waitForDb();
  const db = getDb();

  if (a.classify) {
    await doClassify(db, token);
    process.exit(0);
  }

  if (a.search) {
    await doSearch(db, a.search, token);
    process.exit(0);
  }
  if (a.searchFile) {
    const words = fs
      .readFileSync(a.searchFile, 'utf-8')
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);
    console.log(`批量搜索 ${words.length} 个关键词`);
    for (const w of words) {
      await doSearch(db, w, token);
      await new Promise((r) => setTimeout(r, 400));
    }
    process.exit(0);
  }
  if (a.list) {
    const stats = await db.query(`
      SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE imported_deck_id IS NOT NULL)::int AS imported,
        style, COUNT(*)::int AS n
      FROM ygsf_zuopin GROUP BY style ORDER BY n DESC`);
    console.log('目录统计（按书体）:');
    let tot = 0;
    let imp = 0;
    for (const r of stats.rows) {
      console.log(`  ${r.style || '未知书体'}: ${r.n} 帖（已导入 ${r.imported}）`);
      tot += r.n;
      imp += r.imported;
    }
    console.log(`  合计: ${tot} 帖（已导入 ${imp}）`);
    if (a.style) {
      const rows = await db.query(
        'SELECT zuopin_id, name, author, zitie_id FROM ygsf_zuopin WHERE style = $1 AND imported_deck_id IS NULL ORDER BY name LIMIT 50',
        [a.style],
      );
      console.log(`\n书体「${a.style}」未导入候选（最多 50）:`);
      for (const r of rows.rows) console.log(`  ${r.zuopin_id}  ${r.name}  ${r.author}`);
    }
    process.exit(0);
  }
  if (a.importFlag) {
    await doImport(db, a, token);
    process.exit(0);
  }
}

main().catch((e) => {
  console.error('失败:', e.message);
  process.exit(1);
});
