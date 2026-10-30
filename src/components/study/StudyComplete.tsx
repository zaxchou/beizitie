import React from 'react';
import { Box, Typography, Button, LinearProgress, Paper } from '@mui/material';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import type { StudySession } from '@/types';

export interface StudyCompleteProps {
  session: StudySession;
  onBackToDashboard: () => void;
}

const ratingConfig = [
  { key: 'again' as const, label: '重来', color: '#8b3a30', bg: 'var(--surface)' },
  { key: 'hard' as const, label: '困难', color: '#6e6458', bg: 'var(--surface)' },
  { key: 'good' as const, label: '良好', color: '#302c25', bg: 'var(--surface)' },
  { key: 'easy' as const, label: '简单', color: '#302c25', bg: 'var(--surface)' },
];

const StudyComplete: React.FC<StudyCompleteProps> = ({ session, onBackToDashboard }) => {
  const total = session.cards_studied || 1;

  return (
    <Box className="flex flex-col items-center justify-center py-6 px-4">
      <CheckCircleIcon sx={{ fontSize: 48, mb: 2, color: 'primary.main' }} />

      <Typography variant="h4" className="font-kai mb-1">
        学习完成！
      </Typography>

      <Typography variant="body2" color="text.secondary" className="mb-4">
        你太棒了，继续保持！
      </Typography>

      {/* 总卡片数 */}
      <Typography variant="h3" fontWeight={700} color="primary" className="mb-1">
        {session.cards_studied}
      </Typography>
      <Typography variant="caption" color="text.secondary" className="mb-4">
        本次学习卡片
      </Typography>

      {/* 评分分布 */}
      <Box className="w-full max-w-sm mb-5 space-y-2">
        {ratingConfig.map((item) => {
          const count = session.ratings[item.key];
          const pct = Math.round((count / total) * 100);
          return (
            <Paper
              key={item.key}
              elevation={0}
              className="flex items-center gap-3 px-3 py-2"
              sx={{ bgcolor: item.bg, border: '1px solid', borderColor: 'divider', borderRadius: '2px' }}
            >
              <Typography variant="body2" fontWeight={600} sx={{ color: item.color, minWidth: 36 }}>
                {item.label}
              </Typography>
              <LinearProgress
                variant="determinate"
                value={pct}
                sx={{
                  flex: 1,
                  height: 10,
                  borderRadius: 5,
                  bgcolor: 'var(--line)',
                  '& .MuiLinearProgress-bar': { borderRadius: '2px', bgcolor: item.color },
                }}
              />
              <Typography variant="body2" fontWeight={600} sx={{ color: item.color, minWidth: 24, textAlign: 'right' }}>
                {count}
              </Typography>
            </Paper>
          );
        })}
      </Box>

      <Button
        variant="contained"
        size="large"
        onClick={onBackToDashboard}
        sx={{ px: 6, py: 1.5, borderRadius: '2px', fontSize: 16 }}
      >
        返回 背字帖
      </Button>
    </Box>
  );
};

export default StudyComplete;
