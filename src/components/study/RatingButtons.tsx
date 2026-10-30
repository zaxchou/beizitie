import React, { useEffect, useCallback, useMemo } from 'react';
import { Button, Grid } from '@mui/material';
import type { Rating, SM2Input } from '@/types';
import { calculateNextReview } from '@/lib/sm2';

/** SM-2 卡片状态（用于预览间隔） */
interface SM2State {
  ease: number;
  interval: number;
  repetitions: number;
}

export interface RatingButtonsProps {
  /** 评分回调 */
  onRate: (rating: Rating) => void;
  /** 是否禁用按钮 */
  disabled?: boolean;
  /** 当前卡片 SM-2 状态，用于显示各评分间隔预览 */
  card?: SM2State | null;
}

/** 按钮配置：标签、评分值、快捷键 */
interface ButtonConfig {
  label: string;
  rating: Rating;
  shortcut: string;
  intervalPreview?: string;
}

/**
 * 将分钟数格式化为人类可读的时间描述。
 */
function formatInterval(minutes: number): string {
  if (minutes < 60) return `${minutes}分钟`;
  if (minutes < 1440) return `${Math.round(minutes / 60)}小时`;
  if (minutes < 43200) return `${Math.round(minutes / 1440)}天`;
  return `${Math.round(minutes / 43200)}个月`;
}

const buttonConfigs: ButtonConfig[] = [
  { label: '重来', rating: 1, shortcut: '1' },
  { label: '困难', rating: 2, shortcut: '2' },
  { label: '良好', rating: 3, shortcut: '3' },
  { label: '简单', rating: 4, shortcut: '4' },
];

/**
 * 评分按钮组。
 *
 * 四档**同等视觉权重**：不再用红/橙/绿/青四色暗示「良好」，
 * 也不预高亮任何一档；间隔预览放右侧，键盘 1–4 仍然可用（web 端优势）。
 */
const RatingButtons: React.FC<RatingButtonsProps> = ({ onRate, disabled = false, card = null }) => {
  // 计算各评分对应的预览间隔
  const input: SM2Input = card ?? { ease: 2.5, interval: 0, repetitions: 0 };
  const intervalPreviews = useMemo(
    () => ([1, 2, 3, 4] as Rating[]).map((r) => calculateNextReview(r, input)),
    [input.ease, input.interval, input.repetitions]
  );

  const extendedConfigs = useMemo(
    () =>
      buttonConfigs.map((config, i) => ({
        ...config,
        intervalPreview: formatInterval(intervalPreviews[i].interval),
      })),
    [intervalPreviews]
  );

  // 键盘快捷键监听
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (disabled) return;

      // 忽略在输入框内的按键
      const target = e.target as HTMLElement;
      if (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.tagName === 'SELECT' ||
        target.isContentEditable
      ) {
        return;
      }

      const config = buttonConfigs.find((c) => c.shortcut === e.key);
      if (config) {
        e.preventDefault();
        onRate(config.rating);
      }
    },
    [disabled, onRate]
  );

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [handleKeyDown]);

  return (
    <Grid container spacing={1}>
      {extendedConfigs.map((config) => (
        <Grid item xs={6} sm={3} key={config.rating}>
          <Button
            variant="outlined"
            color="inherit"
            fullWidth
            disabled={disabled}
            aria-keyshortcuts={config.shortcut}
            onClick={() => onRate(config.rating)}
            sx={{
              minHeight: 58,
              height: 58,
              px: 2,
              justifyContent: 'space-between',
              borderColor: 'divider',
              bgcolor: 'background.paper',
              color: 'text.primary',
              '&:hover': { bgcolor: 'var(--surface)', borderColor: 'var(--line-strong)' },
            }}
          >
            <span className="font-kai" style={{ fontSize: 17, letterSpacing: 1 }}>{config.label}</span>
            {config.intervalPreview && (
              <span style={{ fontSize: 12, color: 'var(--muted)' }}>{config.intervalPreview}</span>
            )}
          </Button>
        </Grid>
      ))}
    </Grid>
  );
};

export default RatingButtons;
