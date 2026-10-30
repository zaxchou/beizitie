import React, { useEffect, useCallback, useMemo } from 'react';
import { Box } from '@mui/material';
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
  /** grid = 2×2 按钮（手机）；list = 竖排细线清单（桌面右栏） */
  layout?: 'grid' | 'list';
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
const RatingButtons: React.FC<RatingButtonsProps> = ({ onRate, disabled = false, card = null, layout = 'grid' }) => {
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

  if (layout === 'list') {
    return (
      <Box sx={{ borderTop: '2px solid', borderColor: 'text.primary' }}>
        {extendedConfigs.map((config) => (
          <Box
            key={config.rating}
            component="button"
            type="button"
            aria-keyshortcuts={config.shortcut}
            disabled={disabled}
            onClick={() => onRate(config.rating)}
            sx={{
              width: '100%',
              display: 'flex',
              alignItems: 'baseline',
              justifyContent: 'space-between',
              gap: 2,
              px: 0.25,
              py: 2,
              border: 0,
              borderBottom: '1px solid',
              borderColor: 'text.primary',
              bgcolor: 'transparent',
              color: 'text.primary',
              textAlign: 'left',
              cursor: disabled ? 'not-allowed' : 'pointer',
              opacity: disabled ? 0.4 : 1,
              transition: 'background-color 0.15s ease, color 0.15s ease',
              '&:hover': disabled ? undefined : { backgroundColor: 'text.primary', color: 'background.default' },
              '&:hover .rate-interval': disabled ? undefined : { color: 'background.default', opacity: 0.8 },
            }}
          >
            <Box component="span" sx={{ fontSize: 18, fontWeight: 900, letterSpacing: '0.06em' }}>
              {config.label}
            </Box>
            <Box
              component="span"
              className="rate-interval"
              sx={{ fontFamily: 'var(--font-mono)', fontSize: 11, opacity: 0.7, letterSpacing: '0.04em' }}
            >
              {config.intervalPreview}
            </Box>
          </Box>
        ))}
      </Box>
    );
  }

  return (
    <Box
      sx={{
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        border: '2px solid',
        borderColor: 'text.primary',
      }}
    >
      {extendedConfigs.map((config, index) => (
        <Box
          key={config.rating}
          component="button"
          type="button"
          disabled={disabled}
          aria-keyshortcuts={config.shortcut}
          onClick={() => onRate(config.rating)}
          sx={{
            display: 'flex',
            alignItems: 'baseline',
            justifyContent: 'space-between',
            gap: 1,
            px: 1.75,
            height: 54,
            border: 0,
            borderRight: index % 2 === 0 ? '1px solid' : 0,
            borderBottom: index < 2 ? '1px solid' : 0,
            borderColor: 'text.primary',
            bgcolor: 'background.paper',
            color: 'text.primary',
            textAlign: 'left',
            cursor: disabled ? 'not-allowed' : 'pointer',
            opacity: disabled ? 0.38 : 1,
            '&:active': disabled ? undefined : { bgcolor: 'primary.main', color: 'primary.contrastText' },
          }}
        >
          <Box component="span" sx={{ fontSize: 16.5, fontWeight: 900, letterSpacing: '0.06em' }}>
            {config.label}
          </Box>
          <Box
            component="span"
            sx={{ fontFamily: 'var(--font-mono)', fontSize: 10, opacity: 0.7, letterSpacing: '0.02em' }}
          >
            {config.intervalPreview}
          </Box>
        </Box>
      ))}
    </Box>
  );
};

export default RatingButtons;
