import { useMemo } from 'react';
import { useDeckStore } from '@/stores/useDeckStore';
import { DEFAULT_DAILY_NEW_CARD_LIMIT } from '@/lib/constants';
import { fetchDueCounts, fetchDailyStats, fetchDailyStatsRange, fetchStudyTotal, todayLocal } from '@/lib/api';
import { useCachedFetch } from './useCachedFetch';

export interface DailyStatRow {
  date: string;
  cards_studied: number;
  new_cards_learned: number;
}

export interface DashboardStats {
  newCount: number;          // 今日可学新卡（按牌组每日上限 - 今日已学 计算）
  dueCount: number;          // 今日待复习
  newCardRemaining: number;  // 今日剩余新卡（每日上限 - 今日已学新卡）
  streakDays: number;        // 连续打卡
  totalStudied: number;      // 累计已学卡片
  activeDays: number;        // 累计学习天数
  totalMinutes: number;      // 累计学习分钟
  activityData: DailyStatRow[]; // 完整 13 周
  loading: boolean;
}

/**
 * 计算连续打卡天数（从昨天开始往前推）。
 */
function calculateStreak(stats: DailyStatRow[]): number {
  const activeDays = new Set(stats.filter((s) => s.cards_studied > 0).map((s) => s.date));
  let streak = 0;
  const checkDate = new Date();
  checkDate.setDate(checkDate.getDate() - 1);

  while (true) {
    const dateStr = `${checkDate.getFullYear()}-${String(checkDate.getMonth() + 1).padStart(2, '0')}-${String(checkDate.getDate()).padStart(2, '0')}`;
    if (activeDays.has(dateStr)) {
      streak++;
      checkDate.setDate(checkDate.getDate() - 1);
    } else {
      break;
    }
  }
  return streak;
}

/** 聚合加载所有 Dashboard 统计（带 30s 缓存） */
function useDashboardData() {
  return useCachedFetch(
    'dashboard-stats',
    async () => {
      const today = todayLocal();
      const allFrom = '2020-01-01';

      const [dueCounts, todayStats, allStats, studyTotal] = await Promise.all([
        fetchDueCounts(),
        fetchDailyStats(today),
        fetchDailyStatsRange(allFrom, today),
        fetchStudyTotal(),
      ]);

      return {
        dueCount: dueCounts.reduce((sum, d) => sum + Number(d.due_count), 0),
        newCardRemaining: Math.max(0, DEFAULT_DAILY_NEW_CARD_LIMIT - (todayStats?.new_cards_learned ?? 0)),
        streakDays: calculateStreak(allStats),
        totalStudied: allStats.reduce((s, d) => s + d.cards_studied, 0),
        activeDays: allStats.filter((d) => d.cards_studied > 0).length,
        totalMinutes: Math.round(studyTotal.total_minutes),
        activityData: allStats,
      };
    },
    { ttl: 30_000 }
  );
}

/**
 * 共享仪表盘统计 hook。
 * 用于 Sidebar / Dashboard 等需要展示统计数据的组件，避免各自重复加载。
 * 内置 30 秒内存缓存，多个组件共享同一份数据。
 */
export const useDashboardStats = (): DashboardStats => {
  const decks = useDeckStore((s) => s.decks);
  const { data, loading } = useDashboardData();

  const newCount = useMemo(
    () => decks.reduce((sum, d) => sum + Number((d as any).new_available_today ?? d.new_count ?? 0), 0),
    [decks]
  );

  return useMemo(
    () => ({
      newCount,
      dueCount: data?.dueCount ?? 0,
      newCardRemaining: data?.newCardRemaining ?? DEFAULT_DAILY_NEW_CARD_LIMIT,
      streakDays: data?.streakDays ?? 0,
      totalStudied: data?.totalStudied ?? 0,
      activeDays: data?.activeDays ?? 0,
      totalMinutes: data?.totalMinutes ?? 0,
      activityData: data?.activityData ?? [],
      loading: loading && !data,
    }),
    [newCount, data, loading]
  );
};
