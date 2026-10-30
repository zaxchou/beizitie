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
} from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import PauseCircleIcon from '@mui/icons-material/PauseCircle';
import ShuffleIcon from '@mui/icons-material/Shuffle';
import SortIcon from '@mui/icons-material/Sort';
import FormatListBulletedIcon from '@mui/icons-material/FormatListBulleted';
import { useStudyStore } from '@/stores/useStudyStore';
import { useDeckStore } from '@/stores/useDeckStore';
import { fetchDecks, endStudySession as endStudySessionApi, getImageUrl, hasStudiedDeck, updateStudyMode, updateDeckLimits } from '@/lib/api';
import FlashCard from '@/components/study/FlashCard';
import ProgressBar from '@/components/study/ProgressBar';
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
    return (
      <Box className="flex flex-col items-center gap-6 py-4 relative" sx={{ height: '100%', overflow: 'hidden', width: '100%', maxWidth: 640, mx: 'auto', px: 2 }}>
        <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ flexShrink: 0, width: '100%', maxWidth: 'lg', mx: 'auto' }}>
          <Button onClick={handleRequestExit} size="small" startIcon={<ArrowBackIcon />}
            sx={{ color: 'text.secondary', textTransform: 'none', fontWeight: 500 }}>返回</Button>
          <Typography variant="caption" color="text.secondary" sx={{ px: 1, fontSize: 12, fontVariantNumeric: 'tabular-nums' }}>
            {fmtTime(elapsed)}
          </Typography>
        </Stack>
        <Box sx={{ width: '100%', flexShrink: 0 }}>
          <ProgressBar current={currentIndex + 1} total={queue.length} />
        </Box>
        <Box sx={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', width: '100%', overflow: 'hidden' }}>
          <FlashCard key={currentCard.id} card={currentCard} flipped={flipped} onFlip={handleFlip} fill />
        </Box>
        <Box className="w-full max-w-lg" sx={{ flexShrink: 0 }}>
          <RatingButtons onRate={handleRate} disabled={!flipped}
            card={currentCard ? { ease: currentCard.ease, interval: currentCard.interval, repetitions: currentCard.repetitions } : undefined} />
        </Box>
        <Dialog open={confirmExit} onClose={() => setConfirmExit(false)}>
          <DialogTitle>中断当前学习？</DialogTitle>
          <DialogContent>
            <DialogContentText>已完成 {session?.cards_studied ?? 0} 张卡片，进度会保留。确认要离开吗？</DialogContentText>
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
            该牌组已暂停，前往牌组管理页面恢复
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
