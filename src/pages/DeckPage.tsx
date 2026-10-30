import { useEffect, useMemo, useState, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Box, Typography, Button, useTheme, useMediaQuery } from '@mui/material';
import { useDeckStore } from '@/stores/useDeckStore';
import { useAuthStore } from '@/stores/useAuthStore';
import {
  getImageUrl,
  updateDeckLimits,
  updateStudyMode,
  toggleDeckPause,
  resetDeckProgress,
  forceResetDeckProgress,
} from '@/lib/api';
import ConfirmDialog from '@/components/common/ConfirmDialog';

/**
 * 帖详情：一帖一页。
 * 数字全部来自 /api/decks 的 per-deck 字段；设置直接写回，不做本地覆盖。
 */
const DeckPage: React.FC = () => {
  const { deckId } = useParams<{ deckId: string }>();
  const navigate = useNavigate();
  const theme = useTheme();
  const isPc = useMediaQuery(theme.breakpoints.up('md'));

  const decks = useDeckStore((s) => s.decks);
  const loading = useDeckStore((s) => s.loading);
  const loadDecks = useDeckStore((s) => s.loadDecks);
  const user = useAuthStore((s) => s.user);
  const isGuest = user?.role === 'guest';

  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);

  useEffect(() => {
    if (decks.length === 0) loadDecks(true);
  }, [decks.length, loadDecks]);

  const deck = useMemo(() => decks.find((d) => d.id === deckId), [decks, deckId]);

  const due = Number(deck?.due_count ?? 0);
  const newAvail = Number(deck?.new_available_today ?? 0);
  const learnedToday = Number(deck?.learned_today ?? 0);
  const learned = deck ? deck.card_count - (deck.new_count ?? deck.card_count) : 0;
  const percent = deck && deck.card_count > 0 ? Math.round((learned / deck.card_count) * 100) : 0;
  const canStart = !!deck && !deck.paused_at && due + newAvail > 0;

  const mono = { fontFamily: 'var(--font-mono)', letterSpacing: '0.04em' } as const;

  const save = useCallback(async (fn: () => Promise<unknown>) => {
    setSaving(true);
    setError(null);
    try {
      await fn();
      await loadDecks(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败');
    } finally {
      setSaving(false);
    }
  }, [loadDecks]);

  const changeLimit = (key: 'daily_new_card_limit' | 'daily_review_limit', delta: number): void => {
    if (!deck) return;
    const current = key === 'daily_new_card_limit' ? deck.daily_new_card_limit : deck.daily_review_limit;
    const next = Math.max(key === 'daily_new_card_limit' ? 1 : 10, Math.min(key === 'daily_new_card_limit' ? 200 : 1000, current + delta));
    if (next === current) return;
    void save(() => updateDeckLimits(deck.id, { [key]: next }));
  };

  const handleReset = useCallback(async () => {
    if (!deck) return;
    setSaving(true);
    setError(null);
    try {
      try {
        await resetDeckProgress(deck.id);
      } catch (err) {
        const msg = err instanceof Error ? err.message : '';
        if (msg.includes('force=1') || msg.includes('409')) await forceResetDeckProgress(deck.id);
        else throw err;
      }
      await loadDecks(true);
      setConfirmReset(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : '重置失败');
    } finally {
      setSaving(false);
    }
  }, [deck, loadDecks]);

  if (!deck && loading) {
    return <Box sx={{ py: 8 }}><Typography sx={{ ...mono, fontSize: 12, opacity: 0.7 }}>正在加载帖子…</Typography></Box>;
  }

  if (!deck) {
    return (
      <Box sx={{ py: 10, textAlign: 'center' }}>
        <Typography sx={{ fontSize: 30, fontWeight: 900, letterSpacing: 3 }}>找不到这帖</Typography>
        <Button variant="outlined" sx={{ mt: 2 }} onClick={() => navigate('/')}>回到今日</Button>
      </Box>
    );
  }

  const cover = deck.cover_image ? getImageUrl(deck.cover_image) : '';
  const modeLabel = deck.study_mode === 'sequential' ? '原帖顺序' : deck.study_mode === 'random' ? '随机' : '默认顺序';

  return (
    <Box>
      {/* 帖头 */}
      <Box sx={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 2, pb: { xs: 1.5, md: 1.75 } }}>
        <Box sx={{ minWidth: 0 }}>
          <Button
            variant="text"
            onClick={() => navigate('/')}
            sx={{ minHeight: 0, p: 0, mb: 1, fontSize: 11, fontFamily: 'var(--font-mono)', color: 'text.primary', opacity: 0.7, '&:hover': { backgroundColor: 'transparent', opacity: 1 } }}
          >
            ← 今日
          </Button>
          <Typography
            component="h1"
            sx={{
              fontSize: { xs: 28, md: 44 },
              fontWeight: 900,
              letterSpacing: { xs: '4px', md: '7px' },
              lineHeight: 1.12,
              overflowWrap: 'anywhere',
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
            }}
          >
            {deck.name}
          </Typography>
          <Typography sx={{ ...mono, fontSize: 11, opacity: 0.75, mt: 1 }}>
            {deck.card_count} 字 · {modeLabel} · 每日新字 {deck.daily_new_card_limit} · 复习 {deck.daily_review_limit}
          </Typography>
        </Box>
        <Box sx={{ display: { xs: 'none', md: 'flex' }, gap: 2, py: 1.5, flexShrink: 0 }}>
          <Box><Typography sx={{ ...mono, fontSize: 9.5, opacity: 0.62 }}>已学</Typography><Typography sx={{ fontSize: 40, fontWeight: 900, lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>{learned}<Box component="span" sx={{ fontSize: 13, fontWeight: 400, ml: 0.5 }}>字</Box></Typography></Box>
          <Box><Typography sx={{ ...mono, fontSize: 9.5, opacity: 0.62 }}>进度</Typography><Typography sx={{ fontSize: 40, fontWeight: 900, lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>{percent}<Box component="span" sx={{ fontSize: 13, fontWeight: 400, ml: 0.5 }}>%</Box></Typography></Box>
        </Box>
      </Box>

      {/* 概览 + 书影 */}
      <Box sx={{ border: '2px solid', borderColor: 'text.primary', display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 424px' } }}>
        <Box sx={{ p: { xs: '14px 16px', md: '22px 32px 20px' }, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          <Box sx={{ display: 'flex', gap: { xs: 3.25, md: 6.5 }, alignItems: 'flex-end' }}>
            <Box>
              <Typography sx={{ fontSize: { xs: 34, md: 62 }, fontWeight: 900, lineHeight: 0.9, letterSpacing: '-0.05em', fontVariantNumeric: 'tabular-nums', color: due > 0 ? 'var(--hot-ink)' : 'inherit' }}>
                {due}<Box component="span" sx={{ fontSize: 12, fontWeight: 400, letterSpacing: 0, ml: 0.75, opacity: 0.8 }}>字</Box>
              </Typography>
              <Typography sx={{ ...mono, fontSize: 9.5, opacity: 0.7, mt: 1 }}>待复习 · DUE</Typography>
            </Box>
            <Box>
              <Typography sx={{ fontSize: { xs: 34, md: 62 }, fontWeight: 900, lineHeight: 0.9, letterSpacing: '-0.05em', fontVariantNumeric: 'tabular-nums' }}>
                {newAvail}<Box component="span" sx={{ fontSize: 12, fontWeight: 400, letterSpacing: 0, ml: 0.75, opacity: 0.8 }}>字</Box>
              </Typography>
              <Typography sx={{ ...mono, fontSize: 9.5, opacity: 0.7, mt: 1 }}>可学新字 · NEW</Typography>
            </Box>
            <Box>
              <Typography sx={{ fontSize: { xs: 34, md: 62 }, fontWeight: 900, lineHeight: 0.9, letterSpacing: '-0.05em', fontVariantNumeric: 'tabular-nums' }}>
                {learnedToday}<Box component="span" sx={{ fontSize: 12, fontWeight: 400, letterSpacing: 0, ml: 0.75, opacity: 0.8 }}>字</Box>
              </Typography>
              <Typography sx={{ ...mono, fontSize: 9.5, opacity: 0.7, mt: 1 }}>今日已背写 · DONE</Typography>
            </Box>
          </Box>

          <Box sx={{ height: 4, backgroundColor: 'divider', mt: 2.5 }}>
            <Box sx={{ width: `${percent}%`, height: '100%', backgroundColor: 'text.primary' }} />
          </Box>

          <Box sx={{ display: 'flex', gap: 1, mt: 2.5, flexWrap: 'wrap' }}>
            <Button
              variant="contained"
              disabled={!canStart}
              onClick={() => navigate(`/study/${deck.id}`)}
              sx={{ flex: { xs: '1 1 100%', md: '1 1 420px' }, maxWidth: { md: 420 }, height: 50, justifyContent: 'space-between' }}
            >
              <span>{canStart ? '开始背写' : deck.paused_at ? '已暂停' : '今日完成'}</span>
              <span aria-hidden>→</span>
            </Button>
            {!isGuest && (
              <Button variant="outlined" onClick={() => navigate(`/decks/${deck.id}/cards`)} sx={{ height: 50, flex: { xs: '1 1 100%', md: '0 0 auto' } }}>
                管理卡片
              </Button>
            )}
          </Box>
        </Box>

        <Box sx={{ display: { xs: 'none', md: 'flex' }, alignItems: 'center', justifyContent: 'center', borderLeft: '2px solid', borderColor: 'text.primary', p: 2, overflow: 'hidden' }}>
          {cover ? (
            <Box component="img" src={cover} alt={deck.name} sx={{ width: '100%', height: 260, objectFit: 'cover', filter: 'grayscale(1) contrast(1.06)' }} />
          ) : (
            <Typography sx={{ fontSize: 150, fontWeight: 900, lineHeight: 1 }}>{deck.name.slice(0, 1)}</Typography>
          )}
        </Box>
      </Box>

      {error && (
        <Typography sx={{ ...mono, fontSize: 11, color: 'var(--hot-ink)', mt: 1.5 }}>{error}</Typography>
      )}

      {/* 帖设置 */}
      <Box sx={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', pt: 2.5, pb: 0.5 }}>
        <Typography component="h2" sx={{ fontSize: 13, fontWeight: 900, letterSpacing: '2px' }}>
          帖设置
          <Box component="span" sx={{ ...mono, fontSize: 10.5, fontWeight: 400, letterSpacing: '0.04em', opacity: 0.65, ml: 1 }}>
            {saving ? '保存中…' : '改动立即生效'}
          </Box>
        </Typography>
      </Box>

      <Box sx={{ borderTop: '1px solid', borderColor: 'text.primary' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', py: 1.75, borderBottom: '1px solid', borderColor: 'divider' }}>
          <Box>
            <Typography sx={{ fontSize: 14 }}>每日新字</Typography>
            <Typography sx={{ ...mono, fontSize: 10, opacity: 0.6, mt: 0.25 }}>NEW PER DAY</Typography>
          </Box>
          <Box sx={{ display: 'flex', alignItems: 'center', border: '2px solid', borderColor: 'text.primary' }}>
            <Box component="button" type="button" aria-label="减少每日新字" onClick={() => changeLimit('daily_new_card_limit', -5)} sx={stepBtnL}>−</Box>
            <Box sx={{ width: 58, textAlign: 'center', ...mono, fontSize: 14, fontVariantNumeric: 'tabular-nums' }}>{deck.daily_new_card_limit}</Box>
            <Box component="button" type="button" aria-label="增加每日新字" onClick={() => changeLimit('daily_new_card_limit', 5)} sx={stepBtnR}>＋</Box>
          </Box>
        </Box>

        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', py: 1.75, borderBottom: '1px solid', borderColor: 'divider' }}>
          <Box>
            <Typography sx={{ fontSize: 14 }}>每日复习</Typography>
            <Typography sx={{ ...mono, fontSize: 10, opacity: 0.6, mt: 0.25 }}>REVIEW PER DAY</Typography>
          </Box>
          <Box sx={{ display: 'flex', alignItems: 'center', border: '2px solid', borderColor: 'text.primary' }}>
            <Box component="button" type="button" aria-label="减少每日复习" onClick={() => changeLimit('daily_review_limit', -25)} sx={stepBtnL}>−</Box>
            <Box sx={{ width: 58, textAlign: 'center', ...mono, fontSize: 14, fontVariantNumeric: 'tabular-nums' }}>{deck.daily_review_limit}</Box>
            <Box component="button" type="button" aria-label="增加每日复习" onClick={() => changeLimit('daily_review_limit', 25)} sx={stepBtnR}>＋</Box>
          </Box>
        </Box>

        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', py: 1.75, borderBottom: '1px solid', borderColor: 'divider' }}>
          <Box>
            <Typography sx={{ fontSize: 14 }}>出字顺序</Typography>
            <Typography sx={{ ...mono, fontSize: 10, opacity: 0.6, mt: 0.25 }}>CARD ORDER</Typography>
          </Box>
          <Box sx={{ display: 'flex' }}>
            {([
              { value: 'default' as const, label: '默认' },
              { value: 'sequential' as const, label: '原帖' },
              { value: 'random' as const, label: '随机' },
            ]).map((opt, i) => {
              const active = (deck.study_mode ?? 'default') === opt.value;
              const disabled = opt.value === 'sequential' && !deck.article_text;
              return (
                <Box
                  key={opt.value}
                  component="button"
                  type="button"
                  disabled={disabled}
                  onClick={() => { if (!active) void save(() => updateStudyMode(deck.id, opt.value)); }}
                  sx={{
                    border: '1px solid',
                    borderColor: 'text.primary',
                    borderLeftWidth: i === 0 ? 1 : 0,
                    px: 1.5,
                    py: '5px',
                    fontSize: 12,
                    backgroundColor: active ? 'text.primary' : 'transparent',
                    color: active ? 'background.default' : 'text.primary',
                    opacity: disabled ? 0.35 : 1,
                    cursor: disabled ? 'not-allowed' : 'pointer',
                  }}
                >
                  {opt.label}
                </Box>
              );
            })}
          </Box>
        </Box>

        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', py: 1.75, borderBottom: '1px solid', borderColor: 'text.primary' }}>
          <Box>
            <Typography sx={{ fontSize: 14 }}>暂停学习</Typography>
            <Typography sx={{ ...mono, fontSize: 10, opacity: 0.6, mt: 0.25 }}>暂停后不再推送新字与复习</Typography>
          </Box>
          <Box sx={{ display: 'flex' }}>
            {[false, true].map((on, i) => {
              const active = !!deck.paused_at === on;
              return (
                <Box
                  key={String(on)}
                  component="button"
                  type="button"
                  onClick={() => { if (!active) void save(() => toggleDeckPause(deck.id, on)); }}
                  sx={{
                    border: '1px solid',
                    borderColor: 'text.primary',
                    borderLeftWidth: i === 0 ? 1 : 0,
                    px: 1.5,
                    py: '5px',
                    fontSize: 12,
                    backgroundColor: active ? 'text.primary' : 'transparent',
                    color: active ? 'background.default' : 'text.primary',
                    cursor: 'pointer',
                  }}
                >
                  {on ? '已暂停' : '正常'}
                </Box>
              );
            })}
          </Box>
        </Box>
      </Box>

      {!isGuest && (
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 2, pt: 2 }}>
          <Box>
            <Typography sx={{ fontSize: 13, color: 'var(--hot-ink)' }}>重置学习进度</Typography>
            <Typography sx={{ ...mono, fontSize: 10, opacity: 0.62, mt: 0.25 }}>所有字回到未学状态 · 不可撤销</Typography>
          </Box>
          <Button variant="outlined" onClick={() => setConfirmReset(true)} sx={{ borderColor: 'var(--hot-ink)', color: 'var(--hot-ink)', '&:hover': { backgroundColor: 'var(--hot-ink)', color: '#fdf8ee' } }}>
            重置
          </Button>
        </Box>
      )}

      {isPc && (
        <Box sx={{ ...mono, fontSize: 10, opacity: 0.68, pt: 3, display: 'flex', justifyContent: 'space-between' }}>
          <span>看今字 · 想原帖 · 翻面对照</span>
          <span>1–4 评分 · 空格翻面 · Esc 退出</span>
        </Box>
      )}

      <ConfirmDialog
        open={confirmReset}
        title="重置学习进度"
        message={error || `确定要重置「${deck.name}」的所有学习进度吗？所有字将恢复到未学习状态，此操作不可撤销。`}
        onConfirm={handleReset}
        onCancel={() => { setConfirmReset(false); setError(null); }}
      />
    </Box>
  );
};

const stepBtnL = {
  width: 34,
  height: 32,
  border: 0,
  borderRight: '1px solid',
  borderColor: 'text.primary',
  background: 'transparent',
  fontSize: 16,
  lineHeight: 1,
  color: 'text.primary',
  cursor: 'pointer',
} as const;

const stepBtnR = {
  ...stepBtnL,
  borderRight: 0,
  borderLeft: '1px solid',
} as const;

export default DeckPage;
