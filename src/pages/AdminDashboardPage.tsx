import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  CircularProgress,
  Divider,
  Grid,
  IconButton,
  Stack,
  Tab,
  Tabs,
  Typography,
} from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import RefreshIcon from '@mui/icons-material/Refresh';
import PeopleIcon from '@mui/icons-material/People';
import TimelineIcon from '@mui/icons-material/Timeline';
import StorageIcon from '@mui/icons-material/Storage';
import HealthAndSafetyIcon from '@mui/icons-material/HealthAndSafety';
import { fetchAdminDashboard, type AdminDashboardResponse } from '@/lib/api';
import { useAuthStore } from '@/stores/useAuthStore';

type MetricCardProps = {
  label: string;
  value: number | string | null;
  helper?: string;
  tone?: 'default' | 'warning' | 'success';
};

type SectionCardProps = {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
};

const tabSx = {
  flex: 1,
  minWidth: 0,
  minHeight: 38,
  px: 0.5,
  fontSize: 14,
  fontWeight: 600,
  textTransform: 'none',
  '& .MuiTab-iconWrapper': {
    mr: 0.5,
  },
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

function MetricCard({ label, value, helper, tone = 'default' }: MetricCardProps) {
  const color = tone === 'warning' ? 'warning.main' : tone === 'success' ? 'success.main' : 'text.primary';

  return (
    <Box
      sx={{
        height: '100%',
        px: 1.5,
        py: 1.25,
        borderRadius: '2px',
        bgcolor: 'background.default',
        boxShadow: 'inset 0 0 0 1px var(--mui-palette-divider)',
      }}
    >
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', lineHeight: 1.2, mb: 0.5 }}>
        {label}
      </Typography>
      <Typography variant="h6" sx={{ fontWeight: 750, lineHeight: 1.15, color }}>
        {formatNumber(value)}
      </Typography>
      {helper && (
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.25, lineHeight: 1.2 }}>
          {helper}
        </Typography>
      )}
    </Box>
  );
}

function SectionCard({ title, icon, children }: SectionCardProps) {
  return (
    <Card variant="outlined" sx={{ borderRadius: '2px' }}>
      <CardContent sx={{ p: 2, '&:last-child': { pb: 2 } }}>
        <Stack direction="row" spacing={1.25} alignItems="center" sx={{ mb: 1.5 }}>
          <Box sx={{ color: 'text.secondary', display: 'flex' }}>{icon}</Box>
          <Typography variant="subtitle1" sx={{ fontWeight: 750, lineHeight: 1.25 }}>{title}</Typography>
        </Stack>
        <Grid container spacing={1.25}>{children}</Grid>
      </CardContent>
    </Card>
  );
}

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

  if (!isAdmin) return null;

  return (
    <Box className="py-3" sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
      <Card variant="outlined" sx={{ borderRadius: '2px' }}>
        <CardContent sx={{ p: 1.5, '&:last-child': { pb: 1.5 } }}>
          <Stack spacing={1.25}>
            <Stack direction="row" spacing={1.25} alignItems="center" justifyContent="space-between">
              <Stack direction="row" spacing={1} alignItems="center" sx={{ minWidth: 0, flex: 1 }}>
                <IconButton onClick={() => navigate('/settings')} size="small" sx={{ flexShrink: 0 }}>
                  <ArrowBackIcon fontSize="small" />
                </IconButton>
                <Box sx={{ minWidth: 0, flex: 1 }}>
                  <Typography component="h1" sx={{ fontSize: 24, fontWeight: 900, letterSpacing: "0.06em", lineHeight: 1.2 }}>后台数据</Typography>
                </Box>
              </Stack>
              <Button
                size="small"
                variant="outlined"
                startIcon={refreshing ? <CircularProgress size={14} /> : <RefreshIcon fontSize="small" />}
                onClick={() => loadDashboard(true)}
                disabled={loading || refreshing}
                sx={{ flexShrink: 0, minWidth: 72, px: 1.25, whiteSpace: 'nowrap' }}
              >
                刷新
              </Button>
            </Stack>

            {data && (
              <Typography variant="caption" color="text.secondary">
                最后更新 {formatDateTime(data.fetched_at)}
              </Typography>
            )}

            <Divider />

            <Tabs
              value={activeTab}
              onChange={(_, value: number) => setActiveTab(value)}
              variant="fullWidth"
              sx={{
                minHeight: 38,
                '& .MuiTabs-flexContainer': { width: '100%' },
                '& .MuiTabs-indicator': { height: 2 },
              }}
            >
              <Tab icon={<PeopleIcon fontSize="small" />} iconPosition="start" label="用户" sx={tabSx} />
              <Tab icon={<TimelineIcon fontSize="small" />} iconPosition="start" label="活跃" sx={tabSx} />
              <Tab icon={<StorageIcon fontSize="small" />} iconPosition="start" label="内容" sx={tabSx} />
              <Tab icon={<HealthAndSafetyIcon fontSize="small" />} iconPosition="start" label="健康" sx={tabSx} />
            </Tabs>
          </Stack>
        </CardContent>
      </Card>

      {error && (
        <Alert
          severity="error"
          action={<Button color="inherit" size="small" onClick={() => loadDashboard()}>重试</Button>}
          sx={{ py: 0 }}
        >
          {error}
        </Alert>
      )}

      {loading ? (
        <Card variant="outlined" sx={{ borderRadius: '2px' }}>
          <CardContent sx={{ py: 5, textAlign: 'center' }}>
            <CircularProgress size={26} />
            <Typography variant="body2" color="text.secondary" sx={{ mt: 1.5 }}>正在加载后台数据…</Typography>
          </CardContent>
        </Card>
      ) : data ? (
        <>
          {activeTab === 0 && (
            <SectionCard title="用户概览" icon={<PeopleIcon fontSize="small" />}>
              <Grid item xs={6} sm={4} md={3}><MetricCard label="用户总数" value={data.users.total} /></Grid>
              <Grid item xs={6} sm={4} md={3}><MetricCard label="管理员" value={data.users.admins} /></Grid>
              <Grid item xs={6} sm={4} md={3}><MetricCard label="普通用户" value={data.users.normal} /></Grid>
              <Grid item xs={6} sm={4} md={3}><MetricCard label="今日新增" value={data.users.new_today} /></Grid>
              <Grid item xs={6} sm={4} md={3}><MetricCard label="7 天新增" value={data.users.new_7d} /></Grid>
              <Grid item xs={6} sm={4} md={3}><MetricCard label="30 天新增" value={data.users.new_30d} /></Grid>
              <Grid item xs={12} sm={8} md={6}><MetricCard label="最近注册" value={formatDateTime(data.users.latest_registered_at)} /></Grid>
            </SectionCard>
          )}

          {activeTab === 1 && (
            <SectionCard title="活跃概览" icon={<TimelineIcon fontSize="small" />}>
              <Grid item xs={6} sm={4} md={3}><MetricCard label="今日活跃 DAU" value={data.activity.dau_today} tone="success" /></Grid>
              <Grid item xs={6} sm={4} md={3}><MetricCard label="7 天活跃" value={data.activity.active_7d} /></Grid>
              <Grid item xs={6} sm={4} md={3}><MetricCard label="30 天活跃 MAU" value={data.activity.mau_30d} /></Grid>
              <Grid item xs={6} sm={4} md={3}><MetricCard label="今日学习活跃" value={data.activity.study_active_today} /></Grid>
              <Grid item xs={6} sm={4} md={3}><MetricCard label="今日集字活跃" value={data.activity.jizi_active_today} /></Grid>
              <Grid item xs={6} sm={4} md={3}><MetricCard label="学习记录数" value={data.activity.total_study_sessions} /></Grid>
              <Grid item xs={6} sm={4} md={3}><MetricCard label="累计学卡" value={data.activity.total_cards_studied} /></Grid>
              <Grid item xs={6} sm={4} md={3}><MetricCard label="集字记录数" value={data.activity.total_jizi_requests} /></Grid>
              <Grid item xs={12} sm={4}><MetricCard label="最近学习" value={formatDateTime(data.activity.latest_study_at)} /></Grid>
              <Grid item xs={12} sm={4}><MetricCard label="最近集字" value={formatDateTime(data.activity.latest_jizi_at)} /></Grid>
              <Grid item xs={12} sm={4}>
                <MetricCard
                  label="最近日统计"
                  value={isFutureDate(data.activity.latest_daily_stat_date) ? '日期异常' : (data.activity.latest_daily_stat_date ?? '--')}
                  helper={isFutureDate(data.activity.latest_daily_stat_date) ? data.activity.latest_daily_stat_date ?? undefined : undefined}
                  tone={isFutureDate(data.activity.latest_daily_stat_date) ? 'warning' : 'default'}
                />
              </Grid>
            </SectionCard>
          )}

          {activeTab === 2 && (
            <SectionCard title="内容概览" icon={<StorageIcon fontSize="small" />}>
              <Grid item xs={6} sm={4} md={3}><MetricCard label="牌组数" value={data.content.decks} /></Grid>
              <Grid item xs={6} sm={4} md={3}><MetricCard label="卡片 / 字数" value={data.content.cards} /></Grid>
              <Grid item xs={6} sm={4} md={3}><MetricCard label="市场牌组" value={data.content.marketplace_decks} /></Grid>
              <Grid item xs={6} sm={4} md={3}><MetricCard label="精选牌组" value={data.content.featured_decks} /></Grid>
              <Grid item xs={6} sm={4} md={3}><MetricCard label="有字图卡片" value={data.content.cards_with_image} /></Grid>
              <Grid item xs={6} sm={4} md={3}><MetricCard label="uploads 文件" value={data.content.upload_files} tone="success" /></Grid>
              <Grid item xs={12} sm={6} md={3}><MetricCard label="最近牌组更新" value={formatDateTime(data.content.latest_deck_updated_at)} /></Grid>
              <Grid item xs={12} sm={6} md={3}><MetricCard label="最近卡片创建" value={formatDateTime(data.content.latest_card_created_at)} /></Grid>
            </SectionCard>
          )}

          {activeTab === 3 && (
            <SectionCard title="数据健康检查" icon={<HealthAndSafetyIcon fontSize="small" />}>
              <Grid item xs={6} sm={3}>
                <MetricCard label="空牌组" value={data.health.empty_decks} tone={data.health.empty_decks > 0 ? 'warning' : 'success'} />
              </Grid>
              <Grid item xs={6} sm={3}>
                <MetricCard label="从未学习用户" value={data.health.users_never_studied} helper="含新注册" />
              </Grid>
              <Grid item xs={6} sm={3}>
                <MetricCard label="无图片卡片" value={data.health.cards_without_image} tone={data.health.cards_without_image > 0 ? 'warning' : 'success'} />
              </Grid>
              <Grid item xs={6} sm={3}>
                <MetricCard label="卡片数不一致牌组" value={data.health.decks_card_count_mismatch} tone={data.health.decks_card_count_mismatch > 0 ? 'warning' : 'success'} />
              </Grid>
            </SectionCard>
          )}
        </>
      ) : null}
    </Box>
  );
};

export default AdminDashboardPage;
