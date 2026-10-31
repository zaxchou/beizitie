import React, { useEffect } from 'react';
import {
  Dialog,
  AppBar,
  Toolbar,
  Typography,
  Box,
  Button,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import FullscreenExitIcon from '@mui/icons-material/FullscreenExit';
import JiziPreview from './JiziPreview';
import type { JiziMatchResult, JiziLayout } from '@/types/jizi';

export interface JiziFullscreenPreviewProps {
  open: boolean;
  onClose: () => void;
  results: JiziMatchResult[];
  selections: number[];
  layout: JiziLayout;
  onOpenPicker: (index: number) => void;
  onExport: () => void;
  exporting: boolean;
  text?: string;
}

/** 全屏预览模式 —— 沉浸式查看集字作品 */
const JiziFullscreenPreview: React.FC<JiziFullscreenPreviewProps> = ({
  open,
  onClose,
  results,
  selections,
  layout,
  onOpenPicker,
  onExport,
  exporting,
  text,
}) => {
  // ESC 退出
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose]);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      fullScreen
      PaperProps={{
        sx: {
          bgcolor: '#1a1a1a',
          backgroundImage: 'none',
        },
      }}
    >
      {/* 顶部工具栏 */}
      <AppBar
        position="static"
        color="transparent"
        elevation={0}
        sx={{
          bgcolor: '#17130c',
          backgroundImage: 'none',
          borderBottom: '1px solid rgba(242,236,221,0.28)',
          boxShadow: 'none',
        }}
      >
        <Toolbar variant="dense" sx={{ minHeight: 52, px: { xs: 1.5, md: 3 } }}>
          <Box
            component="button"
            type="button"
            onClick={onClose}
            aria-label="退出全屏"
            sx={{
              border: '1px solid rgba(242,236,221,0.4)',
              background: 'none',
              color: 'rgba(242,236,221,0.86)',
              width: 30,
              height: 30,
              p: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              mr: 1.5,
              '&:hover': { bgcolor: '#f2ecdd', color: '#17130c' },
            }}
          >
            <FullscreenExitIcon sx={{ fontSize: 16 }} />
          </Box>
          <Typography
            sx={{
              flex: 1,
              color: 'rgba(242,236,221,0.7)',
              fontFamily: 'var(--font-mono)',
              fontSize: 10.5,
              letterSpacing: '0.14em',
            }}
          >
            集字预览 · {results.length} 字
          </Typography>
          <Box
            component="button"
            type="button"
            onClick={onClose}
            aria-label="关闭"
            sx={{
              border: '1px solid rgba(242,236,221,0.4)',
              background: 'none',
              color: 'rgba(242,236,221,0.86)',
              width: 30,
              height: 30,
              p: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              '&:hover': { bgcolor: '#f2ecdd', color: '#17130c' },
            }}
          >
            <CloseIcon sx={{ fontSize: 16 }} />
          </Box>
        </Toolbar>
      </AppBar>

      {/* 中间预览区 —— 居中、可滚动 */}
      <Box
        sx={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'auto',
          p: 3,
        }}
      >
        <JiziPreview
          results={results}
          selections={selections}
          layout={layout}
          onOpenPicker={onOpenPicker}
          text={text}
        />
      </Box>

      {/* 底部工具栏 */}
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 1.5,
          py: 1.5,
          px: 2,
          bgcolor: '#17130c',
          borderTop: '1px solid rgba(242,236,221,0.28)',
        }}
      >
        <Button
          variant="contained"
          onClick={onExport}
          disabled={exporting || results.length === 0}
          sx={{ height: 40, px: 2.5, justifyContent: 'space-between', gap: 3, fontFamily: 'var(--font-mono)', fontSize: 11 }}
        >
          <span>{exporting ? '导出中…' : '导出 PNG'}</span>
          <span aria-hidden>↓</span>
        </Button>
      </Box>
    </Dialog>
  );
};

export default JiziFullscreenPreview;
