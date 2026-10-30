import React from 'react';
import { Box, Typography } from '@mui/material';

export interface StatsBarProps {
  dueCount: number;
  newCardRemaining: number;
  streakDays: number;
}

const statItems: { key: 'due' | 'new' | 'streak'; label: string }[] = [
  { key: 'due', label: '待复习' },
  { key: 'new', label: '新卡剩余' },
  { key: 'streak', label: '连续打卡' },
];

const StatsBar: React.FC<StatsBarProps> = ({ dueCount, newCardRemaining, streakDays }) => {
  const values = { due: dueCount, new: newCardRemaining, streak: streakDays };

  return (
    <Box
      sx={{
        display: 'flex', border: '1px solid', borderColor: 'divider',
        borderRadius: '2px', bgcolor: 'background.paper', overflow: 'hidden',
      }}
    >
      {statItems.map((item, i) => {
        const v = values[item.key];
        const urgent = item.key === 'due' && v > 0;
        return (
          <Box
            key={item.key}
            sx={{
              flex: 1, minWidth: 0, px: 2, py: 1.5,
              borderLeft: i > 0 ? '1px solid' : 'none', borderColor: 'divider',
            }}
          >
            <Typography sx={{ fontSize: 11, color: 'text.secondary', lineHeight: 1.3, letterSpacing: 0.3 }}>
              {item.label}
            </Typography>
            <Typography
              className="font-kai"
              sx={{
                fontSize: 26, lineHeight: 1.15, mt: 0.25,
                fontVariantNumeric: 'tabular-nums',
                color: urgent ? 'primary.main' : 'text.primary',
              }}
            >
              {v}
            </Typography>
          </Box>
        );
      })}
    </Box>
  );
};

export default StatsBar;
