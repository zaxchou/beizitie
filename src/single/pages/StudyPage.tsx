import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Box,
  Typography,
  Button,
  Card as MuiCard,
  CardContent,
  Chip,
  LinearProgress,
} from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import FlashCard from '@/components/study/FlashCard';
import RatingButtons from '@/components/study/RatingButtons';
import ConfirmDialog from '@/components/common/ConfirmDialog';
import { localDataSource } from '@/data/local/localAdapter';
import type { Card, Rating } from '@/types';
import type { LocalCard, LocalProgress } from '../../core/types';

interface Props {
  studyingDeck: { id: string; name: string };
  onExitStudy: () => void;
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

export const StudyPage: React.FC<Props> = ({ studyingDeck, onExitStudy }) => {
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
  const progress = useMemo(() => {
    if (!current) return null;
    // FlashCard 只需要 SM-2 字段 + 文本/图片；进度实时覆盖
    return current.card;
  }, [current]);

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

  // ---- 加载中 ----
  if (loading) {
    return <Typography color="text.secondary" sx={{ textAlign: 'center', py: 6 }}>正在出卡…</Typography>;
  }

  const done = sessionDone || queue.length === 0;
  const totalToday = queue.length;

  return (
    <Box className="space-y-3">
      {/* 顶栏 */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <Button
          size="small" startIcon={<ArrowBackIcon />}
          onClick={() => (rated > 0 && !sessionDone ? setConfirmExit(true) : onExitStudy())}
          sx={{ borderRadius: 2 }}
        >
          书库
        </Button>
        <Box sx={{ flex: 1, display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <Typography sx={{ fontWeight: 600, fontSize: 15 }} noWrap>{studyingDeck.name}</Typography>
          <Typography variant="caption" color="text.secondary" sx={{ ml: 'auto' }}>{mmss}</Typography>
          {!done && (
            <LinearProgress
              variant="determinate"
              value={totalToday ? (index / totalToday) * 100 : 100}
              sx={{ height: 4, borderRadius: 2 }}
            />
          )}
        </Box>
      </Box>

      {done ? (
        <MuiCard variant="outlined" sx={{ borderRadius: 2, textAlign: 'center', py: 6 }}>
          <CardContent>
            <Typography className="font-kai" sx={{ fontSize: 44, mb: 1 }}>🎉</Typography>
            <Typography sx={{ fontWeight: 700, fontSize: 18, mb: 0.5 }}>
              {queue.length === 0 ? '今日无需学习' : '本轮完成'}
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              {queue.length === 0 ? '这张帖今天没有到期的卡片' : `共完成 ${rated} 张`}
            </Typography>
            <Button variant="contained" onClick={onExitStudy} sx={{ borderRadius: 2 }}>
              返回书库
            </Button>
          </CardContent>
        </MuiCard>
      ) : (
        <>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Chip label={`${index + 1} / ${totalToday}`} size="small" variant="outlined" />
            <Chip
              label={current.isNew ? '新卡' : '复习'}
              size="small"
              color={current.isNew ? 'primary' : 'secondary'}
              variant="outlined"
            />
          </Box>

          <FlashCard card={progress!} flipped={flipped} onFlip={() => setFlipped((f) => !f)} />

          {flipped ? (
            <RatingButtons onRate={handleRate} card={{ ease: current.card.ease, interval: current.card.interval, repetitions: current.card.repetitions }} />
          ) : (
            <Button fullWidth variant="contained" size="large" onClick={() => setFlipped(true)} sx={{ borderRadius: 2 }}>
              显示字帖原字
            </Button>
          )}
        </>
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
