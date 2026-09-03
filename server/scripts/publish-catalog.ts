/**
 * 单文件版目录生成器（P0.4）：从生产库导出静态目录 JSON，供单文件版/GitHub Pages 使用。
 *
 * 用法（在 /opt/zi2anki 运行）：
 *   npx tsx server/scripts/publish-catalog.ts [--out /opt/zi2anki/catalog-out]
 *
 * 产出：
 *   catalog-out/index.json            全量目录（<3MB）
 *   catalog-out/zitie/<zitieId>.json  每帖单字清单（订阅时按需拉取）
 *
 * 纳入条件（与 D8 一致）：已上架（published_at 非空）、字数 ≥10、有 ygsf 远程直链卡、
 * 书体非未知。其余（春江花月夜等纯本地帖）不进目录。
 * 之后把 catalog-out/ 拷回仓库 catalog/ 目录提交推送即可生效（GitHub Pages 自动发布）。
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { getDb, waitForDb } from '../db.js';

const CDN_BASE = 'https://ygsf.cdn.bcebos.com/autogen/areas/';
const THUMB = '?x-bce-process=style/jpg512';
const MIN_CARDS = 10;
const JUNK_NAME = /(图|画)(轴|页|卷|册)?$|像$|教学|手稿|临摹指导|讲座|课件|教程/;

interface CatalogGlyph {
  rel: string; // base 之后的相对路径（含查询参数）
  h: string;   // 汉字
}

function outDir(): string {
  const args = process.argv.slice(2);
  const i = args.indexOf('--out');
  return i >= 0 ? path.resolve(args[i + 1]) : '/opt/zi2anki/catalog-out';
}

/** 从远程直链解析 CDN base（…/areas/<zitieId>/）与相对路径 */
function splitUrl(url: string): { zitieId: string; rel: string } | null {
  if (!url.startsWith(CDN_BASE)) return null;
  const rest = url.slice(CDN_BASE.length); // <zitieId>/<n>/<file>.png?...
  const m = rest.match(/^([0-9a-f]{16,})\/(.+)$/);
  if (!m) return null;
  return { zitieId: m[1], rel: m[2] };
}

async function main() {
  await waitForDb();
  const db = getDb();
  const out = outDir();

  const { rows: decks } = await db.query(
    `SELECT d.id, d.name, d.card_count, md.calligrapher, md.dynasty, md.style,
            md.description, md.cover_thumb, md.cover_image
     FROM decks d
     JOIN marketplace_decks md ON md.deck_id = d.id AND md.published_at IS NOT NULL
     WHERE d.card_count >= $1
     ORDER BY d.name`,
    [MIN_CARDS],
  );

  console.log(`已上架且 ≥${MIN_CARDS} 卡的牌组 ${decks.length} 个，开始抽取直链清单…`);
  const zitieIndex: any[] = [];
  const zitieFiles = new Map<string, number>();
  let skipped = 0;

  for (const d of decks) {
    const { rows: cards } = await db.query(
      `SELECT front_text, image_url FROM cards
       WHERE deck_id = $1 AND archived_at IS NULL AND image_url LIKE 'https://ygsf.cdn.bcebos.com/autogen/areas/%'
       ORDER BY sort_order NULLS LAST, created_at`,
      [d.id],
    );
    if (cards.length < MIN_CARDS) {
      skipped++;
      continue;
    }
    // 本 deck 的 zitie（以出现最多的 zitieId 为准）
    const zCount = new Map<string, number>();
    const glyphs: CatalogGlyph[] = [];
    const seen = new Set<string>();
    for (const c of cards) {
      const s = splitUrl(c.image_url);
      if (!s) continue;
      zCount.set(s.zitieId, (zCount.get(s.zitieId) || 0) + 1);
      const rel = s.rel.split('?')[0]; // 缩放参数统一存 thumb，逐字不重复存
      if (seen.has(rel)) continue;
      seen.add(rel);
      glyphs.push({ rel, h: (c.front_text || '').trim() });
    }
    if (glyphs.length < MIN_CARDS || zCount.size === 0) {
      skipped++;
      continue;
    }
    const zitieId = [...zCount.entries()].sort((a, b) => b[1] - a[1])[0][0];
    const base = `${CDN_BASE}${zitieId}/`;
    const styles = (d.style || '')
      .split(',')
      .map((s: string) => s.trim())
      .filter(Boolean);
    if (styles.length === 0) {
      skipped++;
      continue; // 未知书体不进目录（D8）
    }
    if (JUNK_NAME.test(d.name)) {
      skipped++;
      continue; // 画题/杂帖不进目录（D8）
    }

    fs.mkdirSync(path.join(out, 'zitie'), { recursive: true });
    fs.writeFileSync(
      path.join(out, 'zitie', `${zitieId}.json`),
      JSON.stringify({ z: zitieId, base, thumb: THUMB, desc: (d.description || '').slice(0, 160), g: glyphs }),
    );
    zitieFiles.set(zitieId, glyphs.length);
    zitieIndex.push({
      id: d.id,
      z: zitieId,
      n: d.name,
      a: d.calligrapher || '',
      d: d.dynasty || '',
      s: styles,
      c: d.cover_thumb || d.cover_image || '',
      g: glyphs.length,
    });
  }

  // 排序：书体 → 书家 → 名（稳定的浏览顺序）
  zitieIndex.sort((a, b) =>
    (a.s[0] || '').localeCompare(b.s[0] || '') ||
    (a.a || '').localeCompare(b.a || '', 'zh-CN') ||
    a.n.localeCompare(b.n, 'zh-CN'),
  );

  const index = {
    v: 1,
    updatedAt: new Date().toISOString(),
    total: zitieIndex.length,
    zuopins: zitieIndex,
  };
  fs.writeFileSync(path.join(out, 'index.json'), JSON.stringify(index));
  const sizeMB = (fs.statSync(path.join(out, 'index.json')).size / 1024 / 1024).toFixed(2);
  console.log(`\n完成：目录 ${zitieIndex.length} 帖（跳过 ${skipped}），index.json ${sizeMB}MB，单字文件 ${zitieFiles.size} 个`);
  console.log(`输出目录: ${out}`);
  console.log('下一步: 把 catalog-out/ 内容拷贝到仓库 catalog/ 目录，提交推送即可发布。');
  process.exit(0);
}

main().catch((e) => {
  console.error('失败:', e.message);
  process.exit(1);
});
