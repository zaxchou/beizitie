/**
 * 小红书 mini 包 · 数据管线
 * 从 catalog 选帖 → 去重独字卡 → 下载 512px 拓片 → 网格搜索 WebP 编码参数（体积预算内取最高画质）
 * → 产出 mini/data/*.json（构建时内联）与 mini/public/img/*.webp（vite publicDir 原样拷贝）
 *
 * 用法: node mini/build-data.mjs
 * 断点续跑：原始 512 图缓存在 mini/.cache/<z>/，重跑只补缺失。
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import sharp from 'sharp';

/** 缓存键 = 内容 URL 哈希：catalog 数据更新导致字符顺序变化时不会字图错位 */
const cacheKey = (url) => crypto.createHash('sha1').update(url).digest('hex').slice(0, 16);

const ROOT = path.resolve(import.meta.dirname, '..');
const DATA_DIR = path.join(ROOT, 'mini', 'data');
const PUB_IMG = path.join(ROOT, 'mini', 'public', 'img');
const CACHE = path.join(ROOT, 'mini', '.cache');
const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'mini', 'config.json'), 'utf-8'));

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0 Safari/537.36';
const IMG_BUDGET = cfg.imageBudgetMB * 1024 * 1024;

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

/** 从压缩目录格式解出一张字的 512px URL */
function glyph512Url(zitie, g) {
  return `${zitie.iiif}${zitie.pages[g.c[0]]}/${g.c[1]},${g.c[2]},${g.c[3]},${g.c[3]}/512,512/0/default.jpg`;
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

  // ---- 去重独字卡（跳过残字 □，按首次出现排序）----
  for (const deck of decks) {
    const seen = new Map();
    for (const g of deck.data.g) {
      const h = (g.h || '').trim();
      if (!h || h === '□') continue;
      if (!seen.has(h)) seen.set(h, g);
    }
    deck.cards = [...seen.entries()].map(([h, g]) => {
      const url = `${deck.data.iiif}${deck.data.pages[g.c[0]]}/${g.c[1]},${g.c[2]},${g.c[3]},${g.c[3]}/512,512/0/default.jpg`;
      return { h, g, url, key: cacheKey(url) };
    });
    console.log(`${deck.n}: ${deck.data.g.length} 字 → 去重 ${deck.cards.length} 独字`);
  }
  const totalCards = decks.reduce((s, d) => s + d.cards.length, 0);

  // ---- 下载 512 原图（带缓存）----
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
      if (done % 25 === 0) console.log(`  [${deck.n}] ${done}/${deck.cards.length}`);
    }
    console.log(`${deck.n}: 原图就绪 ${done} 张`);
  }

  // ---- 网格搜索：每帖采样 16 字，预算内取（尺寸×质量）最高画质 ----
  const sample = (deck) => {
    const step = Math.max(1, Math.floor(deck.cards.length / 16));
    return deck.cards.filter((_, i) => i % step === 0).slice(0, 16);
  };
  async function encodeSize(card, size, q) {
    const raw = fs.readFileSync(path.join(CACHE, deckOf(card).z, `${card.key}.jpg`));
    const buf = await sharp(raw).resize(size, size, { fit: 'cover' }).webp({ quality: q, effort: 5, smartSubsample: true }).toBuffer();
    return buf.length;
  }
  // 卡片 → 所属帖（编码时需要），用 Map 记录
  const cardDeck = new Map();
  for (const d of decks) for (const c of d.cards) cardDeck.set(c, d);
  const deckOf = (c) => cardDeck.get(c);
  const indexOf = (c) => deckOf(c).cards.indexOf(c);

  const combos = [];
  for (const size of cfg.sizes) for (const q of cfg.qualities) combos.push({ size, q });
  combos.reverse(); // 大尺寸高质量优先，取第一个放进预算的组合
  let chosen = null;
  for (const combo of combos) {
    let est = 0;
    for (const deck of decks) {
      const s = sample(deck);
      let sum = 0;
      for (const c of s) sum += await encodeSize(c, combo.size, combo.q);
      est += (sum / s.length) * deck.cards.length;
    }
    console.log(`  参数 ${combo.size}px q${combo.q}: 预估 ${(est / 1048576).toFixed(2)}MB`);
    if (est <= IMG_BUDGET) { chosen = { ...combo, est }; break; }
  }
  if (!chosen) throw new Error('最低档仍超预算，请减少帖数或降低 sizes/qualities');
  console.log(`✅ 选定参数: ${chosen.size}px q${chosen.q}（预估 ${(chosen.est / 1048576).toFixed(2)}MB / 预算 ${IMG_BUDGET / 1048576}MB）`);

  // ---- 全量编码 ----
  let total = 0;
  for (const deck of decks) {
    const outDir = path.join(PUB_IMG, deck.z);
    fs.mkdirSync(outDir, { recursive: true });
    let sum = 0;
    for (let i = 0; i < deck.cards.length; i++) {
      const card = deck.cards[i];
      const out = path.join(outDir, `${i}.webp`);
      const raw = fs.readFileSync(path.join(CACHE, deck.z, `${card.key}.jpg`));
      const buf = await sharp(raw).resize(chosen.size, chosen.size, { fit: 'cover' })
        .webp({ quality: chosen.q, effort: 5, smartSubsample: true }).toBuffer();
      fs.writeFileSync(out, buf);
      sum += buf.length;
    }
    total += sum;
    console.log(`${deck.n}: 编码完成 ${(sum / 1048576).toFixed(2)}MB`);
  }
  console.log(`字图合计 ${(total / 1048576).toFixed(2)}MB / ${totalCards} 张`);

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

  // ---- 清单产出 ----
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
        g: deck.cards.map((c, i) => ({ h: c.h, rel: `img/${deck.z}/${i}.webp` })),
      }),
    );
    zuopins.push({
      id: deck.meta.id || deck.z, z: deck.z, n: deck.n, a: deck.a, d: deck.d,
      s: deck.meta.s || ['楷'], c: deck.coverPath || '', g: deck.cards.length,
      src: 'shlib', f: 1,
    });
  }
  fs.writeFileSync(path.join(DATA_DIR, 'catalog.json'), JSON.stringify({
    v: 1, updatedAt: new Date().toISOString(), total: zuopins.length, zuopins,
  }));
  console.log('✅ mini/data 与 mini/public/img 就绪');
}

function globZitie(z) {
  const fs2 = fs;
  const f = fs2.readdirSync(path.join(ROOT, 'catalog', 'zitie')).find((x) => x.startsWith(z));
  if (!f) throw new Error(`catalog/zitie 里找不到 ${z}`);
  return path.join(ROOT, 'catalog', 'zitie', f);
}

main().catch((e) => { console.error('❌', e.message); process.exit(1); });
