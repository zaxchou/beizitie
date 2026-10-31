import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Box, Typography, Button } from '@mui/material';
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

  const mono = { fontFamily: 'var(--font-mono)', letterSpacing: '0.04em' } as const;
  const filterBtn = (on: boolean) => ({
    border: '1px solid',
    borderColor: on ? 'text.primary' : 'divider',
    bgcolor: on ? 'text.primary' : 'transparent',
    color: on ? 'background.default' : 'inherit',
    ...mono,
    fontSize: 11,
    height: 26,
    px: 1,
    cursor: 'pointer',
    whiteSpace: 'nowrap',
    flexShrink: 0,
    '&:hover': on ? {} : { borderColor: 'text.primary' },
  }) as const;

  return (
    <Box>
      {/* 页头 */}
      <Box sx={{ pb: { xs: 1.5, md: 1.75 } }}>
        <Typography component="h1" sx={{ fontSize: { xs: 30, md: 44 }, fontWeight: 900, letterSpacing: { xs: '4px', md: '7px' }, lineHeight: 1.1 }}>
          碑帖市场
        </Typography>
        <Typography sx={{ ...mono, fontSize: 11, opacity: 0.72, mt: 1 }}>
          共 {total} 部 · 离线目录 · 按书体 / 朝代 / 书家筛
        </Typography>
      </Box>

      {/* 工具条 */}
      <Box sx={{ borderTop: '1px solid', borderColor: 'text.primary', py: 1.25, display: 'flex', flexDirection: 'column', gap: 1.25 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, borderBottom: '1px solid', borderColor: 'text.primary', pb: '3px', flex: { xs: '1 1 100%', sm: '0 1 300px' } }}>
            <SearchIcon sx={{ fontSize: 15, opacity: 0.55 }} />
            <Box
              component="input"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              placeholder="搜索帖名 / 书家 / 朝代"
              aria-label="搜索碑帖"
              sx={{ border: 0, outline: 'none', background: 'transparent', color: 'text.primary', ...mono, fontSize: 12, width: '100%', p: 0 }}
            />
          </Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Typography sx={{ ...mono, fontSize: 9.5, opacity: 0.6 }}>书家</Typography>
            <Box
              component="select"
              value={calligrapherFilter}
              onChange={(e) => setCalligrapherFilter(e.target.value)}
              aria-label="按书家筛选"
              sx={{
                border: 0,
                borderBottom: '1px solid',
                borderColor: 'text.primary',
                background: 'transparent',
                color: 'text.primary',
                ...mono,
                fontSize: 11,
                py: '3px',
                pr: '16px',
                maxWidth: 150,
                outline: 'none',
                cursor: 'pointer',
              }}
            >
              {calligrapherOptions.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </Box>
          </Box>
        </Box>

        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 1,
            flexWrap: { xs: 'wrap', md: 'nowrap' },
            overflowX: { xs: 'visible', md: 'auto' },
            pb: 0.25,
            '&::-webkit-scrollbar': { height: 0 },
            scrollbarWidth: 'none',
          }}
        >
          <Typography sx={{ ...mono, fontSize: 9.5, opacity: 0.6, flexShrink: 0, mr: 0.5 }}>书体</Typography>
          {chips.map((s) => {
            const on = styleFilter === s;
            const n = s === '全部' ? catalogIndex.total : styleCounts[s];
            return (
              <Box key={s} component="button" type="button" onClick={() => setStyleFilter(s)} aria-pressed={on} sx={filterBtn(on)}>
                {s}
                {n !== undefined && <Box component="span" sx={{ ml: 0.6, opacity: 0.55 }}>{n}</Box>}
              </Box>
            );
          })}
        </Box>

        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 1,
            overflowX: 'auto',
            pb: 0.25,
            '&::-webkit-scrollbar': { height: 0 },
            scrollbarWidth: 'none',
          }}
        >
          <Typography sx={{ ...mono, fontSize: 9.5, opacity: 0.6, flexShrink: 0, mr: 0.5 }}>朝代</Typography>
          {DYNASTY_ORDER.filter((d) => dynastyCounts[d])
            .concat(Object.keys(dynastyCounts).filter((d) => !DYNASTY_ORDER.includes(d)))
            .map((d) => {
              const on = dynastyFilter === d;
              return (
                <Box
                  key={`dy-${d}`}
                  component="button"
                  type="button"
                  onClick={() => setDynastyFilter(on ? '全部' : d)}
                  aria-pressed={on}
                  sx={filterBtn(on)}
                >
                  {d}
                  <Box component="span" sx={{ ml: 0.6, opacity: 0.55 }}>{dynastyCounts[d]}</Box>
                </Box>
              );
            })}
        </Box>
      </Box>

      {error && (
        <Typography sx={{ ...mono, fontSize: 11, color: 'var(--hot-ink)', py: 1 }}>{error}</Typography>
      )}

      {loading ? (
        <Typography sx={{ ...mono, fontSize: 11, opacity: 0.7, py: 8, textAlign: 'center' }}>正在读目录…</Typography>
      ) : zuopins.length === 0 ? (
        <Box sx={{ borderTop: '2px solid', borderColor: 'text.primary', py: 10, textAlign: 'center' }}>
          <Typography sx={{ fontSize: 64, fontWeight: 900, lineHeight: 1, opacity: 0.14 }}>无</Typography>
          <Typography sx={{ mt: 1.5, fontSize: 15, fontWeight: 700, letterSpacing: '0.08em' }}>没有匹配的碑帖</Typography>
          <Typography sx={{ ...mono, fontSize: 10.5, opacity: 0.6, mt: 0.75 }}>NO MATCH</Typography>
        </Box>
      ) : (
        <>
          {(() => {
            const featured = catalogIndex.zuopins.filter((z) => z.f === 1);
            if (featured.length === 0) return null;
            return (
              <Box sx={{ pt: 2 }}>
                <Typography sx={{ fontSize: 13, fontWeight: 900, letterSpacing: '2px', pb: 0.75 }}>
                  编辑精选
                  <Box component="span" sx={{ ...mono, fontSize: 10.5, fontWeight: 400, letterSpacing: '0.04em', opacity: 0.65, ml: 1 }}>Featured</Box>
                </Typography>
                <Box sx={{ display: 'flex', gap: 1.25, overflowX: 'auto', pb: 1, borderTop: '1px solid', borderColor: 'text.primary', pt: 1.25, '&::-webkit-scrollbar': { height: 0 }, scrollbarWidth: 'none' }}>
                  {featured.map((z) => (
                    <Box key={z.id} onClick={() => setDetailZuopin(z)} sx={{ flexShrink: 0, width: 96, cursor: 'pointer' }}>
                      <Box sx={{ position: 'relative', width: '100%', aspectRatio: '1/1', overflow: 'hidden', bgcolor: 'var(--surface)', border: '1px solid', borderColor: 'divider', '&:hover': { borderColor: 'text.primary' } }}>
                        {z.c.startsWith('http') ? (
                          <Box
                            component="img"
                            src={z.c}
                            alt={z.n}
                            loading="lazy"
                            referrerPolicy="no-referrer"
                            sx={{ width: '100%', height: '100%', objectFit: 'cover' }}
                            onError={(e: any) => { e.currentTarget.style.display = 'none'; }}
                          />
                        ) : null}
                        <Box sx={{ position: 'absolute', top: 3, left: 3, px: 0.4, py: '1px', bgcolor: 'var(--hot-ink)', color: 'var(--paper)', ...mono, fontSize: 8, fontWeight: 700 }}>
                          荐
                        </Box>
                      </Box>
                      <Typography noWrap className="font-kai" sx={{ fontSize: 12.5, lineHeight: 1.3, mt: 0.5 }}>{z.n}</Typography>
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
              gap: { xs: 1.25, md: 1.5 },
              pt: 2,
            }}
          >
            {zuopins.map((z) => {
              const isSub = subscribed.has(z.z);
              return (
                <Box key={z.id} sx={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                  <Box
                    onClick={() => setDetailZuopin(z)}
                    sx={{
                      position: 'relative',
                      width: '100%',
                      aspectRatio: '1/1',
                      overflow: 'hidden',
                      bgcolor: 'var(--surface)',
                      cursor: 'pointer',
                      border: '1px solid',
                      borderColor: 'divider',
                      '&:hover': { borderColor: 'text.primary' },
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
                        bgcolor: 'transparent',
                      }}
                    >
                      <Typography className="font-kai" sx={{ fontSize: 42, color: 'var(--line-strong)', fontWeight: 400 }}>
                        {z.s[0] || '帖'}
                      </Typography>
                    </Box>
                    {(() => {
                      const sm = sourceMeta(z.src);
                      return sm ? (
                        <Box
                          sx={{
                            position: 'absolute', top: 4, left: 4, px: 0.5, py: '1px',
                            bgcolor: 'var(--paper)',
                            color: sm.tone === 'museum' ? 'var(--hot-ink)' : 'var(--muted)',
                            border: '1px solid',
                            borderColor: sm.tone === 'museum' ? 'var(--hot-ink)' : 'var(--line)',
                            ...mono, fontSize: { xs: 8, sm: 9 }, fontWeight: 700, lineHeight: 1.2,
                          }}
                        >
                          {sm.short}
                        </Box>
                      ) : null;
                    })()}
                    <Box
                      sx={{
                        position: 'absolute', top: 4, right: 4, px: 0.5, py: '1px',
                        bgcolor: 'var(--paper)', color: 'var(--muted)', border: '1px solid var(--line)', ...mono, fontSize: 9, fontWeight: 600,
                      }}
                    >
                      {z.s[0]}
                    </Box>
                  </Box>

                  <Typography
                    noWrap
                    onClick={() => setDetailZuopin(z)}
                    className="font-kai"
                    sx={{ mt: 0.6, fontSize: { xs: 12, sm: 13 }, lineHeight: 1.3, cursor: 'pointer', '&:hover': { textDecoration: 'underline' } }}
                  >
                    {z.n}
                  </Typography>
                  <Typography noWrap sx={{ ...mono, fontSize: 9.5, color: 'text.secondary', lineHeight: 1.4, mt: 0.2 }}>
                    {[z.d, z.a].filter(Boolean).join(' · ')}
                  </Typography>

                  <Box sx={{ display: 'flex', alignItems: 'center', mt: 0.4 }}>
                    {isSub ? (
                      <Typography component="span" sx={{ ...mono, fontSize: 9.5, opacity: 0.5 }}>
                        已加入
                      </Typography>
                    ) : pendingId === z.id ? (
                      <Typography component="span" sx={{ ...mono, fontSize: 9.5, opacity: 0.5 }}>
                        加入中…
                      </Typography>
                    ) : (
                      <Box
                        component="button"
                        type="button"
                        onClick={() => handleSubscribe(z)}
                        sx={{
                          border: 0,
                          background: 'none',
                          color: 'inherit',
                          p: 0,
                          cursor: 'pointer',
                          ...mono,
                          fontSize: 9.5,
                          opacity: 0.7,
                          '&:hover': { opacity: 1, textDecoration: 'underline' },
                        }}
                      >
                        + 加入书库
                      </Box>
                    )}
                  </Box>
                </Box>
              );
            })}
          </Box>

          {zuopins.length < total && (
            <Box sx={{ display: 'flex', justifyContent: 'center', mt: 3 }}>
              <Button
                variant="outlined"
                disabled={loadingMore}
                onClick={async () => { offsetRef.current += PAGE_SIZE; await load(offsetRef.current); }}
                sx={{ height: 40, px: 3, ...mono, fontSize: 11 }}
              >
                {loadingMore ? '加载中…' : `加载更多（${zuopins.length} / ${total}）`}
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
