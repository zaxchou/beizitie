import React, { useEffect, useState } from 'react';
import { Box, Typography, Card, CardContent } from '@mui/material';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { localDataSource } from '@/data/local/localAdapter';
import type { LocalDailyStat } from '@/core/types';

export const DataPage: React.FC<{ refreshKey: number }> = ({ refreshKey }) => {
  const [stats, setStats] = useState<LocalDailyStat[]>([]);
  const [days, setDays] = useState(0);

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
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        const hit = map.get(key);
        series.push({ date: key.slice(5), studied: hit?.studied ?? 0, newLearned: hit?.newLearned ?? 0 });
      }
      setStats(series);
    })();
  }, [refreshKey]);

  const totalStudied = stats.reduce((s, x) => s + x.studied, 0);

  return (
    <Box className="space-y-3">
      <Typography className="font-kai" sx={{ fontSize: 20, fontWeight: 700 }}>学习数据</Typography>

      <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 1 }}>
        {[
          { label: '累计学习', value: stats.reduce((s, x) => s + x.studied, 0), unit: '张' },
          { label: '学习天数', value: days, unit: '天' },
          { label: '近 14 天', value: totalStudied, unit: '张' },
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
          <Box sx={{ height: 200 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={stats} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
                <XAxis dataKey="date" tick={{ fontSize: 9 }} interval={2} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 9 }} axisLine={false} tickLine={false} allowDecimals={false} />
                <Tooltip
                  formatter={(v: any) => [`${v} 张`, '学习量']}
                  labelStyle={{ fontSize: 12 }}
                  contentStyle={{ fontSize: 12, borderRadius: 8 }}
                />
                <Bar dataKey="studied" fill="#1976d2" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </Box>
        </CardContent>
      </Card>

      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', textAlign: 'center' }}>
        数据仅存本机 · 可在设置中导出备份
      </Typography>
    </Box>
  );
};

export default DataPage;
