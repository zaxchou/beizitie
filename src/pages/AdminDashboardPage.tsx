import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Box, Button, Typography } from '@mui/material';
import { fetchAdminDashboard, type AdminDashboardResponse } from '@/lib/api';
import { useAuthStore } from '@/stores/useAuthStore';

/** 后台指标：标签中文 + 英文小字，值统一走 formatNumber */
type Metric = {
  label: string;
  en: string;
  value: number | string | null;
  helper?: string;
  warn?: boolean;
};

function formatNumber(value: number | string | null): string {
  if (value === null || value === '') return '--';
  return typeof value === 'number' ? value.toLocaleString('zh-CN') : value;
}

function formatDateTime(value: string | null): string {
  if (!value) return '--';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('zh-CN', { hour12: false });
}

function isFutureDate(value: string | null): boolean {
  if (!value) return false;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return false;
  const today = new Date();
  today.setHours(23, 59, 59, 999);
  return date.getTime() > today.getTime();
}

/** 后台数据：四组指标，每组前四项走大数字条，其余落成两列表格 */
const AdminDashboardPage: React.FC = () => {
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const isAdmin = user?.role === 'admin';

  const [data, setData] = useState<AdminDashboardResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState(0);

  const loadDashboard = useCallback(async (silent = false) => {
    if (silent) setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      const result = await fetchAdminDashboard();
      setData(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载后台数据失败');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    if (!isAdmin) {
      navigate('/settings');
      return;
    }
    loadDashboard();
  }, [isAdmin, navigate, loadDashboard]);

  const tabs = useMemo<{ label: string; en: string; metrics: Metric[] }[]>(() => {
    if (!data) return [];
    const statDate = data.activity.latest_daily_stat_date;
    const statDateBad = isFutureDate(statDate);
    return [
      {
        label: '用户',
        en: 'USERS',
        metrics: [
          { label: '用户总数', en: 'TOTAL', value: data.users.total },
          { label: '管理员', en: 'ADMINS', value: data.users.admins },
          { label: '普通用户', en: 'NORMAL', value: data.users.normal },
          { label: '今日新增', en: 'NEW TODAY', value: data.users.new_today },
          { label: '7 天新增', en: 'NEW 7D', value: data.users.new_7d },
          { label: '30 天新增', en: 'NEW 30D', value: data.users.new_30d },
          { label: '最近注册', en: 'LATEST', value: formatDateTime(data.users.latest_registered_at) },
        ],
      },
      {
        label: '活跃',
        en: 'ACTIVITY',
        metrics: [
          { label: '今日活跃', en: 'DAU', value: data.activity.dau_today },
          { label: '7 天活跃', en: 'WAU', value: data.activity.active_7d },
          { label: '30 天活跃', en: 'MAU', value: data.activity.mau_30d },
          { label: '今日学习', en: 'STUDY TODAY', value: data.activity.study_active_today },
          { label: '今日集字', en: 'JIZI TODAY', value: data.activity.jizi_active_today },
          { label: '学习记录', en: 'SESSIONS', value: data.activity.total_study_sessions },
          { label: '累计学卡', en: 'CARDS', value: data.activity.total_cards_studied },
          { label: '集字记录', en: 'JIZI REQ', value: data.activity.total_jizi_requests },
          { label: '最近学习', en: 'LATEST STUDY', value: formatDateTime(data.activity.latest_study_at) },
          { label: '最近集字', en: 'LATEST JIZI', value: formatDateTime(data.activity.latest_jizi_at) },
          {
            label: '最近日统计',
            en: 'DAILY STAT',
            value: statDateBad ? '日期异常' : (statDate ?? '--'),
            helper: statDateBad ? statDate ?? undefined : undefined,
            warn: statDateBad,
          },
        ],
      },
      {
        label: '内容',
        en: 'CONTENT',
        metrics: [
          { label: '牌组数', en: 'DECKS', value: data.content.decks },
          { label: '卡片 / 字数', en: 'CARDS', value: data.content.cards },
          { label: '市场牌组', en: 'MARKET', value: data.content.marketplace_decks },
          { label: '精选牌组', en: 'FEATURED', value: data.content.featured_decks },
          { label: '有字图卡片', en: 'WITH IMAGE', value: data.content.cards_with_image },
          { label: 'uploads 文件', en: 'FILES', value: data.content.upload_files },
          { label: '最近牌组更新', en: 'DECK UPDATED', value: formatDateTime(data.content.latest_deck_updated_at) },
          { label: '最近卡片创建', en: 'CARD CREATED', value: formatDateTime(data.content.latest_card_created_at) },
        ],
      },
      {
        label: '健康',
        en: 'HEALTH',
        metrics: [
          { label: '空牌组', en: 'EMPTY DECKS', value: data.health.empty_decks, warn: data.health.empty_decks > 0 },
          { label: '从未学习用户', en: 'NEVER STUDIED', value: data.health.users_never_studied, helper: '含新注册' },
          { label: '无图片卡片', en: 'NO IMAGE', value: data.health.cards_without_image, warn: data.health.cards_without_image > 0 },
          { label: '卡片数不一致牌组', en: 'MISMATCH', value: data.health.decks_card_count_mismatch, warn: data.health.decks_card_count_mismatch > 0 },
        ],
      },
    ];
  }, [data]);

  if (!isAdmin) return null;

  const mono = { fontFamily: 'var(--font-mono)', letterSpacing: '0.04em' } as const;
  const active = tabs[activeTab];
  const strip = active ? active.metrics.slice(0, 4) : [];
  const rest = active ? active.metrics.slice(4) : [];

  return (
    <Box>
      {/* 页头 */}
      <Box sx={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 2, pb: { xs: 1.5, md: 1.75 } }}>
        <Box sx={{ minWidth: 0 }}>
          <Button
            variant="text"
            onClick={() => navigate('/settings')}
            sx={{ minHeight: 0, p: 0, mb: 1, fontSize: 11, ...mono, color: 'text.primary', opacity: 0.7, '&:hover': { backgroundColor: 'transparent', opacity: 1 } }}
          >
            ← 设置
          </Button>
          <Typography component="h1" sx={{ fontSize: { xs: 30, md: 44 }, fontWeight: 900, letterSpacing: { xs: '4px', md: '7px' }, lineHeight: 1.1 }}>
            后台数据
          </Typography>
          <Typography sx={{ ...mono, fontSize: 11, opacity: 0.72, mt: 1 }}>
            {data ? `最后更新 ${formatDateTime(data.fetched_at)} · 只读` : '只读 · 直接读生产库'}
          </Typography>
        </Box>
        <Button
          variant="outlined"
          onClick={() => loadDashboard(true)}
          disabled={loading || refreshing}
          sx={{ height: 36, px: 1.75, flexShrink: 0, ...mono, fontSize: 11 }}
        >
          {refreshing ? '刷新中…' : '刷新'}
        </Button>
      </Box>

      {/* 分组切换 */}
      <Box sx={{ display: 'flex', borderTop: '1px solid', borderBottom: '1px solid', borderColor: 'text.primary', py: 1.25 }}>
        {tabs.map((t, i) => {
          const on = i === activeTab;
          return (
            <Box
              key={t.en}
              component="button"
              type="button"
              onClick={() => setActiveTab(i)}
              aria-pressed={on}
              sx={{
                border: '1px solid',
                borderColor: 'text.primary',
                borderLeftWidth: i === 0 ? 1 : 0,
                bgcolor: on ? 'text.primary' : 'transparent',
                color: on ? 'background.default' : 'inherit',
                px: { xs: 1, md: 2.25 },
                height: 34,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'baseline',
                gap: 0.75,
                '&:hover': on ? {} : { backgroundColor: 'action.hover' },
              }}
            >
              <Box component="span" sx={{ fontSize: 13, fontWeight: 900, letterSpacing: '0.06em', whiteSpace: 'nowrap' }}>{t.label}</Box>
              <Box component="span" sx={{ ...mono, fontSize: 9.5, opacity: 0.62, display: { xs: 'none', md: 'inline' } }}>{t.en}</Box>
            </Box>
          );
        })}
      </Box>

      {error && (
        <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1.5, py: 1.25, borderBottom: '1px solid', borderColor: 'divider' }}>
          <Typography sx={{ ...mono, fontSize: 11, color: 'var(--hot-ink)' }}>{error}</Typography>
          <Box
            component="button"
            type="button"
            onClick={() => loadDashboard()}
            sx={{ border: 0, background: 'none', p: 0, cursor: 'pointer', ...mono, fontSize: 11, color: 'inherit', textDecoration: 'underline' }}
          >
            重试
          </Box>
        </Box>
      )}

      {loading ? (
        <Typography sx={{ ...mono, fontSize: 11, opacity: 0.7, py: 8 }}>正在加载后台数据…</Typography>
      ) : active ? (
        <>
          {/* 大数字条 */}
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: { xs: '1fr 1fr', md: 'repeat(4, 1fr)' },
              borderBottom: '1px solid',
              borderColor: 'text.primary',
            }}
          >
            {strip.map((m, i) => (
              <Box
                key={m.en}
                sx={{
                  py: 1.75,
                  pl: { xs: i % 2 === 0 ? 0 : 1.5, md: i === 0 ? 0 : 2 },
                  pr: { xs: i % 2 === 0 ? 1.5 : 0, md: 2 },
                  borderRight: { xs: i % 2 === 0 ? '1px solid' : 0, md: i < 3 ? '1px solid' : 0 },
                  borderBottom: { xs: i < 2 ? '1px solid' : 0, md: 0 },
                  borderColor: 'divider',
                }}
              >
                <Typography sx={{ ...mono, fontSize: 9.5, letterSpacing: '0.1em', textTransform: 'uppercase', opacity: 0.62 }}>
                  {m.label} · {m.en}
                </Typography>
                <Typography
                  sx={{
                    fontSize: { xs: 30, md: 42 },
                    fontWeight: 900,
                    lineHeight: 1,
                    letterSpacing: '-0.03em',
                    mt: 1,
                    fontVariantNumeric: 'tabular-nums',
                    color: m.warn ? 'var(--hot-ink)' : 'inherit',
                    wordBreak: 'break-word',
                  }}
                >
                  {formatNumber(m.value)}
                </Typography>
                {m.helper && (
                  <Typography sx={{ ...mono, fontSize: 9.5, opacity: 0.55, mt: 0.75 }}>{m.helper}</Typography>
                )}
              </Box>
            ))}
          </Box>

          {/* 其余指标：两列表格 */}
          {rest.length > 0 && (
            <Box sx={{ borderBottom: '1px solid', borderColor: 'text.primary' }}>
              {rest.map((m) => (
                <Box
                  key={m.en}
                  sx={{
                    display: 'grid',
                    gridTemplateColumns: '1fr auto',
                    alignItems: 'baseline',
                    columnGap: 2,
                    py: 1.1,
                    px: { xs: 0.5, md: 1 },
                    borderBottom: '1px solid',
                    borderColor: 'divider',
                    '&:last-of-type': { borderBottom: 0 },
                    '&:hover': { backgroundColor: 'text.primary', color: 'background.default' },
                  }}
                >
                  <Typography sx={{ fontSize: 13 }}>
                    {m.label}
                    <Box component="span" sx={{ ...mono, fontSize: 9.5, opacity: 0.5, ml: 1 }}>{m.en}</Box>
                  </Typography>
                  <Typography
                    sx={{
                      ...mono,
                      fontSize: 12,
                      textAlign: 'right',
                      fontVariantNumeric: 'tabular-nums',
                      color: m.warn ? 'var(--hot-ink)' : 'inherit',
                    }}
                  >
                    {formatNumber(m.value)}
                    {m.helper && <Box component="span" sx={{ opacity: 0.55, ml: 1 }}>{m.helper}</Box>}
                  </Typography>
                </Box>
              ))}
            </Box>
          )}
        </>
      ) : null}
    </Box>
  );
};

export default AdminDashboardPage;
