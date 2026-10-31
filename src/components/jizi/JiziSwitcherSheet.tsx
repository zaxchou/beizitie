import React, { useState, useMemo } from 'react';
import { Drawer, Box, Typography, useMediaQuery, useTheme } from '@mui/material';
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
          maxHeight: isMobile ? '82vh' : '72vh',
          height: isMobile ? '82vh' : '72vh',
          borderTopLeftRadius: 0,
          borderTopRightRadius: 0,
          borderTop: '2px solid',
          borderColor: 'text.primary',
        },
      }}
    >
      {/* 标题栏 */}
      <Box
        sx={{
          display: 'flex',
          alignItems: 'flex-end',
          justifyContent: 'space-between',
          px: { xs: 2, md: 3 },
          pt: 1.5,
          pb: 1.25,
          position: 'sticky',
          top: 0,
          bgcolor: 'background.paper',
          zIndex: 10,
          borderBottom: '1px solid',
          borderColor: 'text.primary',
        }}
      >
        <Box sx={{ minWidth: 0 }}>
          <Typography sx={{ fontFamily: 'var(--font-mono)', fontSize: 9.5, letterSpacing: '0.14em', textTransform: 'uppercase', opacity: 0.6 }}>
            写法 · Variants
          </Typography>
          <Typography component="span" sx={{ display: 'block', fontSize: 19, fontWeight: 900, letterSpacing: '0.08em', mt: 0.5 }}>
            {result ? `「${result.char}」的 ${hits.length} 种写法` : '加载中…'}
          </Typography>
        </Box>
        <Box
          component="button"
          type="button"
          onClick={handleClose}
          aria-label="关闭"
          sx={{
            border: '1px solid',
            borderColor: 'text.primary',
            bgcolor: 'transparent',
            color: 'inherit',
            width: 28,
            height: 28,
            p: 0,
            flexShrink: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            '&:hover': { bgcolor: 'text.primary', color: 'background.default' },
          }}
        >
          <CloseIcon sx={{ fontSize: 16 }} />
        </Box>
      </Box>

      {/* 主体：左列作者筛选 + 右列内容 */}
      <Box sx={{ display: 'flex', flex: 1, minHeight: 0 }}>
        {/* 左列：作者 */}
        <Box
          sx={{
            width: isMobile ? 76 : 104,
            flexShrink: 0,
            overflowY: 'auto',
            borderRight: '1px solid',
            borderColor: 'text.primary',
          }}
        >
          {[null, ...allCalligraphers].map((name) => {
            const on = authorFilter === name;
            return (
              <Box
                key={name ?? '__all__'}
                component="button"
                type="button"
                onClick={() => setAuthorFilter(name)}
                aria-pressed={on}
                sx={{
                  display: 'block',
                  width: '100%',
                  textAlign: 'left',
                  border: 0,
                  borderBottom: '1px solid',
                  borderColor: 'divider',
                  bgcolor: on ? 'text.primary' : 'transparent',
                  color: on ? 'background.default' : 'inherit',
                  px: 1,
                  py: 0.9,
                  cursor: 'pointer',
                  fontSize: 12,
                  fontWeight: on ? 700 : 400,
                  lineHeight: 1.3,
                  wordBreak: 'break-all',
                  '&:hover': on ? {} : { backgroundColor: 'action.hover' },
                }}
              >
                {name ?? '全部'}
              </Box>
            );
          })}
        </Box>

        {/* 右列：字体筛选 + 候选字网格 */}
        <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          {allStyles.length > 0 && (
            <Box
              sx={{
                display: 'flex',
                gap: 0.75,
                px: 1.5,
                py: 1,
                borderBottom: '1px solid',
                borderColor: 'divider',
                overflowX: 'auto',
                flexShrink: 0,
              }}
            >
              {[null, ...allStyles].map((s) => {
                const on = styleFilter === s;
                return (
                  <Box
                    key={s ?? '__all__'}
                    component="button"
                    type="button"
                    onClick={() => setStyleFilter(on ? null : s)}
                    aria-pressed={on}
                    sx={{
                      border: '1px solid',
                      borderColor: on ? 'text.primary' : 'divider',
                      bgcolor: on ? 'text.primary' : 'transparent',
                      color: on ? 'background.default' : 'inherit',
                      fontFamily: 'var(--font-mono)',
                      fontSize: 11,
                      height: 26,
                      px: 1,
                      cursor: 'pointer',
                      whiteSpace: 'nowrap',
                      flexShrink: 0,
                      '&:hover': on ? {} : { borderColor: 'text.primary' },
                    }}
                  >
                    {s ?? '全部字体'}
                  </Box>
                );
              })}
            </Box>
          )}

          <Box sx={{ flex: 1, overflowY: 'auto', px: { xs: 1.5, md: 2 }, py: 1.25 }}>
            {grouped.length === 0 ? (
              <Typography sx={{ fontFamily: 'var(--font-mono)', fontSize: 11, opacity: 0.6, textAlign: 'center', py: 6 }}>
                无匹配结果
              </Typography>
            ) : (
              grouped.map((group) => (
                <Box key={`${group.style}|${group.calligrapher}`} sx={{ mb: 2.25 }}>
                  <Typography
                    sx={{
                      display: 'block',
                      mb: 0.9,
                      pb: 0.6,
                      borderBottom: '1px solid',
                      borderColor: 'divider',
                      fontSize: 12,
                    }}
                  >
                    <Box component="span" sx={{ fontWeight: 900, mr: 0.75 }}>{group.style}</Box>
                    <Box component="span" sx={{ fontFamily: 'var(--font-mono)', fontSize: 10, opacity: 0.6 }}>
                      {group.calligrapher} · {group.deck_name}
                    </Box>
                  </Typography>

                  <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'repeat(3, 1fr)', md: 'repeat(5, 1fr)' }, gap: 0.75 }}>
                    {group.entries.map(({ hit, index: i }) => {
                      const isSelected = i === selectedIndex;
                      return (
                        <Box
                          key={hit.card_id}
                          component="button"
                          type="button"
                          onClick={() => onPick(i)}
                          aria-pressed={isSelected}
                          sx={{
                            cursor: 'pointer',
                            border: isSelected ? '2px solid' : '1px solid',
                            borderColor: isSelected ? 'var(--hot-ink)' : 'divider',
                            bgcolor: 'background.paper',
                            p: 0.5,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            '&:hover': { borderColor: isSelected ? 'var(--hot-ink)' : 'text.primary' },
                          }}
                        >
                          <Box
                            component="img"
                            src={getImageUrl(hit.image_url)}
                            alt={hit.front_text_raw}
                            sx={{ width: '100%', aspectRatio: '1', objectFit: 'contain' }}
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
