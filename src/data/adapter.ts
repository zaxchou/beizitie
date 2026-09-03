/**
 * DataAdapter —— 双版本数据层接口
 *
 * - web 版：ServerAdapter（包装现有 src/lib/api.ts，由登录后的页面直接调用 API）
 * - single 版：LocalAdapter（src/data/local/localAdapter.ts，IndexedDB 本地实现）
 *
 * P1 策略：现有 web 页面保持直连 api.ts（零回归）；single 页面走 LocalAdapter。
 * 后续 P2 逐步把共享 features 收拢到 adapter 之后，两条实现都从这里对齐。
 */
import type {
  CatalogIndex,
  CatalogStyleCount,
  LocalCard,
  LocalDailyStat,
  LocalDeck,
  LocalProgress,
  ZitieGlyphList,
} from '../core/types';
import type { Rating } from '../types';

export interface DeckSettingsPatch {
  dailyNewLimit?: number;
  dailyReviewLimit?: number;
  paused?: boolean;
}

export interface StudyQueue {
  /** 本次要学的卡片（含其当前进度或 null=新卡） */
  items: { card: LocalCard; progress: LocalProgress | null }[];
  newCount: number;
  reviewCount: number;
}

/**
 * 单文件版本地数据源。方法按域分组；全部为 Promise 异步。
 * 服务器版的对应能力由 src/lib/api.ts + useXxxStore 承担（维护模式，不强制对齐）。
 */
export interface LocalDataSource {
  catalog: {
    /** 内联目录索引（构建时打入，无需网络） */
    index(): CatalogIndex;
    styleCounts(): CatalogStyleCount[];
    /** 拉取单帖单字清单（自动尝试多个分发源并缓存） */
    zitie(zitieId: string): Promise<ZitieGlyphList>;
    glyphUrl(z: Pick<ZitieGlyphList, 'base' | 'thumb'>, rel: string): string;
  };
  library: {
    /** 订阅：把单字清单落成本地牌组 */
    addFromZitie(z: ZitieGlyphList, meta: Pick<LocalDeck, 'name' | 'author' | 'dynasty' | 'styles' | 'cover'>): Promise<LocalDeck>;
    list(): Promise<(LocalDeck & {
      newCount: number; reviewCount: number;
      totalCards: number; learnedCount: number;
      newRemaining: number; dueRemaining: number;
    })[]>;
    remove(deckId: string): Promise<void>;
    cards(deckId: string): Promise<LocalCard[]>;
    updateSettings(deckId: string, patch: DeckSettingsPatch): Promise<void>;
  };
  study: {
    queue(deckId: string): Promise<StudyQueue>;
    rate(cardId: string, rating: Rating): Promise<void>;
  };
  stats: {
    today(): Promise<LocalDailyStat>;
    range(days: number): Promise<LocalDailyStat[]>;
  };
  settings: {
    get<T>(key: string, fallback: T): Promise<T>;
    set(key: string, value: unknown): Promise<void>;
  };
  backup: {
    exportAll(): Promise<Blob>;
    importAll(json: string, mode: 'merge' | 'replace'): Promise<{ decks: number; cards: number; progress: number }>;
  };
}
