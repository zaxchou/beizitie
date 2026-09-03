/**
 * YGSF 目录扫描与批量建库（第三步：市场化引入）
 *
 * 只存元数据和图片直链，不下载图片（镜像请用 ygsf-sync.ts --mirror，手动执行）。
 *
 * 用法：
 *   npx tsx server/scripts/ygsf-catalog.ts --search <关键词>          # 按名称搜作品，入目录表
 *   npx tsx server/scripts/ygsf-catalog.ts --search-file <文件>       # 批量关键词（每行一个）
 *   npx tsx server/scripts/ygsf-catalog.ts --classify                 # 候选池书体预分类（轻量）
 *   npx tsx server/scripts/ygsf-catalog.ts --list [--style 楷]        # 目录统计 / 候选清单
 *   npx tsx server/scripts/ygsf-catalog.ts --import --zuopin <id> [--publish] [--max-chars N]
 *   npx tsx server/scripts/ygsf-catalog.ts --import --zitie <id> --name "帖名" [--author X] [--publish]
 *   npx tsx server/scripts/ygsf-catalog.ts --import-batch --style 楷 [--batch 40] [--publish]
 *   npx tsx server/scripts/ygsf-catalog.ts --enrich [--zuopin <id>]
 *
 * 建库逻辑：
 *   - 每个字帖版本（zitie）建一个 deck，卡片 image_url 直接用对方 CDN 直链（零图片存储）
 *   - source_key = ygsf:<zitie_id>（deck）/ ygsf:<zitie_id>:<glyph_id>（卡片），重复执行自动跳过
 *   - 书体取该帖单字 _font 的众数；--publish 额外写入 marketplace_decks 上架市场
 *   - 元数据自动抓取：zitie/details（朝代/版本封面/页数）+ zitie/page/text（碑帖原文）
 *
 * 无人值守护栏（--import-batch）：
 *   - 拉取不完整（登录墙/token 失效）的帖不入库，连续 5 次输出 NEED_TOKEN 并停止
 *   - 杂帖黑名单（教学/手稿/临摹指导等）、与其他书体不符、重名 deck 均跳过
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import { getDb, waitForDb } from '../db.js';
import {
  fetchZitieDetails,
  fetchZitieGlyphs,
  fetchZitieText,
  loadYgsfToken,
  searchZuopin,
  ygsfGet,
  type YgsfGlyph,
} from '../services/ygsf.js';

const JUNK_PATTERNS = ['教学', '手稿', '临摹指导', '讲座', '课件', '教程', '示范课', '视频课'];
const TEXT_MAX_PAGES = 6;

interface Args {
  search?: string;
  searchFile?: string;
  list?: boolean;
  classify: boolean;
  enrich: boolean;
  style?: string;
  importFlag: boolean;
  importBatch: boolean;
  batch: number;
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
    enrich: has('--enrich'),
    style: get('--style'),
    importFlag: has('--import'),
    importBatch: has('--import-batch'),
    batch: parseInt(get('--batch') || '40', 10) || 40,
    zuopin: get('--zuopin'),
    zitie: get('--zitie'),
    name: get('--name'),
    author: get('--author'),
    publish: has('--publish'),
    maxChars: parseInt(get('--max-chars') || '6000', 10) || 6000,
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

function isJunkName(name: string): boolean {
  return JUNK_PATTERNS.some((p) => name.includes(p));
}

function buildDescription(o: {
  name: string;
  author: string;
  dynasty: string;
  style: string;
  glyphCount: number;
  pages: number;
  text: string;
}): string {
  let head = `《${o.name}》`;
  const who = [o.dynasty, o.author].filter(Boolean).join('·');
  if (who) head += `，${who}`;
  if (o.style) head += ` ${o.style}书`;
  head += `。全帖 ${o.glyphCount} 字${o.pages ? `、${o.pages} 页` : ''}。`;
  const parts = [head];
  const text = o.text.replace(/\s+/g, '');
  if (text) parts.push(`碑帖原文起首：${text.slice(0, 80)}${text.length > 80 ? '……' : ''}`);
  return parts.join('');
}

type ImportStatus =
  | 'ok'
  | 'exists'
  | 'duplicate-name'
  | 'junk'
  | 'partial'
  | 'maxchars'
  | 'fail';

async function importOne(
  db: any,
  opts: {
    zuopinId?: string;
    zitieId?: string;
    name?: string;
    author?: string;
    publish: boolean;
    maxChars: number;
    batchMode: boolean;
  },
  token: string,
): Promise<{ status: ImportStatus; message: string; deckId?: string }> {
  let zitieId = opts.zitieId || '';
  let deckName = opts.name || '';
  let author = opts.author || '';
  let coverUrl = '';

  if (opts.zuopinId) {
    const r = await db.query('SELECT * FROM ygsf_zuopin WHERE zuopin_id = $1', [opts.zuopinId]);
    if (r.rows.length === 0)
      return { status: 'fail', message: `目录表中没有该作品: ${opts.zuopinId}` };
    const z = r.rows[0];
    zitieId = zitieId || z.zitie_id;
    deckName = deckName || z.name;
    author = author || z.author;
    coverUrl = z.cover_url || '';
    if (!zitieId) return { status: 'fail', message: `作品「${z.name}」没有可用的字帖版本 id` };
  }
  if (!zitieId || !deckName) return { status: 'fail', message: '缺少 zitie/id 或名称' };

  if (opts.batchMode && isJunkName(deckName)) {
    return { status: 'junk', message: `杂帖黑名单：${deckName}` };
  }

  // 幂等：source_key 已存在则跳过
  const deckKey = `ygsf:${zitieId}`;
  const existing = await db.query('SELECT id, name FROM decks WHERE source_key = $1', [deckKey]);
  if (existing.rows.length > 0) {
    return { status: 'exists', message: `已存在（${existing.rows[0].name}）` };
  }
  // 重名 deck 已在库中（本地旧图库内容），批量模式跳过避免市场重复
  const dupName = await db.query('SELECT id FROM decks WHERE name = $1 LIMIT 1', [deckName]);
  if (dupName.rows.length > 0) {
    return { status: 'duplicate-name', message: `重名牌组已在库：${deckName}` };
  }

  const { glyphs, style, total, limited } = await fetchZitieGlyphs(zitieId, token);
  if (glyphs.length === 0) {
    return { status: limited ? 'partial' : 'fail', message: '没有拉到任何单字' };
  }
  // 护栏：拉取不完整（token 失效触发登录墙/分页缺失）不入残库
  if (limited || glyphs.length < total * 0.95) {
    return {
      status: 'partial',
      message: `拉取不完整 ${glyphs.length}/${total}（登录墙或 token 失效），不入库`,
    };
  }
  if (glyphs.length > opts.maxChars) {
    return { status: 'maxchars', message: `单字数 ${glyphs.length} 超过上限 ${opts.maxChars}` };
  }

  // 元数据：详情（朝代/版本封面/页数）+ 碑帖原文
  const details = await fetchZitieDetails(zitieId, token);
  const text = await fetchZitieText(zitieId, token, TEXT_MAX_PAGES);
  coverUrl = details?.coverUrl || coverUrl;
  const description = buildDescription({
    name: deckName,
    author,
    dynasty: details?.dynasty || '',
    style,
    glyphCount: glyphs.length,
    pages: details?.pageCount || 0,
    text,
  });

  const admin = await db.query("SELECT id FROM users WHERE role = 'admin' ORDER BY created_at LIMIT 1");
  const adminId = admin.rows[0]?.id || null;

  const deckId = crypto.randomUUID();
  const now = new Date().toISOString();
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO decks (id, name, card_count, user_id, source_key, daily_new_card_limit, daily_review_limit, article_text, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, 20, 200, $6, $7, $7)`,
      [deckId, deckName, glyphs.length, adminId, deckKey, text.slice(0, 8000), now],
    );

    // 卡片批量插入（200/批）
    const CHUNK = 200;
    for (let i = 0; i < glyphs.length; i += CHUNK) {
      const batch = glyphs.slice(i, i + CHUNK);
      const values: unknown[] = [];
      const tuples = batch.map((g: YgsfGlyph, j: number) => {
        const b = j * 7;
        values.push(
          crypto.randomUUID(),
          deckId,
          g.hanzi,
          g.colorImage,
          `ygsf:${zitieId}:${g.id}`,
          i + j,
          now,
        );
        return `($${b + 1}, $${b + 2}, NULL, $${b + 3}, $${b + 4}, $${b + 5}, $${b + 6}, 2.5, 0, 0, $${b + 7}, $${b + 7}, $${b + 7})`;
      });
      await client.query(
        `INSERT INTO cards (id, deck_id, user_id, front_text, image_url, source_key, sort_order, ease, interval, repetitions, next_review, created_at, updated_at)
         VALUES ${tuples.join(',')}`,
        values,
      );
    }

    // ygsf_images 映射（批量 upsert）
    for (let i = 0; i < glyphs.length; i += CHUNK) {
      const batch = glyphs.slice(i, i + CHUNK);
      const values: unknown[] = [];
      const tuples = batch.map((g: YgsfGlyph, j: number) => {
        const b = j * 4;
        values.push(g.id, zitieId, g.hanzi, g.colorImage);
        return `($${b + 1}, $${b + 2}, $${b + 3}, $${b + 4})`;
      });
      await client.query(
        `INSERT INTO ygsf_images (glyph_id, zitie_id, hanzi, remote_url)
         VALUES ${tuples.join(',')}
         ON CONFLICT (glyph_id) DO UPDATE SET zitie_id = EXCLUDED.zitie_id, hanzi = EXCLUDED.hanzi, remote_url = EXCLUDED.remote_url`,
        values,
      );
    }

    if (opts.publish) {
      await client.query(
        `INSERT INTO marketplace_decks (deck_id, calligrapher, dynasty, style, description, cover_image, cover_thumb, featured, sort_order, published_at, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $6, 0, 9999, $7, $7)
         ON CONFLICT (deck_id) DO NOTHING`,
        [deckId, author, details?.dynasty || '', style, description, coverUrl, now],
      );
    }
    if (opts.zuopinId) {
      await client.query(
        `UPDATE ygsf_zuopin SET imported_deck_id = $1, style = $2 WHERE zuopin_id = $3`,
        [deckId, style, opts.zuopinId],
      );
    }
    await client.query('COMMIT');
    return {
      status: 'ok',
      message: `已建「${deckName}」（${glyphs.length} 卡，${style || '?'}${details ? `，${details.dynasty || '?'}${details.pageCount ? ` ${details.pageCount} 页` : ''}` : ''}${opts.publish ? '，已上架' : ''}）`,
      deckId,
    };
  } catch (e: any) {
    await client.query('ROLLBACK');
    return { status: 'fail', message: `DB 失败: ${e.message}` };
  } finally {
    client.release();
  }
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

/** 补全已有 ygsf 牌组的元数据（可 --zuopin 指定，缺省跑全部已导入） */
async function doEnrich(db: any, opts: Args, token: string) {
  const cond = opts.zuopin ? ' AND zuopin_id = $2' : '';
  const params = opts.zuopin ? [opts.zuopin] : [];
  const rows = await db.query(
    `SELECT zuopin_id, name, author, zitie_id, imported_deck_id FROM ygsf_zuopin
     WHERE imported_deck_id IS NOT NULL${cond}`,
    params,
  );
  console.log(`待补全元数据 ${rows.rows.length} 帖`);
  for (const z of rows.rows) {
    try {
      const det = await fetchZitieDetails(z.zitie_id, token);
      const text = await fetchZitieText(z.zitie_id, token, 80);
      const cnt = await db.query('SELECT COUNT(*)::int AS n FROM cards WHERE deck_id = $1', [
        z.imported_deck_id,
      ]);
      const glyphCount = cnt.rows[0]?.n || 0;
      const description = buildDescription({
        name: det?.name || z.name,
        author: z.author || det?.author || '',
        dynasty: det?.dynasty || '',
        style: z.style || '',
        glyphCount,
        pages: det?.pageCount || 0,
        text,
      });
      await db.query('UPDATE decks SET article_text = $2 WHERE id = $1', [
        z.imported_deck_id,
        text.slice(0, 8000),
      ]);
      await db.query(
        `UPDATE marketplace_decks SET
           cover_image = CASE WHEN $2 <> '' THEN $2 ELSE cover_image END,
           cover_thumb = CASE WHEN $2 <> '' THEN $2 ELSE cover_thumb END,
           dynasty = $3, description = $4,
           calligrapher = CASE WHEN $5 <> '' THEN $5 ELSE calligrapher END,
           style = CASE WHEN $6 <> '' THEN $6 ELSE style END
         WHERE deck_id = $1`,
        [z.imported_deck_id, det?.coverUrl || '', det?.dynasty || '', description, det?.author || '', z.style || ''],
      );
      console.log(`✓ ${z.name}：封面+朝代(${det?.dynasty || '?'})+简介+原文 ${text.length} 字`);
      await new Promise((r) => setTimeout(r, 300));
    } catch (e: any) {
      console.error(`✗ ${z.name}: ${e.message}`);
    }
  }
}

async function main() {
  const a = parseArgs();
  if (
    !a.search &&
    !a.searchFile &&
    !a.list &&
    !a.importFlag &&
    !a.importBatch &&
    !a.classify &&
    !a.enrich
  ) {
    console.log(
      '用 --search <关键词> / --search-file <文件> / --classify / --list / --import / --import-batch / --enrich。详见文件头注释。',
    );
    process.exit(0);
  }
  const token = loadYgsfToken();
  if (!token && (a.importFlag || a.importBatch || a.classify)) {
    console.error('需要 ygsf 登录 token（--token / 环境变量 YGSF_TOKEN / 项目根 .ygsf-token）');
    process.exit(1);
  }
  await waitForDb();
  const db = getDb();

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
  if (a.classify) {
    await doClassify(db, token);
    process.exit(0);
  }
  if (a.enrich) {
    await doEnrich(db, a, token);
    process.exit(0);
  }
  if (a.list) {
    const stats = await db.query(`
      SELECT
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
    const r = await importOne(
      db,
      {
        zuopinId: a.zuopin,
        zitieId: a.zitie,
        name: a.name,
        author: a.author,
        publish: a.publish,
        maxChars: a.maxChars,
        batchMode: false,
      },
      token,
    );
    console.log(`[${r.status}] ${r.message}`);
    process.exit(r.status === 'ok' || r.status === 'exists' ? 0 : 1);
  }

  if (a.importBatch) {
    if (!a.style) throw new Error('--import-batch 需要 --style');
    const cand = await db.query(
      `SELECT zuopin_id, name FROM ygsf_zuopin
       WHERE style = $1 AND imported_deck_id IS NULL AND zitie_id <> ''
       ORDER BY name LIMIT $2`,
      [a.style, a.batch],
    );
    console.log(`书体「${a.style}」本轮候选 ${cand.rows.length} 帖`);
    let ok = 0;
    let partialStreak = 0;
    let failStreak = 0;
    for (const z of cand.rows) {
      const r = await importOne(
        db,
        { zuopinId: z.zuopin_id, publish: a.publish, maxChars: a.maxChars, batchMode: true },
        token,
      );
      console.log(`  [${r.status}] ${z.name}: ${r.message}`);
      if (r.status === 'ok') {
        ok++;
        partialStreak = 0;
        failStreak = 0;
      } else if (r.status === 'partial') {
        partialStreak++;
        if (partialStreak >= 5) {
          console.log('NEED_TOKEN: 连续多次拉取不完整，token 可能已失效，停止本轮导入');
          process.exit(3);
        }
      } else if (r.status === 'fail') {
        failStreak++;
        if (failStreak >= 10) {
          console.log('连续 10 次失败，停止本轮');
          process.exit(4);
        }
      }
      await new Promise((r2) => setTimeout(r2, 300));
    }
    console.log(`本轮完成：成功 ${ok}/${cand.rows.length}`);
    process.exit(0);
  }
}

main().catch((e) => {
  console.error('失败:', e.message);
  process.exit(1);
});
