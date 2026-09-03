/**
 * 单文件版 App 装配（无登录、本地数据）
 */
import { useEffect, useMemo, useState } from 'react';
import {
  Box,
  CssBaseline,
  Snackbar,
  Alert,
  Typography,
  Badge,
  createTheme,
  ThemeProvider,
  useMediaQuery,
} from '@mui/material';
import { buildThemeOptions } from '@/theme';
import { LibraryPage } from './pages/LibraryPage';
import { MarketPage } from './pages/MarketPage';
import { StudyPage } from './pages/StudyPage';
import { SettingsPage } from './pages/SettingsPage';

type Tab = 'library' | 'market' | 'study' | 'settings';

const TABS: { key: Tab; label: string; icon: string }[] = [
  { key: 'library', label: '书库', icon: '📚' },
  { key: 'market', label: '市场', icon: '🏛' },
  { key: 'study', label: '学习', icon: '🖌' },
  { key: 'settings', label: '设置', icon: '⚙' },
];

export default function SingleApp() {
  const [darkMode, setDarkMode] = useState<'system' | 'light' | 'dark'>(() => {
    return (localStorage.getItem('beizitie-dark') as any) || 'system';
  });
  const prefersDark = useMediaQuery('(prefers-color-scheme: dark)');
  const mode = darkMode === 'system' ? (prefersDark ? 'dark' : 'light') : darkMode;
  const theme = useMemo(() => createTheme(buildThemeOptions(mode)), [mode]);

  const [tab, setTab] = useState<Tab>('library');
  const [studyingDeck, setStudyingDeck] = useState<{ id: string; name: string } | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    localStorage.setItem('beizitie-dark', darkMode);
  }, [darkMode]);

  const goStudy = (deckId: string, name: string) => {
    setStudyingDeck({ id: deckId, name });
    setTab('study');
  };

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <Box sx={{ pb: '64px', minHeight: '100vh', bgcolor: 'background.default' }}>
        {/* 顶栏 */}
        <Box
          sx={{
            px: 2, py: 1.2, display: 'flex', alignItems: 'center', gap: 1.2,
            borderBottom: '1px solid', borderColor: 'divider',
            position: 'sticky', top: 0, zIndex: 10, bgcolor: 'background.paper',
          }}
        >
          <Typography className="font-kai" sx={{ fontSize: 20, fontWeight: 700 }}>
            背字帖
          </Typography>
          <Typography variant="caption" color="text.secondary" sx={{ fontSize: 10 }}>
            单文件版 · 数据仅存本机
          </Typography>
        </Box>

        <Box sx={{ p: { xs: 1.5, sm: 3 } }}>
          {tab === 'library' && <LibraryPage onStudy={goStudy} onChangeTab={setTab} />}
          {tab === 'market' && <MarketPage onSubscribed={(name) => setToast(`《${name}》已加入书库`)} />}
          {tab === 'study' && (
            <StudyPage
              studyingDeck={studyingDeck}
              onPickDeck={() => setTab('library')}
              onExitStudy={() => setStudyingDeck(null)}
            />
          )}
          {tab === 'settings' && <SettingsPage onDarkModeChange={setDarkMode} darkMode={darkMode} />}
        </Box>

        {/* 底部导航 */}
        <Box
          sx={{
            position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 20,
            display: 'flex', bgcolor: 'background.paper', borderTop: '1px solid', borderColor: 'divider',
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
              <Badge
                color="primary"
                variant="dot"
                invisible={!(t.key === 'study' && studyingDeck)}
              >
                <Typography sx={{ fontSize: 18, lineHeight: 1 }}>{t.icon}</Typography>
              </Badge>
              <Typography sx={{ fontSize: 11 }}>{t.label}</Typography>
            </Box>
          ))}
        </Box>

        <Snackbar open={!!toast} autoHideDuration={2500} onClose={() => setToast(null)}>
          <Alert severity="success" onClose={() => setToast(null)}>{toast}</Alert>
        </Snackbar>
      </Box>
    </ThemeProvider>
  );
}
