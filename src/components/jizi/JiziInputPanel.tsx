import React from 'react';
import {
  Box,
  TextField,
  Typography,
  ToggleButtonGroup,
  ToggleButton,
  Slider,
  Chip,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
  Stack,
  Divider,
} from '@mui/material';
import JiziPresetButton from './JiziPresetButton';
import type { JiziLayout, JiziDirection, JiziBackground, JiziMatchResult } from '@/types/jizi';

export interface JiziInputPanelProps {
  text: string;
  onTextChange: (text: string) => void;
  layout: JiziLayout;
  onLayoutChange: (layout: JiziLayout) => void;
  scope?: 'mine' | 'all';
  onScopeChange?: (scope: 'mine' | 'all') => void;
  results?: JiziMatchResult[];
  styleFilter?: string;
  onStyleFilterChange?: (style: string) => void;
  calligrapherFilter?: string;
  onCalligrapherFilterChange?: (name: string) => void;
}

/** 从匹配结果中提取去重的书体/书家列表 */
function extractFilters(results: JiziMatchResult[]): { styles: string[]; calligraphers: string[] } {
  const styleSet = new Set<string>();
  const nameSet = new Set<string>();
  results.forEach((r) => {
    r.hits.forEach((h) => {
      if (h.style) styleSet.add(h.style);
      if (h.calligrapher) nameSet.add(h.calligrapher);
    });
  });
  return {
    styles: Array.from(styleSet).sort(),
    calligraphers: Array.from(nameSet).sort(),
  };
}

/** 输入区 + 排版控件 */
const JiziInputPanel: React.FC<JiziInputPanelProps> = ({
  text,
  onTextChange,
  layout,
  onLayoutChange,
  scope,
  onScopeChange,
  results,
  styleFilter,
  onStyleFilterChange,
  calligrapherFilter,
  onCalligrapherFilterChange,
}) => {
  const update = (patch: Partial<JiziLayout>) => onLayoutChange({ ...layout, ...patch });
  const filters = results ? extractFilters(results) : { styles: [], calligraphers: [] };

  return (
    <Stack spacing={2.5}>
      {/* 文字输入 */}
      <Box>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
          <Typography variant="body2" sx={{ fontWeight: 500 }}>
            集字内容
          </Typography>
          <JiziPresetButton onSelect={onTextChange} />
        </Box>
        <TextField
          fullWidth
          multiline
          rows={4}
          value={text}
          onChange={(e) => onTextChange(e.target.value)}
          placeholder="输入诗句，如：春江潮水连海平"
          variant="outlined"
          sx={{ '& .MuiOutlinedInput-root': { borderRadius: '2px' } }}
        />
        <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: 'block' }}>
          支持中文汉字，标点自动忽略，最多 200 字
        </Typography>
      </Box>

      <Divider />

      {/* 字库范围 + 筛选 */}
      {(onScopeChange || onStyleFilterChange) && (
        <Box>
          {onScopeChange && (
            <Box sx={{ mb: onStyleFilterChange ? 1.5 : 0 }}>
              <Typography variant="body2" sx={{ mb: 1, fontWeight: 500 }}>
                字库范围
              </Typography>
              <Box sx={{ display: 'flex', gap: 1 }}>
                <Chip
                  label="已订阅"
                  size="small"
                  variant={scope === 'mine' ? 'filled' : 'outlined'}
                  color={scope === 'mine' ? 'primary' : 'default'}
                  onClick={() => onScopeChange('mine')}
                />
                <Chip
                  label="全部公开"
                  size="small"
                  variant={scope === 'all' ? 'filled' : 'outlined'}
                  color={scope === 'all' ? 'primary' : 'default'}
                  onClick={() => onScopeChange('all')}
                />
              </Box>
            </Box>
          )}

          {/* 书体筛选 */}
          {onStyleFilterChange && filters.styles.length > 0 && (
            <Box sx={{ mb: onCalligrapherFilterChange && filters.calligraphers.length > 0 ? 1.5 : 0 }}>
              <Typography variant="body2" sx={{ mb: 1, fontWeight: 500 }}>
                书体
              </Typography>
              <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
                <Chip
                  label="全部"
                  size="small"
                  variant={!styleFilter ? 'filled' : 'outlined'}
                  color={!styleFilter ? 'primary' : 'default'}
                  onClick={() => onStyleFilterChange('')}
                />
                {filters.styles.map((s) => (
                  <Chip
                    key={s}
                    label={s}
                    size="small"
                    variant={styleFilter === s ? 'filled' : 'outlined'}
                    color={styleFilter === s ? 'primary' : 'default'}
                    onClick={() => onStyleFilterChange(s)}
                  />
                ))}
              </Box>
            </Box>
          )}

          {/* 书家筛选 */}
          {onCalligrapherFilterChange && filters.calligraphers.length > 0 && (
            <Box>
              <Typography variant="body2" sx={{ mb: 1, fontWeight: 500 }}>
                书家
              </Typography>
              <FormControl size="small" fullWidth>
                <Select
                  value={calligrapherFilter || ''}
                  onChange={(e) => onCalligrapherFilterChange(e.target.value)}
                  displayEmpty
                >
                  <MenuItem value="">全部书家</MenuItem>
                  {filters.calligraphers.map((name) => (
                    <MenuItem key={name} value={name}>{name}</MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Box>
          )}
        </Box>
      )}

      {/* 排版方向 */}
      <Box>
        <Typography variant="body2" sx={{ mb: 1, fontWeight: 500 }}>
          方向
        </Typography>
        <ToggleButtonGroup
          exclusive
          size="small"
          value={layout.direction}
          onChange={(_, v: JiziDirection | null) => v && update({ direction: v })}
        >
          <ToggleButton value="vertical-rl">竖排右起</ToggleButton>
          <ToggleButton value="vertical-lr">竖排左起</ToggleButton>
          <ToggleButton value="horizontal-lr">横排左起</ToggleButton>
          <ToggleButton value="horizontal-rl">横排右起</ToggleButton>
        </ToggleButtonGroup>
      </Box>

      {/* 字号 */}
      <Box>
        <Typography variant="body2" sx={{ mb: 1, fontWeight: 500 }}>
          字号
        </Typography>
        <ToggleButtonGroup
          exclusive
          size="small"
          value={layout.fontSize}
          onChange={(_, v: number | null) => v && update({ fontSize: v })}
        >
          <ToggleButton value={80}>小</ToggleButton>
          <ToggleButton value={120}>中</ToggleButton>
          <ToggleButton value={160}>大</ToggleButton>
        </ToggleButtonGroup>
      </Box>

      {/* 列字数 */}
      <FormControl size="small" fullWidth>
        <InputLabel>{layout.direction.startsWith('vertical') ? '每列字数' : '每行字数'}</InputLabel>
        <Select
          value={layout.colCount}
          label={layout.direction.startsWith('vertical') ? '每列字数' : '每行字数'}
          onChange={(e) => update({ colCount: Number(e.target.value) })}
        >
          <MenuItem value={4}>4 字</MenuItem>
          <MenuItem value={6}>6 字</MenuItem>
          <MenuItem value={8}>8 字</MenuItem>
          <MenuItem value={10}>10 字</MenuItem>
          <MenuItem value={12}>12 字</MenuItem>
          <MenuItem value={14}>14 字</MenuItem>
          <MenuItem value={16}>16 字</MenuItem>
          <MenuItem value={18}>18 字</MenuItem>
          <MenuItem value={20}>20 字</MenuItem>
        </Select>
      </FormControl>

      {/* 字距 */}
      <Box>
        <Typography variant="body2" sx={{ mb: 1, fontWeight: 500 }}>
          字距
        </Typography>
        <Box sx={{ px: 1 }}>
          <Slider
            size="small"
            min={0}
            max={0.4}
            step={0.02}
            value={layout.charGap}
            onChange={(_, v) => update({ charGap: v as number })}
            valueLabelDisplay="auto"
            valueLabelFormat={(v) => `${Math.round(v * 100)}%`}
          />
        </Box>
      </Box>

      {/* 行距 */}
      <Box>
        <Typography variant="body2" sx={{ mb: 1, fontWeight: 500 }}>
          行距
        </Typography>
        <Box sx={{ px: 1 }}>
          <Slider
            size="small"
            min={0}
            max={0.6}
            step={0.02}
            value={layout.lineGap}
            onChange={(_, v) => update({ lineGap: v as number })}
            valueLabelDisplay="auto"
            valueLabelFormat={(v) => `${Math.round(v * 100)}%`}
          />
        </Box>
      </Box>

      {/* 背景 */}
      <Box>
        <Typography variant="body2" sx={{ mb: 1, fontWeight: 500 }}>
          背景
        </Typography>
        <ToggleButtonGroup
          exclusive
          size="small"
          value={layout.background}
          onChange={(_, v: JiziBackground | null) => v && update({ background: v })}
        >
          <ToggleButton value="xuan">宣纸</ToggleButton>
          <ToggleButton value="white">纯白</ToggleButton>
          <ToggleButton value="ink">墨色</ToggleButton>
          <ToggleButton value="vermilion">朱砂</ToggleButton>
        </ToggleButtonGroup>
      </Box>
    </Stack>
  );
};

export default JiziInputPanel;
