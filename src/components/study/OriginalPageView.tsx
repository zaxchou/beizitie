/**
 * 字在帖中：整页原拓 + 该字坐标高亮（馆方来源帖专属）。
 * 市场详情弹窗与学习翻卡共用；坐标对应整页原始尺寸，按百分比定位。
 */
import React, { useState } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  Typography,
  IconButton,
  Box,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import type { CardContext } from '@/types';

export interface OriginalPageViewProps {
  char: string;
  context: CardContext;
  onClose: () => void;
}

const OriginalPageView: React.FC<OriginalPageViewProps> = ({ char, context, onClose }) => {
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  return (
    <Dialog open onClose={onClose} maxWidth="lg" fullWidth PaperProps={{ sx: { borderRadius: 2 } }}>
      <DialogTitle sx={{ pb: 1, display: 'flex', alignItems: 'baseline', gap: 1.5 }}>
        <Typography component="span" className="font-kai" sx={{ fontSize: 30, fontWeight: 700, lineHeight: 1 }}>
          {char}
        </Typography>
        {context.s && (
          <Typography component="span" variant="body2" color="text.secondary" noWrap sx={{ flex: 1 }}>
            「{context.s}」
          </Typography>
        )}
        <IconButton size="small" onClick={onClose} edge="end" aria-label="关闭">
          <CloseIcon />
        </IconButton>
      </DialogTitle>
      <DialogContent sx={{ px: 2, pb: 2 }}>
        <Box sx={{ position: 'relative', borderRadius: 1, overflow: 'hidden', bgcolor: '#211d18' }}>
          <Box
            component="img"
            src={context.p}
            alt="整页原拓"
            onLoad={(e) => {
              const t = e.currentTarget;
              setNatural({ w: t.naturalWidth, h: t.naturalHeight });
            }}
            sx={{ width: '100%', display: 'block' }}
          />
          {natural && (
            <Box
              sx={{
                position: 'absolute',
                left: `${(context.x / natural.w) * 100}%`,
                top: `${(context.y / natural.h) * 100}%`,
                width: `${(context.w / natural.w) * 100}%`,
                height: `${(context.h / natural.h) * 100}%`,
                border: '2px solid #e0b25f',
                borderRadius: 0.5,
                boxSizing: 'border-box',
                boxShadow: '0 0 0 9999px rgba(0,0,0,0.42)',
              }}
            />
          )}
        </Box>
        <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
          字在帖中 —— 该字在整卷拓片中的位置。看行气、看章法，理解单字在原帖中的姿态。
        </Typography>
      </DialogContent>
    </Dialog>
  );
};

export default OriginalPageView;
