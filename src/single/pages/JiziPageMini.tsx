/**
 * 集字（mini 专属·字体排版版）：取字范围 = 包内字帖《兰亭序》。
 * 纯本地匹配（包内清单即索引），作品经 Canvas 以系统宋体排版生成，走 JSBridge 存相册；
 * 无 JSBridge 环境（PC 模拟器）显示预览图并提示。
 * 不打包任何字图/字体文件——轻量化提审形态（HANDOFF 补记 24）。
 */
import React, { useMemo, useState } from 'react';
import { Box, Typography, Button, Card, CardContent, Chip, TextField } from '@mui/material';
import { bundledZitie, catalogJson } from '@catalog/source';
import type { CatalogZuopin } from '../../core/types';

interface Hit {
  h: string;
  deckName: string;
}

/** char → 命中（包内清单即索引；同字多帖取先出现） */
const index = (() => {
  const m = new Map<string, Hit>();
  const decks = JSON.parse(catalogJson) as { zuopins: CatalogZuopin[] };
  const nameByZ = new Map(decks.zuopins.map((z) => [z.z, z.n]));
  for (const z of Object.keys(bundledZitie || {})) {
    const manifest = (bundledZitie as Record<string, any>)[z];
    for (const g of manifest.g) {
      const h = (g.h || '').trim();
      if (!h || h === '□') continue;
      if (!m.has(h)) m.set(h, { h, deckName: nameByZ.get(z) || z });
    }
  }
  return m;
})();

// 模板短语用碑帖原文字形（神龙本为繁体）：经清单逐字核验全覆盖
const TEMPLATES = ['永和九年', '天朗氣清', '惠風和暢', '茂林脩竹'];
const SONG = `'SimSun','宋体','Songti SC',serif`;

/** 字体排版成作品：宣纸底 + 朱线字块 + 题头落款，全程 Canvas 文字绘制 */
function composeCanvas(hits: Hit[], missing: string[], text: string): string {
  const COLS = 5;
  const CELL = 170;
  const PAD = 24;
  const HEAD = 96;
  const rows = Math.ceil(hits.length / COLS) || 1;
  const W = COLS * CELL + PAD * 2;
  const H = HEAD + rows * CELL + 70;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  // 宣纸底
  ctx.fillStyle = '#f4eee0';
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#8a7d68';
  ctx.font = `22px ${SONG}`;
  ctx.textAlign = 'center';
  ctx.fillText(`集字 · ${text.slice(0, 18)}`, W / 2, 52);
  // 字块（宋体大字 + 朱线框）
  for (let i = 0; i < hits.length; i++) {
    const col = i % COLS;
    const row = Math.floor(i / COLS);
    const x = PAD + col * CELL + 10;
    const y = HEAD + row * CELL + 10;
    ctx.fillStyle = '#fbf7ec';
    ctx.fillRect(x, y, CELL - 20, CELL - 20);
    ctx.strokeStyle = 'rgba(180,120,60,.55)';
    ctx.lineWidth = 2;
    ctx.strokeRect(x, y, CELL - 20, CELL - 20);
    ctx.fillStyle = '#1c1c1c';
    ctx.font = `112px ${SONG}`;
    ctx.textBaseline = 'middle';
    ctx.fillText(hits[i].h, x + (CELL - 20) / 2, y + (CELL - 20) / 2 + 6);
    ctx.textBaseline = 'alphabetic';
  }
  ctx.fillStyle = '#a99f8a';
  ctx.font = `16px ${SONG}`;
  ctx.textAlign = 'center';
  ctx.fillText('背字帖 · 集字', W / 2, H - 40);
  if (missing.length) {
    ctx.fillText(`缺字 ${missing.length} 个`, W / 2, H - 50);
  }
  return canvas.toDataURL('image/png');
}

const bundledNames = (() => {
  try {
    const decks = (JSON.parse(catalogJson) as { zuopins: CatalogZuopin[] }).zuopins;
    return decks.map((z) => `《${z.n}》`).join('、');
  } catch {
    return '包内字帖';
  }
})();

export const JiziPageMini: React.FC = () => {
  const [text, setText] = useState('');
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [missing, setMissing] = useState<string[]>([]);
  const [work, setWork] = useState<string | null>(null);
  const [saveTip, setSaveTip] = useState<string | null>(null);

  const coverage = useMemo(() => {
    const t = TEMPLATES.map((tpl) => ({
      tpl,
      full: [...tpl].every((c) => index.has(c)),
    }));
    return t.filter((x) => x.full).map((x) => x.tpl);
  }, []);

  const MAX_CHARS = 40; // 超长输入会把生成画布撑过移动端上限
  const run = (input: string) => {
    const chars = [...new Set([...input.replace(/\s/g, '')])]
      .filter((c) => /[\u4e00-\u9fff\u3400-\u4dbf]/.test(c))
      .slice(0, MAX_CHARS);
    const hit: Hit[] = [];
    const miss: string[] = [];
    for (const c of chars) {
      const hitItem = index.get(c);
      if (hitItem) hit.push(hitItem);
      else miss.push(c);
    }
    setText(input);
    setHits(hit);
    setMissing(miss);
    setWork(null);
  };

  const save = async () => {
    if (!work) return;
    const bridge = (window as any).xhs?.miniTool;
    if (!bridge?.saveImageToPhotosAlbum) {
      setSaveTip('当前环境不支持保存，请在小红书 App 内使用「存相册」');
      return;
    }
    try {
      await bridge.saveImageToPhotosAlbum({ filePath: work });
      setSaveTip('已保存到系统相册');
    } catch (e: any) {
      setSaveTip(`保存失败：${e?.errMsg || e?.message || '未知错误'}`);
    }
  };

  return (
    <Box className="space-y-3">
      <Typography className="font-kai" sx={{ fontSize: 20, fontWeight: 700 }}>集字</Typography>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
        取字范围：包内{bundledNames}
      </Typography>

      <Card variant="outlined" sx={{ borderRadius: 2 }}>
        <CardContent>
          <TextField
            fullWidth multiline rows={2} size="small"
            placeholder="输入要集的字或短句（最多 40 字）…"
            inputProps={{ maxLength: MAX_CHARS }}
            value={text}
            onChange={(e) => setText(e.target.value)}
            sx={{ mb: 1.5 }}
          />
          <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mb: 1.5 }}>
            {coverage.map((tpl) => (
              <Chip key={tpl} label={tpl} size="small" variant="outlined" onClick={() => run(tpl)} sx={{ cursor: 'pointer' }} />
            ))}
          </Box>
          <Button fullWidth variant="contained" sx={{ borderRadius: 2 }} onClick={() => run(text)} disabled={!text.trim()}>
            集字
          </Button>
        </CardContent>
      </Card>

      {hits && (
        <Card variant="outlined" sx={{ borderRadius: 2 }}>
          <CardContent>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
              {hits.map((h, i) => (
                <Box key={`${h.h}-${i}`} sx={{
                  width: 64, height: 64, borderRadius: 1,
                  bgcolor: '#fbf7ec', boxShadow: '0 0 0 1px rgba(180,120,60,.45)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  <Box component="span" className="font-kai" sx={{ fontSize: 38, color: '#1c1c1c', lineHeight: 1 }}>
                    {h.h}
                  </Box>
                </Box>
              ))}
            </Box>
            {missing.length > 0 && (
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1.5 }}>
                缺字 {missing.length} 个（包内帖没有）：{missing.join(' ')}
              </Typography>
            )}
            {hits.length === 0 ? (
              <Typography variant="body2" color="text.secondary" sx={{ mt: 1.5, textAlign: 'center' }}>
                输入的字都不在包内帖中，换个短句试试
              </Typography>
            ) : (
              <Button fullWidth variant="contained" sx={{ borderRadius: 2, mt: 1.5 }} onClick={() => {
                setWork(composeCanvas(hits, missing, text.replace(/\s/g, '')));
                setSaveTip(null);
              }}>
                生成作品
              </Button>
            )}
          </CardContent>
        </Card>
      )}

      {work && (
        <Card variant="outlined" sx={{ borderRadius: 2 }}>
          <CardContent>
            <Box component="img" src={work} alt="集字作品" sx={{ width: '100%', display: 'block', borderRadius: 1 }} />
            <Button fullWidth variant="contained" sx={{ borderRadius: 2, mt: 1.5 }} onClick={save}>
              保存到相册
            </Button>
            {saveTip && (
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1, textAlign: 'center' }}>
                {saveTip}
              </Typography>
            )}
          </CardContent>
        </Card>
      )}
    </Box>
  );
};

export default JiziPageMini;
