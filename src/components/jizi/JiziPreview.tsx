import React, { useState, useRef, useCallback } from 'react';
import { Box, Typography, useTheme } from '@mui/material';
import JiziCell from './JiziCell';
import type { JiziMatchResult, JiziLayout } from '@/types/jizi';

export interface JiziPreviewProps {
  results: JiziMatchResult[];
  selections: number[];
  layout: JiziLayout;
  onOpenPicker: (index: number) => void;
  text?: string;
}

/** 将 results 按文本换行分组（有空行时手动分行，否则按 colCount 自动分行）。
 *  返回每个 group 同时携带其在原 results 中的起始偏移，供 globalIndex 计算。 */
export function groupResults(
  results: JiziMatchResult[],
  colCount: number,
  text?: string,
): Array<{ items: JiziMatchResult[]; offset: number }> {
  if (text && /\n\s*\n/.test(text)) {
    const lines = text.split(/\n\s*\n/).filter((l) => l.trim().length > 0);
    const groups: Array<{ items: JiziMatchResult[]; offset: number }> = [];
    let offset = 0;
    for (const line of lines) {
      const chars = Array.from(line).filter((c) => /\p{Script=Han}/u.test(c));
      const items = results.slice(offset, offset + chars.length);
      if (items.length > 0) groups.push({ items, offset });
      offset += chars.length;
    }
    if (groups.length > 0) return groups;
  }
  const groups: Array<{ items: JiziMatchResult[]; offset: number }> = [];
  for (let i = 0; i < results.length; i += colCount) {
    groups.push({ items: results.slice(i, i + colCount), offset: i });
  }
  return groups;
}

interface TouchState {
  initialDistance: number;
  initialScale: number;
  initialMid: { x: number; y: number };
  initialOffset: { x: number; y: number };
}

/** 预览区 —— 无边全屏，按方向+分行渲染网格，支持双指缩放 */
const JiziPreview: React.FC<JiziPreviewProps> = ({
  results,
  selections,
  layout,
  onOpenPicker,
  text,
}) => {
  const { direction, fontSize, colCount, charGap, lineGap, background, compact } = layout;
  const theme = useTheme();
  const isDarkMode = theme.palette.mode === 'dark';

  // 双指缩放/平移
  const [transform, setTransform] = useState({ scale: 1, x: 0, y: 0 });
  const [isGesturing, setIsGesturing] = useState(false);
  const touchRef = useRef<TouchState | null>(null);
  // 单指拖拽
  const dragRef = useRef<{ startX: number; startY: number; initialX: number; initialY: number; moved: boolean } | null>(null);
  // 标记多指触控，松开后短暂抑制 click，避免误触切换弹窗
  const wasMultiTouchRef = useRef(false);

  const resetZoom = useCallback(() => {
    setTransform({ scale: 1, x: 0, y: 0 });
  }, []);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (e.touches.length === 2) {
      e.preventDefault();
      wasMultiTouchRef.current = true;
      dragRef.current = null;
      const t1 = e.touches[0];
      const t2 = e.touches[1];
      const distance = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
      const mid = {
        x: (t1.clientX + t2.clientX) / 2,
        y: (t1.clientY + t2.clientY) / 2,
      };
      touchRef.current = {
        initialDistance: distance,
        initialScale: transform.scale,
        initialMid: mid,
        initialOffset: { x: transform.x, y: transform.y },
      };
      setIsGesturing(true);
    } else if (e.touches.length === 1) {
      // 单指拖拽（不限缩放级别，始终可拖动）
      wasMultiTouchRef.current = true;
      dragRef.current = {
        startX: e.touches[0].clientX,
        startY: e.touches[0].clientY,
        initialX: transform.x,
        initialY: transform.y,
        moved: false,
      };
    }
  }, [transform]);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (e.touches.length === 2 && touchRef.current) {
      e.preventDefault();
      const t1 = e.touches[0];
      const t2 = e.touches[1];
      const distance = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
      const mid = {
        x: (t1.clientX + t2.clientX) / 2,
        y: (t1.clientY + t2.clientY) / 2,
      };
      const scaleFactor = distance / touchRef.current.initialDistance;
      const newScale = Math.max(0.5, Math.min(4, touchRef.current.initialScale * scaleFactor));
      setTransform({
        scale: newScale,
        x: touchRef.current.initialOffset.x + (mid.x - touchRef.current.initialMid.x),
        y: touchRef.current.initialOffset.y + (mid.y - touchRef.current.initialMid.y),
      });
    } else if (e.touches.length === 1 && dragRef.current) {
      e.preventDefault();
      dragRef.current.moved = true;
      const dx = e.touches[0].clientX - dragRef.current.startX;
      const dy = e.touches[0].clientY - dragRef.current.startY;
      setTransform({
        ...transform,
        x: dragRef.current.initialX + dx,
        y: dragRef.current.initialY + dy,
      });
    }
  }, [transform]);

  const handleTouchEnd = useCallback((e: React.TouchEvent) => {
    if (e.touches.length === 0) {
      setIsGesturing(false);
      touchRef.current = null;
      if (dragRef.current && !dragRef.current.moved) {
        // 单指点击（无拖拽），允许 click
        wasMultiTouchRef.current = false;
      }
      dragRef.current = null;
      setTimeout(() => { wasMultiTouchRef.current = false; }, 150);
    } else if (e.touches.length < 2) {
      touchRef.current = null;
    }
  }, []);

  const handleDoubleClick = useCallback(() => {
    resetZoom();
  }, [resetZoom]);

  // 抑制多指触控后的 click
  const handlePickSafe = useCallback((index: number) => {
    if (wasMultiTouchRef.current) return;
    onOpenPicker(index);
  }, [onOpenPicker]);

  if (results.length === 0) {
    return (
      <Box
        sx={{
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexDirection: 'column',
          color: 'text.secondary',
          pb: 10,
          gap: 1.5,
        }}
      >
        <Typography
          component="div"
          sx={{ fontFamily: '"Noto Serif SC", "楷体", KaiTi, serif', fontSize: 26, letterSpacing: 6, color: 'text.primary' }}
        >
          集字
        </Typography>
        <Typography component="div" sx={{ fontSize: 13 }}>
          输入文字后这里会显示集字预览
        </Typography>
        <Typography component="div" sx={{ fontSize: 12, color: 'text.disabled' }}>
          从已核验碑帖里取原字，可导出高清图片
        </Typography>
      </Box>
    );
  }

  const cg = compact ? 0 : Math.round(fontSize * charGap);
  const lg = compact ? 0 : Math.round(fontSize * lineGap);
  const groups = groupResults(results, colCount, text);
  const isVertical = direction.startsWith('vertical');
  const needsReversed = isVertical && direction.endsWith('rl');
  const orderedGroups = needsReversed ? [...groups].reverse() : groups;
  const horizontalRtl = !isVertical && direction.endsWith('rl');
  const alignEnd = direction.endsWith('rl');

  const bgColors: Record<string, string> = {
    default: isDarkMode ? '#1a1a1a' : '#f0f0f0',
    xuan: '#f5ecd9',
    white: '#ffffff',
    ink: '#1a1a1a',
    vermilion: '#8b0000',
  };
  const isDark = background === 'ink' || background === 'vermilion' || (background === 'default' && isDarkMode);

  return (
    <Box
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      onDoubleClick={handleDoubleClick}
      sx={{
        position: 'relative',
        height: '100%',
        width: '100%',
        overflow: 'hidden',
        bgcolor: bgColors[background] || '#ffffff',
        touchAction: 'none',
        userSelect: 'none',
        WebkitUserSelect: 'none',
        WebkitTouchCallout: 'none',
        backgroundImage:
          background === 'default'
            ? isDarkMode
              ? 'linear-gradient(135deg, #2a2a2a 0%, #1a1a1a 50%, #111111 100%)'
              : 'linear-gradient(135deg, #e8e8e8 0%, #d4d4d4 50%, #c8c8c8 100%)'
            : background === 'xuan'
            ? 'radial-gradient(ellipse at top, rgba(255,250,240,0.3), transparent 60%)'
            : 'none',
      }}
    >
      {/* 变换层：双指缩放/平移作用于内容 */}
      <Box
        sx={{
          position: 'absolute',
          inset: 0,
          p: 1,
          display: 'flex',
          flexDirection: isVertical ? 'row' : 'column',
          justifyContent: isVertical ? (alignEnd ? 'flex-end' : 'flex-start') : 'flex-start',
          alignItems: isVertical ? 'stretch' : (alignEnd ? 'flex-end' : 'flex-start'),
          transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})`,
          transformOrigin: 'center center',
          transition: isGesturing ? 'none' : 'transform 0.2s ease-out',
        }}
      >
        {orderedGroups.map((group, gi) => {
          const isLastGroup = gi === orderedGroups.length - 1;
          return (
            <Box
              key={group.offset}
              sx={{
                display: 'flex',
                flexDirection: isVertical ? 'column' : 'row',
                mr: isVertical && !isLastGroup ? lg : 0,
                mb: !isVertical && !isLastGroup ? lg : 0,
              }}
            >
              {(horizontalRtl ? [...group.items].reverse() : group.items).map((result, ii) => {
                const globalIndex = group.offset + (horizontalRtl ? group.items.length - 1 - ii : ii);
                const isLastCell = ii === group.items.length - 1;
                return (
                  <Box
                    key={globalIndex}
                    sx={{
                      mb: isVertical && !isLastCell ? cg : 0,
                      mr: !isVertical && !isLastCell ? cg : 0,
                    }}
                  >
                    <JiziCell
                      char={result.char}
                      hits={result.hits}
                      selectedIndex={selections[globalIndex] ?? 0}
                      fontSize={fontSize}
                      onOpenPicker={() => handlePickSafe(globalIndex)}
                      darkMode={isDark}
                      compact={compact}
                    />
                  </Box>
                );
              })}
            </Box>
          );
        })}
      </Box>

      {/* 缩放指示器（仅在缩放时显示） */}
      {transform.scale !== 1 && (
        <Box
          onClick={resetZoom}
          sx={{
            position: 'absolute',
            top: 12,
            right: 12,
            zIndex: 5,
            bgcolor: 'rgba(0,0,0,0.65)',
            color: '#fff',
            px: 1.5,
            py: 0.5,
            borderRadius: '2px',
            fontSize: 12,
            fontWeight: 600,
            cursor: 'pointer',
            backdropFilter: 'blur(4px)',
            userSelect: 'none',
            WebkitUserSelect: 'none',
          }}
        >
          {Math.round(transform.scale * 100)}% · 点击重置
        </Box>
      )}
    </Box>
  );
};

export default JiziPreview;
