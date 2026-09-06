/**
 * 单文件版 App 装配（无登录、本地数据）
 * 信息架构与在线版一致：底部 tab = 背字帖(仪表盘) / 市场 / 数据 / 设置，学习从仪表盘牌组卡进入。
 * 集字 tab 待 P2 移植后加入。
 */
import { useEffect, useMemo, useState } from 'react';
import {
  Box,
  CssBaseline,
  Snackbar,
  Alert,
  Typography,
  createTheme,
  ThemeProvider,
  useMediaQuery,
} from '@mui/material';
import DashboardIcon from '@mui/icons-material/Dashboard';
import BarChartIcon from '@mui/icons-material/BarChart';
import SettingsIcon from '@mui/icons-material/Settings';
import StoreIcon from '@mui/icons-material/Store';
import BrushIcon from '@mui/icons-material/Brush';
import { buildThemeOptions } from '@/theme';
import { localDataSource, catalogIndex } from '@/data/local/localAdapter';
import DashboardPage from './pages/DashboardPage';
import MarketPage from '@pages/market';
import StudyPage from './pages/StudyPage';
import JiziPage from '@pages/jizi';
import DataPage from '@data-page';
import SettingsPage from './pages/SettingsPage';

type Tab = 'dashboard' | 'market' | 'jizi' | 'data' | 'settings';

const ALL_TABS: { key: Tab; label: string; icon: JSX.Element }[] = [
  { key: 'dashboard', label: '背字帖', icon: <DashboardIcon /> },
  { key: 'market', label: '市场', icon: <StoreIcon /> },
  { key: 'jizi', label: '集字', icon: <BrushIcon /> },
  { key: 'data', label: '数据', icon: <BarChartIcon /> },
  { key: 'settings', label: '设置', icon: <SettingsIcon /> },
];
// mini 构建：无市场（帖已内置），集字为离线限定版（取字范围=包内帖）
const TABS = __MINI__
  ? ALL_TABS.filter((t) => t.key !== 'market')
  : ALL_TABS;

export default function SingleApp() {
  const [darkMode, setDarkMode] = useState<'system' | 'light' | 'dark'>(() => {
    return (localStorage.getItem('beizitie-dark') as any) || 'system';
  });
  const prefersDark = useMediaQuery('(prefers-color-scheme: dark)');
  const mode = darkMode === 'system' ? (prefersDark ? 'dark' : 'light') : darkMode;
  const theme = useMemo(() => createTheme(buildThemeOptions(mode)), [mode]);

  const [tab, setTab] = useState<Tab>('dashboard');
  const [studyingDeck, setStudyingDeck] = useState<{ id: string; name: string } | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    localStorage.setItem('beizitie-dark', darkMode);
  }, [darkMode]);

  // mini：首启把包内字帖自动加进书库（addFromZitie 幂等，已加入会抛错忽略）
  useEffect(() => {
    if (!__MINI__) return;
    (async () => {
      for (const zp of catalogIndex.zuopins) {
        try {
          const z = await localDataSource.catalog.zitie(zp.z);
          await localDataSource.library.addFromZitie(z, {
            name: zp.n, author: zp.a, dynasty: zp.d, styles: zp.s, cover: zp.c,
          });
        } catch { /* 已在书库 */ }
      }
      bumpRefresh();
    })();
  }, []);

  const bumpRefresh = () => setRefreshKey((k) => k + 1);

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <Box sx={{ pb: 'calc(64px + env(safe-area-inset-bottom, 0px))', minHeight: '100vh', bgcolor: 'background.default' }}>
        {studyingDeck ? (
          <StudyPage
            studyingDeck={studyingDeck}
            onExitStudy={() => { setStudyingDeck(null); bumpRefresh(); }}
          />
        ) : (
          <>
            {/* 顶栏 */}
            <Box
              sx={{
                px: 2, py: 1.2, display: 'flex', alignItems: 'center', gap: 1.2,
                borderBottom: '1px solid', borderColor: 'divider',
                position: 'sticky', top: 0, zIndex: 10, bgcolor: 'background.paper',
              }}
            >
              <Typography className="font-kai" sx={{ fontSize: 20, fontWeight: 700 }}>背字帖</Typography>
              <Typography variant="caption" color="text.secondary" sx={{ fontSize: 10 }}>
                {__MINI__ ? '离线版 · 进度保存在本机' : '单文件版 · 数据仅存本机'}
              </Typography>
            </Box>

            <Box sx={{ p: { xs: 1.5, sm: 3 } }}>
              {tab === 'dashboard' && (
                <DashboardPage
                  refreshKey={refreshKey}
                  onStudy={(id, name) => setStudyingDeck({ id, name })}
                  onChangeTab={setTab}
                  onNotify={setToast}
                />
              )}
              {tab === 'market' && (
                <MarketPage onSubscribed={(name) => { setToast(`《${name}》已加入书库`); bumpRefresh(); }} />
              )}
              {tab === 'jizi' && <JiziPage />}
              {tab === 'data' && <DataPage refreshKey={refreshKey} />}
              {tab === 'settings' && <SettingsPage darkMode={darkMode} onDarkModeChange={setDarkMode} onChanged={bumpRefresh} />}
            </Box>

            {/* 底部导航（与在线版一致；集字待 P2） */}
            <Box
              sx={{
                position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 20,
                display: 'flex', bgcolor: 'background.paper', borderTop: '1px solid', borderColor: 'divider',
                paddingBottom: 'env(safe-area-inset-bottom, 0px)',
              }}
            >
              {TABS.map((t) => (
                <Box
                  key={t.key}
                  onClick={() => setTab(t.key)}
                  sx={{
                    flex: 1, py: 1, cursor: 'pointer', textAlign: 'center',
                    color: tab === t.key ? 'primary.main' : 'text.secondary',
                    bgcolor: tab === t.key ? 'action.selected' : 'transparent',
                  }}
                >
                  {t.icon}
                  <Typography sx={{ fontSize: 11 }}>{t.label}</Typography>
                </Box>
              ))}
            </Box>

            <Snackbar open={!!toast} autoHideDuration={2500} onClose={() => setToast(null)}>
              <Alert severity="success" onClose={() => setToast(null)}>{toast}</Alert>
            </Snackbar>
          </>
        )}
      </Box>
    </ThemeProvider>
  );
}
