import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Box,
  Typography,
  Button,
  Chip,
  TextField,
  MenuItem,
  CircularProgress,
  Alert,
} from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import { localDataSource } from '@/data/local/localAdapter';
import type { CatalogZuopin } from '@/core/types';
import { sourceMeta } from '@/lib/sourceMeta';
import { fetchZitie, catalogIndex } from '@/data/local/localAdapter';
import { DeckDetailDialog } from '@/single/components/DeckDetailDialog';

const PAGE_SIZE = 60;
const STYLE_OPTIONS = ['全部', '楷', '行', '草', '隶', '篆'];
const DYNASTY_ORDER = ['先秦', '汉', '三国', '晋', '南北朝', '隋', '唐', '五代', '宋', '元', '明', '清', '近代', '日本'];

interface Props {
  onSubscribed: (name: string) => void;
}

export const MarketPage: React.FC<Props> = ({ onSubscribed }) => {
  const [zuopins, setZuopins] = useState<CatalogZuopin[]>([]);
  const [total, setTotal] = useState(0);
  const [styleCounts, setStyleCounts] = useState<Record<string, number>>({});
  const [dynastyCounts, setDynastyCounts] = useState<Record<string, number>>({});
  const [calligrapherOptions, setCalligrapherOptions] = useState<string[]>(['全部']);
  const [styleFilter, setStyleFilter] = useState('全部');
  const [dynastyFilter, setDynastyFilter] = useState('全部');
  const [calligrapherFilter, setCalligrapherFilter] = useState('全部');
  const [detailZuopin, setDetailZuopin] = useState<CatalogZuopin | null>(null);
  const [keyword, setKeyword] = useState('');
  const [keywordDebounced, setKeywordDebounced] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const offsetRef = useRef(0);

  // 已订阅 zitie 集合
  const [subscribed, setSubscribed] = useState<Set<string>>(new Set());
  const refreshSubscribed = useCallback(async () => {
    const decks = await localDataSource.library.list();
    setSubscribed(new Set(decks.map((d) => d.zitieId)));
    return new Set(decks.map((d) => d.name));
  }, []);

  useEffect(() => {
    const t = setTimeout(() => setKeywordDebounced(keyword), 350);
    return () => clearTimeout(t);
  }, [keyword]);

  const load = useCallback(
    async (offset: number) => {
      offsetRef.current = offset;
      offset === 0 ? setLoading(true) : setLoadingMore(true);
      setError(null);
      try {
        const all = catalogIndex.zuopins;
        const kw = keywordDebounced.trim().toLowerCase();
        const filtered = all.filter((z) => {
          if (styleFilter !== '全部' && !z.s.includes(styleFilter)) return false;
          if (dynastyFilter !== '全部' && z.d !== dynastyFilter) return false;
          if (calligrapherFilter !== '全部' && z.a !== calligrapherFilter) return false;
          if (kw && !(z.n.toLowerCase().includes(kw) || z.a.toLowerCase().includes(kw) || z.d.toLowerCase().includes(kw)))
            return false;
          return true;
        });
        setZuopins((prev) => (offset === 0 ? filtered.slice(0, PAGE_SIZE) : [...prev, ...filtered.slice(offset, offset + PAGE_SIZE)]));
        setTotal(filtered.length);
        await refreshSubscribed();
      } catch (e: any) {
        setError(e.message);
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [styleFilter, dynastyFilter, calligrapherFilter, keywordDebounced, refreshSubscribed],
  );

  useEffect(() => {
    load(0);
  }, [load]);

  // facets（全量，仅首次）
  useEffect(() => {
    const calligraphers = [...new Set(catalogIndex.zuopins.map((z) => z.a).filter(Boolean))].sort((a, b) =>
      a.localeCompare(b, 'zh-CN'),
    );
    setCalligrapherOptions(['全部', ...calligraphers]);
    const sc = new Map<string, number>();
    for (const z of catalogIndex.zuopins) for (const s of z.s) sc.set(s, (sc.get(s) || 0) + 1);
    setStyleCounts(Object.fromEntries(sc));
    const dc = new Map<string, number>();
    for (const z of catalogIndex.zuopins) if (z.d) dc.set(z.d, (dc.get(z.d) || 0) + 1);
    setDynastyCounts(Object.fromEntries(dc));
  }, []);

  const handleSubscribe = async (z: CatalogZuopin) => {
    setPendingId(z.id);
    setError(null);
    try {
      const zitie = await fetchZitie(z.z);
      await localDataSource.library.addFromZitie(zitie, {
        name: z.n,
        author: z.a,
        dynasty: z.d,
        styles: z.s,
        cover: z.c.startsWith('http') ? z.c : '',
      });
      setSubscribed((prev) => new Set(prev).add(z.z));
      onSubscribed(z.n);
    } catch (e: any) {
      setError(`订阅失败：${e.message}`);
    } finally {
      setPendingId(null);
    }
  };

  const chips = [...STYLE_OPTIONS, ...Object.keys(styleCounts).filter((s) => !STYLE_OPTIONS.includes(s))];

  return (
    <Box className="space-y-3">
      <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1.5 }}>
        <Typography className="font-kai" sx={{ fontSize: 20, fontWeight: 700 }}>碑帖市场</Typography>
        <Typography variant="caption" color="text.secondary">共 {total} 部 · 离线目录</Typography>
      </Box>

      <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
        <TextField
          size="small" variant="outlined" placeholder="搜索帖名 / 书家 / 朝代…"
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          sx={{ minWidth: 200, flex: { xs: '1 1 100%', sm: '0 1 240px' } }}
          InputProps={{ startAdornment: <SearchIcon color="action" fontSize="small" sx={{ mr: 1 }} /> }}
        />
        {chips.map((s) => {
          const selected = styleFilter === s;
          const n = s === '全部' ? catalogIndex.total : styleCounts[s];
          return (
            <Chip
              key={s} size="small"
              label={
                <Box component="span" sx={{ display: 'inline-flex', gap: 0.5, alignItems: 'baseline' }}>
                  <span style={{ fontWeight: selected ? 700 : 500 }}>{s}</span>
                  {n !== undefined && <span style={{ fontSize: 10, opacity: 0.75 }}>{n}</span>}
                </Box>
              }
              onClick={() => setStyleFilter(s)}
              color={selected ? 'primary' : 'default'}
              variant={selected ? 'filled' : 'outlined'}
              sx={{ cursor: 'pointer' }}
            />
          );
        })}
        {DYNASTY_ORDER.filter((d) => dynastyCounts[d])
          .concat(Object.keys(dynastyCounts).filter((d) => !DYNASTY_ORDER.includes(d)))
          .map((d) => {
            const selected = dynastyFilter === d;
            return (
              <Chip
                key={`dy-${d}`} size="small"
                label={
                  <Box component="span" sx={{ display: 'inline-flex', gap: 0.5, alignItems: 'baseline' }}>
                    <span style={{ fontWeight: selected ? 700 : 500 }}>{d}</span>
                    <span style={{ fontSize: 10, opacity: 0.75 }}>{dynastyCounts[d]}</span>
                  </Box>
                }
                onClick={() => setDynastyFilter(selected ? '全部' : d)}
                color={selected ? 'primary' : 'default'}
                variant={selected ? 'filled' : 'outlined'}
                sx={{ cursor: 'pointer' }}
              />
            );
          })}
        <TextField
          select size="small" value={calligrapherFilter}
          onChange={(e) => setCalligrapherFilter(e.target.value)}
          sx={{ minWidth: 120 }}
        >
          {calligrapherOptions.map((c) => (
            <MenuItem key={c} value={c} sx={{ fontSize: 13 }}>{c}</MenuItem>
          ))}
        </TextField>
      </Box>

      {error && <Alert severity="error" onClose={() => setError(null)}>{error}</Alert>}

      {loading ? (
        <Box sx={{ textAlign: 'center', py: 6 }}><CircularProgress /></Box>
      ) : zuopins.length === 0 ? (
        <Typography color="text.secondary" sx={{ textAlign: 'center', py: 6 }}>没有匹配的碑帖</Typography>
      ) : (
        <>
          {(() => {
            const featured = catalogIndex.zuopins.filter((z) => z.f === 1);
            if (featured.length === 0) return null;
            return (
              <Box>
                <Typography sx={{ fontWeight: 600, fontSize: 13, mb: 0.75 }}>
                  ✨ 编辑精选 <Typography component="span" variant="caption" color="text.secondary">最值得收藏的书法字帖</Typography>
                </Typography>
                <Box sx={{ display: 'flex', gap: 1, overflowX: 'auto', pb: 1, '&::-webkit-scrollbar': { height: 5 }, '&::-webkit-scrollbar-thumb': { bgcolor: 'divider', borderRadius: 3 } }}>
                  {featured.map((z) => (
                    <Box key={z.id} onClick={() => setDetailZuopin(z)} sx={{ flexShrink: 0, width: 104, cursor: 'pointer' }}>
                      <Box sx={{ position: 'relative', width: '100%', aspectRatio: '1/1', borderRadius: 1.5, overflow: 'hidden', bgcolor: 'grey.100', boxShadow: '0px 0px 0px 1px rgba(0,0,0,0.08)' }}>
                        {z.c.startsWith('http') ? (
                          <Box component="img" src={z.c} alt={z.n} loading="lazy" referrerPolicy="no-referrer"
                            sx={{ width: '100%', height: '100%', objectFit: 'cover' }}
                            onError={(e: any) => { e.currentTarget.style.display = 'none'; }} />
                        ) : null}
                        <Box sx={{ position: 'absolute', top: 3, left: 3, px: 0.4, py: '1px', borderRadius: 0.5, bgcolor: 'rgba(156,39,176,0.85)', color: '#fff', fontSize: 8, fontWeight: 700 }}>
                          荐
                        </Box>
                      </Box>
                      <Typography noWrap sx={{ fontSize: 9, textAlign: 'center', mt: 0.25 }}>{z.n}</Typography>
                    </Box>
                  ))}
                </Box>
              </Box>
            );
          })()}
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: { xs: 'repeat(3, 1fr)', sm: 'repeat(4, 1fr)', md: 'repeat(5, 1fr)', lg: 'repeat(6, 1fr)' },
              gap: 1.25,
            }}
          >
            {zuopins.map((z) => {
              const isSub = subscribed.has(z.z);
              return (
                <Box key={z.id} sx={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                  <Box
                    onClick={() => setDetailZuopin(z)}
                    sx={{
                      position: 'relative', width: '100%', aspectRatio: '1/1', borderRadius: 1.5,
                      overflow: 'hidden', bgcolor: 'grey.100', cursor: 'pointer',
                      boxShadow: '0px 0px 0px 1px rgba(0,0,0,0.08)',
                      '&:hover': { boxShadow: '0px 0px 0px 2px rgba(25,118,210,0.5)' },
                    }}
                  >
                    {z.c.startsWith('http') ? (
                      <Box
                        component="img"
                        src={z.c}
                        alt={z.n}
                        loading="lazy"
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
                        bgcolor: 'rgba(20,20,20,0.06)',
                      }}
                    >
                      <Typography className="font-kai" sx={{ fontSize: 42, color: 'rgba(0,0,0,0.14)', fontWeight: 700 }}>
                        {z.s[0] || '帖'}
                      </Typography>
                    </Box>
                    {(() => {
                      const sm = sourceMeta(z.src);
                      return sm ? (
                        <Box
                          sx={{
                            position: 'absolute', top: 4, left: 4, px: 0.5, py: '1px', borderRadius: 1,
                            bgcolor: sm.tone === 'museum' ? 'rgba(224,178,95,0.92)' : 'rgba(80,96,120,0.66)',
                            color: sm.tone === 'museum' ? '#3b2a10' : '#fff',
                            fontSize: { xs: 8, sm: 9 }, fontWeight: 700, lineHeight: 1.2,
                          }}
                        >
                          {sm.short}
                        </Box>
                      ) : null;
                    })()}
                    <Box
                      sx={{
                        position: 'absolute', top: 4, right: 4, px: 0.5, py: '1px', borderRadius: 1,
                        bgcolor: 'rgba(20,20,20,0.55)', color: '#fff', fontSize: 9, fontWeight: 700,
                      }}
                    >
                      {z.s[0]}
                    </Box>
                  </Box>
                  <Typography
                    noWrap onClick={() => setDetailZuopin(z)}
                    sx={{ mt: 0.5, textAlign: 'center', fontSize: { xs: 10, sm: 11 }, fontWeight: 500, cursor: 'pointer', '&:hover': { color: 'primary.main' } }}
                  >
                    {z.n}
                  </Typography>
                  <Typography noWrap sx={{ textAlign: 'center', fontSize: 9, color: 'text.secondary' }}>
                    {[z.d, z.a].filter(Boolean).join('·')}
                  </Typography>
                  <Box sx={{ display: 'flex', justifyContent: 'center', mt: 0.25 }}>
                    {isSub ? (
                      <Typography component="span" sx={{ fontSize: 10, fontWeight: 600, color: 'success.main' }}>
                        已加入
                      </Typography>
                    ) : pendingId === z.id ? (
                      <CircularProgress size={12} />
                    ) : (
                      <Typography
                        component="span"
                        onClick={() => handleSubscribe(z)}
                        sx={{ fontSize: 10, fontWeight: 600, color: 'primary.main', cursor: 'pointer', '&:hover': { textDecoration: 'underline' } }}
                      >
                        + 加入书库
                      </Typography>
                    )}
                  </Box>
                </Box>
              );
            })}
          </Box>
          {zuopins.length < total && (
            <Box sx={{ display: 'flex', justifyContent: 'center', mt: 2 }}>
              <Button variant="outlined" disabled={loadingMore} onClick={async () => { offsetRef.current += PAGE_SIZE; await load(offsetRef.current); }} sx={{ borderRadius: 2 }}>
                {loadingMore ? <CircularProgress size={16} sx={{ mr: 1 }} /> : null}
                {loadingMore ? '加载中…' : `加载更多（${zuopins.length}/${total}）`}
              </Button>
            </Box>
          )}
        </>
      )}
      <DeckDetailDialog
        open={!!detailZuopin}
        zuopin={detailZuopin}
        subscribed={!!detailZuopin && subscribed.has(detailZuopin.z)}
        pending={!!detailZuopin && pendingId === detailZuopin.id}
        onClose={() => setDetailZuopin(null)}
        onSubscribe={(z) => handleSubscribe(z)}
      />
    </Box>
  );
};

export default MarketPage;
