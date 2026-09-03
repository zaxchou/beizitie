import React, { useCallback, useMemo, useState } from 'react';
import {
  Box,
  Typography,
  Button,
  Chip,
  TextField,
  Paper,
} from '@mui/material';
import DownloadIcon from '@mui/icons-material/Download';
import { localDataSource } from '@/data/local/localAdapter';
import { exportJiziPNG } from '@/lib/jiziExport';
import { groupResults } from '@/components/jizi/JiziPreview';
import type { JiziLayout, JiziMatchResult } from '@/types/jizi';
import type { LocalCard, LocalDeck } from '@/core/types';

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

function cleanHanzi(raw: string): string {
  let s = (raw || '').trim();
  s = s.replace(/\s*[(\[【（][^)\]】]*[)\]】]?$/u, '');
  s = s.replace(/[_\-]\d+$/u, '');
  s = s.replace(/(\p{Script=Han})\d{1,3}$/u, '$1');
  return s.replace(/\s+/g, '');
}

/** 集字（单文件版）：从本机书库匹配单字，拼作品导出 PNG */
export const JiziPage: React.FC = () => {
  const [text, setText] = useState('');
  const [results, setResults] = useState<JiziMatchResult[] | null>(null);
  const [selections, setSelections] = useState<number[]>([]);
  const [busy, setBusy] = useState(false);
  const [hint, setHint] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [layout, setLayout] = useState<JiziLayout>({
    ...({ direction: 'vertical-rl', fontSize: 120, colCount: 6, charGap: 0.15, lineGap: 0.25, background: 'xuan', compact: true } as JiziLayout),
  });

  const match = useCallback(async () => {
    const chars = [...new Set(cleanHanzi(text).split(''))].filter(Boolean);
    if (chars.length === 0) return;
    setBusy(true);
    setHint(null);
    try {
      // 本机书库全量卡（含暂停牌组，集字不区分）
      const decks: LocalDeck[] = await localDataSource.library.list();
      const hitsByChar = new Map<string, JiziMatchResult>();
      let scanned = 0;
      for (const d of decks) {
        const cards: LocalCard[] = await localDataSource.library.cards(d.id);
        scanned += cards.length;
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
      const results: JiziMatchResult[] = cleanHanzi(text)
        .split('')
        .map((ch) => hitsByChar.get(ch) || { char: ch, hits: [] });
      setResults(results);
      setSelections(new Array(results.length).fill(0));
      const missing = results.filter((r) => r.hits.length === 0).length;
      setHint(missing === 0 ? `全部命中（扫描 ${scanned} 卡）` : `缺字 ${missing} 个（书库未收录，显示虚线框）`);
    } finally {
      setBusy(false);
    }
  }, [text]);

  const cycle = (idx: number) => {
    setSelections((prev) => {
      const hits = results?.[idx]?.hits.length || 0;
      if (hits < 2) return prev;
      const next = [...prev];
      next[idx] = (next[idx] + 1) % hits;
      return next;
    });
  };

  const groups = useMemo(() => {
    if (!results) return [];
    return groupResults(results, layout.colCount, text);
  }, [results, layout.colCount, text]);

  const isVertical = layout.direction.startsWith('vertical');

  const handleExport = async () => {
    if (!results) return;
    setExporting(true);
    try {
      await exportJiziPNG(results, selections, layout, cleanHanzi(text));
    } catch (e: any) {
      setHint(`导出失败：${e.message}`);
    } finally {
      setExporting(false);
    }
  };

  return (
    <Box className="space-y-3">
      <Typography className="font-kai" sx={{ fontSize: 20, fontWeight: 700 }}>集字</Typography>

      {/* 输入 */}
      <TextField
        multiline minRows={2} fullWidth
        placeholder="输入文字，从书库匹配单字…"
        value={text}
        onChange={(e) => setText(e.target.value)}
        sx={{ bgcolor: 'background.paper', borderRadius: 2 }}
      />
      <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
        <Button variant="contained" onClick={match} disabled={busy || !text.trim()} sx={{ borderRadius: 2 }}>
          {busy ? '匹配中…' : '匹配单字'}
        </Button>
        {hint && <Typography variant="caption" color="text.secondary">{hint}</Typography>}
      </Box>

      {/* 预览 */}
      {results && (
        <>
          <Paper
            variant="outlined"
            sx={{
              p: 2, borderRadius: 2, overflow: 'auto',
              bgcolor: layout.background === 'ink' ? '#1a1a1a' : layout.background === 'vermilion' ? '#8b0000' : layout.background === 'white' ? '#fff' : '#f5ecd9',
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
                        title={r.hits.length > 1 ? '点击换一个写法' : undefined}
                        sx={{
                          width: layout.fontSize, height: layout.fontSize,
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          cursor: r.hits.length > 1 ? 'pointer' : 'default',
                          flexShrink: 0,
                        }}
                      >
                        {hit ? (
                          <Box
                            component="img"
                            src={hit.image_url}
                            sx={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }}
                            referrerPolicy="no-referrer"
                          />
                        ) : (
                          <Box
                            sx={{
                              width: '100%', height: '100%', border: '1px dashed #bbb',
                              display: 'flex', alignItems: 'center', justifyContent: 'center',
                              color: layout.background === 'ink' || layout.background === 'vermilion' ? '#ccc' : '#999',
                              fontSize: layout.fontSize * 0.4, fontFamily: 'serif',
                            }}
                          >
                            {r.char}
                          </Box>
                        )}
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
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', textAlign: 'center' }}>
            多写法的字可点击切换 · 文本中的换行/空行会自动分行分列
          </Typography>
        </>
      )}
    </Box>
  );
};

export default JiziPage;
