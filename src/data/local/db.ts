/**
 * IndexedDB 访问层（单文件版 / 小红书 mini 通用）
 * 库：beizitie v2
 * stores: decks(id) / cards(id, idx deckId) / progress(cardId, idx deckId) / stats(date) / kv(key) / images(url)
 *
 * 存储降级（审核教训，HANDOFF 补记 23）：IDB 任何环节失败——open 同步抛错、被其他页面阻塞（onblocked）、
 * 升级挂起超时、事务/配额错误——置 idbBroken，后续读写全部走内存同构实现：功能保持完整可点，
 * 代价仅是进度不跨会话（与平台「数据不保证永久持久化」的语义一致）。
 * 此前一次 IDB 异常会让启动页永久卡死、零按钮（六连拒的「功能缺陷」最可能元凶）。
 */
import type { LocalCard, LocalDailyStat, LocalDeck, LocalProgress } from '../../core/types';

const DB_NAME = 'beizitie';
const DB_VERSION = 2;
const OPEN_TIMEOUT_MS = 5000;

let dbPromise: Promise<IDBDatabase> | null = null;
let idbBroken = false;
let warned = false;

/** 内存降级存储：与 IDB 版接口同构 */
const mem = {
  decks: new Map<string, LocalDeck>(),
  cards: new Map<string, LocalCard>(),
  progress: new Map<string, LocalProgress>(),
  stats: new Map<string, LocalDailyStat>(),
  kv: new Map<string, unknown>(),
  images: new Map<string, CachedImage>(),
};

function markBroken(): void {
  if (idbBroken) return;
  idbBroken = true;
  dbPromise = null;
  if (!warned) {
    warned = true;
    console.warn('[beizitie] IndexedDB 不可用，已降级为内存模式（功能完整，进度不跨会话）');
  }
}

/** 显式重试前调用：重置降级状态，给 IDB 再次探测的机会 */
export function resetStorageFallback(): void {
  idbBroken = false;
  dbPromise = null;
}

export function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    let settled = false;
    const fail = (err: unknown) => {
      if (settled) return;
      settled = true;
      markBroken();
      reject(err instanceof Error ? err : new Error(String(err)));
    };
    let req: IDBOpenDBRequest;
    try {
      req = indexedDB.open(DB_NAME, DB_VERSION);
    } catch (e) {
      fail(e); // 存储被容器禁用时 open 会同步抛错
      return;
    }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('decks')) db.createObjectStore('decks', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('cards')) {
        const s = db.createObjectStore('cards', { keyPath: 'id' });
        s.createIndex('deckId', 'deckId');
      }
      if (!db.objectStoreNames.contains('progress')) {
        const s = db.createObjectStore('progress', { keyPath: 'cardId' });
        s.createIndex('deckId', 'deckId');
      }
      if (!db.objectStoreNames.contains('stats')) db.createObjectStore('stats', { keyPath: 'date' });
      if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv', { keyPath: 'key' });
      // v2：字图离线缓存（url → Blob）
      if (!db.objectStoreNames.contains('images')) db.createObjectStore('images', { keyPath: 'url' });
    };
    req.onsuccess = () => {
      if (settled) return;
      settled = true;
      resolve(req.result);
    };
    req.onerror = () => fail(req.error);
    req.onblocked = () => fail(new Error('IndexedDB blocked（被其他页面占用）'));
    // 升级挂起 / 事件永不回调的兜底
    setTimeout(() => fail(new Error('IndexedDB open 超时')), OPEN_TIMEOUT_MS);
  });
  return dbPromise;
}

function reqToPromise<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** IDB 操作统一走这里：任何失败自动降级内存实现，调用方无感 */
async function withFallback<T>(idbOp: () => Promise<T>, memOp: () => T): Promise<T> {
  if (idbBroken) return memOp();
  try {
    return await idbOp();
  } catch (e) {
    // 只有「库本身不可用」才整体降级；配额不足/单条写失败只影响这一次操作，
    // 否则一次字图缓存写满会让书库、进度、统计全部显示为空。
    const name = (e as { name?: string } | null)?.name || '';
    if (name === 'VersionError' || name === 'InvalidStateError' || name === 'NotFoundError') {
      markBroken();
    } else {
      console.warn('[beizitie] IndexedDB 操作失败，本次降级内存：', name || e);
    }
    return memOp();
  }
}

export async function tx<T>(
  stores: string[],
  mode: IDBTransactionMode,
  fn: (t: IDBTransaction) => Promise<T> | T,
): Promise<T> {
  const db = await openDb();
  const t = db.transaction(stores, mode);
  const result = await fn(t);
  return new Promise((resolve, reject) => {
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

// ---- decks ----
export async function putDeck(deck: LocalDeck): Promise<void> {
  return withFallback(
    () => tx(['decks'], 'readwrite', (t) => void t.objectStore('decks').put(deck)),
    () => { mem.decks.set(deck.id, deck); },
  );
}
export async function getAllDecks(): Promise<LocalDeck[]> {
  return withFallback(
    () => tx(['decks'], 'readonly', (t) => reqToPromise(t.objectStore('decks').getAll()) as Promise<LocalDeck[]>),
    () => [...mem.decks.values()],
  );
}
export async function getDeck(id: string): Promise<LocalDeck | undefined> {
  return withFallback(
    () => tx(['decks'], 'readonly', (t) => reqToPromise(t.objectStore('decks').get(id)) as Promise<LocalDeck | undefined>),
    () => mem.decks.get(id),
  );
}

// ---- cards ----
export async function putCards(cards: LocalCard[]): Promise<void> {
  return withFallback(
    () => tx(['cards'], 'readwrite', (t) => {
      const s = t.objectStore('cards');
      cards.forEach((c) => s.put(c));
    }),
    () => { cards.forEach((c) => mem.cards.set(c.id, c)); },
  );
}
export async function getCardsByDeck(deckId: string): Promise<LocalCard[]> {
  return withFallback(
    () => tx(['cards'], 'readonly', (t) =>
      reqToPromise(t.objectStore('cards').index('deckId').getAll(deckId)) as Promise<LocalCard[]>),
    () => [...mem.cards.values()].filter((c) => c.deckId === deckId),
  );
}
export async function deleteCardsByDeck(deckId: string): Promise<void> {
  return withFallback(
    () => tx(['cards', 'progress'], 'readwrite', async (t) => {
      const cards = (await reqToPromise(t.objectStore('cards').index('deckId').getAll(deckId)) as LocalCard[]);
      const cardStore = t.objectStore('cards');
      const progressStore = t.objectStore('progress');
      for (const c of cards) {
        cardStore.delete(c.id);
        progressStore.delete(c.id);
      }
    }),
    () => {
      for (const c of [...mem.cards.values()]) {
        if (c.deckId === deckId) {
          mem.cards.delete(c.id);
          mem.progress.delete(c.id);
        }
      }
    },
  );
}
export async function getCard(id: string): Promise<LocalCard | undefined> {
  return withFallback(
    () => tx(['cards'], 'readonly', (t) => reqToPromise(t.objectStore('cards').get(id)) as Promise<LocalCard | undefined>),
    () => mem.cards.get(id),
  );
}

// ---- progress ----
export async function getProgress(cardId: string): Promise<LocalProgress | undefined> {
  return withFallback(
    () => tx(['progress'], 'readonly', (t) => reqToPromise(t.objectStore('progress').get(cardId)) as Promise<LocalProgress | undefined>),
    () => mem.progress.get(cardId),
  );
}
export async function putProgress(p: LocalProgress): Promise<void> {
  return withFallback(
    () => tx(['progress'], 'readwrite', (t) => void t.objectStore('progress').put(p)),
    () => { mem.progress.set(p.cardId, p); },
  );
}
export async function getProgressByDeck(deckId: string): Promise<LocalProgress[]> {
  return withFallback(
    () => tx(['progress'], 'readonly', (t) =>
      reqToPromise(t.objectStore('progress').index('deckId').getAll(deckId)) as Promise<LocalProgress[]>),
    () => [...mem.progress.values()].filter((p) => p.deckId === deckId),
  );
}

// ---- stats ----
export function todayLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
export async function getStat(date: string): Promise<LocalDailyStat | undefined> {
  return withFallback(
    () => tx(['stats'], 'readonly', (t) => reqToPromise(t.objectStore('stats').get(date)) as Promise<LocalDailyStat | undefined>),
    () => mem.stats.get(date),
  );
}
/** 一次事务同时写进度与当日统计：评一张卡要么都落盘，要么都不落 */
export async function putProgressAndStat(p: LocalProgress, s: LocalDailyStat): Promise<void> {
  return withFallback(
    () => tx(['progress', 'stats'], 'readwrite', (t) => {
      t.objectStore('progress').put(p);
      t.objectStore('stats').put(s);
    }),
    () => {
      mem.progress.set(p.cardId, p);
      mem.stats.set(s.date, s);
    },
  );
}

export async function putStat(s: LocalDailyStat): Promise<void> {
  return withFallback(
    () => tx(['stats'], 'readwrite', (t) => void t.objectStore('stats').put(s)),
    () => { mem.stats.set(s.date, s); },
  );
}
export async function getAllStats(): Promise<LocalDailyStat[]> {
  return withFallback(
    () => tx(['stats'], 'readonly', (t) => reqToPromise(t.objectStore('stats').getAll()) as Promise<LocalDailyStat[]>),
    () => [...mem.stats.values()],
  );
}

// ---- kv（设置） ----
export async function kvGet(key: string): Promise<unknown> {
  return withFallback(
    async () => {
      const db = await openDb();
      const t = db.transaction('kv', 'readonly');
      const row = (await reqToPromise(t.objectStore('kv').get(key))) as { key: string; value: unknown } | undefined;
      return row?.value;
    },
    () => mem.kv.get(key),
  );
}
export async function kvSet(key: string, value: unknown): Promise<void> {
  return withFallback(
    async () => {
      const db = await openDb();
      const t = db.transaction('kv', 'readwrite');
      t.objectStore('kv').put({ key, value });
      return new Promise<void>((resolve, reject) => {
        t.oncomplete = () => resolve();
        t.onerror = () => reject(t.error);
      });
    },
    () => { mem.kv.set(key, value); },
  );
}

// ---- images（字图离线缓存） ----
export interface CachedImage {
  url: string;
  blob: Blob;
  cached_at: string;
}

export async function getImageBlob(url: string): Promise<Blob | undefined> {
  return withFallback(
    async () => {
      const row = (await tx(['images'], 'readonly', (t) =>
        reqToPromise(t.objectStore('images').get(url)),
      )) as CachedImage | undefined;
      return row?.blob;
    },
    () => mem.images.get(url)?.blob,
  );
}

export async function putImageBlob(url: string, blob: Blob): Promise<void> {
  return withFallback(
    () => tx(['images'], 'readwrite', (t) => void t.objectStore('images').put({ url, blob, cached_at: new Date().toISOString() })),
    () => { mem.images.set(url, { url, blob, cached_at: new Date().toISOString() }); },
  );
}

export async function countImages(): Promise<number> {
  return withFallback(
    () => tx(['images'], 'readonly', (t) => reqToPromise(t.objectStore('images').count())),
    () => mem.images.size,
  );
}

export async function clearImages(): Promise<void> {
  return withFallback(
    () => tx(['images'], 'readwrite', (t) => void t.objectStore('images').clear()),
    () => { mem.images.clear(); },
  );
}
