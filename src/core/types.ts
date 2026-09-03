/** 单文件版与服务器版共享的目录类型（catalog/*.json 的消费侧类型） */

export interface CatalogZuopin {
  id: string;          // deck 引用（服务器牌组 id）
  z: string;           // zitie id（单字清单文件名）
  n: string;           // 帖名
  a: string;           // 书家
  d: string;           // 朝代
  s: string[];         // 书体（多值）
  c: string;           // 封面 URL（http）或 ''（回退首字图）
  g: number;           // 字数
}

export interface CatalogIndex {
  v: number;
  updatedAt: string;
  total: number;
  zuopins: CatalogZuopin[];
}

export interface CatalogStyleCount {
  style: string;
  n: number;
}

/** catalog/zitie/<zitieId>.json */
export interface ZitieGlyphList {
  z: string;
  base: string;        // CDN 目录前缀
  thumb: string;       // 统一缩放参数（如 ?x-bce-process=style/jpg512）
  g: CatalogGlyph[];
}

export interface CatalogGlyph {
  rel: string;         // base 之后的相对路径（无查询参数）
  h: string;           // 汉字
}

export function glyphUrl(z: Pick<ZitieGlyphList, 'base' | 'thumb'>, g: CatalogGlyph): string {
  return `${z.base}${g.rel}${z.thumb}`;
}

/** 单文件版本地牌组（IndexedDB decks store） */
export interface LocalDeck {
  id: string;
  zitieId: string;
  name: string;
  author: string;
  dynasty: string;
  styles: string[];
  cover: string;             // 可为 ''
  createdAt: string;
  settings: {
    dailyNewLimit: number;   // 默认 20
    dailyReviewLimit: number; // 默认 200
    paused: boolean;
  };
}

/** 本地卡片（IndexedDB cards store） */
export interface LocalCard {
  id: string;
  deckId: string;
  hanzi: string;
  imageUrl: string;          // 完整直链
  sortOrder: number;
}

/** 本地学习进度（IndexedDB progress store，键 cardId） */
export interface LocalProgress {
  cardId: string;
  deckId: string;
  ease: number;
  interval: number;          // 分钟
  repetitions: number;
  dueAt: string;             // ISO
  lastReviewed: string | null;
}

/** 每日统计（IndexedDB stats store，键 YYYY-MM-DD，本地时区） */
export interface LocalDailyStat {
  date: string;
  studied: number;
  newLearned: number;
}
