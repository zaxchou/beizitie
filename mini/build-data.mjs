/**
 * 小红书 mini 包 · 数据管线
 * catalog 选帖 → 去重独字卡 → 下载 512px 拓片 → 网格搜索 WebP 参数 → 按 4×4 拼图集
 *
 * 为什么是图集：平台限制 zip ≤10MiB 且文件数 ≤200，1369 张单字文件超限；
 * 拼成 1536² 图集（16 字/张）→ 86 个文件。前端经 CSS background-position / canvas 源矩形切图。
 *
 * 用法: node mini/build-data.mjs
 * 断点续跑：512 原图缓存 mini/.cache/<z>/<url哈希>.jpg，重跑只补缺失。
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import sharp from 'sharp';

const ROOT = path.resolve(import.meta.dirname, '..');
const DATA_DIR = path.join(ROOT, 'mini', 'data');
const PUB_IMG = path.join(ROOT, 'mini', 'public', 'img');
const CACHE = path.join(ROOT, 'mini', '.cache');
const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'mini', 'config.json'), 'utf-8'));

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0 Safari/537.36';
const IMG_BUDGET = cfg.imageBudgetMB * 1024 * 1024;
const GRID = 4; // 每图集 4×4 = 16 字；1536² 解码内存约 9MB，移动端安全

/** 缓存键 = 内容 URL 哈希：catalog 数据更新导致字符顺序变化时不会字图错位 */
const cacheKey = (url) => crypto.createHash('sha1').update(url).digest('hex').slice(0, 16);

async function fetchBin(url, tries = 4) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(30000) });
      if (r.ok) return Buffer.from(await r.arrayBuffer());
    } catch { /* retry */ }
    await new Promise((res) => setTimeout(res, 1500 * (i + 1)));
  }
  throw new Error(`下载失败: ${url}`);
}

async function main() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.mkdirSync(PUB_IMG, { recursive: true });
  const catalog = JSON.parse(fs.readFileSync(path.join(ROOT, 'catalog', 'index.json'), 'utf-8'));
  const indexById = new Map(catalog.zuopins.map((i) => [i.z, i]));

  const decks = cfg.decks.map((d) => {
    const zf = fs.existsSync(path.join(ROOT, 'catalog', 'zitie', `${d.z}.json`))
      ? path.join(ROOT, 'catalog', 'zitie', `${d.z}.json`)
      : globZitie(d.z);
    return { ...d, meta: indexById.get(d.z) || {}, data: JSON.parse(fs.readFileSync(zf, 'utf-8')) };
  });

  // ---- 去重独字卡（跳过残字 □，按首次出现排序），缓存键 = 图 URL 哈希 ----
  for (const deck of decks) {
    const seen = new Map();
    for (const g of deck.data.g) {
      const h = (g.h || '').trim();
      if (!h || h === '□') continue;
      if (!seen.has(h)) seen.set(h, g);
    }
    deck.cards = [...seen.entries()].map(([h, g]) => {
      // shlib：IIIF 坐标切图；ygsf：CDN 相对路径 + 512 缩放参数
      const url = deck.data.iiif
        ? `${deck.data.iiif}${deck.data.pages[g.c[0]]}/${g.c[1]},${g.c[2]},${g.c[3]},${g.c[3]}/512,512/0/default.jpg`
        : `${deck.data.base}${g.rel}${deck.data.thumb}`;
      return { h, g, url, key: cacheKey(url) };
    });
    console.log(`${deck.n}: ${deck.data.g.length} 字 → 去重 ${deck.cards.length} 独字`);
  }
  const totalCards = decks.reduce((s, d) => s + d.cards.length, 0);

  // ---- 下载 512 原图（哈希键缓存，续跑只补缺失）----
  for (const deck of decks) {
    const dir = path.join(CACHE, deck.z);
    fs.mkdirSync(dir, { recursive: true });
    let done = 0;
    for (const card of deck.cards) {
      const out = path.join(dir, `${card.key}.jpg`);
      done++;
      if (fs.existsSync(out) && fs.statSync(out).size > 500) continue;
      const buf = await fetchBin(card.url);
      fs.writeFileSync(out, buf);
      if (done % 50 === 0) console.log(`  [${deck.n}] ${done}/${deck.cards.length}`);
    }
    console.log(`${deck.n}: 原图就绪 ${done} 张`);
  }

  // ---- 网格搜索：每帖采样 16 字，预算内取（尺寸×质量）最高画质 ----
  const cardDeck = new Map();
  for (const d of decks) for (const c of d.cards) cardDeck.set(c, d);
  const deckOf = (c) => cardDeck.get(c);
  // 原图多为非正方形（如 332×512），cover 会把笔画裁掉：contain 完整放入，
  // 补边色取原图角部采样（纸色），图块拼进图集后看不出接缝
  async function squareTile(card, size, q) {
    const raw = fs.readFileSync(path.join(CACHE, deckOf(card).z, `${card.key}.jpg`));
    const meta = await sharp(raw).metadata();
    const s = Math.min(8, meta.width, meta.height);
    const { channels } = await sharp(raw).extract({ left: 0, top: 0, width: s, height: s }).stats();
    const [r, g, b] = channels.map((c) => Math.round(c.mean));
    return sharp(raw)
      .resize(size, size, { fit: 'contain', background: { r, g, b, alpha: 1 } })
      .webp({ quality: q, effort: 5, smartSubsample: true })
      .toBuffer();
  }
  async function encodeTile(card, size, q) {
    return (await squareTile(card, size, q)).length;
  }
  const sample = (deck) => {
    const step = Math.max(1, Math.floor(deck.cards.length / 16));
    return deck.cards.filter((_, i) => i % step === 0).slice(0, 16);
  };
  const combos = [];
  for (const size of cfg.sizes) for (const q of cfg.qualities) combos.push({ size, q });
  combos.reverse();
  let chosen = null;
  for (const combo of combos) {
    let est = 0;
    for (const deck of decks) {
      const s = sample(deck);
      let sum = 0;
      for (const c of s) sum += await encodeTile(c, combo.size, combo.q);
      est += (sum / s.length) * deck.cards.length;
    }
    console.log(`  参数 ${combo.size}px q${combo.q}: 预估 ${(est / 1048576).toFixed(2)}MB`);
    if (est <= IMG_BUDGET) { chosen = { ...combo, est }; break; }
  }
  if (!chosen) throw new Error('最低档仍超预算，请减少帖数或降低 sizes/qualities');
  console.log(`✅ 选定参数: ${chosen.size}px q${chosen.q}（预估 ${(chosen.est / 1048576).toFixed(2)}MB / 预算 ${IMG_BUDGET / 1048576}MB）`);

  // ---- 按 4×4 拼图集（每帖独立编号；缩放后单次编码，无二次损失）----
  fs.rmSync(PUB_IMG, { recursive: true, force: true });
  let total = 0;
  let atlasCount = 0;
  for (const deck of decks) {
    const outDir = path.join(PUB_IMG, 'atlas');
    fs.mkdirSync(outDir, { recursive: true });
    let deckBytes = 0;
    const groups = [];
    for (let i = 0; i < deck.cards.length; i += GRID * GRID) {
      groups.push(deck.cards.slice(i, i + GRID * GRID));
    }
    for (let k = 0; k < groups.length; k++) {
      const tiles = [];
      for (let j = 0; j < groups[k].length; j++) {
        const card = groups[k][j];
        const buf = await squareTile(card, chosen.size, chosen.q);
        card.rel = `img/atlas/${deck.z}-${String(k).padStart(2, '0')}.webp#${j % GRID},${Math.floor(j / GRID)}`;
        tiles.push({ input: buf, left: (j % GRID) * chosen.size, top: Math.floor(j / GRID) * chosen.size });
      }
      const side = chosen.size * GRID;
      const out = path.join(outDir, `${deck.z}-${String(k).padStart(2, '0')}.webp`);
      await sharp({ create: { width: side, height: side, channels: 3, background: '#1c1c1c' } })
        .composite(tiles)
        .webp({ quality: chosen.q, effort: 5 })
        .toFile(out);
      deckBytes += fs.statSync(out).size;
    }
    atlasCount += groups.length;
    total += deckBytes;
    console.log(`${deck.n}: ${groups.length} 个图集 ${(deckBytes / 1048576).toFixed(2)}MB`);
  }
  console.log(`字图合计 ${(total / 1048576).toFixed(2)}MB / ${totalCards} 张 / ${atlasCount} 个图集文件`);

  // ---- 封面 ----
  for (const deck of decks) {
    const coverUrl = deck.cover || deck.meta.c;
    if (!coverUrl || !coverUrl.startsWith('http')) continue;
    try {
      const raw = await fetchBin(coverUrl);
      const out = path.join(PUB_IMG, `cover-${deck.z}.webp`);
      await sharp(raw).resize(300, 300, { fit: 'cover' }).webp({ quality: 78 }).toFile(out);
      deck.coverPath = `img/cover-${deck.z}.webp`;
      console.log(`封面: ${deck.n} ${fs.statSync(out).size}B`);
    } catch (e) { console.log(`封面跳过: ${deck.n} ${e.message}`); }
  }

  // ---- 清单产出（rel 带 #列,行 图集定位）----
  for (const f of fs.readdirSync(DATA_DIR)) if (f.startsWith('zitie-') && f.endsWith('.json')) fs.rmSync(path.join(DATA_DIR, f));
  const zuopins = [];
  for (const deck of decks) {
    fs.writeFileSync(
      path.join(DATA_DIR, `zitie-${deck.z}.json`),
      JSON.stringify({
        z: deck.z,
        base: '',
        thumb: '',
        desc: `${deck.data.desc || ''}\n去重独字卡 ${deck.cards.length} 字 · 离线版`,
        g: deck.cards.map((c) => ({ h: c.h, rel: c.rel })),
      }),
    );
    zuopins.push({
      id: deck.meta.id || deck.z, z: deck.z, n: deck.n, a: deck.a, d: deck.d,
      s: deck.meta.s || ['楷'], c: deck.coverPath || '', g: deck.cards.length,
      src: deck.data.iiif ? 'shlib' : 'ygsf', f: 1,
    });
  }
  fs.writeFileSync(path.join(DATA_DIR, 'catalog.json'), JSON.stringify({
    v: 1, updatedAt: new Date().toISOString(), total: zuopins.length, zuopins,
  }));
  const fileCount = 1 + 1 + 1 + atlasCount + 2; // index.html + 字体 + OFL + 图集 + 封面
  console.log(`✅ 就绪。预计包内文件数 ≈ ${fileCount}（上限 200）`);
}

function globZitie(z) {
  const f = fs.readdirSync(path.join(ROOT, 'catalog', 'zitie')).find((x) => x.startsWith(z));
  if (!f) throw new Error(`catalog/zitie 里找不到 ${z}`);
  return path.join(ROOT, 'catalog', 'zitie', f);
}

main().catch((e) => { console.error('❌', e.message); process.exit(1); });
