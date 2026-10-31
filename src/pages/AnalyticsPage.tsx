import { useEffect, useState, useMemo, useCallback } from 'react';
import {
  Box,
  Typography,
  CircularProgress,
  useTheme,
  useMediaQuery,
} from '@mui/material';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RTooltip, ResponsiveContainer,
  AreaChart, Area,
} from 'recharts';
import { useDeckStore } from '@/stores/useDeckStore';
import { fetchDailyExtra, type DailyExtraPoint } from '@/lib/api';

type RangeKey = '7d' | '15d' | '30d' | '90d';

const RANGE_OPTIONS: { key: RangeKey; label: string; days: number }[] = [
  { key: '7d', label: '近 7 天', days: 7 },
  { key: '15d', label: '近 15 天', days: 15 },
  { key: '30d', label: '近 30 天', days: 30 },
  { key: '90d', label: '近 90 天', days: 90 },
];

/** 浅色/暗色 tooltip */
const ChartTooltip = ({ active, payload, label, unit }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <Box sx={{
      bgcolor: 'background.paper',
      color: 'text.primary',
      px: 1.5, py: 0.75,
      border: '1px solid',
      borderColor: 'text.primary',
      fontSize: 12,
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

/** AnalyticsPage：完全模仿参考图风格。
 *  顶部：标题 + 日期范围 + 牌组下拉
 *  主体：3 个垂直堆叠的 Card（双柱/三柱/面积折线）
 */
const AnalyticsPage: React.FC = () => {
  const { decks, loadDecks } = useDeckStore();
  const theme = useTheme();
  const dark = theme.palette.mode === 'dark';
  const isPc = useMediaQuery(theme.breakpoints.up('md'));

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

  const selectedDeckName = decks.find((d) => d.id === selectedDeck)?.name ?? '未选择帖';
  const chartHeight = isPc ? 200 : 168;
  const palette = dark
    ? { new: '#e0593c', reviewed: '#f2ecdd', hard: '#e8846b', medium: '#b3a795', easy: '#6f665a', grid: 'rgba(242,236,221,0.16)', text: '#f2ecdd' }
    : { new: '#c1432b', reviewed: '#17130c', hard: '#a83a25', medium: '#6f665a', easy: '#b3a795', grid: 'rgba(23,19,12,0.14)', text: '#17130c' };

  const totals = data.reduce(
    (acc, d) => ({
      newLearned: acc.newLearned + (d.new_learned || 0),
      reviewed: acc.reviewed + (d.reviewed || 0),
      hard: acc.hard + (d.hard || 0),
      medium: acc.medium + (d.medium || 0),
      easy: acc.easy + (d.easy || 0),
    }),
    { newLearned: 0, reviewed: 0, hard: 0, medium: 0, easy: 0 },
  );
  const activeDays = data.filter((d) => (d.new_learned || 0) + (d.reviewed || 0) > 0).length;

  const mono = { fontFamily: 'var(--font-mono)', letterSpacing: '0.04em' } as const;
  const statCell = (label: string, value: number, unit: string) => (
    <Box key={label} sx={{ py: 1.75, pr: 2, borderRight: '1px solid', borderColor: 'divider', '&:last-of-type': { borderRight: 0 } }}>
      <Typography sx={{ ...mono, fontSize: 9.5, opacity: 0.64, textTransform: 'uppercase' }}>{label}</Typography>
      <Typography sx={{ fontSize: { xs: 34, md: 46 }, fontWeight: 900, lineHeight: 1, letterSpacing: '-0.04em', mt: 0.75, fontVariantNumeric: 'tabular-nums' }}>
        {value}<Box component="span" sx={{ fontSize: 11, fontWeight: 400, letterSpacing: 0, ml: 0.5, opacity: 0.7 }}>{unit}</Box>
      </Typography>
    </Box>
  );

  return (
    <Box>
      {/* 页头 */}
      <Box sx={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 2, pt: 0.5, pb: { xs: 1.5, md: 1.75 } }}>
        <Box sx={{ minWidth: 0 }}>
          <Typography component="h1" sx={{ fontSize: { xs: 30, md: 40 }, fontWeight: 900, letterSpacing: '0.1em', lineHeight: 1 }}>
            统计
          </Typography>
          <Typography sx={{ ...mono, opacity: 0.7, mt: 1 }}>
            {rangeDesc || '—'} · {activeDays} 天有记录
          </Typography>
        </Box>
        <Box sx={{ display: { xs: 'none', md: 'block' }, textAlign: 'right', ...mono, opacity: 0.8, whiteSpace: 'nowrap' }}>
          {selectedDeckName}
        </Box>
      </Box>

      {/* 工具条：帖 + 区间 */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap', borderTop: '1px solid', borderBottom: '1px solid', borderColor: 'text.primary', py: 1.25 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Box component="span" sx={{ ...mono, fontSize: 9.5, opacity: 0.6 }}>帖</Box>
          <Box
            component="select"
            value={selectedDeck}
            onChange={(e) => handleDeckChange(e.target.value)}
            aria-label="选择帖"
            sx={{
              border: 0,
              borderBottom: '1px solid',
              borderColor: 'text.primary',
              background: 'transparent',
              color: 'text.primary',
              fontFamily: 'var(--font-mono)',
              fontSize: 11,
              py: '4px',
              pr: '16px',
              maxWidth: 220,
              outline: 'none',
              cursor: 'pointer',
            }}
          >
            {decks.map((d) => (
              <Box component="option" key={d.id} value={d.id}>{d.name}</Box>
            ))}
          </Box>
        </Box>
        <Box sx={{ display: 'flex', ml: 'auto' }}>
          {RANGE_OPTIONS.map((o, i) => (
            <Box
              key={o.key}
              component="button"
              type="button"
              onClick={() => handleRangeChange(o.key)}
              sx={{
                border: '1px solid',
                borderColor: 'text.primary',
                borderLeftWidth: i === 0 ? 1 : 0,
                px: 1.25,
                py: '4px',
                fontSize: 12,
                backgroundColor: range === o.key ? 'text.primary' : 'transparent',
                color: range === o.key ? 'background.default' : 'text.primary',
                cursor: 'pointer',
                whiteSpace: 'nowrap',
              }}
            >
              {o.label}
            </Box>
          ))}
        </Box>
      </Box>

      {error && <Typography sx={{ ...mono, fontSize: 11, color: 'var(--hot-ink)', py: 1 }}>{error}</Typography>}

      {loading ? (
        <Box sx={{ py: 8, display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <CircularProgress size={16} />
          <Typography sx={{ ...mono, fontSize: 11, opacity: 0.7 }}>正在加载统计…</Typography>
        </Box>
      ) : (
        <>
          {/* 合计条 */}
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr 1fr', md: 'repeat(4, 1fr)' }, borderBottom: '1px solid', borderColor: 'text.primary' }}>
            {statCell('新学 · New', totals.newLearned, '字')}
            {statCell('复习 · Review', totals.reviewed, '次')}
            {statCell('学时 · Hours', Math.round(totalMinutes / 6) / 10, 'h')}
            {statCell('每日均 · Avg', activeDays ? Math.round(totalMinutes / activeDays) : 0, '分')}
          </Box>

          {/* 图 1：新学 / 复习 */}
          <Box sx={{ borderBottom: '1px solid', borderColor: 'text.primary', py: 1.5 }}>
            <Box sx={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', mb: 1 }}>
              <Typography sx={{ fontSize: 13, fontWeight: 900, letterSpacing: '2px' }}>每日新学与复习</Typography>
              <Legend items={[{ color: palette.new, label: '新学' }, { color: palette.reviewed, label: '复习' }]} />
            </Box>
            <ResponsiveContainer width="100%" height={chartHeight}>
              <BarChart data={data} barGap={2} barCategoryGap="26%">
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={palette.grid} />
                <XAxis dataKey="date" tickFormatter={fmtDate} fontSize={10} tick={{ fill: palette.text }} stroke={palette.grid} interval="preserveStartEnd" />
                <YAxis fontSize={10} tick={{ fill: palette.text }} stroke={palette.grid} width={26} />
                <RTooltip content={<ChartTooltip />} cursor={{ fill: dark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)' }} />
                <Bar dataKey="new_learned" name="新学" fill={palette.new} radius={0} maxBarSize={12} />
                <Bar dataKey="reviewed" name="复习" fill={palette.reviewed} radius={0} maxBarSize={12} />
              </BarChart>
            </ResponsiveContainer>
          </Box>

          {/* 图 2 / 图 3：并排 */}
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' },
              borderBottom: '1px solid',
              borderColor: 'text.primary',
            }}
          >
            <Box
              sx={{
                py: 1.5,
                pr: { md: 2 },
                borderRight: { md: '1px solid' },
                borderBottom: { xs: '1px solid', md: 0 },
                borderColor: 'text.primary',
              }}
            >
              <Box sx={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', mb: 1 }}>
                <Typography sx={{ fontSize: 13, fontWeight: 900, letterSpacing: '2px' }}>评分分布</Typography>
                <Legend items={[
                  { color: palette.hard, label: `困难 ${totals.hard}` },
                  { color: palette.medium, label: `一般 ${totals.medium}` },
                  { color: palette.easy, label: `简单 ${totals.easy}` },
                ]} />
              </Box>
              <ResponsiveContainer width="100%" height={chartHeight - 24}>
                <BarChart data={data} barGap={1} barCategoryGap="26%">
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={palette.grid} />
                  <XAxis dataKey="date" tickFormatter={fmtDate} fontSize={10} tick={{ fill: palette.text }} stroke={palette.grid} interval="preserveStartEnd" />
                  <YAxis fontSize={10} tick={{ fill: palette.text }} stroke={palette.grid} width={26} />
                  <RTooltip content={<ChartTooltip />} cursor={{ fill: dark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)' }} />
                  <Bar dataKey="hard" name="困难" fill={palette.hard} radius={0} maxBarSize={9} />
                  <Bar dataKey="medium" name="一般" fill={palette.medium} radius={0} maxBarSize={9} />
                  <Bar dataKey="easy" name="简单" fill={palette.easy} radius={0} maxBarSize={9} />
                </BarChart>
              </ResponsiveContainer>
            </Box>

            <Box sx={{ py: 1.5, pl: { md: 2 } }}>
              <Box sx={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', mb: 1 }}>
                <Typography sx={{ fontSize: 13, fontWeight: 900, letterSpacing: '2px' }}>每日学时（分钟）</Typography>
                <Typography sx={{ ...mono, fontSize: 10.5, opacity: 0.7 }}>累计 {totalMinutes} 分钟</Typography>
              </Box>
              <ResponsiveContainer width="100%" height={chartHeight - 24}>
                <AreaChart data={data}>
                  <defs>
                    <linearGradient id="minutesFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={palette.reviewed} stopOpacity={0.18} />
                      <stop offset="100%" stopColor={palette.reviewed} stopOpacity={0.01} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={palette.grid} />
                  <XAxis dataKey="date" tickFormatter={fmtDate} fontSize={10} tick={{ fill: palette.text }} stroke={palette.grid} interval="preserveStartEnd" />
                  <YAxis fontSize={10} tick={{ fill: palette.text }} stroke={palette.grid} width={32} />
                  <RTooltip content={<ChartTooltip unit=" 分" />} cursor={{ stroke: palette.reviewed, strokeWidth: 1, strokeDasharray: '3 3' }} />
                  <Area type="monotone" dataKey="minutes" name="学时" stroke={palette.reviewed} strokeWidth={1.5} fill="url(#minutesFill)" dot={false} activeDot={{ r: 3 }} />
                </AreaChart>
              </ResponsiveContainer>
            </Box>
          </Box>
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
        <Box sx={{ width: 8, height: 8, bgcolor: it.color }} />
        <Typography variant="body2" sx={{ fontSize: 12, fontWeight: 500 }}>{it.label}</Typography>
      </Box>
    ))}
  </Box>
);

export default AnalyticsPage;
