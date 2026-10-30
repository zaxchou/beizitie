import React from 'react';
import { Box, LinearProgress, Typography } from '@mui/material';

export interface ProgressBarProps {
  /** 当前位置 */
  current: number;
  /** 总数 */
  total: number;
}

/**
 * 学习进度条。
 * 显示 LinearProgress 进度条 + "{current} / {total}" 文字。
 */
const ProgressBar: React.FC<ProgressBarProps> = ({ current, total }) => {
  const progress = total > 0 ? (current / total) * 100 : 0;

  return (
    <Box className="w-full">
      <LinearProgress
        variant="determinate"
        value={Math.min(progress, 100)}
        sx={{ height: 4, borderRadius: '2px' }}
      />
      <Typography
        variant="body2"
        color="text.secondary"
        className="mt-1 text-center"
      >
        {current} / {total}
      </Typography>
    </Box>
  );
};

export default ProgressBar;
