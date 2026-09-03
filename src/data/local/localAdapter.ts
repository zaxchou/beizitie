/**
 * LocalAdapter —— 单文件版本地数据源（实现 LocalDataSource）
 * 目录：构建时内联 index.json；单字清单按需从分发源拉取（多源自动回退）。
 */
import { calculateNextReview, createInitialSM2State } from '@/lib/sm2';
import { tx } from './db';
import type {
  CatalogIndex,
  CatalogStyleCount,
  CatalogZuopin,
  LocalCard,
  LocalDeck,
  LocalProgress,
  ZitieGlyphList,
} from '../../core/types';
import type { LocalDataSource, StudyQueue } from '../adapter';
import {
  deleteCardsByDeck,
  getAllDecks,
  getAllStats,
  getCard,
  getCardsByDeck,
  getDeck,
  getProgress,
  getProgressByDeck,
  getStat,
  kvGet,
  kvSet,
  openDb,
  putCards,
  putDeck,
  putProgress,
  putStat,
  todayLocal,
} from './db';
import catalogRaw from '../../../catalog/index.json?raw';

// ---- 目录 ----
export const catalogIndex: CatalogIndex = JSON.parse(catalogRaw as unknown as string);

const ZITIE_BASES = [
  'catalog/',                                          // GitHub Pages 同源
  'https://zaxchou.github.io/beizitie/catalog/',       // Pages 绝对地址（file:// 打开时）
  'https://cdn.jsdelivr.net/gh/zaxchou/beizitie@main/catalog/', // jsDelivr 兜底
];
let resolvedBase: string | null = null;

export async function fetchZitie(zitieId: string): Promise<ZitieGlyphList> {
  const override = (await kvGet('zitieBase')) as string | undefined;
  const bases = [
    ...(override ? [override] : []),
    ...(resolvedBase ? [resolvedBase] : []),
    ...(location.protocol === 'http:' || location.protocol === 'https:'
      ? [new URL('catalog/', location.href).href]
      : []),
    ...ZITIE_BASES,
  ];
  const tried = new Set<string>();
  for (const base of bases) {
    if (tried.has(base)) continue;
    tried.add(base);
    try {
      const r = await fetch(`${base}zitie/${zitieId}.json`);
      if (!r.ok) continue;
      const data = (await r.json()) as ZitieGlyphList;
      resolvedBase = base;
      return data;
    } catch {
      /* 尝试下一个源 */
    }
  }
  throw new Error('单字清单拉取失败（所有分发源不可达）');
}

export function glyphUrl(z: Pick<ZitieGlyphList, 'base' | 'thumb'>, rel: string): string {
  return `${z.base}${rel}${z.thumb}`;
}

// ---- 目录查询（内存过滤，目录 2700+ 条内存过滤毫秒级）----
export function searchCatalog(opts: {
  style?: string;
  keyword?: string;
  calligrapher?: string;
  offset: number;
  limit: number;
}): { total: number; calligraphers: string[]; styleCounts: CatalogStyleCount[]; zuopins: CatalogZuopin[] } {
  const kw = (opts.keyword || '').trim().toLowerCase();
  const filtered = catalogIndex.zuopins.filter((z) => {
    if (opts.style && opts.style !== '全部' && !z.s.includes(opts.style)) return false;
    if (opts.calligrapher && opts.calligrapher !== '全部' && z.a !== opts.calligrapher) return false;
    if (kw) {
      const hit = z.n.toLowerCase().includes(kw) || z.a.toLowerCase().includes(kw) || z.d.toLowerCase().includes(kw);
      if (!hit) return false;
    }
    return true;
  });
  // 全量 facets（不受筛选影响，与服务端行为一致）
  const calligraphers = [...new Set(catalogIndex.zuopins.map((z) => z.a).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b, 'zh-CN'),
  );
  const sc = new Map<string, number>();
  for (const z of catalogIndex.zuopins) for (const s of z.s) sc.set(s, (sc.get(s) || 0) + 1);
  const styleCounts: CatalogStyleCount[] = [...sc.entries()]
    .map(([style, n]) => ({ style, n }))
    .sort((a, b) => b.n - a.n);
  return {
    total: filtered.length,
    calligraphers,
    styleCounts,
    zuopins: filtered.slice(opts.offset, opts.offset + opts.limit),
  };
}

export async function isZitieSubscribed(zitieId: string): Promise<boolean> {
  const decks = await getAllDecks();
  return decks.some((d) => d.zitieId === zitieId);
}

// ---- LocalDataSource 实现 ----
export const localDataSource: LocalDataSource = {
  catalog: {
    index: () => catalogIndex,
    styleCounts: () => {
      const sc = new Map<string, number>();
      for (const z of catalogIndex.zuopins) for (const s of z.s) sc.set(s, (sc.get(s) || 0) + 1);
      return [...sc.entries()].map(([style, n]) => ({ style, n })).sort((a, b) => b.n - a.n);
    },
    zitie: fetchZitie,
    glyphUrl,
  },

  library: {
    async addFromZitie(z, meta) {
      // 防重：同一字帖只允许订阅一次
      const existing = await getAllDecks();
      const dup = existing.find((d) => d.zitieId === z.z);
      if (dup) throw new Error('该帖已在书库中');
      const deck: LocalDeck = {
        id: crypto.randomUUID(),
        zitieId: z.z,
        name: meta.name,
        author: meta.author,
        dynasty: meta.dynasty,
        styles: meta.styles,
        cover: meta.cover,
        createdAt: new Date().toISOString(),
        settings: { dailyNewLimit: 20, dailyReviewLimit: 200, paused: false },
      };
      const cards: LocalCard[] = z.g.map((g, i) => ({
        id: crypto.randomUUID(),
        deckId: deck.id,
        hanzi: g.h,
        imageUrl: glyphUrl(z, g.rel),
        sortOrder: i,
      }));
      await putDeck(deck);
      await putCards(cards);
      return deck;
    },

    async list() {
      const decks = await getAllDecks();
      const now = new Date();
      const result = [];
      for (const d of decks.sort((a, b) => a.createdAt.localeCompare(b.createdAt))) {
        const [cards, progress] = await Promise.all([getCardsByDeck(d.id), getProgressByDeck(d.id)]);
        const pMap = new Map(progress.map((p) => [p.cardId, p]));
        const newRemaining = cards.filter((c) => !pMap.get(c.id)).length;
        const dueCount = cards.filter((c) => {
          const p = pMap.get(c.id);
          return p && new Date(p.dueAt) <= now;
        }).length;
        let newCount = newRemaining;
        let reviewCount = dueCount;
        if (d.settings.paused) {
          newCount = 0;
          reviewCount = 0;
        } else {
          newCount = Math.min(newCount, d.settings.dailyNewLimit);
          reviewCount = Math.min(reviewCount, d.settings.dailyReviewLimit);
        }
        result.push({
          ...d,
          newCount,
          reviewCount,
          totalCards: cards.length,
          learnedCount: progress.length,
          newRemaining,
          dueRemaining: dueCount,
        });
      }
      return result;
    },

    async cards(deckId) {
      return getCardsByDeck(deckId);
    },

    async remove(deckId) {
      await deleteCardsByDeck(deckId);
      const db = await openDb();
      db.transaction('decks', 'readwrite').objectStore('decks').delete(deckId);
    },

    async updateSettings(deckId, patch) {
      const d = await getDeck(deckId);
      if (!d) return;
      await putDeck({ ...d, settings: { ...d.settings, ...patch } });
    },
  },

  study: {
    async queue(deckId): Promise<StudyQueue> {
      const [deck, cards, progress] = await Promise.all([
        getDeck(deckId),
        getCardsByDeck(deckId),
        getProgressByDeck(deckId),
      ]);
      const settings = deck?.settings || { dailyNewLimit: 20, dailyReviewLimit: 200, paused: false };
      const pMap = new Map(progress.map((p) => [p.cardId, p]));
      const now = new Date();
      const reviews = cards
        .filter((c) => {
          const p = pMap.get(c.id);
          return p && new Date(p.dueAt) <= now;
        })
        .slice(0, settings.dailyReviewLimit);
      const fresh = cards.filter((c) => !pMap.get(c.id)).slice(0, settings.dailyNewLimit);
      const toShuffle = settings.paused ? [] : [...reviews, ...fresh];
      // 轻微洗牌（新卡穿插）：稳定排序让新卡靠后
      toShuffle.sort(() => Math.random() - 0.5);
      return {
        items: toShuffle.map((c) => ({ card: c, progress: pMap.get(c.id) || null })),
        newCount: fresh.length,
        reviewCount: reviews.length,
      };
    },

    async rate(cardId, rating) {
      const card = await getCard(cardId);
      if (!card) return;
      const existing = await getProgress(cardId);
      const cur = existing
        ? { ease: existing.ease, interval: existing.interval, repetitions: existing.repetitions }
        : createInitialSM2State();
      const next = calculateNextReview(rating, cur);
      const nowIso = new Date().toISOString();
      const p: LocalProgress = {
        cardId,
        deckId: card.deckId,
        ease: next.ease,
        interval: next.interval,
        repetitions: next.repetitions,
        dueAt: next.next_review,
        lastReviewed: nowIso,
      };
      await putProgress(p);
      const date = todayLocal();
      const stat = (await getStat(date)) || { date, studied: 0, newLearned: 0 };
      stat.studied += 1;
      if (!existing) stat.newLearned += 1;
      await putStat(stat);
    },
  },

  stats: {
    async today() {
      const date = todayLocal();
      return (await getStat(date)) || { date, studied: 0, newLearned: 0 };
    },
    async range(days) {
      const all = await getAllStats();
      return all
        .sort((a, b) => b.date.localeCompare(a.date))
        .slice(0, days);
    },
  },

  settings: {
    async get(key, fallback) {
      const v = await kvGet(key);
      return v === undefined || v === null ? fallback : (v as never);
    },
    async set(key, value) {
      await kvSet(key, value);
    },
  },

  backup: {
    /** 导出格式与服务器版兼容：decks/cards/progress 结构对齐服务器表（见双版本计划 D5） */
    async exportAll() {
      const decks = await getAllDecks();
      const allCards: LocalCard[] = [];
      const allProgress: LocalProgress[] = [];
      for (const d of decks) {
        allCards.push(...(await getCardsByDeck(d.id)));
        allProgress.push(...(await getProgressByDeck(d.id)));
      }
      const payload = {
        format: 'beizitie-backup',
        version: 1,
        exportedAt: new Date().toISOString(),
        settings: {
          dailyNewLimit: (await kvGet('dailyNewLimit')) ?? 20,
          dailyReviewLimit: (await kvGet('dailyReviewLimit')) ?? 200,
          darkMode: (await kvGet('darkMode')) ?? 'system',
        },
        decks: decks.map((d) => ({
          id: d.id,
          name: d.name,
          zitieId: d.zitieId,
          calligrapher: d.author,
          dynasty: d.dynasty,
          style: d.styles.join(','),
          created_at: d.createdAt,
          settings: d.settings,
          card_count: allCards.filter((c) => c.deckId === d.id).length,
        })),
        cards: allCards.map((c) => ({
          id: c.id,
          deck_id: c.deckId,
          front_text: c.hanzi,
          image_url: c.imageUrl,
          sort_order: c.sortOrder,
        })),
        progress: allProgress.map((p) => ({
          card_id: p.cardId,
          deck_id: p.deckId,
          ease: p.ease,
          interval: p.interval,
          repetitions: p.repetitions,
          next_review: p.dueAt,
          last_review: p.lastReviewed,
        })),
        stats: await getAllStats(),
      };
      return new Blob([JSON.stringify(payload, null, 1)], { type: 'application/json' });
    },

    async importAll(json, mode) {
      const data = JSON.parse(json);
      if (data.format !== 'beizitie-backup' && data.format !== 'beizitie-export') {
        throw new Error('不是背字帖的备份文件');
      }
      const report = { decks: 0, cards: 0, progress: 0 };
      if (mode === 'replace') {
        for (const d of await getAllDecks()) await deleteCardsByDeck(d.id);
        await tx(['decks', 'stats'], 'readwrite', (t) => {
          t.objectStore('decks').clear();
          t.objectStore('stats').clear();
        });
      }
      for (const d of data.decks || []) {
        await putDeck({
          id: d.id,
          zitieId: d.zitieId || '',
          name: d.name,
          author: d.calligrapher || '',
          dynasty: d.dynasty || '',
          styles: (d.style || '').split(',').filter(Boolean),
          cover: '',
          createdAt: d.created_at || new Date().toISOString(),
          settings: d.settings || { dailyNewLimit: 20, dailyReviewLimit: 200, paused: false },
        });
        report.decks++;
      }
      const cards: LocalCard[] = (data.cards || []).map((c: any) => ({
        id: c.id,
        deckId: c.deck_id,
        hanzi: c.front_text,
        imageUrl: c.image_url,
        sortOrder: c.sort_order ?? 0,
      }));
      await putCards(cards);
      report.cards = cards.length;
      for (const p of data.progress || []) {
        await putProgress({
          cardId: p.card_id,
          deckId: p.deck_id,
          ease: p.ease,
          interval: p.interval,
          repetitions: p.repetitions,
          dueAt: p.next_review,
          lastReviewed: p.last_review ?? null,
        });
        report.progress++;
      }
      for (const s of data.stats || []) await putStat(s);
      return report;
    },
  },
};

