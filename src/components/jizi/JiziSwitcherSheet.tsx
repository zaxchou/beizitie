import React, { useState, useMemo } from 'react';
import {
  Drawer,
  Box,
  Typography,
  Chip,
  IconButton,
  useMediaQuery,
  useTheme,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import { getImageUrl } from '@/lib/api';
import type { JiziMatchResult } from '@/types/jizi';

export interface JiziSwitcherSheetProps {
  open: boolean;
  result: JiziMatchResult | null;
  selectedIndex: number;
  onPick: (index: number) => void;
  onClose: () => void;
}

/** 底部 Sheet —— 左列作者筛选 + 右列字体筛选 + 候选字网格 */
const JiziSwitcherSheet: React.FC<JiziSwitcherSheetProps> = ({
  open,
  result,
  selectedIndex,
  onPick,
  onClose,
}) => {
  const hits = result?.hits ?? [];
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));

  // 所有不重复的作者和字体
  const { allCalligraphers, allStyles } = useMemo(() => {
    const cSet = new Set<string>();
    const sSet = new Set<string>();
    hits.forEach((h) => {
      cSet.add(h.calligrapher || '佚名');
      if (h.style) {
        h.style.split(',').filter(Boolean).forEach((s) => sSet.add(s.trim()));
      }
    });
    return { allCalligraphers: Array.from(cSet), allStyles: Array.from(sSet).sort() };
  }, [hits]);

  // 当前筛选状态
  const [authorFilter, setAuthorFilter] = useState<string | null>(null);
  const [styleFilter, setStyleFilter] = useState<string | null>(null);

  // 关闭时重置筛选
  const handleClose = () => {
    setAuthorFilter(null);
    setStyleFilter(null);
    onClose();
  };

  // 筛选后的 hits 及其对应的原始索引
  const filteredEntries = useMemo(() => {
    return hits
      .map((h, i) => ({ hit: h, index: i }))
      .filter(({ hit }) => {
        if (authorFilter && (hit.calligrapher || '佚名') !== authorFilter) return false;
        if (styleFilter) {
          const styles = hit.style ? hit.style.split(',').map((s) => s.trim()) : [];
          if (!styles.includes(styleFilter)) return false;
        }
        return true;
      });
  }, [hits, authorFilter, styleFilter]);

  // 筛选后按 (style, calligrapher) 分组
  const grouped = useMemo(() => {
    const map = new Map<string, { calligrapher: string; deck_name: string; entries: typeof filteredEntries }>();
    for (const entry of filteredEntries) {
      const key = `${entry.hit.style || '未分类'}|${entry.hit.calligrapher || '佚名'}`;
      if (!map.has(key)) {
        map.set(key, {
          calligrapher: entry.hit.calligrapher || '佚名',
          deck_name: entry.hit.deck_name,
          entries: [],
        });
      }
      map.get(key)!.entries.push(entry);
    }
    return Array.from(map.entries()).map(([k, v]) => ({
      style: k.split('|')[0],
      ...v,
    }));
  }, [filteredEntries]);

  return (
    <Drawer
      anchor="bottom"
      open={open}
      onClose={handleClose}
      PaperProps={{
        sx: {
          maxHeight: isMobile ? '80vh' : '70vh',
          height: isMobile ? '80vh' : '70vh',
          borderTopLeftRadius: 16,
          borderTopRightRadius: 16,
        },
      }}
    >
      {/* 标题栏 */}
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          px: 2,
          py: 1.5,
          position: 'sticky',
          top: 0,
          bgcolor: 'background.paper',
          zIndex: 10,
          borderBottom: 1,
          borderColor: 'divider',
        }}
      >
        <Typography variant="h6" component="span" sx={{ fontWeight: 600, fontSize: 16 }}>
          {result ? `「${result.char}」的 ${hits.length} 种写法` : '加载中...'}
        </Typography>
        <IconButton onClick={handleClose} size="small" edge="end">
          <CloseIcon />
        </IconButton>
      </Box>

      {/* 主体：左列作者筛选 + 右列内容 */}
      <Box sx={{ display: 'flex', flex: 1, minHeight: 0 }}>
        {/* ===== 左列：作者筛选 ===== */}
        <Box
          sx={{
            width: isMobile ? 72 : 90,
            flexShrink: 0,
            overflowY: 'auto',
            borderRight: 1,
            borderColor: 'divider',
            bgcolor: 'action.hover',
            py: 1,
          }}
        >
          {/* 全部（清除作者筛选） */}
          <Box
            onClick={() => setAuthorFilter(null)}
            sx={{
              px: 1,
              py: 0.75,
              fontSize: 12,
              fontWeight: authorFilter === null ? 700 : 400,
              color: authorFilter === null ? 'primary.main' : 'text.secondary',
              cursor: 'pointer',
              borderBottom: 1,
              borderColor: 'divider',
              bgcolor: authorFilter === null ? 'action.selected' : 'transparent',
              '&:hover': { bgcolor: 'action.hover' },
            }}
          >
            全部
          </Box>
          {allCalligraphers.map((name) => (
            <Box
              key={name}
              onClick={() => setAuthorFilter(authorFilter === name ? null : name)}
              sx={{
                px: 1,
                py: 0.75,
                fontSize: 12,
                fontWeight: authorFilter === name ? 700 : 400,
                color: authorFilter === name ? 'primary.main' : 'text.secondary',
                cursor: 'pointer',
                borderBottom: 1,
                borderColor: 'divider',
                bgcolor: authorFilter === name ? 'action.selected' : 'transparent',
                lineHeight: 1.3,
                wordBreak: 'break-all',
                '&:hover': { bgcolor: 'action.hover' },
              }}
            >
              {name}
            </Box>
          ))}
        </Box>

        {/* ===== 右列：字体筛选 + 候选字网格 ===== */}
        <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          {/* 字体筛选标签栏 */}
          {allStyles.length > 0 && (
            <Box
              sx={{
                display: 'flex',
                gap: 0.5,
                px: 1.5,
                py: 1,
                borderBottom: 1,
                borderColor: 'divider',
                overflowX: 'auto',
                flexShrink: 0,
              }}
            >
              <Chip
                label="全部字体"
                size="small"
                variant={styleFilter === null ? 'filled' : 'outlined'}
                color={styleFilter === null ? 'primary' : 'default'}
                onClick={() => setStyleFilter(null)}
                sx={{ fontSize: 11, height: 24 }}
              />
              {allStyles.map((s) => (
                <Chip
                  key={s}
                  label={s}
                  size="small"
                  variant={styleFilter === s ? 'filled' : 'outlined'}
                  color={styleFilter === s ? 'primary' : 'default'}
                  onClick={() => setStyleFilter(styleFilter === s ? null : s)}
                  sx={{ fontSize: 11, height: 24 }}
                />
              ))}
            </Box>
          )}

          {/* 候选字网格 */}
          <Box sx={{ flex: 1, overflowY: 'auto', px: 1.5, py: 1 }}>
            {grouped.length === 0 ? (
              <Typography variant="body2" color="text.secondary" sx={{ textAlign: 'center', py: 6 }}>
                无匹配结果
              </Typography>
            ) : (
              grouped.map((group) => (
                <Box key={`${group.style}|${group.calligrapher}`} sx={{ mb: 2 }}>
                  {/* 分组标题：字体 + 书家 */}
                  <Typography
                    variant="caption"
                    sx={{ fontSize: 11, fontWeight: 500, color: 'text.secondary', display: 'block', mb: 0.75 }}
                  >
                    <Box component="span" sx={{ color: 'primary.main', fontWeight: 600 }}>{group.style}</Box>
                    {' · '}{group.calligrapher}{' · '}{group.deck_name}
                  </Typography>

                  {/* 一行 3 个 */}
                  <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 1 }}>
                    {group.entries.map(({ hit, index: i }) => {
                      const isSelected = i === selectedIndex;
                      return (
                        <Box
                          key={hit.card_id}
                          onClick={() => onPick(i)}
                          sx={{
                            cursor: 'pointer',
                            border: isSelected ? 2 : 0,
                            borderColor: 'primary.main',
                            borderRadius: '2px',
                            p: 0.75,
                            bgcolor: isSelected ? 'action.selected' : 'background.paper',
                            boxShadow: (t) => t.palette.mode === 'dark' ? '0px 0px 0px 1px rgba(255,255,255,0.12)' : '0px 0px 0px 1px rgba(0,0,0,0.08)',
                            transition: 'all 0.12s',
                            '&:hover': { borderColor: 'primary.light' },
                          }}
                        >
                          <Box
                            component="img"
                            src={getImageUrl(hit.image_url)}
                            alt={hit.front_text_raw}
                            sx={{
                              width: '100%',
                              aspectRatio: '1',
                              objectFit: 'contain',
                              bgcolor: '#fafafa',
                              borderRadius: '2px',
                            }}
                            draggable={false}
                          />
                        </Box>
                      );
                    })}
                  </Box>
                </Box>
              ))
            )}
          </Box>
        </Box>
      </Box>
    </Drawer>
  );
};

export default JiziSwitcherSheet;
