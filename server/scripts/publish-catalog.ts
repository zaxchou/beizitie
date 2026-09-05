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

  // 输出目录整体重建：清掉上一轮已下架帖的残留 JSON，避免发版带出过期文件
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(path.join(out, 'zitie'), { recursive: true });

  const { rows: decks } = await db.query(
    `SELECT d.id, d.name, d.card_count, d.source_key, md.calligrapher, md.dynasty, md.style,
            md.description, md.featured, md.cover_thumb, md.cover_image
     FROM decks d
     JOIN marketplace_decks md ON md.deck_id = d.id AND md.published_at IS NOT NULL
     WHERE d.card_count >= $1
       -- 上架口径（宁缺勿错）：YGSF 帖必须已通过 jizi 字图校验（jizi_verified），未校验不进目录
       AND (d.source_key IS NULL OR d.source_key NOT LIKE 'ygsf:%' OR d.source_key IN (SELECT 'ygsf:' || zitie_id FROM jizi_verified))
     ORDER BY d.name`,
    [MIN_CARDS],
  );

  console.log(`已上架且 ≥${MIN_CARDS} 卡的牌组 ${decks.length} 个，开始抽取直链清单…`);
  const zitieIndex: any[] = [];
  const zitieFiles = new Map<string, number>();
  let skipped = 0;

  for (const d of decks) {
    // shlib（上图馆方来源）：IIIF 绝对直链，base/thumb 为空；ygsf：CDN 相对路径 + 统一缩放参数
    const isShlib = (d.source_key || '').startsWith('shlib:');
    const urlFilter = isShlib ? 'https://iiif.library.sh.cn/%' : 'https://ygsf.cdn.bcebos.com/autogen/areas/%';
    const { rows: cards } = await db.query(
      `SELECT front_text, image_url${isShlib ? ', context' : ''} FROM cards
       WHERE deck_id = $1 AND archived_at IS NULL AND image_url LIKE $2
       ORDER BY sort_order NULLS LAST, created_at`,
      [d.id, urlFilter],
    );
    if (cards.length < MIN_CARDS) {
      skipped++;
      continue;
    }
    // 本 deck 的 zitie（以出现最多的 zitieId 为准）
    const zCount = new Map<string, number>();
    const glyphs: CatalogGlyph[] = [];
    const seen = new Set<string>();
    let shlibPages: string[] | undefined;
    let shlibSents: string[] | undefined;
    if (isShlib) {
      // 原拓上下文压缩存储：整页图/所在句各自去重成数组，单字只存下标
      const pages: string[] = []; const pageIdx = new Map<string, number>();
      const sents: string[] = []; const sentIdx = new Map<string, number>();
      const idxOf = (arr: string[], map: Map<string, number>, v: string) => {
        let i = map.get(v);
        if (i === undefined) { i = arr.length; map.set(v, i); arr.push(v); }
        return i;
      };
      for (const c of cards) {
        if (seen.has(c.image_url)) continue;
        seen.add(c.image_url);
        const ctx = c.context as { p: string; x: number; y: number; w: number; h: number; s?: string } | null;
        glyphs.push({
          rel: c.image_url,
          h: (c.front_text || '').trim(),
          c: [idxOf(pages, pageIdx, ctx?.p || ''), ctx?.x || 0, ctx?.y || 0, ctx?.w || 0, ctx?.h || 0, idxOf(sents, sentIdx, ctx?.s || '')],
        });
      }
      shlibPages = pages;
      shlibSents = sents;
      zCount.set(d.source_key.split(':')[1], glyphs.length);
    } else {
      for (const c of cards) {
        const s = splitUrl(c.image_url);
        if (!s) continue;
        zCount.set(s.zitieId, (zCount.get(s.zitieId) || 0) + 1);
        const rel = s.rel.split('?')[0]; // 缩放参数统一存 thumb，逐字不重复存
        if (seen.has(rel)) continue;
        seen.add(rel);
        glyphs.push({ rel, h: (c.front_text || '').trim() });
      }
    }
    if (glyphs.length < MIN_CARDS || zCount.size === 0) {
      skipped++;
      continue;
    }
    const zitieId = [...zCount.entries()].sort((a, b) => b[1] - a[1])[0][0];
    const base = isShlib ? '' : `${CDN_BASE}${zitieId}/`;
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
      JSON.stringify({
        z: zitieId, base, thumb: isShlib ? '' : THUMB, desc: (d.description || '').slice(0, 160), g: glyphs,
        ...(isShlib ? { pages: shlibPages, sents: shlibSents } : {}),
      }),
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
      src: isShlib ? 'shlib' : 'ygsf',
      f: d.featured ? 1 : 0,
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
