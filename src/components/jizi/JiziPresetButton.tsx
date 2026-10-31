import React, { useState } from 'react';
import { Box, Button, Popover, Typography } from '@mui/material';

/** 预设分类 */
interface PresetCategory {
  label: string;
  items: string[];
}

const PRESETS: PresetCategory[] = [
  {
    label: '诗文',
    items: [
      '春江花月夜',
      '静夜思',
      '登鹳雀楼',
      '清明',
      '水调歌头',
      '将进酒',
      '江雪',
      '望庐山瀑布',
      '枫桥夜泊',
      '出塞',
    ],
  },
  {
    label: '对联',
    items: [
      '海纳百川有容乃大',
      '厚德载物自强不息',
      '书山有路勤为径',
      '天道酬勤',
      '宁静致远',
      '淡泊明志',
      '上善若水',
      '知行合一',
    ],
  },
  {
    label: '名言',
    items: [
      '温故而知新',
      '学而时习之',
      '见贤思齐',
      '博学笃志',
      '三人行必有我师',
      '己所不欲勿施于人',
      '天行健君子以自强不息',
      '地势坤君子以厚德载物',
    ],
  },
];

export interface JiziPresetButtonProps {
  onSelect: (text: string) => void;
}

/** 诗文预设按钮 + Popover 选择 */
const JiziPresetButton: React.FC<JiziPresetButtonProps> = ({ onSelect }) => {
  const [anchorEl, setAnchorEl] = useState<HTMLButtonElement | null>(null);
  const open = Boolean(anchorEl);

  const handleSelect = (item: string) => {
    onSelect(item);
    setAnchorEl(null);
  };

  return (
    <>
      <Button
        variant="text"
        onClick={(e) => setAnchorEl(e.currentTarget)}
        sx={{
          minWidth: 0,
          p: 0,
          fontFamily: 'var(--font-mono)',
          fontSize: 11,
          letterSpacing: '0.04em',
          color: 'text.primary',
          '&:hover': { backgroundColor: 'transparent', textDecoration: 'underline' },
        }}
      >
        预设 · Presets
      </Button>

      <Popover
        open={open}
        anchorEl={anchorEl}
        onClose={() => setAnchorEl(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        slotProps={{ paper: { sx: { maxWidth: 380, p: 2, border: '2px solid', borderColor: 'text.primary', borderRadius: 0, boxShadow: 'none' } } }}
      >
        {PRESETS.map((cat, ci) => (
          <Box key={cat.label} sx={{ pt: ci === 0 ? 0 : 1.5, mt: ci === 0 ? 0 : 1.5, borderTop: ci === 0 ? 0 : '1px solid', borderColor: 'divider' }}>
            <Typography sx={{ fontFamily: 'var(--font-mono)', fontSize: 9.5, letterSpacing: '0.14em', textTransform: 'uppercase', opacity: 0.6 }}>
              {cat.label}
            </Typography>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75, mt: 1 }}>
              {cat.items.map((item) => (
                <Box
                  key={item}
                  component="button"
                  type="button"
                  onClick={() => handleSelect(item)}
                  sx={{
                    border: '1px solid',
                    borderColor: 'divider',
                    background: 'none',
                    color: 'inherit',
                    fontSize: 12,
                    px: 1,
                    py: '4px',
                    cursor: 'pointer',
                    '&:hover': { borderColor: 'text.primary', bgcolor: 'text.primary', color: 'background.default' },
                  }}
                >
                  {item}
                </Box>
              ))}
            </Box>
          </Box>
        ))}
      </Popover>
    </>
  );
};

export default JiziPresetButton;
