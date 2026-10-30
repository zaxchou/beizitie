import React, { useState, useMemo } from 'react';
import { Box, Typography, Card, CardContent, ToggleButton, ToggleButtonGroup } from '@mui/material';
import ActivityCalendar, { ActivityDay } from './ActivityCalendar';
import { useDashboardStats } from '@/hooks/useDashboardStats';
import { useDeckStore } from '@/stores/useDeckStore';

type Range = 'all' | '30d' | '7d';

interface StatCardProps {
  label: string;
  value: number | string;
  unit?: string;
  size?: 'sm' | 'md';
}
const StatCard: React.FC<StatCardProps> = ({ label, value, unit, size = 'md' }) => (
  <Box sx={{
    border: '1px solid', borderColor: 'divider', borderRadius: '2px',
    p: size === 'sm' ? 1 : 1.25,
    bgcolor: 'background.paper',
    minWidth: 0,
  }}>
    <Typography
      variant="caption"
      color="text.secondary"
      sx={{ fontSize: size === 'sm' ? 10 : 11, lineHeight: 1.2 }}
    >
      {label}
    </Typography>
    <Box sx={{ display: 'flex', alignItems: 'baseline', mt: size === 'sm' ? 0.25 : 0.5, gap: 0.5 }}>
      <Typography
        className="font-kai"
        sx={{ fontSize: size === 'sm' ? 19 : 23, lineHeight: 1.1, fontVariantNumeric: 'tabular-nums' }}
      >
        {value}
      </Typography>
      {unit && (
        <Typography variant="caption" color="text.secondary" sx={{ fontSize: size === 'sm' ? 10 : 12 }}>
          {unit}
        </Typography>
      )}
    </Box>
  </Box>
);

export interface OverviewPanelProps {
  /** 'page' = 完整版（带 Card 外壳、PC/移动端顶部）；'sidebar' = 紧凑版（嵌入左侧栏，无 Card 外壳） */
  variant?: 'page' | 'sidebar';
}

/**
 * 概览面板：复刻参考图的"标题 + 时间筛选 + 6 个数据卡 + 热力图 + 总结"布局。
 *  - variant='page'：完整版（Card 外壳、6 张 2×3 卡），用于 Dashboard 顶部移动端
 *  - variant='sidebar'：紧凑版（无 Card 外壳、6 张 3×2 卡更小），用于 PC 端左侧栏
 */
const OverviewPanel: React.FC<OverviewPanelProps> = ({ variant = 'page' }) => {
  const isSidebar = variant === 'sidebar';
  const {
    newCount, dueCount, totalMinutes, activityData, loading,
  } = useDashboardStats();
  const decksLoading = useDeckStore((s) => s.loading);
  const [range, setRange] = useState<Range>('all');

  // 根据 range 过滤 activityData：更早的 days 置 0
  const filteredActivity = useMemo<ActivityDay[]>(() => {
    if (range === 'all') return activityData;
    const days = range === '7d' ? 7 : 30;
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days + 1);
    const cutoffStr = `${cutoff.getFullYear()}-${String(cutoff.getMonth() + 1).padStart(2, '0')}-${String(cutoff.getDate()).padStart(2, '0')}`;
    return activityData.map((d) => (d.date < cutoffStr ? { ...d, cards_studied: 0, new_cards_learned: 0 } : d));
  }, [activityData, range]);

  /** 按 range 过滤后的学习天数 */
  const filteredActiveDays = useMemo(
    () => filteredActivity.filter((d) => d.cards_studied > 0).length,
    [filteredActivity]
  );

  /** 累计学时小时数（全量） */
  const hours = useMemo(() => (totalMinutes / 60).toFixed(1), [totalMinutes]);

  const content = (
    <>
      {/* 顶部：标题 + 时间筛选 */}
      <Box display="flex" justifyContent="space-between" alignItems="center" mb={isSidebar ? 1 : 2}>
        <Typography
          variant={isSidebar ? 'overline' : 'h6'}
          fontWeight={600}
          color={isSidebar ? 'text.secondary' : 'text.primary'}
          sx={{ fontSize: isSidebar ? 11 : undefined, lineHeight: isSidebar ? '2' : undefined }}
        >
          {isSidebar ? '学习概览' : '概览'}
        </Typography>
        <ToggleButtonGroup
          size="small"
          exclusive
          value={range}
          onChange={(_, v) => v && setRange(v)}
          sx={{
            '& .MuiToggleButton-root': {
              px: isSidebar ? 0.75 : 1.5,
              fontSize: isSidebar ? 10 : 12,
            },
          }}
        >
          <ToggleButton value="all">All</ToggleButton>
          <ToggleButton value="30d">30d</ToggleButton>
          <ToggleButton value="7d">7d</ToggleButton>
        </ToggleButtonGroup>
      </Box>

      {/* 3 个核心数据卡：待学习 / 待复习 / 学习天数 */}
      <Box
        display="grid"
        gridTemplateColumns="1fr 1fr 1fr"
        gap={isSidebar ? 0.75 : 1.5}
        mb={isSidebar ? 1.25 : 2}
      >
        <StatCard label="待学习" value={loading || decksLoading ? '-' : newCount} unit="张" size={isSidebar ? 'sm' : 'md'} />
        <StatCard label="待复习" value={loading ? '-' : dueCount} unit="张" size={isSidebar ? 'sm' : 'md'} />
        <StatCard label="学习" value={loading ? '-' : filteredActiveDays} unit="天" size={isSidebar ? 'sm' : 'md'} />
      </Box>

      {/* 热力图 */}
      <Box mb={isSidebar ? 0.75 : 1.5}>
        <ActivityCalendar data={filteredActivity} weeks={isSidebar ? 13 : 13} compact={isSidebar} />
      </Box>

      {/* 总结文案 */}
      <Typography
        variant="body2"
        color="text.secondary"
        sx={{ fontSize: isSidebar ? 11 : 13, lineHeight: 1.4 }}
      >
        累计学时 {hours} h
      </Typography>
    </>
  );

  if (isSidebar) {
    return <Box sx={{ pt: 0.5 }}>{content}</Box>;
  }

  return (
    <Card variant="outlined" sx={{ borderRadius: '2px' }}>
      <CardContent sx={{ p: { xs: 2, sm: 2.5 }, '&:last-child': { pb: { xs: 2, sm: 2.5 } } }}>
        {content}
      </CardContent>
    </Card>
  );
};

export default OverviewPanel;
