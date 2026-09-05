/**
 * 单文件版 · 市场详情弹窗
 * 数据全部本地/CDN：目录元数据 + fetchZitie 懒加载（样字预览 + 简介）
 */
import React, { useEffect, useState } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Box,
  Typography,
  Chip,
  CircularProgress,
  IconButton,
  useMediaQuery,
  useTheme,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import { fetchZitie } from '@/data/local/localAdapter';
import type { CatalogZuopin, CardContext } from '@/core/types';
import OriginalPageView from '@/components/study/OriginalPageView';
import { sourceMeta } from '@/lib/sourceMeta';
import { shlibGlyphUrl, shlibPageUrl } from '@/core/types';

interface Props {
  open: boolean;
  zuopin: CatalogZuopin | null;
  subscribed: boolean;
  pending: boolean;
  onClose: () => void;
  onSubscribe: (z: CatalogZuopin) => void;
}

const PREVIEW_COUNT = 8;

export const DeckDetailDialog: React.FC<Props> = ({ open, zuopin, subscribed, pending, onClose, onSubscribe }) => {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));

  const [previews, setPreviews] = useState<Array<{ url: string; hanzi: string; context?: CardContext }>>([]);
  const [viewing, setViewing] = useState<{ hanzi: string; context: CardContext } | null>(null);
  const [desc, setDesc] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open || !zuopin) return;
    let alive = true;
    setLoading(true);
    setPreviews([]);
    setViewing(null);
    setDesc('');
    fetchZitie(zuopin.z)
      .then((zitie) => {
        if (!alive) return;
        setDesc(zitie.desc || '');
        const sents = zitie.sents || [];
        const sample = (zitie.g || []).slice(0, PREVIEW_COUNT).map((gl) => {
          const hasIIIF = !!zitie.iiif && !!gl.c && !!zitie.pages;
          const svc = hasIIIF ? zitie.pages![gl.c![0]] : '';
          return {
            url: hasIIIF
              ? shlibGlyphUrl(zitie.iiif!, svc, gl.c!)
              : `${zitie.base}${gl.rel}${zitie.thumb ?? '?x-bce-process=style/jpg256'}`,
            hanzi: gl.h,
            context: gl.c && hasIIIF
              ? { p: shlibPageUrl(zitie.iiif!, svc), x: gl.c[4], y: gl.c[5], w: gl.c[6], h: gl.c[7], s: sents[gl.c[8]] }
              : undefined,
          };
        });
        setPreviews(sample);
      })
      .catch(() => {
        /* 预览失败不阻塞详情 */
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [open, zuopin]);

  if (!zuopin) return null;

  const who = [zuopin.d, zuopin.a].filter(Boolean).join('·');
  const src = sourceMeta(zuopin.src || (zuopin.z.length === 16 ? 'shlib' : 'ygsf'));

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="sm"
      fullWidth
      PaperProps={{ sx: { borderRadius: 2, overflow: 'hidden' } }}
    >
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1, pb: 0 }}>
        <Typography component="span" sx={{ flex: 1, fontWeight: 600, fontSize: 17 }} noWrap>
          {zuopin.n}
        </Typography>
        <IconButton size="small" onClick={onClose} edge="end" aria-label="关闭">
          <CloseIcon />
        </IconButton>
      </DialogTitle>

      <DialogContent sx={{ pt: 2, pb: 1 }}>
        <Box sx={{ display: 'flex', flexDirection: isMobile ? 'column' : 'row', gap: 2, mb: 2 }}>
          {/* 封面 */}
          <Box
            sx={{
              width: isMobile ? '100%' : 190,
              flexShrink: 0,
              aspectRatio: '3/4',
              maxWidth: isMobile ? 180 : undefined,
              mx: isMobile ? 'auto' : undefined,
              borderRadius: 1.5,
              overflow: 'hidden',
              bgcolor: 'grey.50',
              boxShadow: '0px 0px 0px 1px rgba(0,0,0,0.08)',
              position: 'relative',
            }}
          >
            {zuopin.c.startsWith('http') ? (
              <Box
                component="img"
                src={zuopin.c}
                alt={zuopin.n}
                referrerPolicy="no-referrer"
                sx={{ width: '100%', height: '100%', objectFit: 'cover' }}
                onError={(e: any) => {
                  e.currentTarget.style.display = 'none';
                }}
              />
            ) : null}
            <Box
              sx={{
                position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
                bgcolor: 'rgba(20,20,20,0.04)',
              }}
            >
              <Typography className="font-kai" sx={{ fontSize: 64, color: 'rgba(0,0,0,0.12)', fontWeight: 700 }}>
                {zuopin.n.charAt(0)}
              </Typography>
            </Box>
          </Box>

          {/* 元数据 */}
          <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 }}>
            <Typography sx={{ fontWeight: 600, fontSize: 17 }}>{zuopin.n}</Typography>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, alignItems: 'center' }}>
              {who && (
                <Typography variant="body2" color="text.secondary">{who}</Typography>
              )}
              {zuopin.s.filter(Boolean).map((s) => (
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
              <Typography variant="body2" color="text.secondary">{zuopin.g} 字</Typography>
            </Box>
            {desc && (
              <Typography
                variant="body2"
                color="text.secondary"
                sx={{ mt: 0.5, lineHeight: 1.7, whiteSpace: 'pre-wrap', maxHeight: 130, overflow: 'auto' }}
              >
                {desc}
              </Typography>
            )}
            {src && (
              <Typography variant="caption" color="text.disabled">
                {src.full}
              </Typography>
            )}
          </Box>
        </Box>

        {/* 样字预览 */}
        <Typography variant="subtitle2" sx={{ mb: 1, fontWeight: 600, fontSize: 13 }}>
          单字预览
        </Typography>
        {loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 2 }}><CircularProgress size={20} /></Box>
        ) : previews.length === 0 ? (
          <Typography variant="body2" color="text.disabled" sx={{ py: 1 }}>暂无预览</Typography>
        ) : (
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: `repeat(${Math.min(4, previews.length)}, 1fr)`,
              gap: 1,
            }}
          >
            {previews.map((p, i) => (
              <Box
                key={`${p.hanzi}-${i}`}
                onClick={p.context ? () => setViewing({ hanzi: p.hanzi, context: p.context! }) : undefined}
                title={p.context ? '查看整页原拓中的位置' : undefined}
                sx={{
                  position: 'relative',
                  aspectRatio: '1/1', borderRadius: 1, overflow: 'hidden', bgcolor: 'grey.50',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  boxShadow: '0px 0px 0px 1px rgba(0,0,0,0.06)',
                  cursor: p.context ? 'zoom-in' : 'default',
                }}
              >
                <Box
                  component="img"
                  src={p.url}
                  alt={p.hanzi}
                  loading="lazy"
                  referrerPolicy="no-referrer"
                  sx={{ width: '100%', height: '100%', objectFit: 'contain' }}
                  onError={(e: any) => {
                    e.currentTarget.style.display = 'none';
                  }}
                />
                {p.context && (
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
            ))}
          </Box>
        )}
      </DialogContent>

      <DialogActions sx={{ px: 2, pb: 2 }}>
        {subscribed ? (
          <Button variant="outlined" startIcon={<CheckCircleIcon />} sx={{ borderRadius: 2 }} disabled>
            已加入书库
          </Button>
        ) : (
          <Button
            variant="contained"
            disabled={pending}
            onClick={() => onSubscribe(zuopin)}
            sx={{ borderRadius: 2 }}
          >
            {pending ? <CircularProgress size={16} sx={{ mr: 1 }} /> : null}
            {pending ? '加入中…' : '加入书库'}
          </Button>
        )}
      </DialogActions>
      {viewing && (
        <OriginalPageView char={viewing.hanzi} context={viewing.context} onClose={() => setViewing(null)} />
      )}
    </Dialog>
  );
};

export default DeckDetailDialog;
