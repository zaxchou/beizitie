/**
 * IndexedDB 访问层（单文件版）
 * 库：beizitie v1
 * stores: decks(id) / cards(id, idx deckId) / progress(cardId, idx deckId) / stats(date) / kv(key)
 */
import type { LocalCard, LocalDailyStat, LocalDeck, LocalProgress } from '../../core/types';

const DB_NAME = 'beizitie';
const DB_VERSION = 1;

let dbPromise: Promise<IDBDatabase> | null = null;

export function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
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
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function reqToPromise<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
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
  return tx(['decks'], 'readwrite', (t) => void t.objectStore('decks').put(deck));
}
export async function getAllDecks(): Promise<LocalDeck[]> {
  return tx(['decks'], 'readonly', (t) => reqToPromise(t.objectStore('decks').getAll()) as Promise<LocalDeck[]>);
}
export async function getDeck(id: string): Promise<LocalDeck | undefined> {
  return tx(['decks'], 'readonly', (t) => reqToPromise(t.objectStore('decks').get(id)) as Promise<LocalDeck | undefined>);
}

// ---- cards ----
export async function putCards(cards: LocalCard[]): Promise<void> {
  return tx(['cards'], 'readwrite', (t) => {
    const s = t.objectStore('cards');
    cards.forEach((c) => s.put(c));
  });
}
export async function getCardsByDeck(deckId: string): Promise<LocalCard[]> {
  return tx(['cards'], 'readonly', (t) =>
    reqToPromise(t.objectStore('cards').index('deckId').getAll(deckId)) as Promise<LocalCard[]>);
}
export async function deleteCardsByDeck(deckId: string): Promise<void> {
  return tx(['cards', 'progress'], 'readwrite', async (t) => {
    const cards = (await reqToPromise(t.objectStore('cards').index('deckId').getAll(deckId)) as LocalCard[]);
    const cardStore = t.objectStore('cards');
    const progressStore = t.objectStore('progress');
    for (const c of cards) {
      cardStore.delete(c.id);
      progressStore.delete(c.id);
    }
  });
}
export async function getCard(id: string): Promise<LocalCard | undefined> {
  return tx(['cards'], 'readonly', (t) => reqToPromise(t.objectStore('cards').get(id)) as Promise<LocalCard | undefined>);
}

// ---- progress ----
export async function getProgress(cardId: string): Promise<LocalProgress | undefined> {
  return tx(['progress'], 'readonly', (t) => reqToPromise(t.objectStore('progress').get(cardId)) as Promise<LocalProgress | undefined>);
}
export async function putProgress(p: LocalProgress): Promise<void> {
  return tx(['progress'], 'readwrite', (t) => void t.objectStore('progress').put(p));
}
export async function getProgressByDeck(deckId: string): Promise<LocalProgress[]> {
  return tx(['progress'], 'readonly', (t) =>
    reqToPromise(t.objectStore('progress').index('deckId').getAll(deckId)) as Promise<LocalProgress[]>);
}

// ---- stats ----
export function todayLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
export async function getStat(date: string): Promise<LocalDailyStat | undefined> {
  return tx(['stats'], 'readonly', (t) => reqToPromise(t.objectStore('stats').get(date)) as Promise<LocalDailyStat | undefined>);
}
export async function putStat(s: LocalDailyStat): Promise<void> {
  return tx(['stats'], 'readwrite', (t) => void t.objectStore('stats').put(s));
}
export async function getAllStats(): Promise<LocalDailyStat[]> {
  return tx(['stats'], 'readonly', (t) => reqToPromise(t.objectStore('stats').getAll()) as Promise<LocalDailyStat[]>);
}

// ---- kv（设置） ----
export async function kvGet(key: string): Promise<unknown> {
  const db = await openDb();
  const t = db.transaction('kv', 'readonly');
  const row = (await reqToPromise(t.objectStore('kv').get(key))) as { key: string; value: unknown } | undefined;
  return row?.value;
}
export async function kvSet(key: string, value: unknown): Promise<void> {
  const db = await openDb();
  const t = db.transaction('kv', 'readwrite');
  t.objectStore('kv').put({ key, value });
  return new Promise((resolve, reject) => {
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
  });
}
