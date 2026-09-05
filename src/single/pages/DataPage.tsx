import React, { useEffect, useState } from 'react';
import { Box, Typography, Card, CardContent, LinearProgress } from '@mui/material';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend } from 'recharts';
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
  const [days, setDays] = useState(0);
  const [decks, setDecks] = useState<DeckRow[]>([]);
  const [forecast, setForecast] = useState<{ date: string; count: number }[]>([]);

  useEffect(() => {
    (async () => {
      const all = (await localDataSource.stats.range(9999)).filter((s) => s.studied > 0);
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

  const todayKey = dateKey(new Date());
  const todayStudied = stats.find((s) => s.date === todayKey)?.studied ?? stats[stats.length - 1]?.studied ?? 0;
  const totalStudied = stats.reduce((s, x) => s + x.studied, 0);
  const dueNow = decks.reduce((s, d) => s + d.dueRemaining, 0);

  // 连续打卡（从昨天往前推，今天学了也算今天起）
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

  // 近 14 天拆分为 新卡 / 复习
  const barData = stats.map((s) => ({
    date: s.date,
    新卡: s.newLearned,
    复习: Math.max(0, s.studied - s.newLearned),
  }));

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
          { label: '订阅帖数', value: decks.length, unit: '帖' },
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
          <Typography sx={{ fontWeight: 600, mb: 1.5, fontSize: 14 }}>近 14 天学习量（新卡 / 复习）</Typography>
          <Box sx={{ height: 200 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={barData} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
                <XAxis dataKey="date" tick={{ fontSize: 9 }} interval={2} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 9 }} axisLine={false} tickLine={false} allowDecimals={false} />
                <Tooltip
                  formatter={(v: any, k: any) => [`${v} 张`, k]}
                  labelStyle={{ fontSize: 12 }}
                  contentStyle={{ fontSize: 12, borderRadius: 8 }}
                />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="新卡" stackId="a" fill="#1976d2" radius={[0, 0, 0, 0]} />
                <Bar dataKey="复习" stackId="a" fill="#9c27b0" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </Box>
        </CardContent>
      </Card>

      <Card variant="outlined" sx={{ borderRadius: 2 }}>
        <CardContent>
          <Typography sx={{ fontWeight: 600, mb: 1.5, fontSize: 14 }}>未来 14 天到期预测</Typography>
          <Box sx={{ height: 160 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={forecast} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
                <XAxis dataKey="date" tick={{ fontSize: 9 }} interval={2} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 9 }} axisLine={false} tickLine={false} allowDecimals={false} />
                <Tooltip
                  formatter={(v: any) => [`${v} 张`, '到期']}
                  labelStyle={{ fontSize: 12 }}
                  contentStyle={{ fontSize: 12, borderRadius: 8 }}
                />
                <Bar dataKey="count" fill="#ed6c02" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </Box>
          <Typography variant="caption" color="text.secondary">
            按 SM-2 计划的到期时间统计，可据此安排每日复习量
          </Typography>
        </CardContent>
      </Card>

      <Card variant="outlined" sx={{ borderRadius: 2 }}>
        <CardContent>
          <Typography sx={{ fontWeight: 600, mb: 1.5, fontSize: 14 }}>按帖进度</Typography>
          {decks.length === 0 ? (
            <Typography variant="body2" color="text.secondary">还没有订阅字帖</Typography>
          ) : (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
              {decks.map((d) => {
                const pct = d.totalCards ? Math.round((d.learnedCount / d.totalCards) * 100) : 0;
                return (
                  <Box key={d.id}>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.4 }}>
                      <Typography variant="body2" noWrap sx={{ maxWidth: '65%' }}>{d.name}</Typography>
                      <Typography variant="caption" color="text.secondary">
                        已学 {d.learnedCount}/{d.totalCards} · 待学 {d.newRemaining} · 待复习 {d.dueRemaining}
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
        数据仅存本机 · 可在设置中导出备份
      </Typography>
    </Box>
  );
};

export default DataPage;
