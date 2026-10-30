import { useEffect, useMemo, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Box,
  Typography,
  Button,
  Menu,
  MenuItem,
  Divider,
  useTheme,
  useMediaQuery,
} from '@mui/material';
import MoreHorizIcon from '@mui/icons-material/MoreHoriz';
import { useDeckStore } from '@/stores/useDeckStore';
import { useAuthStore } from '@/stores/useAuthStore';
import {
  resetDeckProgress,
  forceResetDeckProgress,
  toggleDeckPause,
  getImageUrl,
} from '@/lib/api';
import { useDashboardStats } from '@/hooks/useDashboardStats';
import ConfirmDialog from '@/components/common/ConfirmDialog';
import type { Deck } from '@/types';

/**
 * 今日页：待办数字 + 正在背写的帖 + 每帖状态。
 * 数字全部来自 /api/decks 的 per-deck 字段（due_count / new_available_today / learned_today），
 * 不再依赖单独的 due-counts 请求，避免学习回来看到过期数字。
 */
const DashboardPage: React.FC = () => {
  const navigate = useNavigate();
  const theme = useTheme();
  const isPc = useMediaQuery(theme.breakpoints.up('md'));

  const decks = useDeckStore((s) => s.decks);
  const loading = useDeckStore((s) => s.loading);
  const error = useDeckStore((s) => s.error);
  const loadDecks = useDeckStore((s) => s.loadDecks);
  const user = useAuthStore((s) => s.user);
  const isGuest = user?.role === 'guest';

  const stats = useDashboardStats();

  const [resetTarget, setResetTarget] = useState<{ id: string; name: string } | null>(null);
  const [resetError, setResetError] = useState<string | null>(null);
  const [pauseTarget, setPauseTarget] = useState<{ id: string; name: string; paused: boolean } | null>(null);
  const [pauseError, setPauseError] = useState<string | null>(null);
  const [menuAnchor, setMenuAnchor] = useState<{ el: HTMLElement; deck: Deck } | null>(null);

  useEffect(() => {
    loadDecks(true);
  }, [loadDecks]);

  const dueOf = (d: Deck): number => Number(d.due_count ?? 0);
  const newOf = (d: Deck): number => Number(d.new_available_today ?? 0);
  const learnedTodayOf = (d: Deck): number => Number(d.learned_today ?? 0);
  const learnedOf = (d: Deck): number => d.card_count - (d.new_count ?? d.card_count);

  /** 正在背写的帖：有到期或新字的优先，其次未暂停 */
  const current = useMemo<Deck | undefined>(() => (
    decks.find((d) => !d.paused_at && (dueOf(d) > 0 || newOf(d) > 0))
    ?? decks.find((d) => !d.paused_at)
    ?? decks[0]
  ), [decks]);

  const currentDue = current ? dueOf(current) : 0;
  const currentNew = current ? newOf(current) : 0;
  const currentLearnedToday = current ? learnedTodayOf(current) : 0;
  const currentGoal = currentLearnedToday + currentDue + currentNew;
  const todayPercent = currentGoal > 0 ? Math.min(100, Math.round((currentLearnedToday / currentGoal) * 100)) : 0;
  const estMinutes = Math.max(1, Math.round((currentDue * 9 + currentNew * 15) / 60));
  const canStart = !!current && !current.paused_at && currentDue + currentNew > 0;

  const dateLabel = useMemo(() => {
    const now = new Date();
    const week = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][now.getDay()];
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} · ${week}`;
  }, []);

  const handleConfirmPause = useCallback(async () => {
    if (!pauseTarget) return;
    setPauseError(null);
    try {
      await toggleDeckPause(pauseTarget.id, pauseTarget.paused);
      await loadDecks(true);
      setPauseTarget(null);
    } catch (err) {
      setPauseError(err instanceof Error ? err.message : '操作失败，请重试');
    }
  }, [pauseTarget, loadDecks]);

  const handleConfirmReset = useCallback(async () => {
    if (!resetTarget) return;
    setResetError(null);
    try {
      try {
        await resetDeckProgress(resetTarget.id);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : '';
        if (msg.includes('force=1') || msg.includes('409')) {
          await forceResetDeckProgress(resetTarget.id);
        } else {
          throw err;
        }
      }
      await loadDecks(true);
      setResetTarget(null);
    } catch (err) {
      setResetError(err instanceof Error ? err.message : '重置失败，请重试');
    }
  }, [resetTarget, loadDecks]);

  const openMenu = (el: HTMLElement, deck: Deck): void => setMenuAnchor({ el, deck });

  const goDeck = (deck: Deck): void => {
    if (deck.paused_at) return;
    if (dueOf(deck) + newOf(deck) > 0) {
      navigate(`/study/${deck.id}`);
    } else if (!isGuest) {
      navigate(`/decks/${deck.id}/cards`);
    }
  };

  const mono = { fontFamily: 'var(--font-mono)', letterSpacing: '0.04em' } as const;

  if (error) {
    return (
      <Box sx={{ py: 6 }}>
        <Typography sx={{ ...mono, fontSize: 12 }}>加载失败：{error}</Typography>
        <Button variant="outlined" sx={{ mt: 2 }} onClick={() => loadDecks(true)}>重试</Button>
      </Box>
    );
  }

  if (loading && decks.length === 0) {
    return (
      <Box sx={{ py: 8 }}>
        <Typography sx={{ ...mono, fontSize: 12, opacity: 0.7 }}>正在加载…</Typography>
      </Box>
    );
  }

  if (decks.length === 0) {
    return (
      <Box sx={{ py: 10, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
        <Typography sx={{ fontSize: 40, fontWeight: 900, letterSpacing: 4 }}>空</Typography>
        <Typography sx={{ ...mono, opacity: 0.72 }}>还没有碑帖 · 去市场挑一帖</Typography>
        <Button variant="contained" onClick={() => navigate('/market')}>碑帖市场 →</Button>
      </Box>
    );
  }

  const cover = current?.cover_image ? getImageUrl(current.cover_image) : '';

  return (
    <Box>
      {/* 页头 */}
      <Box sx={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', pt: 0.5, pb: { xs: 1.5, md: 1.75 } }}>
        <Box sx={{ flexShrink: 0 }}>
          <Typography
            component="h1"
            sx={{ fontSize: { xs: 30, md: 40 }, fontWeight: 900, letterSpacing: '0.1em', lineHeight: 1, whiteSpace: 'nowrap' }}
          >
            今日
          </Typography>
          <Typography sx={{ ...mono, opacity: 0.7, mt: 1 }}>{dateLabel}</Typography>
        </Box>
        <Box sx={{ display: { xs: 'none', md: 'block' }, textAlign: 'right', whiteSpace: 'nowrap', flexShrink: 0 }}>
          <Typography sx={{ ...mono, lineHeight: 1.9, opacity: 0.8 }}>
            连续 <Box component="b" sx={{ fontSize: 17, fontWeight: 900 }}>{stats.streakDays}</Box> 天 · 累计{' '}
            <Box component="b" sx={{ fontSize: 17, fontWeight: 900 }}>{(stats.totalMinutes / 60).toFixed(1)}</Box> h
            <br />
            已背写 <Box component="b" sx={{ fontSize: 17, fontWeight: 900 }}>{stats.totalStudied}</Box> 字 · 分布于{' '}
            <Box component="b" sx={{ fontSize: 17, fontWeight: 900 }}>{decks.length}</Box> 帖
          </Typography>
        </Box>
      </Box>

      {/* 正在背写的帖 */}
      {current && (
        <Box sx={{ border: '2px solid', borderColor: 'text.primary', display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 424px' } }}>
          <Box sx={{ p: { xs: '14px 16px', md: '22px 32px 20px' }, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
            <Typography
              component="h2"
              sx={{
                fontSize: { xs: 28, md: 50 },
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
              {current.name}
            </Typography>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 1, flexWrap: 'wrap' }}>
              <Typography sx={{ ...mono, fontSize: 11, opacity: 0.8 }}>
                {current.study_mode === 'sequential' ? '原帖顺序' : current.study_mode === 'random' ? '随机' : '默认顺序'}
              </Typography>
              <Box sx={{ border: '1px solid', borderColor: 'text.primary', px: 0.75, py: '1px', ...mono, fontSize: 9.5 }}>
                {current.card_count} 字
              </Box>
              {current.paused_at && (
                <Box sx={{ border: '1px solid', color: 'var(--hot-ink)', borderColor: 'var(--hot-ink)', px: 0.75, py: '1px', ...mono, fontSize: 9.5 }}>
                  已暂停
                </Box>
              )}
            </Box>

            <Box sx={{ borderTop: '1px solid', borderColor: 'text.primary', mt: { xs: 1.5, md: 2 }, mb: { xs: 1.5, md: 1.75 } }} />

            <Box sx={{ display: 'flex', gap: { xs: 3.25, md: 6.5 }, alignItems: 'flex-end' }}>
              <Box>
                <Typography sx={{ fontSize: { xs: 34, md: 62 }, fontWeight: 900, lineHeight: 0.9, letterSpacing: '-0.05em', fontVariantNumeric: 'tabular-nums', color: 'var(--hot-ink)' }}>
                  {currentDue}
                  <Box component="span" sx={{ fontSize: 12, fontWeight: 400, letterSpacing: 0, ml: 0.75, opacity: 0.8 }}>字</Box>
                </Typography>
                <Typography sx={{ ...mono, fontSize: 9.5, opacity: 0.7, mt: 1 }}>待复习 · DUE</Typography>
              </Box>
              <Box>
                <Typography sx={{ fontSize: { xs: 34, md: 62 }, fontWeight: 900, lineHeight: 0.9, letterSpacing: '-0.05em', fontVariantNumeric: 'tabular-nums' }}>
                  {currentNew}
                  <Box component="span" sx={{ fontSize: 12, fontWeight: 400, letterSpacing: 0, ml: 0.75, opacity: 0.8 }}>字</Box>
                </Typography>
                <Typography sx={{ ...mono, fontSize: 9.5, opacity: 0.7, mt: 1 }}>可学新字 · NEW</Typography>
              </Box>
            </Box>

            <Box sx={{ display: 'flex', gap: 1, mt: { xs: 2, md: 2.5 }, flexWrap: 'wrap' }}>
              <Button
                variant="contained"
                disabled={!canStart}
                onClick={() => current && navigate(`/study/${current.id}`)}
                sx={{
                  flex: { xs: '1 1 100%', md: '1 1 420px' },
                  maxWidth: { md: 420 },
                  height: 50,
                  justifyContent: 'space-between',
                  gap: 2,
                }}
              >
                <span>{canStart ? '开始背写' : current.paused_at ? '已暂停' : '今日完成'}</span>
                <span aria-hidden>→</span>
              </Button>
              {!isGuest && (
                <Button
                  variant="outlined"
                  onClick={() => current && navigate(`/decks/${current.id}`)}
                  sx={{ height: 50, flex: { xs: '1 1 100%', md: '0 0 auto' } }}
                >
                  帖详情
                </Button>
              )}
            </Box>

            <Box sx={{ display: { xs: 'block', md: 'none' }, mt: 1.75 }}>
              <Box sx={{ height: 4, backgroundColor: 'divider' }}>
                <Box sx={{ width: `${todayPercent}%`, height: '100%', backgroundColor: 'text.primary' }} />
              </Box>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', mt: 0.75 }}>
                <Typography sx={{ ...mono, fontSize: 9.5, opacity: 0.75 }}>今日已背写 {currentLearnedToday} 字</Typography>
                <Typography sx={{ ...mono, fontSize: 9.5, opacity: 0.75 }}>预计 {estMinutes} 分钟</Typography>
              </Box>
            </Box>
          </Box>

          {/* 桌面右栏 */}
          <Box
            sx={{
              display: { xs: 'none', md: 'flex' },
              flexDirection: 'column',
              alignItems: 'center',
              borderLeft: '2px solid',
              borderColor: 'text.primary',
              p: '18px 24px 16px',
              minWidth: 0,
            }}
          >
            <Typography sx={{ ...mono, fontSize: 10, letterSpacing: '0.16em', textTransform: 'uppercase', opacity: 0.7, alignSelf: 'flex-start' }}>
              Today · 今日进度
            </Typography>
            <Box sx={{ width: 188, height: 188, mt: '6px', mb: '4px', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
              {cover ? (
                <Box
                  component="img"
                  src={cover}
                  alt={current.name}
                  sx={{ width: '100%', height: '100%', objectFit: 'cover', filter: 'grayscale(1) contrast(1.06)' }}
                />
              ) : (
                <Typography sx={{ fontSize: 96, fontWeight: 900, lineHeight: 1 }}>{current.name.slice(0, 1)}</Typography>
              )}
            </Box>
            <Typography sx={{ ...mono, fontSize: 10.5, opacity: 0.75, textAlign: 'center' }}>
              {current.name} · {current.card_count} 字
            </Typography>
            <Box sx={{ width: '100%', height: 4, backgroundColor: 'divider', mt: 1.75 }}>
              <Box sx={{ width: `${todayPercent}%`, height: '100%', backgroundColor: 'text.primary' }} />
            </Box>
            <Box sx={{ width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', mt: 1 }}>
              <Typography sx={{ ...mono, fontSize: 10, opacity: 0.75 }}>今日已背写 {currentLearnedToday} 字</Typography>
              <Typography sx={{ ...mono, fontSize: 10, opacity: 0.75 }}>预计 {estMinutes} 分钟</Typography>
            </Box>
          </Box>
        </Box>
      )}

      {/* 我的碑帖 */}
      <Box sx={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', pt: 2, pb: 1 }}>
        <Typography component="h2" sx={{ fontSize: 13, fontWeight: 900, letterSpacing: '2px' }}>
          我的碑帖
          <Box component="span" sx={{ ...mono, fontSize: 10.5, fontWeight: 400, letterSpacing: '0.04em', opacity: 0.65, ml: 1 }}>
            {decks.length} 帖 · {decks.reduce((n, d) => n + d.card_count, 0)} 字
          </Box>
        </Typography>
        <Box
          component="button"
          type="button"
          onClick={() => navigate('/market')}
          sx={{
            border: 0,
            background: 'none',
            p: 0,
            cursor: 'pointer',
            fontFamily: 'var(--font-mono)',
            fontSize: 10.5,
            letterSpacing: '0.04em',
            color: 'text.primary',
            opacity: 0.75,
            borderBottom: '1px solid',
            borderColor: 'text.primary',
          }}
        >
          碑帖市场 →
        </Box>
      </Box>

      {/* 桌面：细线表 */}
      <Box sx={{ display: { xs: 'none', md: 'block' } }}>
        <Box
          aria-hidden
          sx={{
            display: 'grid',
            gridTemplateColumns: '40px 38px 1fr 180px 220px 24px',
            gap: 2,
            py: 0.75,
            borderTop: '1px solid',
            borderColor: 'text.primary',
            ...mono,
            fontSize: 9.5,
            letterSpacing: '0.14em',
            textTransform: 'uppercase',
            opacity: 0.6,
          }}
        >
          <span>NO</span>
          <span />
          <span>帖 · 模式</span>
          <span style={{ textAlign: 'right' }}>今日</span>
          <span>进度</span>
          <span />
        </Box>

        {decks.map((deck, index) => {
          const due = dueOf(deck);
          const newAvail = newOf(deck);
          const learned = learnedOf(deck);
          const percent = deck.card_count > 0 ? Math.round((learned / deck.card_count) * 100) : 0;
          const paused = !!deck.paused_at;
          const status = due > 0
            ? `${due} 字待复习`
            : newAvail > 0
              ? `可学 ${newAvail} 字`
              : learned === 0 ? '未开始' : '今日已完成';
          return (
            <Box
              key={deck.id}
              role="link"
              tabIndex={0}
              aria-label={`${deck.name}，${status}`}
              onClick={() => goDeck(deck)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); goDeck(deck); }
              }}
              sx={{
                display: 'grid',
                gridTemplateColumns: '40px 38px 1fr 180px 220px 24px',
                gap: 2,
                alignItems: 'center',
                minHeight: 64,
                borderBottom: '1px solid',
                borderColor: 'text.primary',
                cursor: paused ? 'default' : 'pointer',
                '&:hover': paused ? undefined : { backgroundColor: 'text.primary', color: 'background.default' },
                '&:hover .row-sub': paused ? undefined : { opacity: 0.75 },
                '&:hover .row-due': paused ? undefined : { color: 'background.default' },
                '&:hover .row-bar': paused ? undefined : { backgroundColor: 'rgba(242,236,221,0.32)' },
                '&:hover .row-bar > span': paused ? undefined : { backgroundColor: 'background.default' },
                '&:focus-visible': { outline: '2px solid', outlineColor: 'primary.main', outlineOffset: -2 },
              }}
            >
              <Typography sx={{ ...mono, fontSize: 10, opacity: 0.6 }}>{String(index + 1).padStart(2, '0')}</Typography>
              {deck.cover_image ? (
                <Box
                  component="img"
                  src={getImageUrl(deck.cover_image)}
                  alt=""
                  sx={{ width: 38, height: 38, objectFit: 'cover', border: '1px solid', borderColor: 'inherit' }}
                />
              ) : (
                <Box sx={{ width: 38, height: 38, border: '1px solid', borderColor: 'inherit', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 15, fontWeight: 900 }}>
                  {deck.name.slice(0, 1)}
                </Box>
              )}
              <Box sx={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: '2px' }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, minWidth: 0 }}>
                  <Typography noWrap sx={{ fontSize: 17, fontWeight: 900, letterSpacing: '0.04em' }}>
                    {deck.name}
                  </Typography>
                  <Box sx={{ border: '1px solid', borderColor: 'inherit', px: 0.75, ...mono, fontSize: 9.5, opacity: 0.85, whiteSpace: 'nowrap' }}>
                    {deck.study_mode === 'sequential' ? '原帖' : deck.study_mode === 'random' ? '随机' : '默认'}
                  </Box>
                </Box>
                <Typography sx={{ ...mono, fontSize: 10, opacity: 0.68, letterSpacing: '0.04em' }} className="row-sub">
                  {paused ? '已暂停' : `${learned} / ${deck.card_count} 已学`}
                </Typography>
              </Box>
              <Typography
                className="row-due"
                sx={{
                  textAlign: 'right',
                  fontSize: 12,
                  color: due > 0 ? 'var(--hot-ink)' : 'inherit',
                  opacity: due > 0 ? 1 : 0.62,
                }}
              >
                {status}
              </Typography>
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', ...mono, fontSize: 10, opacity: 0.72 }}>
                  <span>{learned} / {deck.card_count}</span>
                  <span>{percent}%</span>
                </Box>
                <Box className="row-bar" sx={{ height: 4, backgroundColor: 'divider', position: 'relative' }}>
                  <Box component="span" sx={{ position: 'absolute', inset: '0 auto 0 0', width: `${percent}%`, backgroundColor: 'text.primary', display: 'block' }} />
                </Box>
              </Box>
              {isGuest ? <span /> : (
                <Box
                  component="button"
                  type="button"
                  aria-label={`${deck.name} 更多操作`}
                  onClick={(e) => { e.stopPropagation(); openMenu(e.currentTarget, deck); }}
                  sx={{ border: 0, background: 'none', p: 0, cursor: 'pointer', color: 'inherit', display: 'flex', alignItems: 'center', justifyContent: 'flex-end', opacity: 0.75 }}
                >
                  <MoreHorizIcon sx={{ fontSize: 18 }} />
                </Box>
              )}
            </Box>
          );
        })}
      </Box>

      {/* 手机：紧凑列表 */}
      <Box sx={{ display: { xs: 'block', md: 'none' } }}>
        {decks.map((deck) => {
          const due = dueOf(deck);
          const newAvail = newOf(deck);
          const learned = learnedOf(deck);
          const status = due > 0
            ? `${due} 字待复习`
            : newAvail > 0
              ? `可学 ${newAvail} 字`
              : learned === 0 ? '未开始' : '今日已完成';
          return (
            <Box
              key={deck.id}
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 1.25,
                py: 1.4,
                borderBottom: '1px solid',
                borderColor: 'divider',
              }}
            >
              <Box
                role="link"
                tabIndex={0}
                aria-label={`${deck.name}，${status}`}
                onClick={() => goDeck(deck)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); goDeck(deck); }
                }}
                sx={{
                  flex: 1,
                  minWidth: 0,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 1.25,
                  cursor: deck.paused_at ? 'default' : 'pointer',
                  '&:focus-visible': { outline: '2px solid', outlineColor: 'primary.main', outlineOffset: 2 },
                }}
              >
                {deck.cover_image ? (
                  <Box component="img" src={getImageUrl(deck.cover_image)} alt="" sx={{ width: 30, height: 30, objectFit: 'cover', border: '1px solid', borderColor: 'divider' }} />
                ) : (
                  <Box sx={{ width: 30, height: 30, border: '1px solid', borderColor: 'text.primary', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 900 }}>
                    {deck.name.slice(0, 1)}
                  </Box>
                )}
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography noWrap sx={{ fontSize: 13.5, letterSpacing: '0.02em' }}>{deck.name}</Typography>
                  <Typography sx={{ ...mono, fontSize: 9, opacity: 0.65 }}>{deck.card_count} 字</Typography>
                </Box>
                <Typography
                  sx={{
                    ...mono,
                    fontSize: 9.5,
                    color: due > 0 ? 'var(--hot-ink)' : 'inherit',
                    opacity: due > 0 ? 1 : 0.7,
                    whiteSpace: 'nowrap',
                  }}
                >
                  {status}
                </Typography>
              </Box>
              {!isGuest && (
                <Box
                  component="button"
                  type="button"
                  aria-label={`${deck.name} 更多操作`}
                  onClick={(e) => openMenu(e.currentTarget, deck)}
                  sx={{ border: 0, background: 'none', p: 0, ml: 0.75, cursor: 'pointer', color: 'text.primary', opacity: 0.55, display: 'flex', '&:hover': { opacity: 1 } }}
                >
                  <MoreHorizIcon sx={{ fontSize: 18 }} />
                </Box>
              )}
            </Box>
          );
        })}
      </Box>

      <Menu
        anchorEl={menuAnchor?.el}
        open={!!menuAnchor}
        onClose={() => setMenuAnchor(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
      >
        <MenuItem
          onClick={() => {
            const deck = menuAnchor?.deck;
            setMenuAnchor(null);
            if (deck) navigate(`/decks/${deck.id}/cards`);
          }}
        >
          管理卡片
        </MenuItem>
        <MenuItem
          onClick={() => {
            const deck = menuAnchor?.deck;
            setMenuAnchor(null);
            if (deck) { setPauseError(null); setPauseTarget({ id: deck.id, name: deck.name, paused: !deck.paused_at }); }
          }}
        >
          {menuAnchor?.deck.paused_at ? '恢复学习' : '暂停学习'}
        </MenuItem>
        <Divider />
        <MenuItem
          sx={{ color: 'var(--hot-ink)' }}
          onClick={() => {
            const deck = menuAnchor?.deck;
            setMenuAnchor(null);
            if (deck) { setResetError(null); setResetTarget({ id: deck.id, name: deck.name }); }
          }}
        >
          重置进度
        </MenuItem>
      </Menu>

      <ConfirmDialog
        open={!!resetTarget}
        title="重置学习进度"
        message={resetError || `确定要重置「${resetTarget?.name ?? ''}」的所有学习进度吗？所有卡片将恢复到未学习状态，此操作不可撤销。`}
        onConfirm={handleConfirmReset}
        onCancel={() => { setResetTarget(null); setResetError(null); }}
      />
      <ConfirmDialog
        open={!!pauseTarget}
        title={pauseTarget?.paused ? '暂停学习' : '恢复学习'}
        message={pauseError || (pauseTarget?.paused
          ? `确定要暂停「${pauseTarget?.name ?? ''}」吗？暂停后不再推送新的学习和复习卡片，可随时恢复。`
          : `确定要恢复「${pauseTarget?.name ?? ''}」吗？恢复后会继续推送到期卡片。`)}
        onConfirm={handleConfirmPause}
        onCancel={() => { setPauseTarget(null); setPauseError(null); }}
      />

      {isPc && (
        <Box sx={{ ...mono, fontSize: 10, opacity: 0.68, pt: 1.5, pb: 0.5, display: 'flex', justifyContent: 'space-between' }}>
          <span>看今字 · 想原帖 · 翻面对照</span>
          <span>1–4 评分 · 空格翻面 · Esc 退出</span>
        </Box>
      )}
    </Box>
  );
};

export default DashboardPage;
