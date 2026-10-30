import React, { useEffect, useCallback, useState } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import {
  Box,
  Alert,
  Button,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogContentText,
  DialogActions,
  Stack,
  Typography,
  Slider,
  Chip,
  useTheme,
  useMediaQuery,
} from '@mui/material';
import PauseCircleIcon from '@mui/icons-material/PauseCircle';
import ShuffleIcon from '@mui/icons-material/Shuffle';
import SortIcon from '@mui/icons-material/Sort';
import FormatListBulletedIcon from '@mui/icons-material/FormatListBulleted';
import { useStudyStore } from '@/stores/useStudyStore';
import { useDeckStore } from '@/stores/useDeckStore';
import { fetchDecks, endStudySession as endStudySessionApi, getImageUrl, hasStudiedDeck, updateStudyMode, updateDeckLimits } from '@/lib/api';
import FlashCard from '@/components/study/FlashCard';
import RatingButtons from '@/components/study/RatingButtons';
import StudyComplete from '@/components/study/StudyComplete';
import { LoadingState } from '@/components/common/LoadingState';
import type { Rating } from '@/types';

type StudyMode = 'default' | 'sequential' | 'random';

/**
 * 学习页面。
 * 首次进牌组弹设置向导（新卡上限 + 复习上限 + 学习模式），之后直接启动。
 */
const StudyPage: React.FC = () => {
  const { deckId } = useParams<{ deckId: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const difficultyFilter = searchParams.get('difficulty');
  const {
    phase,
    queue,
    currentIndex,
    session,
    loading,
    error,
    startSession,
    rateCard,
    endSession,
    reset,
  } = useStudyStore();

  const theme = useTheme();
  const isPc = useMediaQuery(theme.breakpoints.up('md'));
  const [deckName, setDeckName] = useState('学习');
  const [flipped, setFlipped] = useState(false);
  const [confirmExit, setConfirmExit] = useState(false);
  const [elapsed, setElapsed] = useState(0);

  // 首次设置向导
  const [setupOpen, setSetupOpen] = useState(false);
  const [setupNewLimit, setSetupNewLimit] = useState(20);
  const [setupReviewLimit, setSetupReviewLimit] = useState(200);
  const [setupMode, setSetupMode] = useState<StudyMode>('default');
  const [hasArticle, setHasArticle] = useState(false);

  // 加载并判断是否首次
  useEffect(() => {
    if (!deckId) return;
    const init = async () => {
      const [decks, { has_studied }] = await Promise.all([
        fetchDecks(),
        hasStudiedDeck(deckId!),
      ]);
      const deck = decks.find((d) => d.id === deckId);
      setDeckName(deck?.name ?? '学习');
      setHasArticle(!!deck?.article_text);

      // 如果牌组已暂停，直接显示暂停占位 UI
      if (deck?.paused_at) {
        useStudyStore.setState({
          phase: 'complete',
          deckId: deckId!,
          queue: [],
          currentIndex: 0,
          session: {
            id: crypto.randomUUID(),
            deck_id: deckId!,
            started_at: new Date().toISOString(),
            ended_at: new Date().toISOString(),
            cards_studied: 0,
            ratings: { again: 0, hard: 0, good: 0, easy: 0 },
          },
          loading: false,
        });
        return;
      }

      if (has_studied) {
        // 已有学习记录 → 直接启动（从 deck 读已保存的设置）
        await startSession(
          deckId!,
          deck?.daily_new_card_limit,
          deck?.daily_review_limit,
          difficultyFilter || undefined,
          deck?.study_mode || 'default',
        );
      } else {
        // 首次 → 弹向导
        setSetupNewLimit(deck?.daily_new_card_limit ?? 20);
        setSetupReviewLimit(deck?.daily_review_limit ?? 200);
        setSetupMode(deck?.study_mode || 'default');
        setSetupOpen(true);
      }
    };
    init();

    return () => {
      const state = useStudyStore.getState();
      if (state.session && state.phase === 'studying') {
        state.endSession().catch(() => {});
      }
      reset();
    };
  }, [deckId, startSession, reset]);

  // 向导确认
  const handleSetupConfirm = useCallback(async () => {
    if (!deckId) return;
    setSetupOpen(false);
    // 保存设置到后端
    await Promise.all([
      updateDeckLimits(deckId, { daily_new_card_limit: setupNewLimit, daily_review_limit: setupReviewLimit }),
      updateStudyMode(deckId, setupMode),
    ]);
    await startSession(deckId, setupNewLimit, setupReviewLimit, difficultyFilter || undefined, setupMode);
  }, [deckId, setupNewLimit, setupReviewLimit, setupMode, difficultyFilter, startSession]);

  // 学习计时器
  useEffect(() => {
    if (phase !== 'studying' || !session?.started_at || !session?.id) {
      setElapsed(0);
      return;
    }
    const startedAt = session.started_at;
    const sid = session.id;

    const tick = () => {
      const start = new Date(startedAt).getTime();
      const now = Date.now();
      setElapsed(Math.max(0, Math.floor((now - start) / 1000)));
    };
    tick();
    const timerId = setInterval(tick, 1000);

    const persistId = setInterval(async () => {
      try { await endStudySessionApi(sid, { ended_at: new Date().toISOString() }); } catch { /* 静默 */ }
    }, 10000);
    endStudySessionApi(sid, { ended_at: new Date().toISOString() }).catch(() => {});

    const onUnload = () => {
      try {
        const raw = localStorage.getItem('auth-storage');
        if (!raw) return;
        const token = JSON.parse(raw)?.state?.token;
        if (token) {
          fetch(`/api/study-sessions/${sid}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify({ ended_at: new Date().toISOString() }),
            keepalive: true,
          });
        }
      } catch { /* ignore */ }
    };
    window.addEventListener('beforeunload', onUnload);

    return () => {
      clearInterval(timerId);
      clearInterval(persistId);
      window.removeEventListener('beforeunload', onUnload);
    };
  }, [phase, session?.started_at, session?.id]);

  const fmtTime = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  };

  useEffect(() => {
    const PRELOAD_COUNT = 3;
    for (let i = 1; i <= PRELOAD_COUNT; i++) {
      const nextCard = queue[currentIndex + i];
      if (nextCard?.image_url) {
        const img = new Image();
        img.src = getImageUrl(nextCard.image_url);
      }
    }
  }, [queue, currentIndex]);

  const handleFlip = useCallback(() => setFlipped((prev) => !prev), []);

  const handleRate = useCallback(async (rating: Rating) => {
    setFlipped(false);
    await rateCard(rating);
  }, [rateCard]);

  const handleRequestExit = useCallback(() => {
    if (phase === 'studying' && (session?.cards_studied ?? 0) > 0) {
      setConfirmExit(true);
    } else {
      handleConfirmExit();
    }
  }, [phase, session?.cards_studied]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const t = e.target as HTMLElement | null;
      const tag = t?.tagName ?? '';
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t?.isContentEditable) return;
      if (confirmExit || setupOpen) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        handleRequestExit();
        return;
      }
      // 只有焦点不在任何控件上时才接管空格，卡片按钮自己处理 Enter/Space
      if (e.code === 'Space' && (t === document.body || t === document.documentElement)) {
        e.preventDefault();
        setFlipped((f) => !f);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [confirmExit, setupOpen, handleRequestExit]);

  const handleConfirmExit = useCallback(async () => {
    setConfirmExit(false);
    if (phase === 'studying' && session) {
      try { await endSession(); } catch { /* ignore */ }
    }
    navigate('/');
  }, [phase, session, endSession, navigate]);

  // 首次设置弹窗
  if (setupOpen) {
    return (
      <Dialog open maxWidth="xs" fullWidth>
        <DialogTitle sx={{ textAlign: 'center', fontWeight: 600 }}>
          学习设置
        </DialogTitle>
        <DialogContent>
          <Stack spacing={2.5} sx={{ mt: 1 }}>
            <Box>
              <Typography variant="body2" fontWeight={500} gutterBottom>
                每日新卡上限：{setupNewLimit}
              </Typography>
              <Slider value={setupNewLimit} onChange={(_, v) => setSetupNewLimit(v as number)} min={1} max={100} step={1} valueLabelDisplay="auto" />
            </Box>
            <Box>
              <Typography variant="body2" fontWeight={500} gutterBottom>
                每日复习上限：{setupReviewLimit}
              </Typography>
              <Slider value={setupReviewLimit} onChange={(_, v) => setSetupReviewLimit(v as number)} min={1} max={500} step={1} valueLabelDisplay="auto" />
            </Box>
            <Box>
              <Typography variant="body2" fontWeight={500} gutterBottom>
                学习模式
              </Typography>
              <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                {([
                  { value: 'default' as StudyMode, label: '默认', icon: <FormatListBulletedIcon /> },
                  { value: 'sequential' as StudyMode, label: '碑帖文本', icon: <SortIcon /> },
                  { value: 'random' as StudyMode, label: '随机', icon: <ShuffleIcon /> },
                ]).map((opt) => {
                  const disabled = opt.value === 'sequential' && !hasArticle;
                  return (
                    <Chip
                      key={opt.value}
                      icon={opt.icon}
                      label={opt.label}
                      variant={setupMode === opt.value ? 'filled' : 'outlined'}
                      color={setupMode === opt.value ? 'primary' : 'default'}
                      onClick={() => { if (!disabled) setSetupMode(opt.value); }}
                      sx={{ cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.4 : 1 }}
                    />
                  );
                })}
              </Stack>
            </Box>
            <Button variant="contained" size="large" fullWidth onClick={handleSetupConfirm} sx={{ mt: 1 }}>
              开始学习
            </Button>
          </Stack>
        </DialogContent>
      </Dialog>
    );
  }

  // 加载状态
  if (phase === 'loading' || loading) {
    return <LoadingState message="正在准备学习..." />;
  }

  // 错误状态
  if (error) {
    return (
      <Box className="py-4">
        <Alert severity="error" className="mb-4">{error}</Alert>
        <Alert severity="info" action={
          <Box component="button" onClick={() => startSession(deckId!)} className="cursor-pointer bg-transparent border-0 underline" style={{ color: 'var(--vermilion)' }}>重试</Box>
        }>加载学习内容失败</Alert>
      </Box>
    );
  }

  // 学习阶段
  if (phase === 'studying' && queue.length > 0 && currentIndex < queue.length) {
    const currentCard = queue[currentIndex];
    const progress = Math.round(((currentIndex + 1) / Math.max(1, queue.length)) * 100);
    const mono = { fontFamily: 'var(--font-mono)', letterSpacing: '0.04em' } as const;
    const sm2 = currentCard
      ? { ease: currentCard.ease, interval: currentCard.interval, repetitions: currentCard.repetitions }
      : undefined;

    return (
      <Box sx={{ height: '100dvh', display: 'flex', flexDirection: 'column', backgroundColor: 'background.default' }}>
        {/* 顶栏：返回 / 帖名 / 进度 / 计时 */}
        <Box
          sx={{
            flexShrink: 0,
            height: { xs: 56, md: 64 },
            display: 'flex',
            alignItems: 'center',
            gap: { xs: 1.5, md: 2.5 },
            px: { xs: 2, md: 5 },
            borderBottom: '2px solid',
            borderColor: 'text.primary',
          }}
        >
          <Box
            component="button"
            onClick={handleRequestExit}
            sx={{
              border: 0,
              background: 'none',
              p: 0,
              cursor: 'pointer',
              color: 'text.primary',
              ...mono,
              fontSize: 11,
              opacity: 0.75,
              '&:hover': { opacity: 1 },
            }}
          >
            ← 返回
          </Box>
          <Typography
            noWrap
            sx={{ fontSize: { xs: 15, md: 19 }, fontWeight: 900, letterSpacing: '0.06em', minWidth: 0, flex: '0 1 auto' }}
          >
            {deckName}
          </Typography>
          <Box sx={{ ml: 'auto', display: 'flex', gap: { xs: 1.5, md: 2.5 }, ...mono, fontSize: 11, opacity: 0.8, fontVariantNumeric: 'tabular-nums' }}>
            <span>{currentIndex + 1} / {queue.length}</span>
            <span>{fmtTime(elapsed)}</span>
          </Box>
        </Box>
        <Box sx={{ flexShrink: 0, height: 3, backgroundColor: 'divider' }}>
          <Box sx={{ width: `${progress}%`, height: '100%', backgroundColor: 'text.primary' }} />
        </Box>

        {isPc ? (
          <Box sx={{ flex: 1, minHeight: 0, display: 'grid', gridTemplateColumns: '1fr 380px' }}>
            <Box sx={{ minHeight: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', p: 5 }}>
              <Box sx={{ width: '100%', height: '100%', maxWidth: 560, maxHeight: 560, display: 'flex' }}>
                <FlashCard key={currentCard.id} card={currentCard} flipped={flipped} onFlip={handleFlip} fill bare />
              </Box>
            </Box>

            <Box
              sx={{
                borderLeft: '2px solid',
                borderColor: 'text.primary',
                px: '30px',
                py: '26px',
                display: 'flex',
                flexDirection: 'column',
                minHeight: 0,
              }}
            >
              <Typography sx={{ ...mono, fontSize: 10, letterSpacing: '0.16em', textTransform: 'uppercase', opacity: 0.65 }}>
                Copying · 正在背写
              </Typography>
              <Typography
                sx={{
                  fontSize: 26,
                  fontWeight: 900,
                  letterSpacing: '0.08em',
                  mt: 0.5,
                  display: '-webkit-box',
                  WebkitLineClamp: 2,
                  WebkitBoxOrient: 'vertical',
                  overflow: 'hidden',
                }}
              >
                {deckName}
              </Typography>
              <Typography sx={{ ...mono, fontSize: 10.5, opacity: 0.7, mt: 0.75 }}>
                第 {currentIndex + 1} 字 / 共 {queue.length} · 已保存 {session?.cards_studied ?? 0} 字
              </Typography>
              <Box sx={{ borderTop: '1px solid', borderColor: 'text.primary', my: 2.5 }} />
              <Typography sx={{ fontSize: 22, fontWeight: 900, lineHeight: 1.5, letterSpacing: '0.02em' }}>
                这个字，<br />原帖怎么写？
              </Typography>
              <Box sx={{ flex: 1 }} />
              <RatingButtons layout="list" onRate={handleRate} disabled={!flipped || confirmExit} card={sm2} />
              <Typography sx={{ ...mono, fontSize: 10, lineHeight: 1.9, opacity: 0.68, mt: 1.5 }}>
                评分后进入下一字<br />SM-2 自动排下次复习
              </Typography>
            </Box>
          </Box>
        ) : (
          <Box sx={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', px: 2.5, pt: 1.75, pb: 'calc(6px + env(safe-area-inset-bottom, 0px))', gap: 1.25 }}>
            <Box
              sx={{
                flex: 1,
                minHeight: 0,
                border: '2px solid',
                borderColor: 'text.primary',
                backgroundColor: 'background.paper',
                p: 2,
                display: 'flex',
              }}
            >
              <FlashCard key={currentCard.id} card={currentCard} flipped={flipped} onFlip={handleFlip} fill bare />
            </Box>
            <Typography sx={{ fontSize: 19, fontWeight: 900, letterSpacing: '0.02em', flexShrink: 0 }}>
              这个字，原帖怎么写？
            </Typography>
            <Typography sx={{ ...mono, fontSize: 10, opacity: 0.7, flexShrink: 0 }}>
              先看今字，回想原帖的起收笔与结构，再翻面对照。
            </Typography>
            <RatingButtons onRate={handleRate} disabled={!flipped || confirmExit} card={sm2} />
            <Typography sx={{ ...mono, fontSize: 10, opacity: 0.65, flexShrink: 0 }}>
              1–4 评分 · 空格翻面 · 已保存 {session?.cards_studied ?? 0} 字
            </Typography>
          </Box>
        )}

        <Dialog open={confirmExit} onClose={() => setConfirmExit(false)}>
          <DialogTitle>中断当前学习？</DialogTitle>
          <DialogContent>
            <DialogContentText>已背写 {session?.cards_studied ?? 0} 字，进度会保留。确认要离开吗？</DialogContentText>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setConfirmExit(false)}>继续学习</Button>
            <Button onClick={handleConfirmExit} color="error" variant="contained">确认离开</Button>
          </DialogActions>
        </Dialog>
      </Box>
    );
  }

  if (phase === 'complete' && session) {
    // 暂停状态占位 UI
    const pausedDeck = useDeckStore.getState().decks.find(d => d.id === deckId);
    if (pausedDeck?.paused_at) {
      return (
        <Box className="flex flex-col items-center justify-center py-12 px-4 min-h-[60vh]">
          <PauseCircleIcon color="warning" sx={{ fontSize: 64, mb: 2 }} />
          <Typography variant="h4" className="font-kai mb-2" fontWeight={600}>
            已暂停学习
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 4 }}>
            该帖已暂停，到「帖详情」里恢复学习
          </Typography>
          <Button variant="contained" size="large" onClick={handleConfirmExit}
            sx={{ px: 6, py: 1.5, borderRadius: '2px', fontSize: 16 }}>
            返回
          </Button>
        </Box>
      );
    }
    return <StudyComplete session={session} onBackToDashboard={handleConfirmExit} />;
  }

  return <LoadingState message="正在准备学习..." />;
};

export default StudyPage;
