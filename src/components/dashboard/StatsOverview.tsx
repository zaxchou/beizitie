import React, { useMemo } from 'react';
import { Box, Typography } from '@mui/material';
import ActivityCalendar, { type ActivityDay } from './ActivityCalendar';
import StatsBar from './StatsBar';

export interface StatsOverviewProps {
  dueCount: number;
  newCardRemaining: number;
  streakDays: number;
  activityData: ActivityDay[];
}

const StatsOverview: React.FC<StatsOverviewProps> = ({ dueCount, newCardRemaining, streakDays, activityData }) => {

  /** 计算日历显示的实际活动天数与总数 */
  const summary = useMemo(() => {
    const active = activityData.filter((d) => d.cards_studied > 0).length;
    const total = activityData.reduce((s, d) => s + d.cards_studied, 0);
    return { activeDays: active, totalCards: total };
  }, [activityData]);

  return (
    <Box sx={{ p: 2, bgcolor: 'background.paper', border: '1px solid', borderColor: 'divider' }}>
      <StatsBar dueCount={dueCount} newCardRemaining={newCardRemaining} streakDays={streakDays} />

      {/* 活动日历标题 */}
      <Box className="flex items-center justify-between mb-1.5">
        <Typography variant="subtitle2" fontWeight={600}>
          学习活动
        </Typography>
        <Typography variant="caption" color="text.secondary">
          近 3 个月 · {summary.activeDays} 天活跃 · 共 {summary.totalCards} 张
        </Typography>
      </Box>

      {/* 热力图 */}
      <ActivityCalendar data={activityData} weeks={13} />
    </Box>
  );
};

export default React.memo(StatsOverview);
