import React, { useEffect, useState } from 'react';
import { Box, Typography } from '@mui/material';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
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

export const DataPage: React.FC<{ refreshKey: number }> = ({ refreshKey }) => {
  const [stats, setStats] = useState<LocalDailyStat[]>([]);
  const [allStats, setAllStats] = useState<LocalDailyStat[]>([]);
  const [days, setDays] = useState(0);
  const [decks, setDecks] = useState<DeckRow[]>([]);
  const [forecast, setForecast] = useState<{ date: string; count: number }[]>([]);

  useEffect(() => {
    (async () => {
      const all = (await localDataSource.stats.range(9999)).filter((s) => s.studied > 0);
      setAllStats(all);
      setDays(all.length);
      // 近 14 天（含无学习记录的日期补零）
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
      setDecks(await localDataSource.library.list() as DeckRow[]);
      setForecast(await localDataSource.stats.dueForecast(14));
    })();
  }, [refreshKey]);

  // 序列按日期升序、最后一项就是今天；序列里的 date 是 MM-DD，不能直接和 YYYY-MM-DD 比
  const todayStudied = stats[stats.length - 1]?.studied ?? 0;
  const totalStudied = allStats.reduce((s, x) => s + x.studied, 0);
  const dueNow = decks.reduce((s, d) => s + d.dueRemaining, 0);

  // 连续打卡（从昨天往前推，今天学了也算今天起）
  const activeDates = new Set(allStats.map((s) => s.date));
  let streak = 0;
  {
    const d = new Date();
    if (!activeDates.has(dateKey(d))) d.setDate(d.getDate() - 1);
    while (activeDates.has(dateKey(d))) {
      streak++;
      d.setDate(d.getDate() - 1);
    }
  }

  // 近 14 天拆分为 新卡 / 复习
  const barData = stats.map((s) => ({
    date: s.date,
    新卡: s.newLearned,
    复习: Math.max(0, s.studied - s.newLearned),
  }));

  const mono = { fontFamily: 'var(--font-mono)', letterSpacing: '0.04em' } as const;

  const stats6 = [
    { label: '今日学习', en: 'TODAY', value: todayStudied, unit: '字' },
    { label: '累计学习', en: 'TOTAL', value: totalStudied, unit: '字' },
    { label: '学习天数', en: 'DAYS', value: days, unit: '天' },
    { label: '连续打卡', en: 'STREAK', value: streak, unit: '天' },
    { label: '待复习', en: 'DUE', value: dueNow, unit: '字' },
    { label: '订阅帖数', en: 'DECKS', value: decks.length, unit: '帖' },
  ];

  return (
    <Box>
      {/* 页头 */}
      <Box sx={{ pb: { xs: 1.5, md: 1.75 } }}>
        <Typography component="h1" sx={{ fontSize: { xs: 30, md: 44 }, fontWeight: 900, letterSpacing: { xs: '4px', md: '7px' }, lineHeight: 1.1 }}>
          数据
        </Typography>
        <Typography sx={{ ...mono, fontSize: 11, opacity: 0.72, mt: 1 }}>
          累计 {totalStudied} 字 · {days} 天有记录 · 连续 {streak} 天
        </Typography>
      </Box>

      {/* 六个数字 */}
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: 'repeat(3, 1fr)', md: 'repeat(6, 1fr)' },
          borderTop: '2px solid',
          borderBottom: '1px solid',
          borderColor: 'text.primary',
        }}
      >
        {stats6.map((x, i) => (
          <Box
            key={x.en}
            sx={{
              py: 1.75,
              px: { xs: 1.25, md: 1.5 },
              borderRight: { xs: i % 3 === 2 ? 0 : '1px solid', md: i === 5 ? 0 : '1px solid' },
              borderBottom: { xs: i < 3 ? '1px solid' : 0, md: 0 },
              borderColor: 'divider',
            }}
          >
            <Typography sx={{ ...mono, fontSize: 9, letterSpacing: '0.1em', opacity: 0.6 }}>
              {x.label} · {x.en}
            </Typography>
            <Typography
              sx={{
                fontSize: { xs: 26, md: 34 },
                fontWeight: 900,
                lineHeight: 1,
                letterSpacing: '-0.03em',
                mt: 0.9,
                fontVariantNumeric: 'tabular-nums',
                color: x.en === 'DUE' && x.value > 0 ? 'var(--hot-ink)' : 'inherit',
              }}
            >
              {x.value}
              <Box component="span" sx={{ fontSize: 10, fontWeight: 400, letterSpacing: 0, ml: 0.5, opacity: 0.7 }}>{x.unit}</Box>
            </Typography>
          </Box>
        ))}
      </Box>

      {/* 近 14 天 */}
      <Box sx={{ borderBottom: '1px solid', borderColor: 'text.primary', py: 1.75 }}>
        <Box sx={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', mb: 1 }}>
          <Typography sx={{ fontSize: 13, fontWeight: 900, letterSpacing: '2px' }}>近 14 天学习量</Typography>
          <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'center' }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
              <Box component="span" sx={{ width: 7, height: 7, bgcolor: 'var(--vermilion)' }} />
              <Box component="span" sx={{ ...mono, fontSize: 9.5, opacity: 0.7 }}>新卡</Box>
            </Box>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
              <Box component="span" sx={{ width: 7, height: 7, bgcolor: 'var(--ink)' }} />
              <Box component="span" sx={{ ...mono, fontSize: 9.5, opacity: 0.7 }}>复习</Box>
            </Box>
          </Box>
        </Box>
        {days === 0 ? (
          <Typography sx={{ ...mono, fontSize: 10.5, opacity: 0.55, py: 6 }}>
            NO DATA · 还没有学习记录，先去「今日」背几个字
          </Typography>
        ) : (
        <Box sx={{ height: 190 }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={barData} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
              <XAxis dataKey="date" tick={{ fontSize: 9 }} interval={2} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 9 }} axisLine={false} tickLine={false} allowDecimals={false} />
              <Tooltip
                formatter={(v: any, k: any) => [`${v} 张`, k]}
                labelStyle={{ fontSize: 12 }}
                contentStyle={{ fontSize: 12, borderRadius: 0, border: '1px solid var(--line-strong)', background: 'var(--paper)', color: 'var(--ink)' }}
              />
              <Bar dataKey="新卡" stackId="a" fill="var(--vermilion)" radius={0} />
              <Bar dataKey="复习" stackId="a" fill="var(--ink)" radius={0} />
            </BarChart>
          </ResponsiveContainer>
        </Box>
        )}
      </Box>

      {/* 到期预测 */}
      <Box sx={{ borderBottom: '1px solid', borderColor: 'text.primary', py: 1.75 }}>
        <Box sx={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', mb: 1 }}>
          <Typography sx={{ fontSize: 13, fontWeight: 900, letterSpacing: '2px' }}>未来 14 天到期</Typography>
          <Typography sx={{ ...mono, fontSize: 9.5, opacity: 0.6 }}>按 SM-2 到期时间统计</Typography>
        </Box>
        {forecast.every((f) => f.count === 0) ? (
          <Typography sx={{ ...mono, fontSize: 10.5, opacity: 0.55, py: 4 }}>
            NO DATA · 暂无到期安排
          </Typography>
        ) : (
        <Box sx={{ height: 150 }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={forecast} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
              <XAxis dataKey="date" tick={{ fontSize: 9 }} interval={2} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 9 }} axisLine={false} tickLine={false} allowDecimals={false} />
              <Tooltip
                formatter={(v: any) => [`${v} 张`, '到期']}
                labelStyle={{ fontSize: 12 }}
                contentStyle={{ fontSize: 12, borderRadius: 0, border: '1px solid var(--line-strong)', background: 'var(--paper)', color: 'var(--ink)' }}
              />
              <Bar dataKey="count" fill="var(--ink)" radius={0} />
            </BarChart>
          </ResponsiveContainer>
        </Box>
        )}
      </Box>

      {/* 按帖进度 */}
      <Box sx={{ pt: 2.5 }}>
        <Typography sx={{ fontSize: 13, fontWeight: 900, letterSpacing: '2px', pb: 0.75 }}>
          按帖进度
          <Box component="span" sx={{ ...mono, fontSize: 10.5, fontWeight: 400, letterSpacing: '0.04em', opacity: 0.65, ml: 1 }}>Decks · {decks.length}</Box>
        </Typography>

        {decks.length === 0 ? (
          <Typography sx={{ ...mono, fontSize: 11, opacity: 0.65, py: 3 }}>还没有订阅字帖</Typography>
        ) : (
          <Box sx={{ borderTop: '1px solid', borderColor: 'text.primary' }}>
            {decks.map((d) => {
              const pct = d.totalCards ? Math.round((d.learnedCount / d.totalCards) * 100) : 0;
              return (
                <Box
                  key={d.id}
                  sx={{
                    display: 'grid',
                    gridTemplateColumns: { xs: '1fr', md: 'minmax(0,1.4fr) 140px 180px' },
                    alignItems: 'center',
                    columnGap: 2,
                    rowGap: 0.75,
                    py: 1.25,
                    px: { xs: 0.5, md: 1 },
                    borderBottom: '1px solid',
                    borderColor: 'divider',
                  }}
                >
                  <Typography sx={{ fontSize: 14, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {d.name}
                  </Typography>
                  <Typography sx={{ ...mono, fontSize: 10.5, opacity: 0.7, fontVariantNumeric: 'tabular-nums' }}>
                    已学 {d.learnedCount}/{d.totalCards}
                  </Typography>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Box sx={{ flex: 1, height: 4, bgcolor: 'divider' }}>
                      <Box sx={{ width: `${pct}%`, height: '100%', bgcolor: pct >= 100 ? 'var(--vermilion)' : 'text.primary' }} />
                    </Box>
                    <Typography sx={{ ...mono, fontSize: 10.5, minWidth: 44, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                      待学 {d.newRemaining} · {pct}%
                    </Typography>
                  </Box>
                </Box>
              );
            })}
          </Box>
        )}
      </Box>

      <Typography sx={{ ...mono, fontSize: 10, opacity: 0.5, pt: 2 }}>
        数据仅存本机 · 可在设置中导出备份
      </Typography>
    </Box>
  );
};

export default DataPage;
