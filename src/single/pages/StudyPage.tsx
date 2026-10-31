import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Box, Typography, Button } from '@mui/material';
import FlashCard from '@/components/study/FlashCard';
import RatingButtons from '@/components/study/RatingButtons';
import ConfirmDialog from '@/components/common/ConfirmDialog';
import { localDataSource } from '@/data/local/localAdapter';
import { resolveImageSrc, warmDeckImages } from '@/data/local/imageCache';
import type { Card, Rating } from '@/types';
import type { LocalCard, LocalProgress } from '../../core/types';

interface Props {
  studyingDeck: { id: string; name: string };
  onExitStudy: () => void;
  /** 退出按钮文案（默认「书库」；mini 版回主页） */
  exitLabel?: string;
}

interface QueueItem {
  card: Card;
  isNew: boolean;
}

/** 本地卡 → 服务器版 Card 形状（FlashCard/导出格式兼容） */
function toCard(c: LocalCard, p: LocalProgress | null): Card {
  return {
    id: c.id,
    deck_id: c.deckId,
    front_text: c.hanzi,
    back_text: '',
    image_url: c.imageUrl,
    context: c.context ?? null,
    image_storage_path: '',
    ease: p?.ease ?? 2.5,
    interval: p?.interval ?? 0,
    repetitions: p?.repetitions ?? 0,
    next_review: p?.dueAt ?? new Date().toISOString(),
    last_review: p?.lastReviewed ?? null,
    created_at: '',
    updated_at: '',
    synced: false,
  };
}

export const StudyPage: React.FC<Props> = ({ studyingDeck, onExitStudy, exitLabel = '书库' }) => {
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [loading, setLoading] = useState(false);
  const [rated, setRated] = useState(0);
  const [sessionDone, setSessionDone] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [confirmExit, setConfirmExit] = useState(false);

  useEffect(() => {
    const t = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, []);
  const mmss = `${String(Math.floor(elapsed / 60)).padStart(2, '0')}:${String(elapsed % 60).padStart(2, '0')}`;

  const current = queue[index];
  const currentSrc = current?.card.image_url || '';

  // 字图离线缓存：命中 IDB 用本地 blob，未命中即时网络显示并后台缓存
  const [resolvedSrc, setResolvedSrc] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    // 换卡先清掉上一张的解析结果：blob 解析是异步的，旧值会串到新卡第一帧
    setResolvedSrc(null);
    if (!currentSrc) return;
    resolveImageSrc(currentSrc).then((s) => {
      if (alive) setResolvedSrc(s);
    });
    return () => {
      alive = false;
    };
  }, [currentSrc]);

  const progress = useMemo(() => {
    if (!current) return null;
    // FlashCard 只需要 SM-2 字段 + 文本/图片；进度实时覆盖；图片地址优先走离线缓存
    return { ...current.card, image_url: resolvedSrc || current.card.image_url };
  }, [current, resolvedSrc]);

  const start = useCallback(async (deckId: string) => {
    setLoading(true);
    try {
      const q = await localDataSource.study.queue(deckId);
      const items: QueueItem[] = q.items.map(({ card, progress: p }) => ({
        card: toCard(card, p),
        isNew: !p,
      }));
      setQueue(items);
      setIndex(0);
      setFlipped(false);
      setRated(0);
      setSessionDone(false);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (studyingDeck) start(studyingDeck.id);
  }, [studyingDeck, start]);

  // 学习开始后低并发预热整帖字图（断网也能继续学），退出学习即中止
  useEffect(() => {
    if (__MINI__) return; // 纯离线包无网络可预热；且 Chrome 61（审核基线）无 AbortController，new 即崩
    if (queue.length === 0) return;
    const ctrl = new AbortController();
    void warmDeckImages(queue.map((q) => q.card.image_url), () => ctrl.signal.aborted);
    return () => ctrl.abort();
  }, [queue]);

  const handleRate = async (rating: Rating) => {
    if (!current) return;
    await localDataSource.study.rate(current.card.id, rating);
    setRated((n) => n + 1);
    setFlipped(false);
    if (index + 1 >= queue.length) {
      setSessionDone(true);
    } else {
      setIndex((i) => i + 1);
    }
  };

  // 空格翻面 / ESC 退出（焦点在输入框时不抢键）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (document.activeElement?.tagName || '').toLowerCase();
      const typing = tag === 'input' || tag === 'textarea' || tag === 'select';
      if (e.code === 'Space' && !typing) {
        e.preventDefault();
        if (!sessionDone && queue.length > 0) setFlipped((f) => !f);
        return;
      }
      if (e.key === 'Escape') {
        if (rated > 0 && !sessionDone) setConfirmExit(true);
        else onExitStudy();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [rated, sessionDone, queue.length, onExitStudy]);

  // ---- 加载中 ----
  if (loading) {
    return <Typography sx={{ fontFamily: 'var(--font-mono)', fontSize: 11, opacity: 0.7, textAlign: 'center', py: 6 }}>正在出卡…</Typography>;
  }

  const done = sessionDone || queue.length === 0;
  const totalToday = queue.length;

  return (
    <Box sx={{ minHeight: '100dvh', display: 'flex', flexDirection: 'column', bgcolor: 'background.default' }}>
      {/* 顶栏：返回 / 帖名 / 进度 · 计时 */}
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: { xs: 1.5, md: 2.5 },
          px: { xs: 2, md: 4 },
          height: 56,
          flexShrink: 0,
          borderBottom: '1px solid',
          borderColor: 'text.primary',
        }}
      >
        <Box
          component="button"
          type="button"
          onClick={() => (rated > 0 && !sessionDone ? setConfirmExit(true) : onExitStudy())}
          sx={{
            border: 0,
            background: 'none',
            color: 'inherit',
            p: 0,
            cursor: 'pointer',
            fontFamily: 'var(--font-mono)',
            fontSize: 11,
            letterSpacing: '0.04em',
            opacity: 0.75,
            whiteSpace: 'nowrap',
            '&:hover': { opacity: 1, textDecoration: 'underline' },
          }}
        >
          ← {exitLabel}
        </Box>
        <Typography
          sx={{ fontSize: 13, fontWeight: 700, letterSpacing: '0.06em', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
        >
          {studyingDeck.name}
        </Typography>
        <Typography sx={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, letterSpacing: '0.04em', opacity: 0.7, whiteSpace: 'nowrap' }}>
          {done ? mmss : `${index + 1}/${totalToday} · ${mmss}`}
        </Typography>
      </Box>

      {/* 进度：一条 2px 墨线 */}
      {!done && (
        <Box sx={{ height: 2, bgcolor: 'divider', flexShrink: 0 }}>
          <Box sx={{ width: `${totalToday ? (index / totalToday) * 100 : 100}%`, height: '100%', bgcolor: 'text.primary', transition: 'width 200ms linear' }} />
        </Box>
      )}

      {done ? (
        <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', px: 3, textAlign: 'center' }}>
          <Typography className="font-kai" sx={{ fontSize: 96, fontWeight: 900, lineHeight: 1, opacity: 0.14 }}>畢</Typography>
          <Typography sx={{ mt: 2, fontSize: 18, fontWeight: 700, letterSpacing: '0.08em' }}>
            {queue.length === 0 ? '今日无需背写' : '本轮完成'}
          </Typography>
          <Typography sx={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, letterSpacing: '0.04em', opacity: 0.65, mt: 0.75 }}>
            {queue.length === 0 ? 'NOTHING DUE · 这帖今天没有到期的字' : `DONE · 共背写 ${rated} 字 · 用时 ${mmss}`}
          </Typography>
          <Button
            variant="contained"
            onClick={onExitStudy}
            sx={{ mt: 3, height: 46, px: 3, justifyContent: 'space-between', gap: 4 }}
          >
            <span>返回{exitLabel}</span>
            <span aria-hidden>→</span>
          </Button>
        </Box>
      ) : (
        <Box
          sx={{
            flex: 1,
            width: '100%',
            maxWidth: 760,
            mx: 'auto',
            px: { xs: 2.5, md: 4 },
            py: { xs: 2, md: 3 },
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            minHeight: 0,
          }}
        >
          <Typography sx={{ fontFamily: 'var(--font-mono)', fontSize: 9.5, letterSpacing: '0.16em', opacity: 0.6 }}>
            {current.isNew ? 'NEW · 新字' : 'REVIEW · 复习'}
          </Typography>
          <Typography sx={{ fontSize: { xs: 14, md: 15 }, fontWeight: 500, letterSpacing: '0.14em', mt: 0.75 }}>
            这个字，原帖怎么写？
          </Typography>

          {/* 卡面：翻面前是今字，翻面后是原帖字图 */}
          <Box
            sx={{
              mt: { xs: 1.5, md: 2 },
              height: { xs: 'min(46vh, 380px)', md: 'min(52vh, 460px)' },
              minHeight: 220,
              border: '2px solid',
              borderColor: 'text.primary',
              bgcolor: 'background.paper',
              overflow: 'hidden',
            }}
          >
            <FlashCard
              key={current.card.id}
              card={progress!}
              flipped={flipped}
              onFlip={() => setFlipped((f) => !f)}
              bare
            />
          </Box>

          {/* 动作区高度固定：翻面前后不再跳 */}
          <Box sx={{ mt: { xs: 1.5, md: 2 }, minHeight: { xs: 124, md: 58 } }}>
            {flipped ? (
              <RatingButtons
                onRate={handleRate}
                card={{
                  ease: current.card.ease,
                  interval: current.card.interval,
                  repetitions: current.card.repetitions,
                }}
              />
            ) : (
              <Button
                fullWidth
                variant="contained"
                onClick={() => setFlipped(true)}
                sx={{ height: 56, justifyContent: 'space-between', px: 2.25 }}
              >
                <span>看原帖</span>
                <span aria-hidden>→</span>
              </Button>
            )}
          </Box>

          <Typography
            sx={{
              display: { xs: 'none', md: 'block' },
              fontFamily: 'var(--font-mono)',
              fontSize: 9.5,
              letterSpacing: '0.06em',
              opacity: 0.5,
              mt: 1,
            }}
          >
            空格翻面 · 1–4 评分 · ESC 退出
          </Typography>
        </Box>
      )}

      <ConfirmDialog
        open={confirmExit}
        title="中断学习"
        message={`已学习 ${rated} 张，中断后已评分的进度会保留。确定要返回吗？`}
        onConfirm={() => { setConfirmExit(false); onExitStudy(); }}
        onCancel={() => setConfirmExit(false)}
      />
    </Box>
  );
};

export default StudyPage;
