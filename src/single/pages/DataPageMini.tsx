import React, { useEffect, useState } from 'react';
import { Box, Typography, Card, CardContent, LinearProgress } from '@mui/material';
import { localDataSource } from '@/data/local/localAdapter';
import type { LocalDailyStat } from '@/core/types';

type DeckRow = {
  id: string;
  name: string;
  totalCards: number;
  learnedCount: number;
  newRemaining: number;
  dueRemaining: number;
};

const dateKey = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/**
 * 离线版学习数据：手写简易图表（不引 recharts，控体积、兼容 Chrome 61 基线）
 */
export const DataPageMini: React.FC<{ refreshKey: number }> = ({ refreshKey }) => {
  const [stats, setStats] = useState<LocalDailyStat[]>([]);
  const [days, setDays] = useState(0);
  const [decks, setDecks] = useState<DeckRow[]>([]);

  useEffect(() => {
    (async () => {
      const all = (await localDataSource.stats.range(9999)).filter((s) => s.studied > 0);
      setDays(all.length);
      const map = new Map(all.map((s) => [s.date, s]));
      const series: LocalDailyStat[] = [];
      for (let i = 13; i >= 0; i--) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        const key = dateKey(d);
        const hit = map.get(key);
        series.push({ date: key.slice(5), studied: hit?.studied ?? 0, newLearned: hit?.newLearned ?? 0 });
      }
      setStats(series);
      setDecks((await localDataSource.library.list()) as DeckRow[]);
    })();
  }, [refreshKey]);

  const todayKey = dateKey(new Date());
  const todayStudied = stats.find((s) => s.date === todayKey)?.studied ?? stats[stats.length - 1]?.studied ?? 0;
  const totalStudied = stats.reduce((s, x) => s + x.studied, 0);
  const dueNow = decks.reduce((s, d) => s + d.dueRemaining, 0);
  const maxStudied = Math.max(1, ...stats.map((s) => s.studied));

  const activeDates = new Set(stats.filter((s) => s.studied > 0).map((s) => s.date));
  let streak = 0;
  {
    const d = new Date();
    if (!activeDates.has(dateKey(d))) d.setDate(d.getDate() - 1);
    while (activeDates.has(dateKey(d))) {
      streak++;
      d.setDate(d.getDate() - 1);
    }
  }

  return (
    <Box className="space-y-3">
      <Typography className="font-kai" sx={{ fontSize: 20, fontWeight: 700 }}>学习数据</Typography>

      <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 1 }}>
        {[
          { label: '今日学习', value: todayStudied, unit: '张' },
          { label: '累计学习', value: totalStudied, unit: '张' },
          { label: '学习天数', value: days, unit: '天' },
          { label: '连续打卡', value: streak, unit: '天' },
          { label: '待复习', value: dueNow, unit: '张' },
          { label: '我的字帖', value: decks.length, unit: '帖' },
        ].map((x) => (
          <Box
            key={x.label}
            sx={{
              p: 1.2, borderRadius: 2, textAlign: 'center', bgcolor: 'background.paper',
              boxShadow: '0px 0px 0px 1px rgba(0,0,0,0.08), 0px 1px 2px rgba(0,0,0,0.06)',
            }}
          >
            <Typography sx={{ fontSize: 22, fontWeight: 700, lineHeight: 1.2 }}>
              {x.value}
              <Typography component="span" variant="caption" color="text.secondary" sx={{ ml: 0.3 }}>
                {x.unit}
              </Typography>
            </Typography>
            <Typography variant="caption" color="text.secondary" sx={{ fontSize: 11 }}>
              {x.label}
            </Typography>
          </Box>
        ))}
      </Box>

      <Card variant="outlined" sx={{ borderRadius: 2 }}>
        <CardContent>
          <Typography sx={{ fontWeight: 600, mb: 1.5, fontSize: 14 }}>近 14 天学习量</Typography>
          <Box sx={{ display: 'flex', alignItems: 'flex-end', height: 120, mx: 0.5 }}>
            {stats.map((s) => (
              <Box key={s.date} sx={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                <Box
                  sx={{
                    width: '62%', borderRadius: '3px 3px 0 0', bgcolor: s.studied ? 'primary.main' : 'divider',
                    height: `${(s.studied / maxStudied) * 92 + (s.studied ? 4 : 2)}px`,
                  }}
                />
              </Box>
            ))}
          </Box>
          <Box sx={{ display: 'flex', mx: 0.5 }}>
            {stats.map((s) => (
              <Typography key={s.date} sx={{ flex: 1, fontSize: 8, textAlign: 'center', color: 'text.secondary' }}>
                {s.date.slice(3)}
              </Typography>
            ))}
          </Box>
        </CardContent>
      </Card>

      <Card variant="outlined" sx={{ borderRadius: 2 }}>
        <CardContent>
          <Typography sx={{ fontWeight: 600, mb: 1.5, fontSize: 14 }}>按帖进度</Typography>
          {decks.length === 0 ? (
            <Typography variant="body2" color="text.secondary">还没有字帖</Typography>
          ) : (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
              {decks.map((d) => {
                const pct = d.totalCards ? Math.round((d.learnedCount / d.totalCards) * 100) : 0;
                return (
                  <Box key={d.id}>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.4 }}>
                      <Typography variant="body2" noWrap sx={{ maxWidth: '65%' }}>{d.name}</Typography>
                      <Typography variant="caption" color="text.secondary">
                        已学 {d.learnedCount}/{d.totalCards} · 待复习 {d.dueRemaining}
                      </Typography>
                    </Box>
                    <LinearProgress
                      variant="determinate"
                      value={pct}
                      sx={{ height: 7, borderRadius: 3 }}
                      color={pct >= 100 ? 'success' : 'primary'}
                    />
                  </Box>
                );
              })}
            </Box>
          )}
        </CardContent>
      </Card>

      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', textAlign: 'center' }}>
        进度保存在本机 · 清理应用数据可能丢失
      </Typography>
    </Box>
  );
};

export default DataPageMini;
