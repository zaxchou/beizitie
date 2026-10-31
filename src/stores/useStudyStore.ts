// ===== 学习会话状态管理（Zustand + Express API） =====

import { create } from 'zustand';
import type { Card, Rating, StudySession } from '@/types';
import { calculateNextReview } from '@/lib/sm2';
import { DEFAULT_DAILY_NEW_CARD_LIMIT, SM2_DEFAULTS } from '@/lib/constants';
import {
  fetchDueCards,
  fetchNewCards,
  fetchDailyStats,
  incrementDailyStats,
  updateCardProgress,
  createStudySession as createStudySessionApi,
  endStudySession as endStudySessionApi,
  todayLocal,
} from '@/lib/api';

/** 学习阶段 */
type StudyPhase = 'idle' | 'loading' | 'studying' | 'complete';

interface StudyStore {
  /** 当前学习阶段 */
  phase: StudyPhase;
  /** 当前牌组 ID */
  deckId: string | null;
  /** 学习队列（待复习的卡片） */
  queue: Card[];
  /** 当前卡片索引 */
  currentIndex: number;
  /** 当前学习会话 */
  session: StudySession | null;
  /** 加载状态 */
  loading: boolean;
  /** 错误信息 */
  error: string | null;

  /** 初始化学习会话：加载到期卡片 + 新卡片，dailyReviewLimit 控制复习上限 */
  startSession: (deckId: string, dailyNewCardLimit?: number, dailyReviewLimit?: number, difficultyFilter?: string, mode?: 'default' | 'sequential' | 'random') => Promise<void>;
  /** 对当前卡片评分并前进到下一张 */
  rateCard: (rating: Rating) => Promise<void>;
  /** 结束当前学习会话 */
  endSession: () => Promise<void>;
  /** 重置状态 */
  reset: () => void;
  /** 清除错误 */
  clearError: () => void;
}

const initialRatings = { again: 0, hard: 0, good: 0, easy: 0 };

export const useStudyStore = create<StudyStore>((set, get) => ({
  phase: 'idle',
  deckId: null,
  queue: [],
  currentIndex: 0,
  session: null,
  loading: false,
  error: null,

  startSession: async (deckId: string, dailyNewCardLimit?: number, dailyReviewLimit?: number, difficultyFilter?: string, mode?: 'default' | 'sequential' | 'random') => {
    set({ loading: true, error: null, deckId });

    try {
      const newCardLimit = dailyNewCardLimit ?? DEFAULT_DAILY_NEW_CARD_LIMIT;
      const reviewLimit = dailyReviewLimit ?? 200;

      // 并行加载到期卡片和每日统计（用本牌组 deckId 查，避免跨牌组污染）
      const [dueCards, todayStats] = await Promise.all([
        fetchDueCards(deckId, reviewLimit, mode),
        fetchDailyStats(todayLocal(), deckId),
      ]);

      // 计算今天还能学多少新卡
      const newCardsLearnedToday = todayStats.new_cards_learned;
      const remainingNewCards = Math.max(0, newCardLimit - newCardsLearnedToday);

      // 加载新卡片
      let newCards: Card[] = [];
      if (remainingNewCards > 0) {
        newCards = await fetchNewCards(deckId, remainingNewCards, mode);
      }

      // 合并队列：到期卡排在前面
      let queue = [...dueCards, ...newCards];

      // 按难度筛选（如果有关）
      if (difficultyFilter) {
        queue = queue.filter((c) => {
          if (difficultyFilter === 'hard') return c.interval > 0 && c.ease < 2.0;
          if (difficultyFilter === 'medium') return c.interval > 0 && c.ease >= 2.0 && c.ease < 2.5;
          if (difficultyFilter === 'easy') return c.interval > 0 && c.ease >= 2.5;
          return true;
        });
      }

      if (queue.length === 0) {
        // 没有需要学习的卡片
        set({
          phase: 'complete',
          queue: [],
          currentIndex: 0,
          session: {
            id: crypto.randomUUID(),
            deck_id: deckId,
            started_at: new Date().toISOString(),
            ended_at: new Date().toISOString(),
            cards_studied: 0,
            ratings: { ...initialRatings },
          },
          loading: false,
        });
        return;
      }

      // 创建学习会话
      const session = await createStudySessionApi(
        deckId,
        new Date().toISOString()
      );

      set({
        phase: 'studying',
        queue,
        currentIndex: 0,
        session,
        loading: false,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : '无法开始学习';
      set({ error: message, loading: false, phase: 'idle' });
    }
  },

  rateCard: async (rating: Rating) => {
    const { queue, currentIndex, session } = get();
    if (currentIndex >= queue.length || !session) return;

    const card = queue[currentIndex];
    const now = new Date().toISOString();

    try {
      // 使用 SM-2 算法计算新状态
      const sm2Input = {
        ease: card.ease || SM2_DEFAULTS.INITIAL_EASE,
        interval: card.interval,
        repetitions: card.repetitions,
      };
      const output = calculateNextReview(rating, sm2Input);

      // 更新卡片进度（通过 /progress 端点，写入 user_card_progress）
      const wasNew = card.interval === 0;
      await updateCardProgress(card.id, {
        ease: output.ease,
        interval: output.interval,
        repetitions: output.repetitions,
        next_review: output.next_review,
        last_review: now,
      });

      // 更新本地队列中的卡片（避免重新加载）
      queue[currentIndex] = {
        ...card,
        ease: output.ease,
        interval: output.interval,
        repetitions: output.repetitions,
        next_review: output.next_review,
        last_review: now,
        updated_at: now,
      };

      // 更新学习会话的评分统计
      const updatedRatings = { ...session.ratings };
      switch (rating) {
        case 1:
          updatedRatings.again += 1;
          break;
        case 2:
          updatedRatings.hard += 1;
          break;
        case 3:
          updatedRatings.good += 1;
          break;
        case 4:
          updatedRatings.easy += 1;
          break;
      }

      const updatedSession: StudySession = {
        ...session,
        cards_studied: session.cards_studied + 1,
        ratings: updatedRatings,
      };

      // 原子增量更新每日统计（使用本地日期，不受 UTC 时区偏移影响）
      // 传 deck_id：按本牌组累加，避免跨牌组数据污染
      // 用后端 SQL 端累加，避免连续快速评分时"读后写"互相覆盖导致计数偏小
      const today = todayLocal();
      await incrementDailyStats(today, {
        deck_id: session.deck_id,
        cards_studied: 1,
        new_cards_learned: wasNew ? 1 : 0,
      });

      // 每评一张就把会话计数落库：直接关页/崩溃时评分分布与已学数不会丢
      // （会话的 ended_at 由学习页每 10s 心跳维护，这里不传，避免提前结束）
      try {
        await endStudySessionApi(session.id, {
          cards_studied: updatedSession.cards_studied,
          ratings: updatedRatings,
        });
      } catch { /* 单条记录失败不阻塞评分，退出时还会再写一次 */ }

      // 前进到下一张卡片
      const nextIndex = currentIndex + 1;
      if (nextIndex >= queue.length) {
        // 队列已完成
        set({ currentIndex: nextIndex, session: updatedSession });
        await get().endSession();
      } else {
        set({ currentIndex: nextIndex, session: updatedSession });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : '评分失败';
      set({ error: message });
    }
  },

  endSession: async () => {
    const { session } = get();
    if (!session) return;

    try {
      const now = new Date().toISOString();
      const finalSession = await endStudySessionApi(session.id, {
        ended_at: now,
        cards_studied: session.cards_studied,
        ratings: session.ratings,
      });
      set({ phase: 'complete', session: finalSession });
    } catch (err) {
      console.error('[useStudyStore] endSession 失败:', err);
      set({ phase: 'complete' });
    }
  },

  reset: () => {
    set({
      phase: 'idle',
      deckId: null,
      queue: [],
      currentIndex: 0,
      session: null,
      loading: false,
      error: null,
    });
  },

  clearError: () => set({ error: null }),
}));
