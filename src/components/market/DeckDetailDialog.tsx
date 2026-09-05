import { useEffect, useState, useCallback } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Box,
  Typography,
  Chip,
  Alert,
  CircularProgress,
  IconButton,
  useMediaQuery,
  useTheme,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import AddCircleOutlineIcon from '@mui/icons-material/AddCircleOutline';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import {
  fetchMarketplaceDeck,
  fetchDeckCardPreviews,
  subscribeDeck,
  unsubscribeDeck,
  getImageUrl,
} from '@/lib/api';
import type { MarketplaceDeck } from '@/types';
import type { CardPreview } from '@/lib/api';
import { sourceMeta } from '@/lib/sourceMeta';

export interface DeckDetailDialogProps {
  open: boolean;
  deck: MarketplaceDeck | null;
  onClose: () => void;
  onSubscribed: () => void;
}

/** 封面占位 */
const CoverPlaceholder: React.FC<{ name: string; large?: boolean }> = ({ name, large }) => (  <Box
    sx={{
      width: '100%',
      height: '100%',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      bgcolor: (t) => t.palette.mode === 'dark' ? 'rgba(255,255,255,0.08)' : 'grey.100',
      color: 'grey.400',
      fontSize: large ? 72 : 28,
      fontWeight: 600,
    }}
  >
    {name?.charAt(0) || '?'}
  </Box>
);

/** 字在帖中：整页原拓 + 该字坐标高亮（馆方来源帖专属，坐标对应整页原始尺寸） */
const OriginalPageView: React.FC<{ card: CardPreview; onClose: () => void }> = ({ card, onClose }) => {
  const ctx = card.context!;
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  return (
    <Dialog open onClose={onClose} maxWidth="lg" fullWidth PaperProps={{ sx: { borderRadius: 2 } }}>
      <DialogTitle sx={{ pb: 1, display: 'flex', alignItems: 'baseline', gap: 1.5 }}>
        <Typography component="span" className="font-kai" sx={{ fontSize: 30, fontWeight: 700, lineHeight: 1 }}>
          {card.front_text}
        </Typography>
        {ctx.s && (
          <Typography component="span" variant="body2" color="text.secondary" noWrap sx={{ flex: 1 }}>
            「{ctx.s}」
          </Typography>
        )}
        <IconButton size="small" onClick={onClose} edge="end" aria-label="关闭">
          <CloseIcon />
        </IconButton>
      </DialogTitle>
      <DialogContent sx={{ px: 2, pb: 2 }}>
        <Box sx={{ position: 'relative', borderRadius: 1, overflow: 'hidden', bgcolor: '#211d18' }}>
          <Box
            component="img"
            src={ctx.p}
            alt="整页原拓"
            onLoad={(e) => {
              const t = e.currentTarget;
              setNatural({ w: t.naturalWidth, h: t.naturalHeight });
            }}
            sx={{ width: '100%', display: 'block' }}
          />
          {natural && (
            <Box
              sx={{
                position: 'absolute',
                left: `${(ctx.x / natural.w) * 100}%`,
                top: `${(ctx.y / natural.h) * 100}%`,
                width: `${(ctx.w / natural.w) * 100}%`,
                height: `${(ctx.h / natural.h) * 100}%`,
                border: '2px solid #e0b25f',
                borderRadius: 0.5,
                boxSizing: 'border-box',
                boxShadow: '0 0 0 9999px rgba(0,0,0,0.42)',
              }}
            />
          )}
        </Box>
        <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
          字在帖中 —— 该字在整卷拓片中的位置。看行气、看章法，理解单字在原帖中的姿态。
        </Typography>
      </DialogContent>
    </Dialog>
  );
};

const DeckDetailDialog: React.FC<DeckDetailDialogProps> = ({ open, deck, onClose, onSubscribed }) => {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));

  const [detail, setDetail] = useState<MarketplaceDeck | null>(null);
  const [cardPreviews, setCardPreviews] = useState<CardPreview[]>([]);
  const [loading, setLoading] = useState(false);
  const [cardsLoading, setCardsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionPending, setActionPending] = useState(false);
  const [viewing, setViewing] = useState<CardPreview | null>(null);

  /** 加载数据 */
  useEffect(() => {
    if (open && deck) {
      setLoading(true);
      setCardsLoading(true);
      setError(null);
      setViewing(null);
      fetchMarketplaceDeck(deck.deck_id)
        .then(setDetail)
        .catch((err) => setError(err instanceof Error ? err.message : '加载详情失败'))
        .finally(() => setLoading(false));
      fetchDeckCardPreviews(deck.deck_id)
        .then((data) => setCardPreviews(data.cards))
        .catch(() => { /* 卡片预览加载失败不阻塞 */ })
        .finally(() => setCardsLoading(false));
    }
  }, [open, deck]);

  const current = detail || deck;
  const isSubscribed = current?.is_subscribed ?? false;
  const src = sourceMeta(current?.source_key ?? deck?.source_key);

  /** 订阅/退订 */
  const handleToggle = useCallback(async () => {
    if (!current) return;
    setActionPending(true);
    setError(null);
    try {
      if (isSubscribed) {
        await unsubscribeDeck(current.deck_id);
        setDetail((d) => d ? { ...d, is_subscribed: false } : d);
      } else {
        await subscribeDeck(current.deck_id);
        setDetail((d) => d ? { ...d, is_subscribed: true } : d);
      }
      onSubscribed();
    } catch (err) {
      setError(err instanceof Error ? err.message : '操作失败');
    } finally {
      setActionPending(false);
    }
  }, [current, isSubscribed, onSubscribed]);

  if (!deck) return null;

  return (
    <>
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="md"
      fullWidth
      PaperProps={{ sx: { borderRadius: 2, overflow: 'hidden' } }}
    >
      {/* 标题栏 */}
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1, pb: 0 }}>
        <Typography component="span" sx={{ flex: 1, fontWeight: 600, fontSize: { xs: 16, sm: 18 } }} noWrap>
          {current?.name ?? ''}
        </Typography>
        <IconButton size="small" onClick={onClose} edge="end" aria-label="关闭">
          <CloseIcon />
        </IconButton>
      </DialogTitle>

      <DialogContent sx={{ pt: 2, pb: 1 }}>
        {loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
            <CircularProgress size={32} />
          </Box>
        ) : (
          <>
            {error && <Alert severity="error" sx={{ mb: 1.5 }} onClose={() => setError(null)}>{error}</Alert>}

            {/* 主体：封面 + 元数据 */}
            <Box
              sx={{
                display: 'flex',
                flexDirection: isMobile ? 'column' : 'row',
                gap: 2.5,
                mb: 2.5,
              }}
            >
              {/* 封面图 */}
              <Box
                sx={{
                  width: isMobile ? '100%' : 240,
                  flexShrink: 0,
                  aspectRatio: '3/4',
                  maxWidth: isMobile ? 200 : undefined,
                  mx: isMobile ? 'auto' : undefined,
                  borderRadius: 1.5,
                  overflow: 'hidden',
                  bgcolor: (t) => t.palette.mode === 'dark' ? 'rgba(255,255,255,0.06)' : 'grey.50',
                  boxShadow: (t) => t.palette.mode === 'dark' ? '0px 0px 0px 1px rgba(255,255,255,0.12)' : '0px 0px 0px 1px rgba(0,0,0,0.08)',
                }}
              >
                {current?.cover_image ? (
                  <Box
                    component="img"
                    src={getImageUrl(current.cover_image)}
                    alt={current.name}
                    sx={{ width: '100%', height: '100%', objectFit: 'cover' }}
                  />
                ) : (
                  <CoverPlaceholder name={current?.name ?? ''} large />
                )}
              </Box>

              {/* 元数据 */}
              <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 1 }}>
                <Typography component="span" sx={{ fontWeight: 600, fontSize: { xs: 16, sm: 18 } }}>
                  {current?.name ?? ''}
                </Typography>

                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, alignItems: 'center' }}>
                  {current?.calligrapher && (
                    <Typography variant="body2" color="text.secondary">
                      {current.calligrapher}
                    </Typography>
                  )}
                  {current?.dynasty && (
                    <Typography variant="body2" color="text.secondary">
                      {current.dynasty}
                    </Typography>
                  )}
                  {current?.style && current.style.split(',').filter(Boolean).map((s) => (
                    <Chip key={s} label={s} size="small" variant="outlined" sx={{ fontSize: 11, height: 22 }} />
                  ))}
                  {src && (
                    <Chip
                      label={src.label}
                      size="small"
                      title={src.full}
                      sx={{
                        fontSize: 11, height: 22,
                        ...(src.tone === 'museum' && {
                          bgcolor: 'rgba(224,178,95,0.18)',
                          borderColor: 'rgba(196,148,58,0.6)',
                          color: '#8a6420',
                        }),
                      }}
                    />
                  )}
                  {current?.card_count != null && (
                    <Typography variant="body2" color="text.secondary">
                      {current.card_count} 张字帖
                    </Typography>
                  )}
                </Box>

                {current?.description && (
                  <Typography
                    variant="body2"
                    color="text.secondary"
                    sx={{
                      mt: 0.5,
                      lineHeight: 1.7,
                      whiteSpace: 'pre-wrap',
                      maxHeight: 120,
                      overflow: 'auto',
                    }}
                  >
                    {current.description}
                  </Typography>
                )}
                {src && (
                  <Typography variant="caption" color="text.disabled" sx={{ mt: -0.5 }}>
                    {src.full}
                  </Typography>
                )}
              </Box>
            </Box>

            {/* 卡片预览网格 */}
            <Typography variant="subtitle2" sx={{ mb: 1, fontWeight: 600, fontSize: 13 }}>
              字帖预览{cardPreviews.length > 0 ? `（${cardPreviews.length} 张）` : ''}
            </Typography>
            {cardsLoading ? (
              <Box sx={{ display: 'flex', justifyContent: 'center', py: 2 }}>
                <CircularProgress size={20} />
              </Box>
            ) : cardPreviews.length === 0 ? (
              <Typography variant="body2" color="text.disabled" sx={{ py: 1 }}>
                暂无预览
              </Typography>
            ) : (
              <Box
                sx={{
                  display: 'flex',
                  gap: 1,
                  overflowX: 'auto',
                  pb: 1,
                  '&::-webkit-scrollbar': { height: 6 },
                  '&::-webkit-scrollbar-thumb': { bgcolor: 'divider', borderRadius: 3 },
                }}
              >
                {cardPreviews.map((card, idx) => (
                  <Box
                    key={idx}
                    sx={{
                      flexShrink: 0,
                      width: 100,
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      gap: 0.5,
                    }}
                  >
                    <Box
                      onClick={card.context ? () => setViewing(card) : undefined}
                      title={card.context ? '查看整页原拓中的位置' : undefined}
                      sx={{
                        position: 'relative',
                        width: 100,
                        height: 100,
                        borderRadius: 1,
                        overflow: 'hidden',
                        bgcolor: (t) => t.palette.mode === 'dark' ? 'rgba(255,255,255,0.06)' : 'grey.50',
                        boxShadow: (t) => t.palette.mode === 'dark' ? '0px 0px 0px 1px rgba(255,255,255,0.12)' : '0px 0px 0px 1px rgba(0,0,0,0.08)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        cursor: card.context ? 'zoom-in' : 'default',
                      }}
                    >
                      {card.image_url ? (
                        <Box
                          component="img"
                          src={getImageUrl(card.image_url)}
                          alt={card.front_text}
                          sx={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }}
                          loading="lazy"
                        />
                      ) : (
                        <Typography variant="body2" color="text.disabled">
                          {card.front_text}
                        </Typography>
                      )}
                      {card.context && (
                        <Box
                          sx={{
                            position: 'absolute', top: 2, right: 2,
                            px: 0.4, py: '1px', borderRadius: 0.5,
                            bgcolor: 'rgba(224,178,95,0.92)', color: '#3b2a10',
                            fontSize: 9, fontWeight: 700, lineHeight: 1.3,
                          }}
                        >
                          原拓
                        </Box>
                      )}
                    </Box>
                    <Typography
                      variant="caption"
                      color="text.secondary"
                      noWrap
                      sx={{ maxWidth: 100, textAlign: 'center', fontSize: 11 }}
                    >
                      {card.front_text}
                    </Typography>
                  </Box>
                ))}
              </Box>
            )}
          </>
        )}
      </DialogContent>

      {/* 底部操作栏 */}
      <DialogActions sx={{ px: 3, pb: 2, pt: 0, gap: 1 }}>
        <Button
          variant="contained"
          fullWidth
          size="large"
          onClick={handleToggle}
          disabled={actionPending || loading}
          startIcon={
            actionPending ? (
              <CircularProgress size={18} color="inherit" />
            ) : isSubscribed ? (
              <CheckCircleIcon />
            ) : (
              <AddCircleOutlineIcon />
            )
          }
          sx={{
            textTransform: 'none',
            fontWeight: 600,
            bgcolor: isSubscribed ? 'success.main' : 'primary.main',
            '&:hover': {
              bgcolor: isSubscribed ? 'success.dark' : 'primary.dark',
            },
          }}
        >
          {isSubscribed ? '已订阅（点击退订）' : '订阅此牌组'}
        </Button>
      </DialogActions>
    </Dialog>
    {viewing && <OriginalPageView card={viewing} onClose={() => setViewing(null)} />}
    </>
  );
};

export default DeckDetailDialog;
