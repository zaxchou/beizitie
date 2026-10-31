import React, { useCallback, useEffect, useState } from 'react';
import { Box, Typography, Button, Dialog, DialogTitle, DialogContent, DialogActions } from '@mui/material';
import ConfirmDialog from '@/components/common/ConfirmDialog';
import { localDataSource } from '@/data/local/localAdapter';
import type { LocalDeck, StudyMode } from '@/core/types';

type DeckRow = LocalDeck & {
  newCount: number;
  reviewCount: number;
  totalCards: number;
  learnedCount: number;
  newRemaining: number;
  dueRemaining: number;
};

interface Props {
  refreshKey: number;
  onStudy: (deckId: string, name: string) => void;
  onChangeTab: (tab: 'market' | 'settings') => void;
  onNotify: (msg: string) => void;
}

const mono = { fontFamily: 'var(--font-mono)', letterSpacing: '0.04em' } as const;

const rowActionSx = {
  border: 0,
  background: 'none',
  color: 'inherit',
  p: 0,
  cursor: 'pointer',
  ...mono,
  fontSize: 11,
  opacity: 0.72,
  '&:hover': { opacity: 1, textDecoration: 'underline' },
} as const;

/** 今日：本地书库的待复习/可学新字/学习天数，下面一张帖表 */
export const DashboardPage: React.FC<Props> = ({ refreshKey, onStudy, onChangeTab, onNotify }) => {
  const [decks, setDecks] = useState<DeckRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [today, setToday] = useState({ studied: 0, newLearned: 0 });
  const [studyDays, setStudyDays] = useState<Set<string>>(new Set());
  const [confirmDelete, setConfirmDelete] = useState<DeckRow | null>(null);
  const [settingsFor, setSettingsFor] = useState<DeckRow | null>(null);

  const load = useCallback(async () => {
    setDecks(await localDataSource.library.list());
    setToday(await localDataSource.stats.today());
    const all = await localDataSource.stats.range(9999);
    setStudyDays(new Set(all.filter((s) => s.studied > 0).map((s) => s.date)));
  }, []);

  useEffect(() => {
    setLoading(true);
    load().finally(() => setLoading(false));
  }, [load, refreshKey]);

  const doDelete = async () => {
    if (!confirmDelete) return;
    await localDataSource.library.remove(confirmDelete.id);
    setConfirmDelete(null);
    onNotify(`《${confirmDelete.name}》已删除`);
    load();
  };

  // 一次性合并保存：updateSettings 是读-改-写，拆成多次并发调用会互相覆盖（丢设置）
  const saveSettings = async (deck: DeckRow, patch: { dailyNewLimit: number; dailyReviewLimit: number; mode: StudyMode }) => {
    await localDataSource.library.updateSettings(deck.id, patch);
    setSettingsFor(null);
    load();
  };

  const newTotal = decks.reduce((s, d) => s + d.newCount, 0);
  const reviewTotal = decks.reduce((s, d) => s + d.reviewCount, 0);
  const now = new Date();
  const dateLabel = `${now.getMonth() + 1} 月 ${now.getDate()} 日 · ${['周日', '周一', '周二', '周三', '周四', '周五', '周六'][now.getDay()]}`;

  const statCell = (label: string, en: string, value: number | string, unit: string, hot = false) => (
    <Box sx={{ py: 1.75, px: { xs: 1.25, md: 2 }, borderRight: '1px solid', borderColor: 'divider', '&:last-of-type': { borderRight: 0 } }}>
      <Typography sx={{ ...mono, fontSize: 9.5, letterSpacing: '0.12em', opacity: 0.62 }}>
        {label} · {en}
      </Typography>
      <Typography
        sx={{
          fontSize: { xs: 30, md: 48 },
          fontWeight: 900,
          lineHeight: 0.95,
          letterSpacing: '-0.04em',
          mt: 1,
          fontVariantNumeric: 'tabular-nums',
          color: hot ? 'var(--hot-ink)' : 'inherit',
        }}
      >
        {loading ? '—' : value}
        <Box component="span" sx={{ fontSize: 11, fontWeight: 400, letterSpacing: 0, ml: 0.75, opacity: 0.75 }}>{unit}</Box>
      </Typography>
    </Box>
  );

  return (
    <Box>
      {/* 页头 */}
      <Box sx={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 2, pb: { xs: 1.5, md: 1.75 } }}>
        <Box sx={{ minWidth: 0 }}>
          <Typography component="h1" sx={{ fontSize: { xs: 30, md: 44 }, fontWeight: 900, letterSpacing: { xs: '4px', md: '7px' }, lineHeight: 1.1 }}>
            今日
          </Typography>
          <Typography sx={{ ...mono, fontSize: 11, opacity: 0.72, mt: 1 }}>
            {dateLabel} · 学习 {studyDays.size} 天 · 今日新学 {today.newLearned}
          </Typography>
        </Box>
        {!__MINI__ && (
          <Button
            variant="outlined"
            onClick={() => onChangeTab('market')}
            sx={{ display: { xs: 'none', md: 'inline-flex' }, height: 36, px: 1.75, flexShrink: 0, ...mono, fontSize: 11 }}
          >
            市场 ↗
          </Button>
        )}
      </Box>

      {/* 三个数字条 */}
      <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', borderTop: '2px solid', borderBottom: '1px solid', borderColor: 'text.primary' }}>
        {statCell('待复习', 'DUE', reviewTotal, '字', reviewTotal > 0)}
        {statCell('可学新字', 'NEW', newTotal, '字')}
        {statCell('学习天数', 'DAYS', studyDays.size, '天')}
      </Box>

      {/* 帖表 */}
      <Box sx={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', pt: 2.5, pb: 0.75 }}>
        <Typography sx={{ fontSize: 13, fontWeight: 900, letterSpacing: '2px' }}>
          帖
          <Box component="span" sx={{ ...mono, fontSize: 10.5, fontWeight: 400, letterSpacing: '0.04em', opacity: 0.65, ml: 1 }}>Decks · {decks.length}</Box>
        </Typography>
        {!__MINI__ && decks.length > 0 && (
          <Box component="button" type="button" onClick={() => onChangeTab('market')} sx={rowActionSx}>
            + 添加碑帖
          </Box>
        )}
      </Box>

      {loading ? (
        <Typography sx={{ ...mono, fontSize: 11, opacity: 0.7, py: 6 }}>正在读本地书库…</Typography>
      ) : decks.length === 0 ? (
        <Box sx={{ borderTop: '2px solid', borderColor: 'text.primary', py: { xs: 8, md: 10 }, textAlign: 'center' }}>
          <Typography className="font-kai" sx={{ fontSize: 64, fontWeight: 900, lineHeight: 1, opacity: 0.14, letterSpacing: '0.1em' }}>
            帖
          </Typography>
          <Typography sx={{ mt: 1.5, fontSize: 15, fontWeight: 700, letterSpacing: '0.08em' }}>
            书库还是空的
          </Typography>
          <Typography sx={{ ...mono, fontSize: 10.5, opacity: 0.65, mt: 0.75 }}>
            {__MINI__ ? 'EMPTY · 内置字帖准备中' : 'EMPTY · 从市场订阅一部碑帖开始'}
          </Typography>
          {!__MINI__ && (
            <Button variant="contained" onClick={() => onChangeTab('market')} sx={{ mt: 2.5, height: 44, px: 3, justifyContent: 'space-between', gap: 3 }}>
              <span>去市场订阅碑帖</span>
              <span aria-hidden>→</span>
            </Button>
          )}
        </Box>
      ) : (
        <Box>
          {/* 表头（桌面） */}
          <Box
            sx={{
              display: { xs: 'none', md: 'grid' },
              gridTemplateColumns: '48px minmax(0,1.6fr) 120px 150px 196px',
              alignItems: 'center',
              columnGap: 2,
              borderTop: '1px solid',
              borderColor: 'text.primary',
              px: 1,
              py: 0.9,
              ...mono,
              fontSize: 9.5,
              letterSpacing: '0.12em',
              opacity: 0.6,
            }}
          >
            <Box>NO</Box>
            <Box>帖 · Deck</Box>
            <Box>今日</Box>
            <Box>进度</Box>
            <Box sx={{ textAlign: 'right' }}>操作</Box>
          </Box>

          {decks.map((d, i) => {
            const reviewProgress = d.totalCards > 0 ? Math.round((d.learnedCount / d.totalCards) * 100) : 0;
            const paused = !!d.settings.paused;
            const canStart = !paused && d.totalCards > 0;
            const modeLabel = d.settings.mode === 'sequential' ? '原帖顺序' : d.settings.mode === 'random' ? '随机' : '默认顺序';
            return (
              <Box
                key={d.id}
                sx={{
                  display: 'grid',
                  gridTemplateColumns: { xs: 'minmax(0,1fr) auto', md: '48px minmax(0,1.6fr) 120px 150px 196px' },
                  alignItems: 'center',
                  columnGap: 2,
                  px: { xs: 0.5, md: 1 },
                  py: { xs: 1.5, md: 1.25 },
                  borderBottom: '1px solid',
                  borderColor: 'divider',
                  transition: 'background-color 120ms linear, color 120ms linear',
                  '&:hover': { backgroundColor: 'text.primary', color: 'background.default' },
                }}
              >
                <Typography sx={{ display: { xs: 'none', md: 'block' }, ...mono, fontSize: 10.5, opacity: 0.5, fontVariantNumeric: 'tabular-nums' }}>
                  {String(i + 1).padStart(2, '0')}
                </Typography>

                <Box sx={{ minWidth: 0 }}>
                  <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1, minWidth: 0 }}>
                    <Typography sx={{ fontSize: { xs: 16, md: 17 }, fontWeight: 700, letterSpacing: '0.04em', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {d.name}
                    </Typography>
                    {paused && (
                      <Typography sx={{ ...mono, fontSize: 9, opacity: 0.6, border: '1px solid', borderColor: 'currentColor', px: 0.5, flexShrink: 0 }}>暂停</Typography>
                    )}
                  </Box>
                  <Typography sx={{ ...mono, fontSize: 10, opacity: 0.55, mt: 0.4 }}>
                    {d.totalCards} 字 · {modeLabel}
                    <Box component="span" sx={{ display: { xs: 'inline', md: 'none' } }}>
                      {' · '}新 {d.newRemaining} · 复习 {d.dueRemaining}
                    </Box>
                  </Typography>
                  <Box sx={{ display: { xs: 'block', md: 'none' }, mt: 1, mr: 1 }}>
                    <Box sx={{ height: 3, bgcolor: 'divider' }}>
                      <Box sx={{ width: `${reviewProgress}%`, height: '100%', bgcolor: 'currentColor', opacity: 0.85 }} />
                    </Box>
                  </Box>
                </Box>

                <Typography sx={{ display: { xs: 'none', md: 'block' }, ...mono, fontSize: 11, opacity: 0.8, fontVariantNumeric: 'tabular-nums' }}>
                  新 {d.newRemaining} · 复习 {d.dueRemaining}
                </Typography>

                <Box sx={{ display: { xs: 'none', md: 'block' } }}>
                  <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1 }}>
                    <Typography sx={{ ...mono, fontSize: 11, fontVariantNumeric: 'tabular-nums' }}>{reviewProgress}%</Typography>
                    <Box sx={{ flex: 1, height: 4, bgcolor: 'divider' }}>
                      <Box sx={{ width: `${reviewProgress}%`, height: '100%', bgcolor: 'currentColor', opacity: 0.85 }} />
                    </Box>
                  </Box>
                </Box>

                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: { xs: 1, md: 1.25 }, pr: { xs: 0.5, md: 0 } }}>
                  <Box
                    component="button"
                    type="button"
                    disabled={!canStart}
                    onClick={() => canStart && onStudy(d.id, d.name)}
                    sx={{
                      border: '1px solid',
                      borderColor: 'currentColor',
                      background: 'none',
                      color: 'inherit',
                      ...mono,
                      fontSize: 11,
                      height: 30,
                      px: 1.25,
                      cursor: canStart ? 'pointer' : 'not-allowed',
                      opacity: canStart ? 1 : 0.35,
                      whiteSpace: 'nowrap',
                      '&:hover': canStart ? { bgcolor: 'currentColor', color: 'background.default' } : {},
                    }}
                  >
                    开始 →
                  </Box>
                  <Box component="button" type="button" onClick={() => setSettingsFor(d)} sx={rowActionSx}>设置</Box>
                  <Box component="button" type="button" onClick={() => setConfirmDelete(d)} aria-label={`删除 ${d.name}`} sx={rowActionSx}>删</Box>
                </Box>
              </Box>
            );
          })}
        </Box>
      )}

      <ConfirmDialog
        open={!!confirmDelete}
        title="删除帖"
        message={`确定删除《${confirmDelete?.name ?? ''}》？该帖的全部学习进度会被删除（建议先在设置里导出备份）。`}
        onConfirm={doDelete}
        onCancel={() => setConfirmDelete(null)}
      />

      {settingsFor && (
        <LimitEditor
          deck={settingsFor}
          onClose={() => setSettingsFor(null)}
          onSaved={(patch) => { void saveSettings(settingsFor, patch); }}
        />
      )}
    </Box>
  );
};

/** 每日上限 + 出卡顺序（方角、等宽标签） */
function LimitEditor({ deck, onClose, onSaved }: {
  deck: DeckRow;
  onClose: () => void;
  onSaved: (patch: { dailyNewLimit: number; dailyReviewLimit: number; mode: StudyMode }) => void;
}) {
  const [newLimit, setNewLimit] = useState(deck.settings.dailyNewLimit);
  const [reviewLimit, setReviewLimit] = useState(deck.settings.dailyReviewLimit);
  const [mode, setMode] = useState<StudyMode>(deck.settings.mode || 'default');

  const numInput = (value: number, onChange: (n: number) => void, min: number, max?: number) => (
    <Box
      component="input"
      type="number"
      value={value}
      min={min}
      max={max}
      onChange={(e) => {
        const n = Math.max(min, parseInt(e.target.value, 10) || 0);
        onChange(max ? Math.min(max, n) : n);
      }}
      sx={{
        width: 84,
        border: 0,
        borderBottom: '1px solid',
        borderColor: 'text.primary',
        background: 'transparent',
        color: 'text.primary',
        ...mono,
        fontSize: 15,
        textAlign: 'right',
        py: '3px',
        outline: 'none',
      }}
    />
  );

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle sx={{ p: '14px 20px 12px', borderBottom: '1px solid', borderColor: 'divider' }}>
        <Typography sx={{ ...mono, fontSize: 10.5, letterSpacing: '0.14em', opacity: 0.7 }}>
          学习设置 · {deck.name}
        </Typography>
      </DialogTitle>
      <DialogContent sx={{ p: '8px 20px 4px' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', py: 1.75, borderBottom: '1px solid', borderColor: 'divider' }}>
          <Typography sx={{ fontSize: 14 }}>每日新字<Box component="span" sx={{ ...mono, fontSize: 9.5, opacity: 0.55, ml: 0.75 }}>NEW / DAY</Box></Typography>
          {numInput(newLimit, setNewLimit, 0, 200)}
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', py: 1.75, borderBottom: '1px solid', borderColor: 'divider' }}>
          <Typography sx={{ fontSize: 14 }}>每日复习<Box component="span" sx={{ ...mono, fontSize: 9.5, opacity: 0.55, ml: 0.75 }}>REVIEW / DAY</Box></Typography>
          {numInput(reviewLimit, setReviewLimit, 0)}
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', py: 1.75 }}>
          <Typography sx={{ fontSize: 14 }}>出卡顺序<Box component="span" sx={{ ...mono, fontSize: 9.5, opacity: 0.55, ml: 0.75 }}>ORDER</Box></Typography>
          <Box
            component="select"
            value={mode}
            onChange={(e) => setMode(e.target.value as StudyMode)}
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
              outline: 'none',
              cursor: 'pointer',
            }}
          >
            <option value="default">默认（到期优先）</option>
            <option value="sequential">按帖序</option>
            <option value="random">随机</option>
          </Box>
        </Box>
      </DialogContent>
      <DialogActions sx={{ p: '12px 20px 16px', gap: 1 }}>
        <Button onClick={onClose} sx={{ ...mono, fontSize: 11, color: 'text.primary' }}>取消</Button>
        <Button
          variant="contained"
          onClick={() => {
            onSaved({ dailyNewLimit: newLimit, dailyReviewLimit: reviewLimit, mode });
            onClose();
          }}
          sx={{ ...mono, fontSize: 11, height: 36, px: 2 }}
        >
          保存
        </Button>
      </DialogActions>
    </Dialog>
  );
}

export default DashboardPage;
