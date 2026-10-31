import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Box,
  Typography,
  Button,
} from '@mui/material';
import { localDataSource } from '@/data/local/localAdapter';
import { exportJiziPNG } from '@/lib/jiziExport';
import { groupResults } from '@/components/jizi/JiziPreview';
import type { JiziLayout, JiziMatchResult } from '@/types/jizi';
import type { LocalCard, LocalDeck } from '@/core/types';

const SERVER_API = 'https://beizitie.com';
const DIRECTIONS: { key: JiziLayout['direction']; label: string }[] = [
  { key: 'vertical-rl', label: '竖排·右起' },
  { key: 'horizontal-lr', label: '横排' },
];
const FONT_SIZES = [80, 120, 160];
const COL_COUNTS = [4, 6, 8];
const BACKGROUNDS: { key: JiziLayout['background']; label: string }[] = [
  { key: 'xuan', label: '宣纸' },
  { key: 'white', label: '白' },
  { key: 'ink', label: '墨' },
  { key: 'vermilion', label: '朱砂' },
];
const STYLE_FILTERS = ['全部', '楷', '行', '草', '隶', '篆'];

function cleanHanzi(raw: string): string {
  let s = (raw || '').trim();
  s = s.replace(/\s*[(\[【（][^)\]】]*[)\]】]?$/u, '');
  s = s.replace(/[_\-]\d+$/u, '');
  s = s.replace(/(\p{Script=Han})\d{1,3}$/u, '$1');
  return s.replace(/\s+/g, '');
}

/** 相对路径（/uploads/...）补全为在线版绝对地址 */
function absolutize(url: string): string {
  return url.startsWith('http') ? url : `${SERVER_API}${url}`;
}

type Scope = 'all' | 'mine';

/** 全部字库匹配结果的模块级缓存：字符 → 结果（跨查询复用，重复字零请求） */
const allCharCache = new Map<string, JiziMatchResult>();

export const JiziPage: React.FC = () => {
  const [scope, setScope] = useState<Scope>('all');
  const [text, setText] = useState('');
  const [results, setResults] = useState<JiziMatchResult[] | null>(null);
  const [selections, setSelections] = useState<number[]>([]);
  const [busy, setBusy] = useState(false);
  const [hint, setHint] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  const [styleFilter, setStyleFilter] = useState('全部');
  const [calligrapherFilter, setCalligrapherFilter] = useState('全部');

  const [layout, setLayout] = useState<JiziLayout>({
    direction: 'vertical-rl',
    fontSize: 120,
    colCount: 6,
    charGap: 0.15,
    lineGap: 0.25,
    background: 'xuan',
    compact: true,
  });

  // ---- 数据源：全部字库（在线版公开接口，168 万+ 单字）/ 我的书库（本地） ----
  // 字符级缓存：跨查询/跨会话(模块级)复用已匹配的字，重复内容零网络请求
  const matchAll = useCallback(async (chars: string[]): Promise<JiziMatchResult[]> => {
    const missing = chars.filter((c) => !allCharCache.has(c));
    if (missing.length > 0) {
      const r = await fetch(`${SERVER_API}/api/jizi/match?text=${encodeURIComponent(missing.join(''))}&scope=all&_plat=web`);
      if (!r.ok) throw new Error(`在线匹配失败 HTTP ${r.status}`);
      const data = await r.json();
      for (const res of data.results || []) {
        for (const hit of res.hits || []) hit.image_url = absolutize(hit.image_url);
        allCharCache.set(res.char, res);
      }
    }
    return chars.map((c) => allCharCache.get(c) || { char: c, hits: [] });
  }, []);

  const matchMine = useCallback(async (chars: string[]): Promise<JiziMatchResult[]> => {
    const decks: LocalDeck[] = await localDataSource.library.list();
    const hitsByChar = new Map<string, JiziMatchResult>();
    for (const d of decks) {
      const cards: LocalCard[] = await localDataSource.library.cards(d.id);
      for (const c of cards) {
        const h = cleanHanzi(c.hanzi);
        if (!chars.includes(h)) continue;
        let r = hitsByChar.get(h);
        if (!r) {
          r = { char: h, hits: [] };
          hitsByChar.set(h, r);
        }
        r.hits.push({
          card_id: c.id,
          image_url: c.imageUrl,
          deck_id: c.deckId,
          deck_name: d.name,
          style: d.styles[0] || '',
          calligrapher: d.author,
          front_text_raw: c.hanzi,
          sort_key: c.sortOrder,
        });
      }
    }
    return chars.map((ch) => hitsByChar.get(ch) || { char: ch, hits: [] });
  }, []);

  const match = useCallback(async () => {
    const chars = [...new Set(cleanHanzi(text).split(''))].filter(Boolean);
    if (chars.length === 0) return;
    setBusy(true);
    setError(null);
    setHint(null);
    try {
      const results = scope === 'all' ? await matchAll(chars) : await matchMine(chars);
      setResults(results);
      setSelections(new Array(results.length).fill(0));
      const missing = results.filter((r) => r.hits.length === 0).length;
      setHint(
        (scope === 'all' ? '全库匹配完成' : '本机书库匹配完成') + (missing ? `，缺字 ${missing} 个` : ''),
      );
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }, [text, scope, matchAll, matchMine]);

  // ---- 书体/书家筛选（作用于每个字的候选写法） ----
  const filteredResults = useMemo(() => {
    if (!results) return [];
    if (styleFilter === '全部' && calligrapherFilter === '全部') return results;
    return results.map((r) => ({
      ...r,
      hits: r.hits.filter((h) => {
        if (styleFilter !== '全部' && !(h.style || '').includes(styleFilter)) return false;
        if (calligrapherFilter !== '全部' && h.calligrapher !== calligrapherFilter) return false;
        return true;
      }),
    }));
  }, [results, styleFilter, calligrapherFilter]);

  const calligrapherOptions = useMemo(() => {
    if (!results) return ['全部'];
    const set = new Set<string>();
    for (const r of results) for (const h of r.hits) if (h.calligrapher) set.add(h.calligrapher);
    return ['全部', ...[...set].sort((a, b) => a.localeCompare(b, 'zh-CN'))];
  }, [results]);

  const cycle = (idx: number) => {
    setSelections((prev) => {
      const hits = filteredResults[idx]?.hits.length || 0;
      if (hits < 2) return prev;
      const next = [...prev];
      next[idx] = (next[idx] + 1) % hits;
      return next;
    });
  };

  const groups = useMemo(() => {
    if (!results) return [];
    return groupResults(filteredResults, layout.colCount, text);
  }, [filteredResults, layout.colCount, text]);

  // 换书体/书家后候选变少时，旧下标可能越界（r.hits[sel] 变 undefined）→ 收敛到最后一个候选
  useEffect(() => {
    setSelections((prev) =>
      prev.map((s, i) => {
        const n = filteredResults[i]?.hits.length ?? 0;
        return n > 0 ? Math.min(s, n - 1) : 0;
      }),
    );
  }, [filteredResults]);

  const isVertical = layout.direction.startsWith('vertical');
  const isDarkBg = layout.background === 'ink' || layout.background === 'vermilion';

  const handleExport = async () => {
    if (!results) return;
    setExporting(true);
    try {
      await exportJiziPNG(filteredResults, selections, layout, cleanHanzi(text));
    } catch (e: any) {
      setError(`导出失败：${e.message}`);
    } finally {
      setExporting(false);
    }
  };

  const mono = { fontFamily: 'var(--font-mono)', letterSpacing: '0.04em' } as const;
  const rowLabel = { ...mono, fontSize: 9.5, opacity: 0.6, flexShrink: 0, minWidth: 34 } as const;
  const seg = (label: string, on: boolean, onClick: () => void) => (
    <Box
      key={label}
      component="button"
      type="button"
      onClick={onClick}
      aria-pressed={on}
      sx={{
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
      }}
    >
      {label}
    </Box>
  );

  return (
    <Box sx={{ maxWidth: 920, mx: 'auto' }}>
      {/* 页头 */}
      <Box sx={{ pb: { xs: 1.5, md: 1.75 } }}>
        <Typography component="h1" sx={{ fontSize: { xs: 30, md: 44 }, fontWeight: 900, letterSpacing: { xs: '4px', md: '7px' }, lineHeight: 1.1 }}>
          集字
        </Typography>
        <Typography sx={{ ...mono, fontSize: 11, opacity: 0.72, mt: 1 }}>
          {scope === 'all' ? '在线全库 · 168 万+ 单字' : '仅本机已订阅碑帖'} · 点字可换写法
        </Typography>
      </Box>

      {/* 数据源 */}
      <Box sx={{ borderTop: '1px solid', borderBottom: '1px solid', borderColor: 'text.primary', py: 1.25, display: 'flex', alignItems: 'center', gap: 1 }}>
        <Typography sx={rowLabel}>字库</Typography>
        {seg('全部字库', scope === 'all', () => setScope('all'))}
        {seg('我的书库', scope === 'mine', () => setScope('mine'))}
        <Typography sx={{ ...mono, fontSize: 9.5, opacity: 0.5, ml: 'auto', display: { xs: 'none', sm: 'block' } }}>
          SOURCE
        </Typography>
      </Box>

      {/* 输入 */}
      <Box sx={{ pt: 2 }}>
        <Typography sx={{ ...mono, fontSize: 9.5, letterSpacing: '0.14em', textTransform: 'uppercase', opacity: 0.6, mb: 0.75 }}>
          集字内容 · Text
        </Typography>
        <Box
          component="textarea"
          value={text}
          onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setText(e.target.value)}
          placeholder="输入文字，从字库匹配单字…"
          aria-label="集字内容"
          rows={3}
          sx={{
            width: '100%',
            resize: 'none',
            border: '1px solid',
            borderColor: 'text.primary',
            bgcolor: 'transparent',
            color: 'text.primary',
            p: '10px 12px',
            fontSize: 15,
            lineHeight: 1.9,
            letterSpacing: '0.05em',
            outline: 'none',
            fontFamily: 'inherit',
            '&::placeholder': { color: 'text.disabled' },
          }}
        />
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mt: 1.25 }}>
          <Button
            variant="contained"
            onClick={match}
            disabled={busy || !text.trim()}
            sx={{ height: 44, px: 2.25, justifyContent: 'space-between', gap: 3, flexShrink: 0 }}
          >
            <span>{busy ? '匹配中…' : '匹配单字'}</span>
            <span aria-hidden>→</span>
          </Button>
          {hint && <Typography sx={{ ...mono, fontSize: 10, opacity: 0.55 }}>{hint}</Typography>}
        </Box>

        {error && (
          <Typography sx={{ ...mono, fontSize: 11, color: 'var(--hot-ink)', mt: 1.25 }}>{error}</Typography>
        )}
      </Box>

      {results && (
        <>
          {/* 筛选 */}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap', mt: 2, pb: 1, borderBottom: '1px solid', borderColor: 'divider' }}>
            <Typography sx={rowLabel}>书体</Typography>
            {STYLE_FILTERS.map((s) => seg(s, styleFilter === s, () => setStyleFilter(s)))}
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, ml: { xs: 0, sm: 'auto' } }}>
              <Typography sx={rowLabel}>书家</Typography>
              <Box
                component="select"
                value={calligrapherFilter}
                onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setCalligrapherFilter(e.target.value)}
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
                  maxWidth: 140,
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

          {/* 预览：纸面 + 方正字阵 */}
          <Box
            sx={{
              mt: 2,
              p: 2,
              border: '2px solid',
              borderColor: 'text.primary',
              overflow: 'auto',
              maxHeight: { xs: '62vh', md: 'none' },
              bgcolor: isDarkBg ? (layout.background === 'ink' ? '#1a1a1a' : '#8b0000')
                : layout.background === 'white' ? '#fff' : '#f5ecd9',
            }}
          >
            <Box
              sx={{
                display: 'flex',
                flexDirection: isVertical ? 'row-reverse' : 'column',
                gap: `${Math.round(layout.fontSize * layout.lineGap)}px`,
                width: 'fit-content',
                mx: 'auto',
              }}
            >
              {groups.map((g, gi) => (
                <Box
                  key={gi}
                  sx={{
                    display: 'flex',
                    flexDirection: isVertical ? 'column' : 'row',
                    gap: `${Math.round(layout.fontSize * layout.charGap)}px`,
                  }}
                >
                  {g.items.map((r, ii) => {
                    const globalIndex = g.offset + ii;
                    const sel = selections[globalIndex] ?? 0;
                    const hit = r.hits[sel];
                    return (
                      <Box
                        key={globalIndex}
                        onClick={() => cycle(globalIndex)}
                        title={r.hits.length > 1 ? '点击换一个写法' : hit ? hit.calligrapher : '缺字'}
                        sx={{
                          width: layout.fontSize,
                          display: 'flex',
                          flexDirection: 'column',
                          alignItems: 'center',
                          cursor: r.hits.length > 1 ? 'pointer' : 'default',
                          flexShrink: 0,
                        }}
                      >
                        <Box sx={{ width: layout.fontSize, height: layout.fontSize, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                          {hit ? (
                            <Box
                              component="img"
                              src={hit.image_url}
                              referrerPolicy="no-referrer"
                              sx={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }}
                            />
                          ) : (
                            <Box
                              sx={{
                                width: '100%', height: '100%', border: '1px dashed',
                                borderColor: isDarkBg ? 'rgba(255,255,255,0.4)' : 'rgba(23,19,12,0.35)',
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                color: isDarkBg ? 'rgba(255,255,255,0.6)' : 'rgba(23,19,12,0.5)',
                                fontSize: layout.fontSize * 0.4, fontFamily: 'serif',
                              }}
                            >
                              {r.char}
                            </Box>
                          )}
                        </Box>
                        <Typography
                          noWrap
                          sx={{
                            ...mono,
                            fontSize: 8.5,
                            lineHeight: 1.4,
                            maxWidth: '100%',
                            color: isDarkBg ? 'rgba(255,255,255,0.6)' : 'rgba(23,19,12,0.55)',
                          }}
                        >
                          {[hit?.calligrapher, hit?.deck_name].filter(Boolean).join('·') || '缺字'}
                        </Typography>
                      </Box>
                    );
                  })}
                </Box>
              ))}
            </Box>
          </Box>

          {/* 排版控制 */}
          <Box sx={{ mt: 2, borderTop: '1px solid', borderColor: 'text.primary', pt: 1.5, display: 'flex', flexDirection: 'column', gap: 1 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, overflowX: 'auto' }}>
              <Typography sx={rowLabel}>方向</Typography>
              {DIRECTIONS.map((d) => seg(d.label, layout.direction === d.key, () => setLayout((l) => ({ ...l, direction: d.key }))))}
            </Box>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, overflowX: 'auto' }}>
              <Typography sx={rowLabel}>字号</Typography>
              {FONT_SIZES.map((s) => seg(`${s}`, layout.fontSize === s, () => setLayout((l) => ({ ...l, fontSize: s }))))}
            </Box>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, overflowX: 'auto' }}>
              <Typography sx={rowLabel}>{isVertical ? '每列' : '每行'}</Typography>
              {COL_COUNTS.map((c) => seg(`${c} 字`, layout.colCount === c, () => setLayout((l) => ({ ...l, colCount: c }))))}
            </Box>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
              <Typography sx={rowLabel}>背景</Typography>
              {BACKGROUNDS.map((b) => seg(b.label, layout.background === b.key, () => setLayout((l) => ({ ...l, background: b.key }))))}
            </Box>
          </Box>

          <Button
            fullWidth
            variant="contained"
            onClick={handleExport}
            disabled={exporting}
            sx={{ mt: 2, height: 46, justifyContent: 'space-between', px: 2.25 }}
          >
            <span>{exporting ? '生成中…' : '导出高清 PNG'}</span>
            <span aria-hidden>↓</span>
          </Button>
        </>
      )}
    </Box>
  );
};

export default JiziPage;
