import React, { useCallback, useMemo, useState } from 'react';
import {
  Box,
  Typography,
  Button,
  Chip,
  TextField,
  Paper,
  MenuItem,
  CircularProgress,
  Alert,
} from '@mui/material';
import DownloadIcon from '@mui/icons-material/Download';
import SearchIcon from '@mui/icons-material/Search';
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

  return (
    <Box className="space-y-3">
      <Typography className="font-kai" sx={{ fontSize: 20, fontWeight: 700 }}>集字</Typography>

      {/* 数据源 */}
      <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
        <Chip label="全部字库" size="small"
          color={scope === 'all' ? 'primary' : 'default'}
          variant={scope === 'all' ? 'filled' : 'outlined'}
          onClick={() => setScope('all')} sx={{ cursor: 'pointer' }} />
        <Chip label="我的书库" size="small"
          color={scope === 'mine' ? 'primary' : 'default'}
          variant={scope === 'mine' ? 'filled' : 'outlined'}
          onClick={() => setScope('mine')} sx={{ cursor: 'pointer' }} />
        <Typography variant="caption" color="text.secondary">
          {scope === 'all' ? '在线版全库 · 168 万+ 单字' : '仅本机已订阅碑帖'}
        </Typography>
      </Box>

      {/* 输入 */}
      <TextField
        multiline minRows={2} fullWidth
        placeholder="输入文字，从字库匹配单字…"
        value={text}
        onChange={(e) => setText(e.target.value)}
        sx={{ bgcolor: 'background.paper', borderRadius: 2 }}
      />
      <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
        <Button
          variant="contained" startIcon={<SearchIcon />}
          onClick={match} disabled={busy || !text.trim()} sx={{ borderRadius: 2 }}
        >
          {busy ? '匹配中…' : '匹配单字'}
        </Button>
        {busy && <CircularProgress size={16} />}
        {hint && <Typography variant="caption" color="text.secondary">{hint}</Typography>}
      </Box>

      {error && <Alert severity="error" onClose={() => setError(null)}>{error}</Alert>}

      {/* 结果 */}
      {results && (
        <>
          {/* 书体/书家筛选 */}
          <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
            {STYLE_FILTERS.map((s) => (
              <Chip key={s} label={s} size="small"
                color={styleFilter === s ? 'primary' : 'default'}
                variant={styleFilter === s ? 'filled' : 'outlined'}
                onClick={() => setStyleFilter(s)} sx={{ cursor: 'pointer' }} />
            ))}
            <TextField
              select size="small" value={calligrapherFilter}
              onChange={(e) => setCalligrapherFilter(e.target.value)}
              sx={{ minWidth: 110, '& .MuiInputBase-input': { fontSize: 12 } }}
            >
              {calligrapherOptions.map((c) => (
                <MenuItem key={c} value={c} sx={{ fontSize: 12 }}>{c}</MenuItem>
              ))}
            </TextField>
          </Box>

          {/* 预览 */}
          <Paper
            variant="outlined"
            sx={{
              p: 2, borderRadius: 2, overflow: 'auto',
              bgcolor: isDarkBg ? (layout.background === 'ink' ? '#1a1a1a' : '#8b0000')
                : layout.background === 'white' ? '#fff' : '#f5ecd9',
            }}
          >
            <Box
              sx={{
                display: 'flex',
                flexDirection: isVertical ? 'row-reverse' : 'column',
                gap: `${Math.round(layout.fontSize * layout.lineGap)}px`,
                width: 'fit-content', mx: 'auto',
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
                          display: 'flex', flexDirection: 'column', alignItems: 'center',
                          cursor: r.hits.length > 1 ? 'pointer' : 'default', flexShrink: 0,
                        }}
                      >
                        <Box
                          sx={{
                            width: layout.fontSize, height: layout.fontSize,
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                          }}
                        >
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
                                width: '100%', height: '100%', border: '1px dashed #bbb',
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                color: isDarkBg ? '#ccc' : '#999',
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
                            fontSize: 9, lineHeight: 1.4, maxWidth: '100%',
                            color: isDarkBg ? 'rgba(255,255,255,0.65)' : 'text.secondary',
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
          </Paper>

          {/* 排版控制 */}
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, alignItems: 'center' }}>
            {DIRECTIONS.map((d) => (
              <Chip key={d.key} label={d.label} size="small"
                color={layout.direction === d.key ? 'primary' : 'default'}
                variant={layout.direction === d.key ? 'filled' : 'outlined'}
                onClick={() => setLayout((l) => ({ ...l, direction: d.key }))} sx={{ cursor: 'pointer' }} />
            ))}
            {FONT_SIZES.map((s) => (
              <Chip key={s} label={`${s}px`} size="small"
                color={layout.fontSize === s ? 'primary' : 'default'}
                variant={layout.fontSize === s ? 'filled' : 'outlined'}
                onClick={() => setLayout((l) => ({ ...l, fontSize: s }))} sx={{ cursor: 'pointer' }} />
            ))}
            {COL_COUNTS.map((c) => (
              <Chip key={c} label={`${isVertical ? '列' : '行'}${c}`} size="small"
                color={layout.colCount === c ? 'primary' : 'default'}
                variant={layout.colCount === c ? 'filled' : 'outlined'}
                onClick={() => setLayout((l) => ({ ...l, colCount: c }))} sx={{ cursor: 'pointer' }} />
            ))}
            {BACKGROUNDS.map((b) => (
              <Chip key={b.key} label={b.label} size="small"
                color={layout.background === b.key ? 'primary' : 'default'}
                variant={layout.background === b.key ? 'filled' : 'outlined'}
                onClick={() => setLayout((l) => ({ ...l, background: b.key }))} sx={{ cursor: 'pointer' }} />
            ))}
          </Box>

          <Button
            fullWidth variant="contained" startIcon={<DownloadIcon />}
            onClick={handleExport} disabled={exporting} sx={{ borderRadius: 2 }}
          >
            {exporting ? '生成中…' : '导出高清 PNG'}
          </Button>
        </>
      )}
    </Box>
  );
};

export default JiziPage;
