import React, { useMemo, useState, useCallback } from 'react';
import { Box, Typography, useTheme } from '@mui/material';

export interface ActivityDay { date: string; cards_studied: number; new_cards_learned: number; }
export interface ActivityCalendarProps { data: ActivityDay[]; weeks?: number; /** 紧凑模式：去掉月份/星期/图例文字 */ compact?: boolean; }

function getLevel(c: number) { if (c === 0) return 0; if (c < 5) return 1; if (c < 15) return 2; if (c < 30) return 3; return 4; }
// 学习量热力图：0 级用纸色，1–4 级走朱红由浅到深（不再是蓝色梯度）
function getColor(lv: number, d: boolean) { return d ? ['#2a261f','#4a2f27','#6b3b2e','#955143','#c46a58'][lv] : ['#ece4d8','#e2cbc0','#cf9d8d','#b2705d','#8b3a30'][lv]; }
function fmt(d: Date) { return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }

const DAY = ['一','','三','','五','','日'];
const MO = ['1月','2月','3月','4月','5月','6月','7月','8月','9月','10月','11月','12月'];

const ActivityCalendar: React.FC<ActivityCalendarProps> = ({ data, weeks = 13, compact = false }) => {
  const theme = useTheme(); const dark = theme.palette.mode === 'dark';
  const [tip, setTip] = useState<string | null>(null);

  const { grid, ml } = useMemo(() => {
    const m = new Map<string, ActivityDay>(); data.forEach(d => m.set(d.date, d));
    const today = new Date();
    const end = new Date(today); end.setDate(end.getDate() + ((13 - end.getDay()) % 7));
    const start = new Date(end); start.setDate(start.getDate() - (weeks - 1) * 7 - 6);

    const ml: number[] = new Array(weeks).fill(-1);
    const grid: { d: string; c: number; n: number; l: number; t: boolean }[][] = [];
    let cur = new Date(start), lastM = -1;
    for (let w = 0; w < weeks; w++) {
      const col: typeof grid[number] = [];
      for (let day = 0; day < 7; day++) {
        const ds = fmt(cur);
        const it = m.get(ds); const cnt = it?.cards_studied ?? 0;
        col.push({ d: ds, c: cnt, n: it?.new_cards_learned ?? 0, l: getLevel(cnt), t: ds === fmt(today) });
        if (day === 0 && cur.getMonth() !== lastM) { ml[w] = cur.getMonth(); lastM = cur.getMonth(); }
        cur = new Date(cur); cur.setDate(cur.getDate() + 1);
      }
      grid.push(col);
    }
    return { grid, ml };
  }, [data, weeks]);

  const onHover = useCallback((cell: typeof grid[number][number]) => {
    setTip(`${cell.d}\n${cell.c} 张复习 · ${cell.n} 张学新`);
  }, []);

  return (
    <Box sx={{ width: '100%', position: 'relative' }}>
      {/* 月份标签（紧凑模式隐藏） */}
      {!compact && (
        <Box sx={{ display: 'flex', ml: '28px', mb: '4px', height: '14px', position: 'relative' }}>
          {ml.map((m, i) => m >= 0 ? (
            <Typography key={i} variant="caption" sx={{ position: 'absolute', left: `calc(${i} * (100% / ${weeks}))`, fontSize: '10px', color: 'text.secondary' }}>
              {MO[m]}
            </Typography>
          ) : null)}
        </Box>
      )}

      <Box sx={{ display: 'flex' }}>
        {/* 星期标签（紧凑模式隐藏） */}
        {!compact && (
          <Box sx={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between', mr: '4px', pt: '2px', width: '24px' }}>
            {DAY.map((l, i) => <Box key={i} sx={{ height: '14px', fontSize: '10px', color: 'text.secondary', lineHeight: '14px', textAlign: 'center' }}>{l}</Box>)}
          </Box>
        )}

        {/* 格子 */}
        <Box sx={{ display: 'flex', gap: '4px', flex: 1 }}>
          {grid.map((col, w) => (
            <Box key={w} sx={{ display: 'flex', flexDirection: 'column', gap: '4px', flex: 1 }}>
              {col.map((cell, d) => (
                <Box
                  key={d}
                  sx={{
                    width: '100%', aspectRatio: '1', borderRadius: '4px',
                    bgcolor: getColor(cell.l, dark),
                    outline: cell.t ? '2px solid' : 'none', outlineColor: 'primary.main',
                    cursor: 'pointer', transition: 'transform .1s',
                    '&:hover': { transform: 'scale(1.3)', zIndex: 1 },
                  }}
                  onMouseEnter={() => onHover(cell)}
                  onMouseLeave={() => setTip(null)}
                />
              ))}
            </Box>
          ))}
        </Box>
      </Box>

      {/* 图例（紧凑模式隐藏） */}
      {!compact && (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: '4px', mt: '8px', justifyContent: 'flex-end' }}>
          <Typography variant="caption" sx={{ fontSize: '10px', color: 'text.secondary' }}>少</Typography>
          {[0,1,2,3,4].map(lv => <Box key={lv} sx={{ width: 12, height: 12, borderRadius: '2px', bgcolor: getColor(lv, dark) }} />)}
          <Typography variant="caption" sx={{ fontSize: '10px', color: 'text.secondary' }}>多</Typography>
        </Box>
      )}

      {/* 轻量 tooltip */}
      {tip && (
        <Typography
          sx={{
            position: 'fixed', bottom: 40, left: '50%', transform: 'translateX(-50%)',
            bgcolor: dark ? '#333' : '#fff', color: 'text.primary',
            px: 2, py: 0.5, borderRadius: '2px', fontSize: '12px', whiteSpace: 'pre-line',
            boxShadow: 2, zIndex: 10, pointerEvents: 'none',
          }}
        >{tip}</Typography>
      )}
    </Box>
  );
};

export default React.memo(ActivityCalendar);
