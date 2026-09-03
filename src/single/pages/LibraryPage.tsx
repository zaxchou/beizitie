import React, { useCallback, useEffect, useState } from 'react';
import {
  Box,
  Typography,
  Button,
  Card,
  CardContent,
  Chip,
  IconButton,
} from '@mui/material';
import ConfirmDialog from '@/components/common/ConfirmDialog';
import DeleteIcon from '@mui/icons-material/Delete';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import PauseIcon from '@mui/icons-material/Pause';
import { localDataSource } from '@/data/local/localAdapter';
import type { LocalDeck } from '@/core/types';

type DeckWithCounts = LocalDeck & { newCount: number; reviewCount: number };

interface Props {
  onStudy: (deckId: string, name: string) => void;
  onChangeTab: (tab: 'market' | 'settings') => void;
}

export const LibraryPage: React.FC<Props> = ({ onStudy, onChangeTab }) => {
  const [decks, setDecks] = useState<DeckWithCounts[]>([]);
  const [loading, setLoading] = useState(true);
  const [today, setToday] = useState<{ studied: number; newLearned: number }>({ studied: 0, newLearned: 0 });
  const [confirmDelete, setConfirmDelete] = useState<DeckWithCounts | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setDecks(await localDataSource.library.list());
      setToday(await localDataSource.stats.today());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const togglePause = async (d: DeckWithCounts) => {
    await localDataSource.library.updateSettings(d.id, { paused: !d.settings.paused });
    load();
  };

  const doDelete = async () => {
    if (!confirmDelete) return;
    await localDataSource.library.remove(confirmDelete.id);
    setConfirmDelete(null);
    load();
  };

  return (
    <Box className="space-y-3">
      <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1.5 }}>
        <Typography className="font-kai" sx={{ fontSize: 20, fontWeight: 700 }}>我的书库</Typography>
        <Typography variant="caption" color="text.secondary">
          今日已学 {today.studied} · 新学 {today.newLearned}
        </Typography>
      </Box>

      {loading ? (
        <Typography color="text.secondary">加载中…</Typography>
      ) : decks.length === 0 ? (
        <Box sx={{ textAlign: 'center', py: 6 }}>
          <Typography className="font-kai" sx={{ fontSize: 40, mb: 1 }}>🖌</Typography>
          <Typography color="text.secondary" sx={{ mb: 2 }}>
            书库还是空的，去市场挑一本碑帖开始吧
          </Typography>
          <Button variant="contained" onClick={() => onChangeTab('market')} sx={{ borderRadius: 2 }}>
            逛逛市场
          </Button>
        </Box>
      ) : (
        decks.map((d) => {
          const paused = d.settings.paused;
          const total = d.newCount + d.reviewCount;
          return (
            <Card key={d.id} variant="outlined" sx={{ borderRadius: 2 }}>
              <CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 } }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <Typography noWrap sx={{ fontWeight: 600, fontSize: 15 }}>{d.name}</Typography>
                      {d.styles.map((s) => (
                        <Chip key={s} label={s} size="small" sx={{ height: 18, fontSize: 10 }} />
                      ))}
                    </Box>
                    <Typography variant="caption" color="text.secondary">
                      {[d.dynasty, d.author].filter(Boolean).join('·') || '佚名'}
                    </Typography>
                  </Box>
                  <IconButton size="small" onClick={() => togglePause(d)} title={paused ? '恢复' : '暂停'}>
                    {paused ? <PlayArrowIcon fontSize="small" /> : <PauseIcon fontSize="small" />}
                  </IconButton>
                  <IconButton size="small" color="error" onClick={() => setConfirmDelete(d)} title="删除">
                    <DeleteIcon fontSize="small" />
                  </IconButton>
                  <Button
                    variant="contained"
                    size="small"
                    disabled={paused || total === 0}
                    startIcon={<PlayArrowIcon />}
                    onClick={() => onStudy(d.id, d.name)}
                    sx={{ borderRadius: 2 }}
                  >
                    {paused ? '已暂停' : total > 0 ? `学习 ${total}` : '今日完毕'}
                  </Button>
                </Box>
                {!paused && total > 0 && (
                  <Box sx={{ display: 'flex', gap: 1, mt: 0.5 }}>
                    {d.newCount > 0 && <Chip label={`新学 ${d.newCount}`} size="small" color="primary" variant="outlined" sx={{ height: 20, fontSize: 11 }} />}
                    {d.reviewCount > 0 && <Chip label={`复习 ${d.reviewCount}`} size="small" color="secondary" variant="outlined" sx={{ height: 20, fontSize: 11 }} />}
                  </Box>
                )}
              </CardContent>
            </Card>
          );
        })
      )}

      <ConfirmDialog
        open={!!confirmDelete}
        title="删除牌组"
        message={`确定删除《${confirmDelete?.name ?? ''}》？该牌组的全部学习进度将被删除（建议先在设置里导出备份）。`}
        onConfirm={doDelete}
        onCancel={() => setConfirmDelete(null)}
      />
      {decks.length > 0 && (
        <Box sx={{ textAlign: 'center', pt: 1 }}>
          <Button size="small" color="inherit" onClick={() => onChangeTab('market')}>
            + 去市场添加更多碑帖
          </Button>
        </Box>
      )}
    </Box>
  );
};

export default LibraryPage;
