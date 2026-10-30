import { useEffect, useState, useMemo, useCallback } from 'react';
import {
  Box,
  Typography,
  Card,
  CardContent,
  CircularProgress,
  Alert,
  ToggleButtonGroup,
  ToggleButton,
  useTheme,
  useMediaQuery,
  MenuItem,
  TextField,
} from '@mui/material';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RTooltip, ResponsiveContainer,
  AreaChart, Area, LabelList,
} from 'recharts';
import { useDeckStore } from '@/stores/useDeckStore';
import { fetchDailyExtra, type DailyExtraPoint } from '@/lib/api';

/** 紧凑主题配色（参考图风格） */
const COLORS = {
  newLearned: '#8b3a30',   // 朱红（新学）
  reviewed: '#a08d74',     // 墨褐（复习）
  hard: '#8b3a30',         // 朱红（困难 = 重来 + 困难）
  medium: '#a08d74',       // 墨褐（一般 = 良好）
  easy: '#6e6458',         // 墨灰（简单）
  area: 'rgba(139,58,48,0.14)',
  grid: '#e3d9c9',
};

const COLORS_DARK = {
  ...COLORS,
  newLearned: '#c46a58',
  reviewed: '#b3a894',
  hard: '#c46a58',
  medium: '#b3a894',
  easy: '#a89e8e',
  area: 'rgba(196,106,88,0.16)',
  grid: '#332d25',
};

type RangeKey = '7d' | '15d' | '30d' | '90d';

const RANGE_OPTIONS: { key: RangeKey; label: string; days: number }[] = [
  { key: '7d', label: '近 7 天', days: 7 },
  { key: '15d', label: '近 15 天', days: 15 },
  { key: '30d', label: '近 30 天', days: 30 },
  { key: '90d', label: '近 90 天', days: 90 },
];

/** 浅色/暗色 tooltip */
const ChartTooltip = ({ active, payload, label, unit }: any) => {
  const theme = useTheme();
  if (!active || !payload?.length) return null;
  const dark = theme.palette.mode === 'dark';
  return (
    <Box sx={{
      bgcolor: dark ? '#333' : '#fff',
      color: dark ? '#e0e0e0' : '#333',
      px: 1.5, py: 0.75,
      borderRadius: '2px',
      border: 1, borderColor: dark ? '#555' : '#ddd',
      fontSize: 12, boxShadow: 2,
    }}>
      <Box sx={{ fontWeight: 600, mb: 0.25 }}>{label}</Box>
      {payload.map((p: any, i: number) => (
        <Box key={i} sx={{ color: p.color || p.fill }}>
          {p.name}: <b>{p.value}</b>{unit || ''}
        </Box>
      ))}
    </Box>
  );
};

/** 柱顶数字 Label（仅在值 > 0 时显示） */
const BarTopLabel = (props: any) => {
  const { x, y, width, value } = props;
  if (!value || value <= 0) return null;
  return (
    <text
      x={x + width / 2}
      y={y - 4}
      textAnchor="middle"
      fontSize={10}
      fill={props.fill || '#666'}
      fontWeight={600}
    >
      {value}
    </text>
  );
};

/** AnalyticsPage：完全模仿参考图风格。
 *  顶部：标题 + 日期范围 + 牌组下拉
 *  主体：3 个垂直堆叠的 Card（双柱/三柱/面积折线）
 */
const AnalyticsPage: React.FC = () => {
  const { decks, loadDecks } = useDeckStore();
  const theme = useTheme();
  const dark = theme.palette.mode === 'dark';
  const C = dark ? COLORS_DARK : COLORS;
  const isPc = useMediaQuery(theme.breakpoints.up('md'));
  const textColor = dark ? '#bdbdbd' : '#555';

  const [selectedDeck, setSelectedDeck] = useState<string>(() => localStorage.getItem('analytics-last-deck') || '');
  const [range, setRange] = useState<RangeKey>(() => (localStorage.getItem('analytics-last-range') as RangeKey) || '7d');
  const [data, setData] = useState<DailyExtraPoint[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  // 加载牌组（仅已订阅的，用于下拉选择）
  useEffect(() => {
    const init = async () => {
      await loadDecks(true);
      setReady(true);
    };
    init();
  }, [loadDecks]);

  // 自动选第一个牌组（无缓存 / 缓存的牌组在当前用户列表中不存在时）
  useEffect(() => {
    if (ready && decks.length > 0) {
      const isValid = decks.some((d) => d.id === selectedDeck);
      if (!isValid) {
        const firstId = decks[0].id;
        setSelectedDeck(firstId);
        localStorage.setItem('analytics-last-deck', firstId);
      }
    }
  }, [ready, decks, selectedDeck]);

  // 切换牌组
  const handleDeckChange = (id: string) => {
    setSelectedDeck(id);
    localStorage.setItem('analytics-last-deck', id);
  };

  // 切换范围
  const handleRangeChange = (k: RangeKey) => {
    setRange(k);
    localStorage.setItem('analytics-last-range', k);
  };

  // 加载每日扩展数据
  useEffect(() => {
    if (!selectedDeck) return;
    const opt = RANGE_OPTIONS.find((r) => r.key === range);
    if (!opt) return;
    setLoading(true);
    setError(null);
    fetchDailyExtra(opt.days, { deckId: selectedDeck })
      .then((d) => setData(d))
      .catch((err) => setError(err instanceof Error ? err.message : '加载失败'))
      .finally(() => setLoading(false));
  }, [selectedDeck, range]);

  /** 累计：仅 "学时" 用 */
  const totalMinutes = useMemo(() => data.reduce((s, d) => s + (d.minutes || 0), 0), [data]);

  /** 格式化 X 轴日期：MM/DD */
  const fmtDate = useCallback((d: string) => d.slice(5), []);

  /** 范围描述（用于顶部） */
  const rangeDesc = useMemo(() => {
    if (data.length < 2) return '';
    return `${data[0].date} ~ ${data[data.length - 1].date}`;
  }, [data]);

  if (!ready) {
    return (
      <Box className="flex justify-center py-12"><CircularProgress /></Box>
    );
  }

  if (!decks.length) {
    return (
      <Box className="py-8 text-center">
        <Typography color="text.secondary">还没有牌组数据</Typography>
      </Box>
    );
  }

  const chartHeight = isPc ? 240 : 180;

  return (
    <Box className="space-y-4 py-4">
      {/* 顶部：标题 + 日期范围 + 牌组 */}
      <Card variant="outlined" sx={{ borderRadius: '2px' }}>
        <CardContent sx={{ p: 2, '&:last-child': { pb: 2 } }}>
          <Box className="flex items-center justify-between flex-wrap gap-2">
            <Box className="flex items-baseline gap-2">
              <Typography
                variant="subtitle1"
                fontWeight={700}
                className="font-kai"
                sx={{ color: 'text.primary' }}
              >
                学习统计
              </Typography>
              {rangeDesc && (
                <Typography variant="caption" color="text.secondary">
                  {rangeDesc}
                </Typography>
              )}
            </Box>
            <Box className="flex items-center gap-2">
              <TextField
                select
                size="small"
                value={selectedDeck}
                onChange={(e) => handleDeckChange(e.target.value)}
                sx={{ minWidth: 120, '& .MuiInputBase-input': { fontSize: 13, py: 0.5 } }}
              >
                {decks.map((d) => (
                  <MenuItem key={d.id} value={d.id} sx={{ fontSize: 13 }}>{d.name}</MenuItem>
                ))}
              </TextField>
              <ToggleButtonGroup
                value={range}
                exclusive
                size="small"
                onChange={(_, v) => v && handleRangeChange(v as RangeKey)}
                sx={{
                  '& .MuiToggleButton-root': { fontSize: 12, px: 1.25, py: 0.25 },
                }}
              >
                {RANGE_OPTIONS.map((o) => (
                  <ToggleButton key={o.key} value={o.key}>{o.label}</ToggleButton>
                ))}
              </ToggleButtonGroup>
            </Box>
          </Box>
        </CardContent>
      </Card>

      {error && <Alert severity="error">{error}</Alert>}

      {loading ? (
        <Box className="flex justify-center py-12"><CircularProgress /></Box>
      ) : (
        <>
          {/* 图 1：新学 / 复习 */}
          <Card variant="outlined" sx={{ borderRadius: '2px' }}>
            <CardContent sx={{ p: 2, '&:last-child': { pb: 2 } }}>
              <Legend items={[
                { color: C.newLearned, label: '新学' },
                { color: C.reviewed, label: '复习' },
              ]} />
              <ResponsiveContainer width="100%" height={chartHeight}>
                <BarChart data={data} barGap={4} barCategoryGap="22%">
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={C.grid} />
                  <XAxis
                    dataKey="date" tickFormatter={fmtDate}
                    fontSize={11} tick={{ fill: textColor }} stroke={C.grid}
                    interval="preserveStartEnd"
                  />
                  <YAxis fontSize={11} tick={{ fill: textColor }} stroke={C.grid} width={28} />
                  <RTooltip content={<ChartTooltip />} cursor={{ fill: dark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)' }} />
                  <Bar dataKey="new_learned" name="新学" fill={C.newLearned} radius={[2, 2, 0, 0]} maxBarSize={14}>
                    <LabelList dataKey="new_learned" content={(p: any) => <BarTopLabel {...p} fill={C.newLearned} />} />
                  </Bar>
                  <Bar dataKey="reviewed" name="复习" fill={C.reviewed} radius={[2, 2, 0, 0]} maxBarSize={14}>
                    <LabelList dataKey="reviewed" content={(p: any) => <BarTopLabel {...p} fill={C.reviewed} />} />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          {/* 图 2：困难 / 一般 / 简单 */}
          <Card variant="outlined" sx={{ borderRadius: '2px' }}>
            <CardContent sx={{ p: 2, '&:last-child': { pb: 2 } }}>
              <Legend items={[
                { color: C.hard, label: '困难' },
                { color: C.medium, label: '一般' },
                { color: C.easy, label: '简单' },
              ]} />
              <ResponsiveContainer width="100%" height={chartHeight}>
                <BarChart data={data} barGap={2} barCategoryGap="22%">
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={C.grid} />
                  <XAxis
                    dataKey="date" tickFormatter={fmtDate}
                    fontSize={11} tick={{ fill: textColor }} stroke={C.grid}
                    interval="preserveStartEnd"
                  />
                  <YAxis fontSize={11} tick={{ fill: textColor }} stroke={C.grid} width={28} />
                  <RTooltip content={<ChartTooltip />} cursor={{ fill: dark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)' }} />
                  <Bar dataKey="hard" name="困难" fill={C.hard} radius={[2, 2, 0, 0]} maxBarSize={10}>
                    <LabelList dataKey="hard" content={(p: any) => <BarTopLabel {...p} fill={C.hard} />} />
                  </Bar>
                  <Bar dataKey="medium" name="一般" fill={C.medium} radius={[2, 2, 0, 0]} maxBarSize={10}>
                    <LabelList dataKey="medium" content={(p: any) => <BarTopLabel {...p} fill={C.medium} />} />
                  </Bar>
                  <Bar dataKey="easy" name="简单" fill={C.easy} radius={[2, 2, 0, 0]} maxBarSize={10}>
                    <LabelList dataKey="easy" content={(p: any) => <BarTopLabel {...p} fill={C.easy} />} />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          {/* 图 3：学习时长（面积折线） */}
          <Card variant="outlined" sx={{ borderRadius: '2px' }}>
            <CardContent sx={{ p: 2, '&:last-child': { pb: 2 } }}>
              <Box className="flex items-center justify-between mb-1">
                <Typography variant="body2" fontWeight={600}>学习时长(分钟)</Typography>
                <Typography variant="caption" color="text.secondary">
                  累计 {totalMinutes} 分钟
                </Typography>
              </Box>
              <ResponsiveContainer width="100%" height={chartHeight}>
                <AreaChart data={data}>
                  <defs>
                    <linearGradient id="minutesFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={C.area} stopOpacity={0.35} />
                      <stop offset="100%" stopColor={C.area} stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={C.grid} />
                  <XAxis
                    dataKey="date" tickFormatter={fmtDate}
                    fontSize={11} tick={{ fill: textColor }} stroke={C.grid}
                    interval="preserveStartEnd"
                  />
                  <YAxis fontSize={11} tick={{ fill: textColor }} stroke={C.grid} width={36} />
                  <RTooltip content={<ChartTooltip unit=" 分" />} cursor={{ stroke: C.area, strokeWidth: 1, strokeDasharray: '3 3' }} />
                  <Area
                    type="monotone"
                    dataKey="minutes"
                    name="学时"
                    stroke={C.area}
                    strokeWidth={2.5}
                    fill="url(#minutesFill)"
                    dot={{ r: 3, fill: C.area, strokeWidth: 0 }}
                    activeDot={{ r: 5 }}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </>
      )}
    </Box>
  );
};

/** 顶部图例（圆点 + 文字） */
const Legend: React.FC<{ items: { color: string; label: string }[] }> = ({ items }) => (
  <Box className="flex items-center gap-3 mb-1">
    {items.map((it) => (
      <Box key={it.label} className="flex items-center gap-1">
        <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: it.color }} />
        <Typography variant="body2" sx={{ fontSize: 12, fontWeight: 500 }}>{it.label}</Typography>
      </Box>
    ))}
  </Box>
);

export default AnalyticsPage;
