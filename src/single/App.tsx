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
import { buildThemeOptions } from '@/theme';
import { localDataSource, catalogIndex, resyncBundledImages } from '@/data/local/localAdapter';
import { kvGet, kvSet } from '@/data/local/db';
import DashboardPage from './pages/DashboardPage';
import MarketPage from '@pages/market';
import StudyPage from './pages/StudyPage';
import JiziPage from '@pages/jizi';
import DataPage from '@data-page';
import SettingsPage from './pages/SettingsPage';

type Tab = 'dashboard' | 'market' | 'jizi' | 'data' | 'settings';

const ALL_TABS: { key: Tab; en: string; cn: string }[] = [
  { key: 'dashboard', en: 'TODAY', cn: '今日' },
  { key: 'market', en: 'MARKET', cn: '市场' },
  { key: 'jizi', en: 'JIZI', cn: '集字' },
  { key: 'data', en: 'STATS', cn: '数据' },
  { key: 'settings', en: 'SET', cn: '设置' },
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

  // mini：包内字帖自动进书库。按数据版本 stamp 跳过——用户删过的帖不会每次启动都复活
  useEffect(() => {
    if (!__MINI__) return;
    (async () => {
      // 图地址迁移每次启动都跑：极轻（内存比对），兜住升级竞态
      await resyncBundledImages();
      const stamp = (catalogIndex as { updatedAt?: string }).updatedAt || '';
      if ((await kvGet('miniDataStamp')) === stamp) { bumpRefresh(); return; }
      for (const zp of catalogIndex.zuopins) {
        try {
          const z = await localDataSource.catalog.zitie(zp.z);
          await localDataSource.library.addFromZitie(z, {
            name: zp.n, author: zp.a, dynasty: zp.d, styles: zp.s, cover: zp.c,
          });
        } catch { /* 已在书库 */ }
      }
      await kvSet('miniDataStamp', stamp);
      bumpRefresh();
    })();
  }, []);

  const bumpRefresh = () => setRefreshKey((k) => k + 1);

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <Box sx={{ minHeight: '100vh', bgcolor: 'background.default', display: 'flex', flexDirection: 'column' }}>
        {studyingDeck ? (
          <StudyPage
            studyingDeck={studyingDeck}
            onExitStudy={() => { setStudyingDeck(null); bumpRefresh(); }}
          />
        ) : (
          <>
            {/* 桌面顶栏：字标 + 中英导航 + 本机说明 */}
            <Box
              sx={{
                display: { xs: 'none', md: 'flex' },
                alignItems: 'center',
                gap: 3,
                px: 5,
                height: 64,
                borderBottom: '2px solid',
                borderColor: 'text.primary',
                position: 'sticky',
                top: 0,
                zIndex: 10,
                bgcolor: 'background.default',
              }}
            >
              <Typography sx={{ fontSize: 28, fontWeight: 900, letterSpacing: '0.14em', lineHeight: 1 }}>背字帖</Typography>
              <Box sx={{ display: 'flex', alignSelf: 'stretch' }}>
                {TABS.map((t) => {
                  const on = tab === t.key;
                  return (
                    <Box
                      key={t.key}
                      component="button"
                      type="button"
                      onClick={() => setTab(t.key)}
                      aria-pressed={on}
                      sx={{
                        border: 0,
                        background: 'none',
                        color: 'inherit',
                        px: 1.75,
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 0.75,
                        borderBottom: on ? '2px solid' : '2px solid transparent',
                        borderColor: on ? 'text.primary' : 'transparent',
                        mb: '-2px',
                        opacity: on ? 1 : 0.62,
                        '&:hover': { opacity: 1 },
                      }}
                    >
                      <Box component="span" sx={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, letterSpacing: '0.12em' }}>{t.en}</Box>
                      <Box component="span" sx={{ fontSize: 13.5, fontWeight: 700, letterSpacing: '0.06em' }}>{t.cn}</Box>
                    </Box>
                  );
                })}
              </Box>
              <Box sx={{ ml: 'auto', fontFamily: 'var(--font-mono)', fontSize: 10.5, letterSpacing: '0.04em', opacity: 0.6 }}>
                {__MINI__ ? '离线版 · 数据仅存本机' : '单文件版 · 数据仅存本机'}
              </Box>
            </Box>

            {/* 手机字标栏 */}
            <Box
              sx={{
                display: { xs: 'flex', md: 'none' },
                alignItems: 'baseline',
                justifyContent: 'space-between',
                px: 2.5,
                height: 56,
                borderBottom: '1px solid',
                borderColor: 'text.primary',
                position: 'sticky',
                top: 0,
                zIndex: 10,
                bgcolor: 'background.default',
              }}
            >
              <Typography sx={{ fontSize: 22, fontWeight: 900, letterSpacing: '0.12em' }}>背字帖</Typography>
              <Typography sx={{ fontFamily: 'var(--font-mono)', fontSize: 9.5, letterSpacing: '0.04em', opacity: 0.6 }}>
                {__MINI__ ? '离线版 · 仅存本机' : '单文件版 · 仅存本机'}
              </Typography>
            </Box>

            <Box
              component="main"
              sx={{
                flex: 1,
                width: '100%',
                maxWidth: 1440,
                mx: 'auto',
                px: { xs: 2.5, md: 5 },
                pt: { xs: 2, md: 2.5 },
                pb: { xs: 'calc(74px + env(safe-area-inset-bottom, 0px))', md: 3 },
              }}
            >
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

            {/* 手机底部导航 */}
            <Box
              sx={{
                display: { xs: 'flex', md: 'none' },
                position: 'fixed',
                bottom: 0,
                left: 0,
                right: 0,
                zIndex: 20,
                bgcolor: 'background.default',
                borderTop: '1px solid',
                borderColor: 'text.primary',
                paddingBottom: 'env(safe-area-inset-bottom, 0px)',
              }}
            >
              {TABS.map((t) => {
                const on = tab === t.key;
                return (
                  <Box
                    key={t.key}
                    component="button"
                    type="button"
                    onClick={() => setTab(t.key)}
                    aria-current={on ? 'page' : undefined}
                    sx={{
                      flex: 1,
                      py: 0.75,
                      border: 0,
                      borderTop: on ? '3px solid var(--vermilion)' : '3px solid transparent',
                      background: 'none',
                      color: on ? 'text.primary' : 'text.secondary',
                      cursor: 'pointer',
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      gap: 0.25,
                    }}
                  >
                    <Box component="span" sx={{ fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.1em', opacity: 0.7 }}>{t.en}</Box>
                    <Box component="span" sx={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.06em' }}>{t.cn}</Box>
                  </Box>
                );
              })}
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
