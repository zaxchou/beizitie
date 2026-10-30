import { useEffect, useState, useMemo, useCallback } from 'react';
import {
  Box,
  Typography,
  IconButton,
  CircularProgress,
  Button,
} from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import EditIcon from '@mui/icons-material/Edit';
import {
  fetchMarketplaceDecksPaged,
  subscribeDeck,
  unsubscribeDeck,
  getImageUrl,
} from '@/lib/api';
import type { MarketplaceDeck } from '@/types';
import ConfirmDialog from '@/components/common/ConfirmDialog';
import EditDeckDialog from '@/components/market/EditDeckDialog';
import { sourceMeta } from '@/lib/sourceMeta';
import DeckDetailDialog from '@/components/market/DeckDetailDialog';
import { useAuthStore } from '@/stores/useAuthStore';

/** 书体筛选选项 */
const STYLE_OPTIONS = ['全部', '楷', '行', '草', '隶', '篆'] as const;

/**
 * 市场页面。
 * 路由 /market
 * 密集网格布局：封面图 + 标题 + 悬浮订阅按钮。
 * admin 用户每张字帖可编辑元数据 + 上传封面。
 */
const MarketPage: React.FC = () => {
  const [decks, setDecks] = useState<MarketplaceDeck[]>([]);
  const [total, setTotal] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { user } = useAuthStore();
  const isAdmin = user?.role === 'admin';

  // 筛选条件
  const [searchKeyword, setSearchKeyword] = useState('');
  const [searchDebounced, setSearchDebounced] = useState('');
  const [styleFilter, setStyleFilter] = useState<string>('全部');
  const [dynastyFilter, setDynastyFilter] = useState<string>('全部');
  const [calligrapherFilter, setCalligrapherFilter] = useState<string>('全部');
  const [dynastyCounts, setDynastyCounts] = useState<Record<string, number>>({});

  // 操作中状态
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [unsubConfirmDeck, setUnsubConfirmDeck] = useState<MarketplaceDeck | null>(null);
  const [showSubscribedOnly, setShowSubscribedOnly] = useState(false);

  // 编辑弹窗
  const [editDeck, setEditDeck] = useState<MarketplaceDeck | null>(null);

  // 详情弹窗
  const [detailDeck, setDetailDeck] = useState<MarketplaceDeck | null>(null);

  const PAGE_SIZE = 60;

  /** 加载市场牌组（服务端筛选 + 分页；offset=0 重置列表） */
  const loadDecks = useCallback(
    async (offset: number) => {
      if (offset === 0) setLoading(true);
      else setLoadingMore(true);
      setError(null);
      try {
        const data = await fetchMarketplaceDecksPaged({
          style: styleFilter !== '全部' ? styleFilter : undefined,
          calligrapher: calligrapherFilter !== '全部' ? calligrapherFilter : undefined,
          dynasty: dynastyFilter !== '全部' ? dynastyFilter : undefined,
          search: searchDebounced.trim() || undefined,
          limit: PAGE_SIZE,
          offset,
        });
        setDecks((prev) => (offset === 0 ? data.decks : [...prev, ...data.decks]));
        setTotal(data.total);
        if (data.calligraphers?.length) {
          setCalligrapherOptions(['全部', ...data.calligraphers]);
        }
        if (data.styleCounts) {
          const m: Record<string, number> = {};
          for (const s of data.styleCounts) m[s.style] = s.n;
          setStyleCounts(m);
        }
        if (data.dynastyCounts) {
          const m: Record<string, number> = {};
          for (const d of data.dynastyCounts) m[d.dynasty] = d.n;
          setDynastyCounts(m);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : '加载市场失败');
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [styleFilter, dynastyFilter, calligrapherFilter, searchDebounced],
  );

  useEffect(() => {
    loadDecks(0);
  }, [loadDecks]);

  // 搜索防抖
  useEffect(() => {
    const t = setTimeout(() => setSearchDebounced(searchKeyword), 400);
    return () => clearTimeout(t);
  }, [searchKeyword]);

  /** 书家下拉列表（来自服务端全量 facets） */
  const [calligrapherOptions, setCalligrapherOptions] = useState<string[]>(['全部']);
  /** 各书体数量（来自服务端 facets） */
  const [styleCounts, setStyleCounts] = useState<Record<string, number>>({});

  const deckMatchesFilters = useCallback((deck: MarketplaceDeck): boolean => {
    if (styleFilter !== '全部') {
      const styles = deck.style ? deck.style.split(',').map((s) => s.trim()) : [];
      if (!styles.includes(styleFilter)) return false;
    }
    if (calligrapherFilter !== '全部' && deck.calligrapher !== calligrapherFilter) return false;

    if (showSubscribedOnly && !deck.is_subscribed) return false;

    const kw = searchKeyword.trim().toLowerCase();
    if (kw) {
      return (
        deck.name.toLowerCase().includes(kw) ||
        deck.calligrapher.toLowerCase().includes(kw) ||
        deck.description.toLowerCase().includes(kw) ||
        deck.dynasty.toLowerCase().includes(kw)
      );
    }
    return true;
  }, [styleFilter, calligrapherFilter, searchKeyword, showSubscribedOnly]);

  /** 客户端筛选 */
  const featuredDecks = useMemo(() => {
    return decks.filter((d) => d.featured === 1 && deckMatchesFilters(d));
  }, [decks, deckMatchesFilters]);

  const regularDecks = useMemo(() => {
    return decks.filter((d) => d.featured !== 1 && deckMatchesFilters(d));
  }, [decks, deckMatchesFilters]);

  /** 订阅/退订 */
  const handleToggleSubscribe = useCallback(
    async (deck: MarketplaceDeck) => {
      if (deck.is_subscribed) {
        setUnsubConfirmDeck(deck);
        return;
      }
      setActionError(null);
      setPendingId(deck.deck_id);
      try {
        await subscribeDeck(deck.deck_id);
        setDecks((prev) =>
          prev.map((d) =>
            d.deck_id === deck.deck_id ? { ...d, is_subscribed: true } : d,
          ),
        );
      } catch (err) {
        setActionError(err instanceof Error ? err.message : '订阅失败');
      } finally {
        setPendingId(null);
      }
    },
    [],
  );

  const mono = { fontFamily: 'var(--font-mono)', letterSpacing: '0.04em' } as const;

  /** 精选在前，其余按服务端顺序 */
  const orderedDecks = useMemo(() => [...featuredDecks, ...regularDecks], [featuredDecks, regularDecks]);

  const chipSx = (active: boolean) => ({
    border: '1px solid',
    borderColor: 'text.primary',
    borderLeftWidth: 0,
    px: 1.1,
    py: '4px',
    fontSize: 12,
    letterSpacing: '0.02em',
    backgroundColor: active ? 'text.primary' : 'transparent',
    color: active ? 'background.default' : 'text.primary',
    cursor: 'pointer',
    userSelect: 'none',
    whiteSpace: 'nowrap',
    '&:first-of-type': { borderLeftWidth: 1 },
  });

  const selectSx = {
    border: 0,
    borderBottom: '1px solid',
    borderColor: 'text.primary',
    background: 'transparent',
    color: 'text.primary',
    fontFamily: 'var(--font-mono)',
    fontSize: 11,
    letterSpacing: '0.04em',
    py: '4px',
    pr: '18px',
    cursor: 'pointer',
    outline: 'none',
    appearance: 'none',
    backgroundImage:
      'linear-gradient(45deg, transparent 50%, currentColor 50%), linear-gradient(135deg, currentColor 50%, transparent 50%)',
    backgroundPosition: 'calc(100% - 9px) 55%, calc(100% - 4px) 55%',
    backgroundSize: '5px 5px, 5px 5px',
    backgroundRepeat: 'no-repeat',
  };

  const renderStatus = (deck: MarketplaceDeck) => (
    <Box
      component="button"
      type="button"
      onClick={(e) => { e.stopPropagation(); if (pendingId !== deck.deck_id) handleToggleSubscribe(deck); }}
      sx={{
        border: 0,
        background: 'none',
        p: 0,
        cursor: 'pointer',
        fontFamily: 'var(--font-mono)',
        fontSize: 10.5,
        letterSpacing: '0.04em',
        color: deck.is_subscribed ? 'text.primary' : 'var(--hot-ink)',
        opacity: deck.is_subscribed ? 0.65 : 1,
        whiteSpace: 'nowrap',
        '&:hover': { textDecoration: 'underline' },
      }}
    >
      {pendingId === deck.deck_id ? '处理中…' : deck.is_subscribed ? '已订阅' : '＋ 订阅'}
    </Box>
  );

  /** 确认退订 */
  const handleConfirmUnsubscribe = useCallback(async () => {
    if (!unsubConfirmDeck) return;
    setActionError(null);
    setPendingId(unsubConfirmDeck.deck_id);
    try {
      await unsubscribeDeck(unsubConfirmDeck.deck_id);
      setDecks((prev) =>
        prev.map((d) => (d.deck_id === unsubConfirmDeck.deck_id ? { ...d, is_subscribed: false } : d)),
      );
    } catch (err) {
      setActionError(err instanceof Error ? err.message : '退订失败');
    } finally {
      setPendingId(null);
      setUnsubConfirmDeck(null);
    }
  }, [unsubConfirmDeck]);

  return (
    <Box>
      {/* 页头 */}
      <Box sx={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', pt: 0.5, pb: { xs: 1.5, md: 1.75 } }}>
        <Box sx={{ minWidth: 0 }}>
          <Typography
            component="h1"
            sx={{ fontSize: { xs: 30, md: 40 }, fontWeight: 900, letterSpacing: '0.1em', lineHeight: 1 }}
          >
            碑帖市场
          </Typography>
          <Typography sx={{ ...mono, opacity: 0.7, mt: 1 }}>
            共 {total} 部 · 按书体、朝代、书家筛
          </Typography>
        </Box>
        <Box sx={{ display: { xs: 'none', md: 'block' }, textAlign: 'right', ...mono, opacity: 0.8, whiteSpace: 'nowrap' }}>
          已显示 {decks.length} / {total}
        </Box>
      </Box>

      {/* 工具条 */}
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: { xs: 1.25, md: 2 },
          flexWrap: 'wrap',
          borderTop: '1px solid',
          borderBottom: '1px solid',
          borderColor: 'text.primary',
          py: 1.25,
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flex: '1 1 280px', minWidth: 0 }}>
          <SearchIcon sx={{ fontSize: 16, opacity: 0.55 }} />
          <Box
            component="input"
            value={searchKeyword}
            onChange={(e) => setSearchKeyword(e.target.value)}
            placeholder="搜帖名、书家、朝代"
            sx={{
              flex: 1,
              minWidth: 0,
              border: 0,
              borderBottom: '2px solid',
              borderColor: 'text.primary',
              background: 'transparent',
              fontFamily: 'inherit',
              fontSize: 14,
              color: 'text.primary',
              py: '3px',
              outline: 'none',
              '&::placeholder': { color: 'text.disabled' },
            }}
          />
        </Box>

        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Box component="span" sx={{ ...mono, fontSize: 9.5, opacity: 0.6 }}>书体</Box>
          <Box sx={{ display: 'flex' }}>
            {STYLE_OPTIONS.map((opt) => (
              <Box key={opt} component="button" type="button" onClick={() => setStyleFilter(opt)} sx={chipSx(styleFilter === opt)}>
                {opt}
                {opt !== '全部' && styleCounts[opt] ? ` ${styleCounts[opt]}` : ''}
              </Box>
            ))}
          </Box>
        </Box>

        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Box component="span" sx={{ ...mono, fontSize: 9.5, opacity: 0.6 }}>朝代</Box>
          <Box
            component="select"
            value={dynastyFilter}
            onChange={(e) => setDynastyFilter(e.target.value)}
            sx={selectSx}
            aria-label="按朝代筛选"
          >
            <option value="全部">全部</option>
            {Object.entries(dynastyCounts).map(([name, n]) => (
              <option key={name} value={name}>{name} {n}</option>
            ))}
          </Box>
        </Box>

        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Box component="span" sx={{ ...mono, fontSize: 9.5, opacity: 0.6 }}>书家</Box>
          <Box
            component="select"
            value={calligrapherFilter}
            onChange={(e) => setCalligrapherFilter(e.target.value)}
            sx={selectSx}
            aria-label="按书家筛选"
          >
            {calligrapherOptions.map((name) => (
              <option key={name} value={name}>{name}</option>
            ))}
          </Box>
        </Box>

        <Box
          component="button"
          type="button"
          onClick={() => setShowSubscribedOnly((v) => !v)}
          sx={chipSx(showSubscribedOnly)}
          aria-pressed={showSubscribedOnly}
        >
          已订阅
        </Box>
      </Box>

      {actionError && (
        <Box sx={{ borderBottom: '1px solid', borderColor: 'divider', py: 1 }}>
          <Typography sx={{ ...mono, fontSize: 11, color: 'var(--hot-ink)' }}>{actionError}</Typography>
        </Box>
      )}

      {loading ? (
        <Box sx={{ py: 8, display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <CircularProgress size={16} />
          <Typography sx={{ ...mono, fontSize: 11, opacity: 0.7 }}>正在加载碑帖…</Typography>
        </Box>
      ) : error ? (
        <Box sx={{ py: 6 }}>
          <Typography sx={{ ...mono, fontSize: 12 }}>加载失败：{error}</Typography>
          <Button variant="outlined" sx={{ mt: 2 }} onClick={() => loadDecks(0)}>重试</Button>
        </Box>
      ) : orderedDecks.length === 0 ? (
        <Box sx={{ py: 10, textAlign: 'center' }}>
          <Typography sx={{ fontSize: 34, fontWeight: 900, letterSpacing: 4 }}>无</Typography>
          <Typography sx={{ ...mono, fontSize: 11, opacity: 0.7, mt: 1 }}>没有匹配的碑帖 · 换个筛选条件</Typography>
        </Box>
      ) : (
        <>
          {/* 桌面：书目表 */}
          <Box sx={{ display: { xs: 'none', md: 'block' } }}>
            <Box
              aria-hidden
              sx={{
                display: 'grid',
                gridTemplateColumns: '40px 44px 1fr 140px 90px 80px 90px 120px',
                gap: 2,
                py: 0.75,
                ...mono,
                fontSize: 9.5,
                letterSpacing: '0.14em',
                textTransform: 'uppercase',
                opacity: 0.6,
              }}
            >
              <span>NO</span>
              <span />
              <span>帖 / 说明</span>
              <span>书家</span>
              <span>朝代</span>
              <span>书体</span>
              <span style={{ textAlign: 'right' }}>字数</span>
              <span style={{ textAlign: 'right' }}>状态</span>
            </Box>
            {orderedDecks.map((deck, index) => {
              const sm = sourceMeta(deck.source_key);
              return (
                <Box
                  key={deck.deck_id}
                  role="link"
                  tabIndex={0}
                  aria-label={`${deck.name}，${deck.is_subscribed ? '已订阅' : '未订阅'}`}
                  onClick={() => setDetailDeck(deck)}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setDetailDeck(deck); } }}
                  sx={{
                    display: 'grid',
                    gridTemplateColumns: '40px 44px 1fr 140px 90px 80px 90px 120px',
                    gap: 2,
                    alignItems: 'center',
                    minHeight: 64,
                    borderTop: '1px solid',
                    borderColor: 'divider',
                    cursor: 'pointer',
                    '&:hover': { backgroundColor: 'text.primary', color: 'background.default' },
                    '&:hover .m-sub': { opacity: 0.72 },
                    '&:hover .m-status': { color: 'background.default', opacity: 0.85 },
                    '&:focus-visible': { outline: '2px solid', outlineColor: 'primary.main', outlineOffset: -2 },
                  }}
                >
                  <Typography sx={{ ...mono, fontSize: 10, opacity: 0.6 }}>{String(index + 1).padStart(2, '0')}</Typography>
                  {deck.cover_image ? (
                    <Box component="img" src={getImageUrl(deck.cover_image)} alt="" loading="lazy"
                      sx={{ width: 44, height: 44, objectFit: 'cover', border: '1px solid', borderColor: 'inherit' }} />
                  ) : (
                    <Box sx={{ width: 44, height: 44, border: '1px solid', borderColor: 'inherit', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 17, fontWeight: 900 }}>
                      {deck.name.charAt(0) || '?'}
                    </Box>
                  )}
                  <Box sx={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: '2px' }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
                      <Typography noWrap sx={{ fontSize: 17, fontWeight: 900, letterSpacing: '0.03em' }}>{deck.name}</Typography>
                      {deck.featured === 1 && (
                        <Box sx={{ border: '1px solid', borderColor: 'inherit', px: 0.6, ...mono, fontSize: 9, opacity: 0.8, whiteSpace: 'nowrap' }}>精选</Box>
                      )}
                      {sm && (
                        <Box sx={{ border: '1px solid', borderColor: 'inherit', px: 0.6, ...mono, fontSize: 9, opacity: 0.6, whiteSpace: 'nowrap' }}>{sm.short}</Box>
                      )}
                    </Box>
                    <Typography noWrap className="m-sub" sx={{ ...mono, fontSize: 10, opacity: 0.6, maxWidth: { md: 420 } }}>{deck.description || '—'}</Typography>
                  </Box>
                  <Typography noWrap sx={{ fontSize: 12.5 }}>{deck.calligrapher || '佚名'}</Typography>
                  <Typography noWrap sx={{ ...mono, fontSize: 11, opacity: 0.75 }}>{deck.dynasty || '—'}</Typography>
                  <Typography noWrap sx={{ ...mono, fontSize: 11, opacity: 0.75 }}>{deck.style || '—'}</Typography>
                  <Typography sx={{ textAlign: 'right', ...mono, fontSize: 11.5, fontVariantNumeric: 'tabular-nums' }}>{deck.card_count}</Typography>
                  <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 1 }}>
                    {isAdmin && (
                      <IconButton size="small" aria-label={`编辑 ${deck.name}`}
                        onClick={(e) => { e.stopPropagation(); setEditDeck(deck); }}
                        sx={{ p: 0.25, opacity: 0.6, color: 'inherit' }}>
                        <EditIcon sx={{ fontSize: 14 }} />
                      </IconButton>
                    )}
                    <Box className="m-status" sx={{ display: 'inline-flex' }}>{renderStatus(deck)}</Box>
                  </Box>
                </Box>
              );
            })}
          </Box>

          {/* 手机：列表 */}
          <Box sx={{ display: { xs: 'block', md: 'none' } }}>
            {orderedDecks.map((deck) => (
              <Box
                key={deck.deck_id}
                role="link"
                tabIndex={0}
                aria-label={`${deck.name}，${deck.is_subscribed ? '已订阅' : '未订阅'}`}
                onClick={() => setDetailDeck(deck)}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setDetailDeck(deck); } }}
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 1.25,
                  py: 1.25,
                  borderBottom: '1px solid',
                  borderColor: 'divider',
                  cursor: 'pointer',
                }}
              >
                {deck.cover_image ? (
                  <Box component="img" src={getImageUrl(deck.cover_image)} alt="" loading="lazy"
                    sx={{ width: 34, height: 34, objectFit: 'cover', border: '1px solid', borderColor: 'divider' }} />
                ) : (
                  <Box sx={{ width: 34, height: 34, border: '1px solid', borderColor: 'text.primary', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 900 }}>
                    {deck.name.charAt(0) || '?'}
                  </Box>
                )}
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography noWrap sx={{ fontSize: 13.5, letterSpacing: '0.02em' }}>{deck.name}</Typography>
                  <Typography noWrap sx={{ ...mono, fontSize: 9, opacity: 0.65 }}>
                    {[deck.dynasty, deck.calligrapher, deck.style].filter(Boolean).join(' · ')}
                  </Typography>
                </Box>
                <Box sx={{ textAlign: 'right', flexShrink: 0 }}>
                  <Typography sx={{ ...mono, fontSize: 9.5, opacity: 0.7 }}>{deck.card_count} 字</Typography>
                  <Box sx={{ display: 'inline-flex', mt: 0.25 }}>{renderStatus(deck)}</Box>
                </Box>
              </Box>
            ))}
          </Box>

          {/* 分页 */}
          {decks.length < total && (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 2 }}>
              <Button
                variant="outlined"
                onClick={() => loadDecks(decks.length)}
                disabled={loadingMore}
                sx={{ minWidth: 220, height: 44 }}
              >
                {loadingMore ? '加载中…' : `加载更多（已显示 ${decks.length} / ${total}）`}
              </Button>
            </Box>
          )}
        </>
      )}

      {/* 退订确认对话框 */}
      <ConfirmDialog
        open={!!unsubConfirmDeck}
        title="退订牌组"
        message={`确定要退订「${unsubConfirmDeck?.name ?? ''}」吗？退订后该牌组的所有学习进度将被永久删除，此操作不可撤销。`}
        onConfirm={handleConfirmUnsubscribe}
        onCancel={() => setUnsubConfirmDeck(null)}
      />

      {/* 编辑弹窗 */}
      <EditDeckDialog
        deckId={editDeck?.deck_id ?? null}
        deckName={editDeck?.name ?? ''}
        open={!!editDeck}
        publishMode={false}
        onClose={() => setEditDeck(null)}
        onSaved={() => { setEditDeck(null); loadDecks(0); }}
      />

      {/* 详情弹窗 */}
      <DeckDetailDialog
        open={!!detailDeck}
        deck={detailDeck}
        onClose={() => setDetailDeck(null)}
        onSubscribed={() => loadDecks(0)}
      />
    </Box>
  );
};

export default MarketPage;
