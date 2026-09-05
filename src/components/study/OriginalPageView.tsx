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
  const [failed, setFailed] = useState(false);
  // 整页图走馆方 IIIF（有并发限流 403/429）：失败给明确提示，避免整块黑图无解释
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
        {failed ? (
          <Box sx={{ py: 6, textAlign: 'center', bgcolor: '#211d18', borderRadius: 1 }}>
            <Typography sx={{ color: '#f4eee0', mb: 0.5 }}>整页原拓加载失败</Typography>
            <Typography variant="caption" sx={{ color: 'rgba(244,238,224,0.6)' }}>
              图片源（上海图书馆 IIIF）可能限流，请稍后重试
            </Typography>
          </Box>
        ) : (
        <Box sx={{ position: 'relative', borderRadius: 1, overflow: 'hidden', bgcolor: '#211d18' }}>
          <Box
            component="img"
            src={context.p}
            alt="整页原拓"
            onLoad={(e) => {
              const t = e.currentTarget;
              setNatural({ w: t.naturalWidth, h: t.naturalHeight });
            }}
            onError={() => setFailed(true)}
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
        )}
        <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
          字在帖中 —— 该字在整卷拓片中的位置。看行气、看章法，理解单字在原帖中的姿态。
        </Typography>
      </DialogContent>
    </Dialog>
  );
};

export default OriginalPageView;
