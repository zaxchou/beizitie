import { useMemo } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { ThemeProvider, createTheme, CssBaseline, useMediaQuery } from '@mui/material';
import { useSettingsStore } from '@/stores/useSettingsStore';
import { buildThemeOptions } from '@/theme';
import AppShell from '@/components/layout/AppShell';
import DashboardPage from '@/pages/DashboardPage';
import StudyPage from '@/pages/StudyPage';
import DecksPage from '@/pages/DecksPage';
import DeckPage from '@/pages/DeckPage';
import CardManagePage from '@/pages/CardManagePage';
import SettingsPage from '@/pages/SettingsPage';
import UserManagePage from '@/pages/UserManagePage';
import AdminDashboardPage from '@/pages/AdminDashboardPage';
import AnalyticsPage from '@/pages/AnalyticsPage';
import MarketPage from '@/pages/MarketPage';
import JiziPage from '@/pages/JiziPage';
import NotFoundPage from '@/pages/NotFoundPage';
import LoginPage from '@/pages/LoginPage';
import RegisterPage from '@/pages/RegisterPage';
import { ProtectedRoute } from '@/components/auth/ProtectedRoute';

function App() {
  const darkMode = useSettingsStore((s) => s.darkMode);
  const prefersDark = useMediaQuery('(prefers-color-scheme: dark)');

  const resolvedMode: 'light' | 'dark' =
    darkMode === 'dark'
      ? 'dark'
      : darkMode === 'system'
        ? (prefersDark ? 'dark' : 'light')
        : 'light';

  const theme = useMemo(
    () => createTheme(buildThemeOptions(resolvedMode)),
    [resolvedMode]
  );

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />
          {/* 集字公开访问（不需要登录） */}
          <Route element={<AppShell />}>
            <Route path="/jizi" element={<JiziPage />} />
          </Route>
          <Route element={<ProtectedRoute />}>
            <Route element={<AppShell />}>
              <Route path="/" element={<DashboardPage />} />
              <Route path="/dashboard" element={<DashboardPage />} />
              <Route path="/study/:deckId" element={<StudyPage />} />
              <Route path="/decks" element={<DecksPage />} />
              <Route path="/decks/:deckId" element={<DeckPage />} />
              <Route path="/decks/:deckId/cards" element={<CardManagePage />} />
              <Route path="/market" element={<MarketPage />} />
              <Route path="/settings" element={<SettingsPage />} />
              <Route path="/settings/users" element={<UserManagePage />} />
              <Route path="/settings/admin-dashboard" element={<AdminDashboardPage />} />
              <Route path="/analytics" element={<AnalyticsPage />} />
              <Route path="*" element={<NotFoundPage />} />
            </Route>
          </Route>
        </Routes>
      </BrowserRouter>
    </ThemeProvider>
  );
}

export default App;
