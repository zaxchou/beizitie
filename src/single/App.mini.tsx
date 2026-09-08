/**
 * 小红书 mini 专用壳（审核极简版）：整个工具只有一个功能——背《兰亭序》。
 * 无 tab、无市场 / 集字 / 数据 / 设置；主屏给今日概览（新学 / 复习 / 已学 / 全帖），
 * 启动自动把包内字帖装进本机书库，背完回主屏数字即刷新。
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Box,
  Button,
  CircularProgress,
  CssBaseline,
  Typography,
  createTheme,
  ThemeProvider,
  useMediaQuery,
} from '@mui/material';
import { buildThemeOptions } from '@/theme';
import { localDataSource, catalogIndex, resyncBundledImages } from '@/data/local/localAdapter';
import { kvGet, kvSet } from '@/data/local/db';
import StudyPage from './pages/StudyPage';

type DeckStats = Awaited<ReturnType<typeof localDataSource.library.list>>[number];

export default function MiniApp() {
  const prefersDark = useMediaQuery('(prefers-color-scheme: dark)');
  const mode = prefersDark ? 'dark' : 'light';
  const theme = useMemo(() => createTheme(buildThemeOptions(mode)), [mode]);

  const [deck, setDeck] = useState<DeckStats | null>(null);
  const [ready, setReady] = useState(false);
  const [studying, setStudying] = useState(false);

  const loadDeck = useCallback(async () => {
    const zp = catalogIndex.zuopins[0];
    const decks = await localDataSource.library.list();
    setDeck(decks.find((d) => d.zitieId === zp?.z) || null);
  }, []);

  useEffect(() => {
    (async () => {
      // 图地址迁移每次启动都跑：极轻（内存比对），兜住升级竞态
      await resyncBundledImages();
      const stamp = (catalogIndex as { updatedAt?: string }).updatedAt || '';
      if ((await kvGet('miniDataStamp')) !== stamp) {
        for (const zp of catalogIndex.zuopins) {
          try {
            const z = await localDataSource.catalog.zitie(zp.z);
            await localDataSource.library.addFromZitie(z, {
              name: zp.n, author: zp.a, dynasty: zp.d, styles: zp.s, cover: zp.c,
            });
          } catch { /* 已在书库 */ }
        }
        await kvSet('miniDataStamp', stamp);
      }
      // 包内帖 → 书库里的牌组（用户删过就不复活）
      await loadDeck();
      setReady(true);
    })();
  }, [loadDeck]);

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <Box sx={{ minHeight: '100vh', bgcolor: 'background.default', px: { xs: 1.5, sm: 3 }, pt: 1 }}>
        {!ready || (!studying && !deck) ? (
          <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', py: 10, gap: 2 }}>
            <CircularProgress size={28} />
            <Typography color="text.secondary" sx={{ fontSize: 13 }}>正在准备字帖…</Typography>
          </Box>
        ) : studying && deck ? (
          <StudyPage
            studyingDeck={{ id: deck.id, name: deck.name }}
            onExitStudy={() => { setStudying(false); void loadDeck(); }}
            exitLabel="主页"
          />
        ) : deck ? (
          <Box sx={{ maxWidth: 480, mx: 'auto', display: 'flex', flexDirection: 'column', alignItems: 'center', py: 6, gap: 3 }}>
            <Box sx={{ textAlign: 'center' }}>
              <Typography className="font-kai" sx={{ fontSize: 34, fontWeight: 700 }}>背字帖</Typography>
              <Typography variant="caption" color="text.secondary" sx={{ fontSize: 11 }}>离线版 · 进度保存在本机</Typography>
            </Box>

            <Box
              sx={{
                width: '100%', borderRadius: 3, border: '1px solid', borderColor: 'divider',
                bgcolor: 'background.paper', px: 3, py: 4, textAlign: 'center',
              }}
            >
              <Typography className="font-kai" sx={{ fontSize: 26, fontWeight: 700, mb: 0.5 }}>《{deck.name}》</Typography>
              <Typography color="text.secondary" sx={{ fontSize: 13, mb: 3 }}>
                {deck.author} · {deck.dynasty}
              </Typography>

              <Box sx={{ display: 'flex', justifyContent: 'space-around', mb: 3.5 }}>
                {[
                  { v: deck.newCount, l: '今日新学' },
                  { v: deck.reviewCount, l: '今日复习' },
                  { v: deck.learnedCount, l: '已学' },
                  { v: deck.totalCards, l: '全帖' },
                ].map((s) => (
                  <Box key={s.l} sx={{ textAlign: 'center' }}>
                    <Typography sx={{ fontWeight: 700, fontSize: 21 }}>{s.v}</Typography>
                    <Typography color="text.secondary" sx={{ fontSize: 11 }}>{s.l}</Typography>
                  </Box>
                ))}
              </Box>

              <Button fullWidth variant="contained" size="large" onClick={() => setStudying(true)} sx={{ borderRadius: 2 }}>
                开始背字
              </Button>
            </Box>

            <Typography variant="caption" color="text.disabled" sx={{ fontSize: 10, textAlign: 'center' }}>
              字帖图版仅供个人学习研究
            </Typography>
          </Box>
        ) : null}
      </Box>
    </ThemeProvider>
  );
}
