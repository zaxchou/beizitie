import { useState } from 'react';
import {
  Box, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle, Switch, TextField, Typography,
} from '@mui/material';
import type { StudyMode } from '@/core/types';

export interface TieyeDeckSettingsProps {
  deck: {
    id: string;
    name: string;
    newRemaining: number;
    dueRemaining: number;
    settings: { dailyNewLimit: number; dailyReviewLimit: number; paused: boolean; mode?: StudyMode };
  };
  onClose: () => void;
  onSave: (patch: { dailyNewLimit: number; dailyReviewLimit: number; paused: boolean; mode: StudyMode }) => void;
  onDelete: () => void;
}

const MODES: { key: StudyMode; label: string }[] = [
  { key: 'default', label: '到期优先' },
  { key: 'sequential', label: '按帖序' },
  { key: 'random', label: '随机' },
];

const clamp = (raw: string, max: number) => Math.min(max, Math.max(0, parseInt(raw, 10) || 0));

/** 每帖学习设置：每日新卡/复习上限、出卡顺序、暂停；危险操作（移出书库）放在最下层 */
export default function TieyeDeckSettings({ deck, onClose, onSave, onDelete }: TieyeDeckSettingsProps) {
  const [newLimit, setNewLimit] = useState(deck.settings.dailyNewLimit);
  const [reviewLimit, setReviewLimit] = useState(deck.settings.dailyReviewLimit);
  const [mode, setMode] = useState<StudyMode>(deck.settings.mode || 'default');
  const [paused, setPaused] = useState(!!deck.settings.paused);

  const row = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', mt: 2 };
  const note = { fontSize: 12, color: 'text.secondary', lineHeight: 1.7, mt: 0.5, mb: 0 } as const;

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle sx={{ fontSize: 16, fontFamily: 'SimSun, "Songti SC", serif', letterSpacing: 1, pb: 0.5 }}>
        学习设置 · {deck.name}
      </DialogTitle>
      <DialogContent>
        <Box sx={row}>
          <Typography variant="body2">每日新卡上限</Typography>
          <TextField
            type="number" value={newLimit} sx={{ width: 96 }}
            onChange={(e) => setNewLimit(clamp(e.target.value, 500))}
            inputProps={{ min: 0, max: 500, inputMode: 'numeric', 'aria-label': '每日新卡上限' }}
          />
        </Box>
        <Typography sx={note}>这本帖还有 {deck.newRemaining} 个新字，每轮按上限出卡。</Typography>

        <Box sx={row}>
          <Typography variant="body2">每日复习上限</Typography>
          <TextField
            type="number" value={reviewLimit} sx={{ width: 96 }}
            onChange={(e) => setReviewLimit(clamp(e.target.value, 2000))}
            inputProps={{ min: 0, max: 2000, inputMode: 'numeric', 'aria-label': '每日复习上限' }}
          />
        </Box>
        <Typography sx={note}>当前到期 {deck.dueRemaining} 张。</Typography>

        <Box sx={{ ...row, alignItems: 'flex-start' }}>
          <Typography variant="body2" sx={{ pt: 0.75 }}>出卡顺序</Typography>
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, justifyContent: 'flex-end', flex: 1, pl: 2 }}>
            {MODES.map((m) => (
              <Chip
                key={m.key} label={m.label} clickable size="small"
                variant={mode === m.key ? 'filled' : 'outlined'}
                color={mode === m.key ? 'primary' : 'default'}
                onClick={() => setMode(m.key)}
              />
            ))}
          </Box>
        </Box>

        <Box sx={{ ...row, alignItems: 'flex-start' }}>
          <Box sx={{ pr: 2 }}>
            <Typography variant="body2">暂停这本帖</Typography>
            <Typography sx={note}>暂停后不进入每轮出卡，进度保留。</Typography>
          </Box>
          <Switch checked={paused} onChange={(e) => setPaused(e.target.checked)} inputProps={{ 'aria-label': '暂停这本帖' }} />
        </Box>

        <Box sx={{ mt: 3, pt: 2, borderTop: '1px solid', borderColor: 'divider' }}>
          <Button size="small" color="error" onClick={onDelete} sx={{ minHeight: 36, px: 0 }}>
            移出书库并删除进度
          </Button>
        </Box>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose}>取消</Button>
        <Button
          variant="contained"
          onClick={() => onSave({ dailyNewLimit: newLimit, dailyReviewLimit: reviewLimit, paused, mode })}
        >
          保存
        </Button>
      </DialogActions>
    </Dialog>
  );
}
