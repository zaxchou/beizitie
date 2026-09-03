import React, { useCallback, useEffect, useState } from 'react';
import {
  Box,
  Typography,
  Button,
  Card,
  CardContent,
  Chip,
  IconButton,
  LinearProgress,
  TextField,
} from '@mui/material';
import DeleteIcon from '@mui/icons-material/Delete';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import PauseCircleIcon from '@mui/icons-material/PauseCircle';
import SettingsIcon from '@mui/icons-material/Settings';
import ConfirmDialog from '@/components/common/ConfirmDialog';
import { localDataSource } from '@/data/local/localAdapter';
import type { LocalDeck } from '@/core/types';

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

function StatCard({ label, value, unit }: { label: string; value: number | string; unit: string }) {
  return (
    <Box
      sx={{
        p: 1.2, borderRadius: 2, textAlign: 'center',
        bgcolor: 'background.paper',
        boxShadow: '0px 0px 0px 1px rgba(0,0,0,0.08), 0px 1px 2px rgba(0,0,0,0.06)',
      }}
    >
      <Typography sx={{ fontSize: 22, fontWeight: 700, lineHeight: 1.2 }}>
        {value}
        <Typography component="span" variant="caption" color="text.secondary" sx={{ ml: 0.3 }}>
          {unit}
        </Typography>
      </Typography>
      <Typography variant="caption" color="text.secondary" sx={{ fontSize: 11 }}>
        {label}
      </Typography>
    </Box>
  );
}

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

  const saveLimit = async (deck: DeckRow, key: 'dailyNewLimit' | 'dailyReviewLimit', value: number) => {
    await localDataSource.library.updateSettings(deck.id, { [key]: value });
    setSettingsFor(null);
    load();
  };

  const newTotal = decks.reduce((s, d) => s + d.newCount, 0);
  const reviewTotal = decks.reduce((s, d) => s + d.reviewCount, 0);

  return (
    <Box className="space-y-3">
      <Box sx={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
        <Typography className="font-kai" sx={{ fontSize: 20, fontWeight: 700 }}>概览</Typography>
        <Typography variant="caption" color="text.secondary">
          今日已学 {today.studied} · 新学 {today.newLearned}
        </Typography>
      </Box>

      {/* 3 个核心数据卡（与在线版一致：待学习 / 待复习 / 学习天数） */}
      <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 1 }}>
        <StatCard label="待学习" value={loading ? '-' : newTotal} unit="张" />
        <StatCard label="待复习" value={loading ? '-' : reviewTotal} unit="张" />
        <StatCard label="学习天数" value={loading ? '-' : studyDays.size} unit="天" />
      </Box>

      {/* 牌组列表 */}
      {loading ? (
        <Typography color="text.secondary">加载中…</Typography>
      ) : decks.length === 0 ? (
        <Box sx={{ textAlign: 'center', py: 6 }}>
          <Typography className="font-kai" sx={{ fontSize: 40, mb: 1 }}>🖌</Typography>
          <Typography color="text.secondary" sx={{ mb: 2 }}>
            创建你的第一个书法记忆牌组，开始学习之旅吧！
          </Typography>
          <Button variant="contained" onClick={() => onChangeTab('market')} sx={{ borderRadius: 2 }}>
            去市场订阅碑帖
          </Button>
        </Box>
      ) : (
        decks.map((d) => {
          const reviewProgress =
            d.totalCards > 0 ? Math.round((d.learnedCount / d.totalCards) * 100) : 0;
          const paused = !!d.settings.paused;
          return (
            <Card key={d.id} variant="outlined" sx={{ borderRadius: 2 }}>
              <CardContent sx={{ pb: 0.5, '&:last-child': { pb: 0.5 } }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <Typography noWrap sx={{ fontWeight: 600, fontSize: 15, flex: 1 }}>
                    {d.name}
                  </Typography>
                  <Typography variant="body2" color="text.secondary" fontWeight={500}>
                    {d.totalCards} 张
                  </Typography>
                  <Chip
                    label={d.totalCards > 0 ? (d.learnedCount > 0 ? `${reviewProgress}%` : '新牌组') : '空'}
                    size="small"
                    sx={{
                      fontSize: 11, height: 22,
                      bgcolor: reviewProgress > 0 ? 'primary.main' : 'action.hover',
                      color: reviewProgress > 0 ? '#fff' : 'text.secondary',
                    }}
                  />
                </Box>
                <LinearProgress
                  variant="determinate"
                  value={reviewProgress}
                  sx={{ height: 6, borderRadius: 2, bgcolor: 'action.hover', '& .MuiLinearProgress-bar': { borderRadius: 2 } }}
                />
              </CardContent>
              <Box sx={{ px: 2, pt: 0, pb: 0 }}>
                {paused ? (
                  <Chip
                    label="已暂停" size="small" color="warning" variant="outlined"
                    icon={<PauseCircleIcon />} sx={{ fontSize: 11, height: 22 }}
                  />
                ) : (
                  <Typography variant="caption" color="text.secondary">
                    新卡 {d.newRemaining} · 复习 {d.dueRemaining}
                  </Typography>
                )}
              </Box>
              <Box sx={{ display: 'flex', alignItems: 'center', px: 2, pt: 1, pb: 1.5, gap: 1 }}>
                <Box
                  onClick={() => !paused && d.totalCards > 0 && onStudy(d.id, d.name)}
                  sx={{
                    display: 'inline-flex', alignItems: 'center', gap: 0.5,
                    px: 1.5, py: 0.4, borderRadius: 99, fontSize: 13, fontWeight: 600,
                    color: paused || d.totalCards === 0 ? 'text.disabled' : 'primary.main',
                    bgcolor: paused || d.totalCards === 0 ? 'action.disabledBackground' : 'rgba(62,181,168,0.08)',
                    cursor: paused || d.totalCards === 0 ? 'not-allowed' : 'pointer',
                    transition: 'all 0.15s', userSelect: 'none',
                    '&:hover': paused || d.totalCards === 0 ? {} : { bgcolor: 'primary.main', color: '#fff' },
                  }}
                >
                  <PlayArrowIcon sx={{ fontSize: 15 }} />
                  开始学习
                </Box>
                <Box sx={{ flex: 1 }} />
                <IconButton
                  size="small" title="删除牌组" color="error"
                  onClick={() => setConfirmDelete(d)}
                >
                  <DeleteIcon sx={{ fontSize: 16 }} />
                </IconButton>
                <IconButton size="small" title="学习设置" onClick={() => setSettingsFor(d)}>
                  <SettingsIcon sx={{ fontSize: 16 }} />
                </IconButton>
              </Box>
            </Card>
          );
        })
      )}

      {decks.length > 0 && (
        <Box sx={{ textAlign: 'center', pt: 1 }}>
          <Button size="small" color="inherit" onClick={() => onChangeTab('market')}>
            + 去市场添加更多碑帖
          </Button>
        </Box>
      )}

      {/* 删除确认 */}
      <ConfirmDialog
        open={!!confirmDelete}
        title="删除牌组"
        message={`确定删除《${confirmDelete?.name ?? ''}》？该牌组的全部学习进度将被删除（建议先在设置里导出备份）。`}
        onConfirm={doDelete}
        onCancel={() => setConfirmDelete(null)}
      />

      {/* 每日上限设置（简化弹层） */}
      {settingsFor && (
        <LimitEditor
          deck={settingsFor}
          onClose={() => setSettingsFor(null)}
          onSaved={(key, value) => { void saveLimit(settingsFor, key, value); }}
        />
      )}
    </Box>
  );
};

/** 每日上限编辑（点击设置图标出现） */
import { Dialog, DialogTitle, DialogContent, DialogActions } from '@mui/material';

function LimitEditor({ deck, onClose, onSaved }: {
  deck: DeckRow;
  onClose: () => void;
  onSaved: (key: 'dailyNewLimit' | 'dailyReviewLimit', value: number) => void;
}) {
  const [newLimit, setNewLimit] = useState(deck.settings.dailyNewLimit);
  const [reviewLimit, setReviewLimit] = useState(deck.settings.dailyReviewLimit);
  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle sx={{ fontSize: 16 }}>学习设置 · {deck.name}</DialogTitle>
      <DialogContent>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mt: 1, mb: 2 }}>
          <Typography variant="body2">每日新卡上限</Typography>
          <TextField
            type="number" size="small" value={newLimit} sx={{ width: 90 }}
            onChange={(e) => setNewLimit(Math.max(0, parseInt(e.target.value, 10) || 0))}
            inputProps={{ min: 0, max: 200 }}
          />
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Typography variant="body2">每日复习上限</Typography>
          <TextField
            type="number" size="small" value={reviewLimit} sx={{ width: 90 }}
            onChange={(e) => setReviewLimit(Math.max(0, parseInt(e.target.value, 10) || 0))}
            inputProps={{ min: 0 }}
          />
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>取消</Button>
        <Button
          variant="contained"
          onClick={() => {
            onSaved('dailyNewLimit', newLimit);
            onSaved('dailyReviewLimit', reviewLimit);
            onClose();
          }}
        >
          保存
        </Button>
      </DialogActions>
    </Dialog>
  );
}

export default DashboardPage;
