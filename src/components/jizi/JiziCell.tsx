import React from 'react';
import { Box, Typography } from '@mui/material';
import { getImageUrl } from '@/lib/api';
import type { CharHit } from '@/types/jizi';

export interface JiziCellProps {
  char: string;
  hits: CharHit[];
  selectedIndex: number;
  fontSize: number;
  onOpenPicker: () => void;
  darkMode?: boolean;
  compact?: boolean;
}

/** 单字单元 —— 显示图片 + 来源标注（书家/字帖），点击弹窗选择写法 */
const JiziCell: React.FC<JiziCellProps> = ({
  char,
  hits,
  selectedIndex,
  fontSize,
  onOpenPicker,
  darkMode,
  compact,
}) => {
  const safeIndex = hits.length > 0 ? Math.min(Math.max(0, selectedIndex), hits.length - 1) : 0;
  const current = hits.length > 0 ? hits[safeIndex] : null;

  const textColor = darkMode ? 'rgba(255,255,255,0.9)' : 'rgba(0,0,0,0.85)';
  const subColor = darkMode ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.55)';
  const badgeColor = darkMode ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.4)';
  const badgeBg = darkMode ? 'rgba(0,0,0,0.5)' : 'rgba(255,255,255,0.7)';
  const emptyBg = darkMode ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.02)';
  const missingColor = darkMode ? 'rgba(255,255,255,0.3)' : 'rgba(0,0,0,0.25)';
  const borderColor = darkMode ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.12)';

  return (
    <Box
      sx={{
        width: fontSize,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        userSelect: 'none',
        WebkitUserSelect: 'none',
        WebkitTouchCallout: 'none',
      }}
    >
      {/* 字图区域 */}
      <Box
        sx={{
          width: fontSize,
          height: fontSize,
          position: 'relative',
          cursor: hits.length > 0 ? 'pointer' : 'default',
          bgcolor: current ? 'transparent' : emptyBg,
          border: current ? 'none' : '1px dashed',
          borderColor: borderColor,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden',
        }}
        onClick={() => { if (hits.length > 0) onOpenPicker(); }}
      >
        {current ? (
          <Box
            component="img"
            src={getImageUrl(current.image_url)}
            alt={char}
            sx={{
              maxWidth: '100%',
              maxHeight: '100%',
              objectFit: 'contain',
            }}
            draggable={false}
          />
        ) : (
          <Typography
            sx={{
              fontSize: fontSize * 0.4,
              color: missingColor,
              fontFamily: 'serif',
            }}
          >
            {char}
          </Typography>
        )}

        {/* 角标：n/N */}
        {hits.length > 1 && (
          <Typography
            sx={{
              position: 'absolute',
              bottom: 1,
              right: 2,
              fontSize: 9,
              color: badgeColor,
              bgcolor: badgeBg,
              px: 0.3,
              borderRadius: '2px',
              lineHeight: 1.2,
              pointerEvents: 'none',
            }}
          >
            {safeIndex + 1}/{hits.length}
          </Typography>
        )}
      </Box>

      {/* 来源标注：字 + 书家 + 字帖（紧凑模式隐藏） */}
      {current && !compact && (
        <Box
          sx={{
            width: '100%',
            mt: 0.25,
            display: 'flex',
            borderTop: 1,
            borderColor: darkMode ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)',
            lineHeight: 1.2,
          }}
        >
          {/* 左列：字本身 30% */}
          <Box
            sx={{
              width: '30%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              borderRight: 1,
              borderColor: darkMode ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)',
              py: 0.4,
            }}
          >
            <Typography
              sx={{
                fontSize: Math.max(16, fontSize * 0.22),
                color: textColor,
                fontFamily: 'serif',
                fontWeight: 500,
                lineHeight: 1,
              }}
            >
              {char}
            </Typography>
          </Box>
          {/* 右列：书家 + 字帖 两行 */}
          <Box
            sx={{
              width: '70%',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'center',
              py: 0.3,
              px: 0.5,
              overflow: 'hidden',
            }}
          >
            <Typography
              sx={{
                fontSize: Math.max(9, fontSize * 0.085),
                color: textColor,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                lineHeight: 1.2,
              }}
            >
              {current.calligrapher || '佚名'}
            </Typography>
            <Typography
              sx={{
                fontSize: Math.max(8, fontSize * 0.07),
                color: subColor,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                lineHeight: 1.2,
                mt: 0.1,
              }}
            >
              {current.deck_name}
            </Typography>
          </Box>
        </Box>
      )}
    </Box>
  );
};

export default JiziCell;
