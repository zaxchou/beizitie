import React from 'react';
import { Box, Typography } from '@mui/material';

/**
 * 品牌标识：朱红印章「字」+ 宋体字标。
 * 登录/注册这类无侧栏的页面用它代替 emoji 图标，保证与帖页语言一致。
 */
const BrandMark: React.FC<{ size?: 'sm' | 'md' }> = ({ size = 'md' }) => {
  const stamp = size === 'sm' ? 24 : 32;
  const word = size === 'sm' ? 20 : 28;
  return (
    <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 1.25 }}>
      <Box
        aria-hidden="true"
        sx={{
          width: stamp, height: stamp, flexShrink: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          bgcolor: 'primary.main', color: 'primary.contrastText',
          p: '2px',
        }}
      >
        <Box
          sx={{
            width: '100%', height: '100%', display: 'flex',
            alignItems: 'center', justifyContent: 'center',
            border: '1px solid', borderColor: 'primary.contrastText',
            fontFamily: '"Noto Serif SC", "Songti SC", serif',
            fontSize: size === 'sm' ? 14 : 19, lineHeight: 1,
            opacity: 0.92,
          }}
        >
          字
        </Box>
      </Box>
      <Typography
        component="span"
        sx={{ fontFamily: '"Noto Serif SC", "楷体", KaiTi, serif', fontSize: word, letterSpacing: 2, lineHeight: 1 }}
      >
        背字帖
      </Typography>
    </Box>
  );
};

export default BrandMark;
