import React from 'react';
import { Box, DialogActions, DialogTitle, Typography } from '@mui/material';

/**
 * 弹窗通用件：等宽小标 + 中文粗题 + 细分隔线，表单标签与方角输入框。
 * 卡片管理、市场发布等弹窗共用，避免各写一套。
 */
export const DialogHead: React.FC<{ title: string; en: string; sub?: string; id?: string }> = ({ title, en, sub, id }) => (
  <DialogTitle id={id} sx={{ p: '14px 20px 12px', borderBottom: '1px solid', borderColor: 'divider' }}>
    <Typography sx={{ fontFamily: 'var(--font-mono)', fontSize: 9.5, letterSpacing: '0.14em', textTransform: 'uppercase', opacity: 0.6 }}>
      {en}
    </Typography>
    <Typography component="span" sx={{ display: 'block', fontSize: 19, fontWeight: 900, letterSpacing: '0.08em', mt: 0.5 }}>
      {title}
    </Typography>
    {sub && (
      <Typography component="span" sx={{ display: 'block', fontFamily: 'var(--font-mono)', fontSize: 10, opacity: 0.55, mt: 0.5 }}>
        {sub}
      </Typography>
    )}
  </DialogTitle>
);

export const FieldLabel: React.FC<{ children: React.ReactNode; required?: boolean; hint?: string }> = ({ children, required, hint }) => (
  <Box sx={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 1, mb: 0.75 }}>
    <Typography sx={{ fontFamily: 'var(--font-mono)', fontSize: 9.5, letterSpacing: '0.12em', textTransform: 'uppercase', opacity: 0.62 }}>
      {children}
      {required && <Box component="span" sx={{ color: 'var(--hot-ink)', ml: 0.5 }}>*</Box>}
    </Typography>
    {hint && (
      <Typography sx={{ fontFamily: 'var(--font-mono)', fontSize: 9, opacity: 0.45, whiteSpace: 'nowrap' }}>{hint}</Typography>
    )}
  </Box>
);

/** 方角细线输入框，聚焦只加深边框 */
export const dlgFieldSx = {
  '& .MuiOutlinedInput-root': {
    borderRadius: 0,
    fontSize: 14,
    backgroundColor: 'transparent',
    '& fieldset': { borderColor: 'divider' },
    '&:hover fieldset': { borderColor: 'text.primary' },
    '&.Mui-focused fieldset': { borderColor: 'text.primary', borderWidth: 1 },
  },
  '& textarea': { lineHeight: 1.8 },
} as const;

export const dlgActionSx = {
  p: '12px 20px 16px',
  gap: 1,
  borderTop: '1px solid',
  borderColor: 'divider',
} as const;

export const DlgActions: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <DialogActions sx={dlgActionSx}>{children}</DialogActions>
);

export const dlgCancelSx = { fontFamily: 'var(--font-mono)', fontSize: 11, color: 'text.primary' } as const;
export const dlgSaveSx = { fontFamily: 'var(--font-mono)', fontSize: 11, height: 36, px: 2 } as const;
