/**
 * YGSF 远程字库同步工具（以观书法 → 直链 + 混合缓存）
 *
 * 不下载图片：把牌组卡片的 image_url 切换成以观书法 CDN 的直链，
 * 字帖单字清单通过 api.ygsf.com 拉取（响应为 AES-128-ECB 加密，密钥来自其公开前端）。
 * 映射关系存 ygsf_images 表，支持把远程图镜像到本地 uploads 后一键切换本地/远程。
 *
 * 用法：
 *   npx tsx server/scripts/ygsf-sync.ts --info --zid <字帖id>
 *   npx tsx server/scripts/ygsf-sync.ts --deck "瘦金体千字文" --zid <字帖id> --dry-run
 *   npx tsx server/scripts/ygsf-sync.ts --deck "瘦金体千字文" --zid <字帖id> --apply
 *   npx tsx server/scripts/ygsf-sync.ts --mirror --deck "瘦金体千字文" [--limit N]
 *   npx tsx server/scripts/ygsf-sync.ts --to-local  --deck "瘦金体千字文"
 *   npx tsx server/scripts/ygsf-sync.ts --to-remote --deck "瘦金体千字文"
 *   npx tsx server/scripts/ygsf-sync.ts --restore <备份json路径>
 *
 * 登录态：匿名只能翻字帖前 4 页；--token 传登录 token（或环境变量 YGSF_TOKEN，
 * 或 /opt/zi2anki/.ygsf-token 文件）。token 只在拉清单时用，图片直链本身永久公开。
 *
 * 混合机制：
 *   --apply   同步直链并登记 ygsf_images 映射表
 *   --mirror  把远程图下载到 uploads/ygsf_<glyph>.png（断点续传，可 --limit 控制量）
 *   --to-local   已镜像的字切成本地路径（对方开防盗链时的兜底）
 *   --to-remote  切回远程直链
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { getDb, waitForDb } from '../db.js';

const AES_KEY = Buffer.from('PkT!ihpN^QkQ62k%', 'utf8');
const API_BASE = 'https://api.ygsf.com/v2.4';
const MAX_PAGES = 200;
const MIRROR_DELAY_MS = 250;
const REMOTE_URL_PREFIX = 'https://ygsf.cdn.bcebos.com/';
const LOCAL_URL_PREFIX = '/uploads/ygsf_';

interface YgsfGlyph {
  _id: string;
  _hanzi: string;
  _font?: string;
  _author?: string;
  _color_image?: string;
}

function decryptYgsf(payload: string): any {
  const b64 = payload
    .trim()
    .replace(/-/g, '+')
    .replace(/_/g, '/')
    .replace(/!/g, '=');
  const decipher = crypto.createDecipheriv('aes-128-ecb', AES_KEY, null);
  const json = Buffer.concat([
    decipher.update(Buffer.from(b64, 'base64')),
    decipher.final(),
  ]).toString('utf8');
  return JSON.parse(json);
}

function loadToken(cliToken?: string): string {
  if (cliToken) return cliToken;
  if (process.env.YGSF_TOKEN) return process.env.YGSF_TOKEN;
  // 脚本约定从项目根目录运行（/opt/zi2anki 或本地仓库根）
  const tokenFile = path.resolve(process.cwd(), '.ygsf-token');
  try {
    return fs.readFileSync(tokenFile, 'utf-8').trim();
  } catch {
    return '';
  }
}

async function ygsfGet(
  apiPath: string,
  params: Record<string, string | number>,
  token: string,
): Promise<any> {
  const qs = new URLSearchParams({ _plat: 'web' });
  if (token) qs.set('_token', token);
  for (const [k, v] of Object.entries(params)) qs.set(k, String(v));
  const res = await fetch(`${API_BASE}${apiPath}?${qs.toString()}`, {
    headers: { 'User-Agent': 'Mozilla/5.0' },
  });
  if (!res.ok) throw new Error(`YGSF API HTTP ${res.status}: ${apiPath}`);
  const body = decryptYgsf(await res.text());
  if (body.stat !== 0) {
    const err: any = new Error(`YGSF API stat=${body.stat} ${body.error?.title || ''}: ${apiPath}`);
    err.isLoginWall = body.error?.title?.includes('登录');
    throw err;
  }
  return body.data;
}

/**
 * 分页拉取整个字帖的单字清单，按 _id 去重。
 * 优先 zitie/glyphs/query（当前数据，loaded 偏移）；异常或为空时回退 zitie/page/glyphs（旧快照，匿名约 4 页）。
 */
async function fetchAllGlyphs(
  zid: string,
  token: string,
): Promise<{ glyphs: YgsfGlyph[]; limited: boolean }> {
  const all: YgsfGlyph[] = [];
  const seen = new Set<string>();
  let limited = false;

  // 主通道：zitie/glyphs/query（当前数据）
  try {
    for (let loaded = 0; loaded < MAX_PAGES * 120; loaded += 120) {
      const data = await ygsfGet('/zitie/glyphs/query', { zid, loaded }, token);
      const list: any[] = Array.isArray(data) ? data : data?.list || [];
      let fresh = 0;
      for (const g of list) {
        if (!g?._id || seen.has(g._id)) continue;
        seen.add(g._id);
        all.push(g);
        fresh++;
      }
      if (list.length === 0 || fresh === 0) break;
      await new Promise((r) => setTimeout(r, 120));
    }
  } catch (e: any) {
    if (!e.isLoginWall) throw e;
    limited = true;
  }

  // 回退：zitie/page/glyphs（旧快照接口，匿名可用页数有限）
  if (all.length === 0) {
    for (let page = 1; page <= MAX_PAGES; page++) {
      let list: any[];
      try {
        const data = await ygsfGet('/zitie/page/glyphs', { zid, page }, token);
        list = Array.isArray(data) ? data : data?.list || [];
      } catch (e: any) {
        if (e.isLoginWall) {
          limited = true;
          break;
        }
        throw e;
      }
      let fresh = 0;
      for (const g of list) {
        if (!g?._id || seen.has(g._id)) continue;
        seen.add(g._id);
        all.push(g);
        fresh++;
      }
      if (list.length === 0 || fresh === 0) break;
    }
  }
  return { glyphs: all, limited };
}

/** 与 jizi.ts 的清洗规则保持一致：去括号后缀、下划线数字、尾部数字 */
function cleanFrontText(raw: string): string {
  if (!raw) return '';
  let s = raw.trim();
  s = s.replace(/\s*[(\[【（][^)\]】]*[)\]】]?$/u, '');
  s = s.replace(/[_\-]\d+$/u, '');
  s = s.replace(/(\p{Script=Han})\d{1,3}$/u, '$1');
  s = s.replace(/\s+/g, '');
  return s;
}

/** 汉字 → 远程图片 URL 列表（同字多变体按顺序分配） */
function buildVariantMap(glyphs: YgsfGlyph[]): Map<string, string[]> {
  const map = new Map<string, string[]>();
  const seenUrl = new Set<string>();
  for (const g of glyphs) {
    const hanzi = (g._hanzi || '').trim();
    const url = (g._color_image || '').trim();
    if (!hanzi || !url || seenUrl.has(g._id)) continue;
    seenUrl.add(g._id);
    const arr = map.get(hanzi) || [];
    arr.push(url);
    map.set(hanzi, arr);
  }
  return map;
}

/** 从远程或本地图片地址中解析 glyph id（YGSF 为 32 位 hex，贪婪匹配 .png 前的完整 id） */
function glyphIdFromUrl(url: string): string | null {
  const m = url && url.match(/([0-9a-f]{16,})\.png/);
  return m ? m[1] : null;
}

function localUrlFor(glyphId: string): string {
  return `${LOCAL_URL_PREFIX}${glyphId}.png`;
}

async function downloadTo(url: string, filePath: string): Promise<number> {
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(filePath, buf);
  return buf.length;
}

function resolveDeck(db: any, deckName: string) {
  return db.query('SELECT id, name, card_count FROM decks WHERE name ILIKE $1', [deckName]);
}

function parseArgs() {
  const args = process.argv.slice(2);
  const get = (flag: string) => {
    const i = args.indexOf(flag);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const has = (flag: string) => args.includes(flag);
  const limitRaw = get('--limit');
  return {
    info: has('--info'),
    dryRun: has('--dry-run'),
    apply: has('--apply'),
    mirror: has('--mirror'),
    toLocal: has('--to-local'),
    toRemote: has('--to-remote'),
    restorePath: get('--restore'),
    deckName: get('--deck'),
    zid: get('--zid'),
    limit: limitRaw ? Math.max(1, parseInt(limitRaw, 10) || 0) : 0,
    token: loadToken(get('--token')),
  };
}

async function main() {
  const { info, dryRun, apply, mirror, toLocal, toRemote, restorePath, deckName, zid, limit, token } =
    parseArgs();

  // ===== 回滚模式 =====
  if (restorePath) {
    await waitForDb();
    const db = getDb();
    const backup = JSON.parse(fs.readFileSync(restorePath, 'utf-8'));
    let restored = 0;
    for (const c of backup.cards) {
      const r = await db.query('UPDATE cards SET image_url = $2 WHERE id = $1', [
        c.id,
        c.image_url,
      ]);
      restored += r.rowCount || 0;
    }
    console.log(`已回滚 ${restored}/${backup.cards.length} 张卡片（deck: ${backup.deckName}）`);
    process.exit(0);
  }

  // ===== info 模式：只看远端字帖概况，不需要数据库 =====
  if (info) {
    if (!zid) throw new Error('--info 需要 --zid');
    const { glyphs, limited } = await fetchAllGlyphs(zid, token);
    const withImg = glyphs.filter((g) => g._color_image);
    const hanziSet = new Set(glyphs.map((g) => (g._hanzi || '').trim()));
    console.log(
      `字帖 ${zid}：共 ${glyphs.length} 个单字（含图片 ${withImg.length}），去重汉字 ${hanziSet.size} 个${limited ? ' ⚠️ 匿名受限，未拉全（需要 --token）' : ''}`,
    );
    console.log(`样例:`, glyphs.slice(0, 5).map((g) => `${g._hanzi}(${g._author || '?'}·${g._font || '?'})`).join(' '));
    console.log(`首条直链: ${withImg[0]?._color_image}`);
    process.exit(0);
  }

  // ===== 以下模式都需要数据库 =====
  await waitForDb();
  const db = getDb();
  const modeCount = [apply, mirror, toLocal, toRemote].filter(Boolean).length;
  if (modeCount > 1) throw new Error('--apply / --mirror / --to-local / --to-remote 只能选一个');
  if (!deckName) throw new Error('需要 --deck "牌组名"');
  if (apply && !zid) throw new Error('--apply 需要 --zid');

  const deckRes = await resolveDeck(db, deckName);
  if (deckRes.rows.length === 0) throw new Error(`未找到牌组: ${deckName}`);
  if (deckRes.rows.length > 1) {
    console.log('匹配到多个牌组，请用更精确的名称:');
    for (const d of deckRes.rows) console.log(`  ${d.id}  ${d.name}`);
    process.exit(1);
  }
  const deck = deckRes.rows[0];
  const cardsRes = await db.query(
    'SELECT id, front_text, image_url FROM cards WHERE deck_id = $1 ORDER BY sort_order NULLS LAST, id',
    [deck.id],
  );
  const cards = cardsRes.rows;

  // ===== apply：同步直链 + 登记映射表 =====
  if (apply) {
    console.log(`牌组「${deck.name}」（${deck.id}）共 ${cards.length} 张卡片`);

    process.stdout.write('拉取 YGSF 单字清单');
    const { glyphs, limited } = await fetchAllGlyphs(zid, token);
    console.log(`：${glyphs.length} 个单字${limited ? ' ⚠️ 匿名在第 4 页左右被登录墙截断，仅部分覆盖（需要 --token 才能拉全）' : ''}`);
    const variantMap = buildVariantMap(glyphs);
    console.log(`可匹配汉字 ${variantMap.size} 个（同字多变体共 ${glyphs.filter((g) => g._color_image).length} 条图片）`);

    // 逐卡匹配：同字多变体按出现顺序轮转分配
    const cursor = new Map<string, number>();
    const plan: { id: string; front_text: string; from: string; to: string }[] = [];
    const unmatched: string[] = [];
    for (const c of cards) {
      const hanzi = cleanFrontText(c.front_text);
      const variants = variantMap.get(hanzi);
      if (!variants || variants.length === 0) {
        unmatched.push(c.front_text);
        continue;
      }
      const idx = cursor.get(hanzi) || 0;
      cursor.set(hanzi, (idx + 1) % variants.length);
      const to = variants[idx];
      if (to && to !== c.image_url) plan.push({ id: c.id, front_text: c.front_text, from: c.image_url, to });
    }

    console.log(`\n匹配结果：待更新 ${plan.length} 张，无需变更 ${cards.length - unmatched.length - plan.length} 张，未匹配 ${unmatched.length} 张`);
    if (unmatched.length > 0) {
      console.log(`未匹配样例（最多 20）: ${unmatched.slice(0, 20).join(' ')}`);
    }
    if (plan.length > 0) {
      console.log(`更新样例: ${plan[0].front_text} → ${plan[0].to.slice(0, 90)}...`);
    }

    if (dryRun) {
      console.log('\n[dry-run] 未做任何修改。确认无误后加 --apply 执行。');
      process.exit(0);
    }

    // 先备份，再更新
    const ts = new Date().toISOString().replace(/[-:T.]/g, '').slice(0, 14);
    const backup = {
      deckId: deck.id,
      deckName: deck.name,
      zid,
      createdAt: new Date().toISOString(),
      cards: cards.map((c) => ({ id: c.id, front_text: c.front_text, image_url: c.image_url })),
    };
    const backupPath = path.join('backups', `ygsf-image-urls-${String(deck.name).replace(/\s+/g, '_')}-${ts}.json`);
    fs.mkdirSync(path.dirname(backupPath), { recursive: true });
    fs.writeFileSync(backupPath, JSON.stringify(backup, null, 1), 'utf-8');
    console.log(`\n已备份原 image_url 到 ${backupPath}`);

    let updated = 0;
    for (const p of plan) {
      const r = await db.query('UPDATE cards SET image_url = $2 WHERE id = $1', [p.id, p.to]);
      updated += r.rowCount || 0;
    }
    console.log(`已更新 ${updated}/${plan.length} 张卡片为远程直链。`);

    // 登记映射表（保留已有 local_path/cached_at）
    let mapped = 0;
    for (const g of glyphs) {
      if (!g._id || !g._color_image) continue;
      await db.query(
        `INSERT INTO ygsf_images (glyph_id, zitie_id, hanzi, remote_url)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (glyph_id) DO UPDATE SET zitie_id = EXCLUDED.zitie_id, hanzi = EXCLUDED.hanzi, remote_url = EXCLUDED.remote_url`,
        [g._id, zid, (g._hanzi || '').trim(), g._color_image],
      );
      mapped++;
    }
    console.log(`映射表已登记 ${mapped} 条。`);
    console.log(`如需回滚: npx tsx server/scripts/ygsf-sync.ts --restore ${backupPath}`);
    process.exit(0);
  }

  // ===== mirror：把远程图下载到本地 uploads（断点续传）=====
  if (mirror) {
    const remoteCards = cards.filter((c: any) => c.image_url?.startsWith(REMOTE_URL_PREFIX));
    console.log(`牌组「${deck.name}」远程直链卡片 ${remoteCards.length} 张${limit ? `，本次最多镜像 ${limit} 张` : ''}`);
    const uploadsDir = path.resolve(process.cwd(), 'uploads');
    let done = 0;
    let skipped = 0;
    for (const c of remoteCards) {
      if (limit && done >= limit) break;
      const glyphId = glyphIdFromUrl(c.image_url);
      if (!glyphId) continue;
      const localRel = localUrlFor(glyphId);
      const localAbs = path.join(uploadsDir, path.basename(localRel));
      const existing = await db.query('SELECT local_path FROM ygsf_images WHERE glyph_id = $1', [glyphId]);
      if (existing.rows[0]?.local_path && fs.existsSync(localAbs)) {
        skipped++;
        continue;
      }
      try {
        const size = await downloadTo(c.image_url, localAbs);
        await db.query(
          `INSERT INTO ygsf_images (glyph_id, zitie_id, remote_url, local_path, cached_at)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (glyph_id) DO UPDATE SET remote_url = EXCLUDED.remote_url, local_path = EXCLUDED.local_path, cached_at = EXCLUDED.cached_at`,
          [glyphId, zid || '', c.image_url, localRel, new Date().toISOString()],
        );
        done++;
        process.stdout.write(`\r已镜像 ${done} 张（跳过已存在 ${skipped}）`);
        await new Promise((r) => setTimeout(r, MIRROR_DELAY_MS));
      } catch (e: any) {
        console.error(`\n下载失败 ${glyphId}: ${e.message}`);
      }
    }
    console.log(`\n镜像完成：本次 ${done} 张，已缓存跳过 ${skipped} 张。`);
    process.exit(0);
  }

  // ===== to-local：已镜像的字切成本地路径 =====
  if (toLocal) {
    const flip = await db.query(
      `UPDATE cards c SET image_url = y.local_path
       FROM ygsf_images y
       WHERE c.deck_id = $1
         AND c.image_url LIKE $2
         AND y.local_path IS NOT NULL
         AND c.image_url LIKE '%' || y.glyph_id || '.png%'`,
      [deck.id, `${REMOTE_URL_PREFIX}%`],
    );
    const remain = await db.query(
      `SELECT COUNT(*)::int AS n FROM cards WHERE deck_id = $1 AND image_url LIKE $2`,
      [deck.id, `${REMOTE_URL_PREFIX}%`],
    );
    console.log(`已切换 ${flip.rowCount} 张卡片到本地缓存；未镜像的远程卡 ${remain.rows[0].n} 张保持直链。`);
    console.log(`切回远程: npx tsx server/scripts/ygsf-sync.ts --to-remote --deck "${deck.name}"`);
    process.exit(0);
  }

  // ===== to-remote：切回远程直链 =====
  if (toRemote) {
    const flip = await db.query(
      `UPDATE cards c SET image_url = y.remote_url
       FROM ygsf_images y
       WHERE c.deck_id = $1
         AND c.image_url LIKE $2
         AND c.image_url LIKE '%' || y.glyph_id || '.png%'`,
      [deck.id, `${LOCAL_URL_PREFIX}%`],
    );
    console.log(`已切回 ${flip.rowCount} 张卡片到远程直链。`);
    process.exit(0);
  }

  console.log('未指定操作。用 --info / --dry-run / --apply / --mirror / --to-local / --to-remote / --restore。');
  process.exit(0);
}

main().catch((e) => {
  console.error('失败:', e.message);
  process.exit(1);
});
