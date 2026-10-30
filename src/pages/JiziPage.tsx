import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  Box,
  Typography,
  Button,
  Drawer,
  TextField,
  Alert,
  CircularProgress,
  Chip,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  ToggleButtonGroup,
  ToggleButton,
  Slider,
  Switch,
  IconButton,
  Fab,
  Paper,
  Stack,
  Divider,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogContentText,
  DialogActions,
} from '@mui/material';
import { useTheme, alpha } from '@mui/material/styles';
import EditIcon from '@mui/icons-material/Edit';
import StyleIcon from '@mui/icons-material/Style';
import DashboardIcon from '@mui/icons-material/Dashboard';
import VisibilityIcon from '@mui/icons-material/Visibility';
import DownloadIcon from '@mui/icons-material/Download';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import CloseIcon from '@mui/icons-material/Close';
import FullscreenIcon from '@mui/icons-material/Fullscreen';
import HistoryIcon from '@mui/icons-material/History';
import JiziPresetButton from '@/components/jizi/JiziPresetButton';
import JiziPreview from '@/components/jizi/JiziPreview';
import JiziSwitcherSheet from '@/components/jizi/JiziSwitcherSheet';
import JiziFullscreenPreview from '@/components/jizi/JiziFullscreenPreview';
import { fetchJiziMatch, fetchJiziHistory, saveJiziHistory, deleteJiziHistory, getImageUrl } from '@/lib/api';
import { exportJiziPNG } from '@/lib/jiziExport';
import { useJiziStore } from '@/stores/useJiziStore';
import { useAuthStore } from '@/stores/useAuthStore';
import { DEFAULT_LAYOUT } from '@/types/jizi';
import type { JiziMatchResult, CharHit, JiziDirection, JiziBackground, JiziLayout } from '@/types/jizi';

type JiziTab = 'text' | 'select' | 'layout' | 'preview' | null;

/** 从匹配结果中提取去重的书体/书家列表 */
function extractFilters(results: JiziMatchResult[]): { styles: string[]; calligraphers: string[] } {
  const styleSet = new Set<string>();
  const nameSet = new Set<string>();
  results.forEach((r) => {
    r.hits.forEach((h) => {
      if (h.style) {
        h.style.split(',').filter(Boolean).forEach((s) => styleSet.add(s.trim()));
      }
      if (h.calligrapher) nameSet.add(h.calligrapher);
    });
  });
  return {
    styles: Array.from(styleSet).sort(),
    calligraphers: Array.from(nameSet).sort(),
  };
}

/** Sheet 顶部标题栏 */
const SheetHeader: React.FC<{ title: string; onClose: () => void }> = ({ title, onClose }) => (
  <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1.5 }}>
    <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>{title}</Typography>
    <IconButton size="small" onClick={onClose}>
      <CloseIcon fontSize="small" />
    </IconButton>
  </Box>
);

const JiziPage: React.FC = () => {
  const theme = useTheme();
  const store = useJiziStore();
  const { text, results, selections: selectedCardIds, layout, scope, styleFilter, calligrapherFilter } = store;
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [switcherIndex, setSwitcherIndex] = useState(-1);
  const [exporting, setExporting] = useState(false);
  const [fullscreenOpen, setFullscreenOpen] = useState(false);
  const [styleConfirmOpen, setStyleConfirmOpen] = useState(false);
  const [pendingStyleHit, setPendingStyleHit] = useState<CharHit | null>(null);
  const [pendingStyleRefIndex, setPendingStyleRefIndex] = useState(0);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<JiziTab>(null);
  const [toolsExpanded, setToolsExpanded] = useState(true);

  const historyFetched = useRef(false);

  const token = useAuthStore((s) => s.token);
  const isLoggedIn = !!token;
  const history = store.history;

  const handleMatch = useCallback(async () => {
    const trimmed = text.trim();
    if (!trimmed) return;
    setLoading(true);
    setError(null);
    try {
      const resp = await fetchJiziMatch(trimmed, scope);
      store.setResults(resp.results);
      store.setSelections({});
      // 登录用户自动保存搜索记录
      if (useAuthStore.getState().token && resp.results.length > 0) {
        saveJiziHistory(trimmed).then((data) => {
          if (data.saved) {
            fetchJiziHistory().then((h) => store.setHistory(h.items)).catch(() => {});
          }
        }).catch(() => {});
      }
      closeSheet();
    } catch (err) {
      setError(err instanceof Error ? err.message : '匹配失败');
      store.setResults([]);
    } finally {
      setLoading(false);
    }
  }, [text, scope]);

  // 登录后拉取搜索历史
  useEffect(() => {
    if (!isLoggedIn || historyFetched.current) return;
    historyFetched.current = true;
    fetchJiziHistory()
      .then((data) => store.setHistory(data.items))
      .catch(() => {});
  }, [isLoggedIn]);

  const hasResults = results.length > 0;

  const filteredResults = useMemo(() => {
    if (!styleFilter && !calligrapherFilter) return results;
    return results.map((r) => ({
      ...r,
      hits: r.hits.filter((h) => {
        if (styleFilter) {
          const styles = h.style ? h.style.split(',').map((s) => s.trim()) : [];
          if (!styles.includes(styleFilter)) return false;
        }
        if (calligrapherFilter && h.calligrapher !== calligrapherFilter) return false;
        return true;
      }),
    }));
  }, [results, styleFilter, calligrapherFilter]);

  const filters = useMemo(() => extractFilters(results), [results]);

  useEffect(() => {
    if (!results.length) return;
    const allStyles = new Set<string>();
    const allCalligraphers = new Set<string>();
    results.forEach((r) => r.hits.forEach((h) => {
      if (h.style) allStyles.add(h.style);
      if (h.calligrapher) allCalligraphers.add(h.calligrapher);
    }));
    if (styleFilter && !allStyles.has(styleFilter)) store.setStyleFilter('');
    if (calligrapherFilter && !allCalligraphers.has(calligrapherFilter)) store.setCalligrapherFilter('');
  }, [results, styleFilter, calligrapherFilter]);

  const selections = useMemo<number[]>(() => {
    return filteredResults.map((r, i) => {
      const cardId = selectedCardIds[i];
      if (!cardId) return 0;
      const idx = r.hits.findIndex((h) => h.card_id === cardId);
      return idx >= 0 ? idx : 0;
    });
  }, [filteredResults, selectedCardIds]);

  const update = (patch: Partial<JiziLayout>) => store.setLayout({ ...layout, ...patch });

  const handleOpenPicker = useCallback((index: number) => {
    setSwitcherIndex(index);
    setSwitcherOpen(true);
  }, []);

  const handleSwitcherPick = useCallback((hitIndex: number) => {
    const result = filteredResults[switcherIndex];
    const card = result?.hits[hitIndex];
    if (card) {
      useJiziStore.setState((s) => ({ selections: { ...s.selections, [switcherIndex]: card.card_id } }));
    }
    setSwitcherOpen(false);

    // 找到第一个有匹配字的位置作为"风格基准字"
    // 如果用户这次点选的正是这个基准字，就弹窗询问是否把它的风格统一到全文
    const firstMatchIndex = filteredResults.findIndex((r) => r.hits.length > 0);
    if (switcherIndex === firstMatchIndex && firstMatchIndex >= 0) {
      const card = filteredResults[firstMatchIndex]?.hits[hitIndex];
      if (card) {
        setPendingStyleHit(card);
        setPendingStyleRefIndex(firstMatchIndex);
        setStyleConfirmOpen(true);
      }
    }
  }, [switcherIndex, filteredResults]);

  const handleStyleConfirm = useCallback(() => {
    if (!pendingStyleHit) {
      setStyleConfirmOpen(false);
      return;
    }
    const refDeck = pendingStyleHit.deck_id;
    const refCalligrapher = pendingStyleHit.calligrapher;

    const prev = useJiziStore.getState().selections;
    const next: Record<number, string> = { ...prev };
    filteredResults.forEach((r, i) => {
      if (i === pendingStyleRefIndex) return;
      const sameDeck = r.hits.find((h) => h.deck_id === refDeck);
      if (sameDeck) {
        next[i] = sameDeck.card_id;
        return;
      }
      if (refCalligrapher) {
        const sameCalligrapher = r.hits.find((h) => h.calligrapher === refCalligrapher);
        if (sameCalligrapher) {
          next[i] = sameCalligrapher.card_id;
        }
      }
    });
    useJiziStore.setState({ selections: next });
    setStyleConfirmOpen(false);
    setPendingStyleHit(null);
  }, [pendingStyleHit, pendingStyleRefIndex, filteredResults]);

  const handleStyleCancel = useCallback(() => {
    setStyleConfirmOpen(false);
    setPendingStyleHit(null);
  }, []);

  const handleExport = useCallback(async () => {
    setExporting(true);
    try {
      await exportJiziPNG(filteredResults, selections, layout, text);
    } catch (err) {
      setError(err instanceof Error ? err.message : '导出失败');
    } finally {
      setExporting(false);
    }
  }, [filteredResults, selections, layout, text]);

  const handleResetLayout = useCallback(() => {
    store.setLayout({ ...DEFAULT_LAYOUT });
  }, []);

  const closeSheet = useCallback(() => setActiveTab(null), []);

  const handleOpenPickerFromList = useCallback((index: number) => {
    closeSheet();
    setTimeout(() => handleOpenPicker(index), 200);
  }, [closeSheet, handleOpenPicker]);

  const matchedCount = filteredResults.filter((r) => r.hits.length > 0).length;

  return (
    <Box sx={{ height: '100%', position: 'relative', overflow: 'hidden' }}>
      {error && (
        <Alert severity="error" onClose={() => setError(null)} sx={{ position: 'absolute', top: 8, left: 8, right: 8, zIndex: 20 }}>
          {error}
        </Alert>
      )}

      {/* 加载指示器 */}
      {loading && (
        <Box sx={{ position: 'absolute', top: 8, left: '50%', transform: 'translateX(-50%)', zIndex: 5 }}>
          <CircularProgress size={20} />
        </Box>
      )}

      {/* ===== 可收缩浮动工具按钮 + 字数显示 ===== */}
      {toolsExpanded ? (
        <Box sx={{
          position: 'absolute',
          left: '50%', transform: 'translateX(-50%)',
          bottom: 44,
          zIndex: 10,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 0.5,
        }}>
          {hasResults && (
            <Box sx={{
              bgcolor: alpha(theme.palette.background.paper, 0.85),
              backdropFilter: 'blur(4px)',
              px: 1.25, py: 0.25,
              borderRadius: '2px',
              fontSize: 12,
              color: 'text.secondary',
              boxShadow: 1,
              pointerEvents: 'none',
            }}>
              {matchedCount} / {results.length} 字
            </Box>
          )}
          <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
            <Fab
              size="small"
              onClick={() => setToolsExpanded(false)}
              sx={{
                width: 36, height: 36, minHeight: 0,
                bgcolor: alpha(theme.palette.background.paper, 0.7),
                backdropFilter: 'blur(8px)',
                color: 'text.secondary',
                '&:hover': { bgcolor: alpha(theme.palette.background.paper, 0.85) },
              }}
            >
              <CloseIcon sx={{ fontSize: 18 }} />
            </Fab>
            {([
              { label: '文字', value: 'text', icon: <EditIcon sx={{ fontSize: 18 }} /> },
              { label: '选择', value: 'select', icon: <StyleIcon sx={{ fontSize: 18 }} /> },
              { label: '排版', value: 'layout', icon: <DashboardIcon sx={{ fontSize: 18 }} /> },
              { label: '预览', value: 'preview', icon: <VisibilityIcon sx={{ fontSize: 18 }} /> },
            ] as const).map((btn) => (
              <Paper
                key={btn.value}
                elevation={4}
                onClick={() => setActiveTab(activeTab === btn.value ? null : btn.value)}
                sx={{
                  pointerEvents: 'auto',
                  cursor: 'pointer',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 0.25,
                  width: 48,
                  height: 40,
                  borderRadius: '2px',
                  bgcolor: activeTab === btn.value ? 'primary.main' : alpha(theme.palette.background.paper, 0.7),
                  color: activeTab === btn.value ? '#fff' : 'text.secondary',
                  backdropFilter: 'blur(8px)',
                  transition: 'all 0.15s',
                  '&:hover': { bgcolor: activeTab === btn.value ? 'primary.dark' : alpha(theme.palette.background.paper, 0.85) },
                }}
              >
                {btn.icon}
                <Typography sx={{ fontSize: 9, lineHeight: 1 }}>{btn.label}</Typography>
              </Paper>
            ))}
          </Box>
        </Box>
      ) : (
        <Fab
          size="small"
          onClick={() => setToolsExpanded(true)}
          sx={{
            position: 'absolute',
            left: 8,
            bottom: 44,
            zIndex: 10,
            width: 36, height: 36, minHeight: 0,
            bgcolor: alpha(theme.palette.background.paper, 0.7),
            backdropFilter: 'blur(8px)',
            color: 'text.secondary',
            '&:hover': { bgcolor: alpha(theme.palette.background.paper, 0.85) },
          }}
        >
          <ChevronRightIcon sx={{ fontSize: 20 }} />
        </Fab>
      )}

      {/* ===== 主预览区（无边全屏） ===== */}
      <Box sx={{ position: 'absolute', inset: 0 }}>
        <JiziPreview
          results={filteredResults}
          selections={selections}
          layout={layout}
          onOpenPicker={handleOpenPicker}
          text={text}
        />

        {!hasResults && !loading && (
          <Box sx={{
            position: 'absolute', inset: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexDirection: 'column', gap: 1.5,
            color: 'text.secondary', pointerEvents: 'none', pb: 10,
          }}>
            <Typography className="font-kai" sx={{ fontSize: 26, letterSpacing: 6, color: 'text.primary' }}>
              集字
            </Typography>
            <Typography sx={{ fontSize: 13 }}>输入文字后这里会显示集字预览</Typography>
            <Typography sx={{ fontSize: 12, color: 'text.disabled' }}>
              从已核验碑帖里取原字 · 点「文字」开始
            </Typography>
          </Box>
        )}
      </Box>

      {/* ===== Sheet: 文字 ===== */}
      <Drawer
        anchor="bottom"
        open={activeTab === 'text'}
        onClose={closeSheet}
        PaperProps={{ sx: { borderTopLeftRadius: 16, borderTopRightRadius: 16, maxHeight: '70vh' } }}
      >
        <Box sx={{ p: 2 }}>
          <SheetHeader title="编辑文字" onClose={closeSheet} />
          <Stack spacing={2}>
            <Box>
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
                <Typography variant="body2" sx={{ fontWeight: 500 }}>集字内容</Typography>
                <Box sx={{ display: 'flex', gap: 0.5 }}>
                  {text && (
                    <Button size="small" color="error" onClick={() => store.setText('')} sx={{ minWidth: 0, fontSize: 12, px: 1 }}>
                      清空
                    </Button>
                  )}
                  <JiziPresetButton onSelect={store.setText} />
                </Box>
              </Box>
              <TextField
                fullWidth
                multiline
                rows={4}
                value={text}
                onChange={(e) => store.setText(e.target.value)}
                placeholder="输入诗句，如：春江潮水连海平"
                variant="outlined"
                sx={{ '& .MuiOutlinedInput-root': { borderRadius: '2px' } }}
              />
              <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: 'block' }}>
                支持中文汉字，标点自动忽略，最多 500 字
              </Typography>
              <Button
                fullWidth
                variant="contained"
                onClick={handleMatch}
                disabled={loading || !text.trim()}
                sx={{ mt: 1.5, textTransform: 'none', py: 1, borderRadius: '2px' }}
              >
                {loading ? '集字中...' : '开始集字'}
              </Button>
              {isLoggedIn && history.length > 0 && (
                <Box sx={{ mt: 2 }}>
                  <Typography variant="body2" sx={{ fontWeight: 500, mb: 0.5, color: 'text.secondary' }}>
                    历史记录
                  </Typography>
                  <List dense disablePadding sx={{ maxHeight: 200, overflowY: 'auto' }}>
                    {history.map((item) => {
                      const firstLine = item.text.split('\n')[0];
                      const display = firstLine.length > 30 ? firstLine.slice(0, 30) + '…' : firstLine;
                      const date = item.created_at.slice(0, 10);
                      return (
                        <ListItemButton
                          key={item.id}
                          onClick={() => { store.setText(item.text); }}
                          sx={{ borderRadius: '2px', px: 1, py: 0.5 }}
                        >
                          <ListItemIcon sx={{ minWidth: 28 }}>
                            <HistoryIcon sx={{ fontSize: 16, color: 'text.secondary' }} />
                          </ListItemIcon>
                          <ListItemText
                            primary={display}
                            secondary={date}
                            primaryTypographyProps={{ fontSize: 13, noWrap: true }}
                            secondaryTypographyProps={{ fontSize: 11 }}
                          />
                          <Button
                            size="small"
                            onClick={(e) => {
                              e.stopPropagation();
                              setDeleteConfirmId(item.id);
                            }}
                            sx={{ minWidth: 0, px: 0.75, py: 0, fontSize: 11, whiteSpace: 'nowrap', flexShrink: 0, color: 'text.disabled', '&:hover': { color: 'error.main' } }}
                          >
                            删除
                          </Button>
                        </ListItemButton>
                      );
                    })}
                  </List>
                </Box>
              )}
            </Box>
          </Stack>
        </Box>
      </Drawer>

      {/* ===== Sheet: 选择 ===== */}
      <Drawer
        anchor="bottom"
        open={activeTab === 'select'}
        onClose={closeSheet}
        PaperProps={{ sx: { borderTopLeftRadius: 16, borderTopRightRadius: 16, maxHeight: '85vh' } }}
      >
        <Box sx={{ p: 2 }}>
          <SheetHeader title="选择风格" onClose={closeSheet} />
          <Stack spacing={2.5}>
            {/* 书体筛选 */}
            {filters.styles.length > 0 && (
              <Box>
                <Typography variant="body2" sx={{ mb: 1, fontWeight: 500 }}>书体</Typography>
                <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
                  <Chip
                    label="全部"
                    size="small"
                    variant={!styleFilter ? 'filled' : 'outlined'}
                    color={!styleFilter ? 'primary' : 'default'}
                    onClick={() => store.setStyleFilter('')}
                  />
                  {filters.styles.map((s) => (
                    <Chip
                      key={s}
                      label={s}
                      size="small"
                      variant={styleFilter === s ? 'filled' : 'outlined'}
                      color={styleFilter === s ? 'primary' : 'default'}
                      onClick={() => store.setStyleFilter(s)}
                    />
                  ))}
                </Box>
              </Box>
            )}

            {/* 书家筛选 */}
            {filters.calligraphers.length > 0 && (
              <FormControl size="small" fullWidth>
                <InputLabel>书家</InputLabel>
                <Select
                  value={calligrapherFilter || ''}
                  onChange={(e) => store.setCalligrapherFilter(e.target.value)}
                  label="书家"
                >
                  <MenuItem value="">全部书家</MenuItem>
                  {filters.calligraphers.map((name) => (
                    <MenuItem key={name} value={name}>{name}</MenuItem>
                  ))}
                </Select>
              </FormControl>
            )}

            {/* 逐字调整 */}
            {hasResults && (
              <>
                <Divider />
                <Box>
                  <Typography variant="body2" sx={{ fontWeight: 500, mb: 0.5 }}>逐字调整</Typography>
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
                    点击下方任一文字，可切换写法
                  </Typography>
                  <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                    {filteredResults.map((r, i) => {
                      const sel = selections[i] ?? 0;
                      const hit = r.hits[sel];
                      if (!hit) return null;
                      return (
                        <Box
                          key={i}
                          onClick={() => handleOpenPickerFromList(i)}
                          sx={{
                            position: 'relative',
                            cursor: 'pointer',
                            border: 1,
                            borderColor: 'divider',
                            borderRadius: '2px',
                            width: 56,
                            height: 56,
                            bgcolor: 'action.hover',
                            overflow: 'hidden',
                            '&:hover': { borderColor: 'primary.main' },
                          }}
                        >
                          <Box
                            component="img"
                            src={getImageUrl(hit.image_url)}
                            alt={r.char}
                            sx={{ width: '100%', height: '100%', objectFit: 'contain' }}
                            draggable={false}
                          />
                          {r.hits.length > 1 && (
                            <Typography
                              sx={{
                                position: 'absolute',
                                bottom: 1,
                                right: 2,
                                fontSize: 8,
                                color: 'text.secondary',
                                bgcolor: alpha(theme.palette.background.paper, 0.8),
                                px: 0.3,
                                borderRadius: '2px',
                                lineHeight: 1.2,
                              }}
                            >
                              {sel + 1}/{r.hits.length}
                            </Typography>
                          )}
                        </Box>
                      );
                    })}
                  </Box>
                </Box>
              </>
            )}
          </Stack>
        </Box>
      </Drawer>

      {/* ===== Sheet: 排版 ===== */}
      <Drawer
        anchor="bottom"
        open={activeTab === 'layout'}
        onClose={closeSheet}
        PaperProps={{ sx: { borderTopLeftRadius: 16, borderTopRightRadius: 16, maxHeight: '85vh' } }}
      >
        <Box sx={{ p: 2 }}>
          <SheetHeader title="排版设置" onClose={closeSheet} />
          <Stack spacing={2}>
            {/* —— 方向 + 字号 同一行 —— */}
            <Box sx={{ display: 'flex', gap: 2, alignItems: 'stretch' }}>
              <Box sx={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.75 }}>
                  方向
                </Typography>
                <ToggleButtonGroup
                  exclusive
                  size="small"
                  fullWidth
                  value={layout.direction}
                  onChange={(_, v: JiziDirection | null) => v && update({ direction: v })}
                  sx={{
                    flex: 1,
                    '& .MuiToggleButton-root': {
                      flex: 1,
                      px: 0,
                      py: 0.5,
                      lineHeight: 1.1,
                      fontSize: 11,
                      flexDirection: 'column',
                      gap: 0.25,
                    },
                  }}
                >
                  <ToggleButton value="vertical-rl" aria-label="竖排右起">
                    <Box sx={{ fontSize: 14, fontFamily: 'monospace', letterSpacing: -1 }}>↓←</Box>
                    竖右
                  </ToggleButton>
                  <ToggleButton value="vertical-lr" aria-label="竖排左起">
                    <Box sx={{ fontSize: 14, fontFamily: 'monospace', letterSpacing: -1 }}>↓→</Box>
                    竖左
                  </ToggleButton>
                  <ToggleButton value="horizontal-lr" aria-label="横排左起">
                    <Box sx={{ fontSize: 14, fontFamily: 'monospace', letterSpacing: -1 }}>→↓</Box>
                    横左
                  </ToggleButton>
                  <ToggleButton value="horizontal-rl" aria-label="横排右起">
                    <Box sx={{ fontSize: 14, fontFamily: 'monospace', letterSpacing: -1 }}>←↓</Box>
                    横右
                  </ToggleButton>
                </ToggleButtonGroup>
              </Box>
              <Box sx={{ width: 120, display: 'flex', flexDirection: 'column' }}>
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.75 }}>
                  字号
                </Typography>
                <ToggleButtonGroup
                  exclusive
                  size="small"
                  fullWidth
                  value={layout.fontSize}
                  onChange={(_, v: number | null) => v && update({ fontSize: v })}
                  sx={{
                    flex: 1,
                    '& .MuiToggleButton-root': { flex: 1, px: 0, fontSize: 12 },
                  }}
                >
                  <ToggleButton value={80}>小</ToggleButton>
                  <ToggleButton value={120}>中</ToggleButton>
                  <ToggleButton value={160}>大</ToggleButton>
                </ToggleButtonGroup>
              </Box>
            </Box>

            <Divider sx={{ my: 0.5 }} />

            {/* —— 每行/列字数 —— */}
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
              <Typography variant="caption" color="text.secondary" sx={{ minWidth: 60 }}>
                {layout.direction.startsWith('vertical') ? '每列字数' : '每行字数'}
              </Typography>
              <Box sx={{ flex: 1, px: 0.5 }}>
                <Slider
                  size="small"
                  min={4}
                  max={20}
                  step={2}
                  marks
                  value={layout.colCount}
                  onChange={(_, v) => update({ colCount: v as number })}
                  valueLabelDisplay="auto"
                  valueLabelFormat={(v) => `${v} 字`}
                />
              </Box>
              <Typography variant="body2" sx={{ minWidth: 32, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                {layout.colCount}
              </Typography>
            </Box>

            <Divider sx={{ my: 0.5 }} />

            {/* —— 间距 + 紧凑模式 —— */}
            <Box>
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 0.5 }}>
                <Typography variant="caption" color="text.secondary">间距</Typography>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                  <Typography variant="caption" color={layout.compact ? 'primary.main' : 'text.secondary'} sx={{ fontWeight: layout.compact ? 600 : 400 }}>
                    紧凑模式
                  </Typography>
                  <Switch
                    size="small"
                    checked={layout.compact}
                    onChange={(e) => update({ compact: e.target.checked })}
                  />
                </Box>
              </Box>
              <Box sx={{ opacity: layout.compact ? 0.4 : 1, pointerEvents: layout.compact ? 'none' : 'auto', transition: 'opacity 0.2s' }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                  <Typography variant="caption" color="text.secondary" sx={{ minWidth: 32 }}>字距</Typography>
                  <Box sx={{ flex: 1, px: 0.5 }}>
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
                  <Typography variant="caption" sx={{ minWidth: 36, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                    {Math.round(layout.charGap * 100)}%
                  </Typography>
                </Box>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                  <Typography variant="caption" color="text.secondary" sx={{ minWidth: 32 }}>行距</Typography>
                  <Box sx={{ flex: 1, px: 0.5 }}>
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
                  <Typography variant="caption" sx={{ minWidth: 36, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                    {Math.round(layout.lineGap * 100)}%
                  </Typography>
                </Box>
              </Box>
            </Box>

            <Divider sx={{ my: 0.5 }} />

            {/* —— 背景：色块 —— */}
            <Box>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
                背景
              </Typography>
              <Box sx={{ display: 'flex', gap: 1.5, justifyContent: 'space-around', px: 1 }}>
                {([
                  { value: 'default', label: '渐变', color: '#e0e0e0' },
                  { value: 'xuan', label: '宣纸', color: '#f5ecd9' },
                  { value: 'white', label: '纯白', color: '#ffffff' },
                  { value: 'ink', label: '墨色', color: '#1a1a1a' },
                  { value: 'vermilion', label: '朱砂', color: '#8b0000' },
                ] as const).map((bg) => {
                  const active = layout.background === bg.value;
                  return (
                    <Box
                      key={bg.value}
                      onClick={() => update({ background: bg.value as JiziBackground })}
                      sx={{
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        gap: 0.5,
                        cursor: 'pointer',
                      }}
                    >
                      <Box
                        sx={{
                          width: 36,
                          height: 36,
                          borderRadius: '50%',
                          bgcolor: bg.color,
                          border: '2px solid',
                          borderColor: active ? 'primary.main' : 'rgba(0,0,0,0.12)',
                          boxShadow: active ? '0 0 0 2px rgba(25,118,210,0.2)' : 'inset 0 0 0 1px rgba(0,0,0,0.04)',
                          transition: 'all 0.15s',
                        }}
                      />
                      <Typography variant="caption" sx={{ fontSize: 10, color: active ? 'primary.main' : 'text.secondary', fontWeight: active ? 600 : 400 }}>
                        {bg.label}
                      </Typography>
                    </Box>
                  );
                })}
              </Box>
            </Box>

            <Box sx={{ display: 'flex', justifyContent: 'center', pt: 0.5 }}>
              <Button size="small" onClick={handleResetLayout} sx={{ color: 'text.secondary', textTransform: 'none' }}>
                恢复默认
              </Button>
            </Box>
          </Stack>
        </Box>
      </Drawer>

      {/* ===== Sheet: 预览 ===== */}
      <Drawer
        anchor="bottom"
        open={activeTab === 'preview'}
        onClose={closeSheet}
        PaperProps={{ sx: { borderTopLeftRadius: 16, borderTopRightRadius: 16 } }}
      >
        <Box sx={{ p: 2 }}>
          <SheetHeader title="预览与导出" onClose={closeSheet} />
          <Stack spacing={1.5}>
            <Button
              fullWidth
              variant="outlined"
              startIcon={<FullscreenIcon />}
              onClick={() => {
                closeSheet();
                setFullscreenOpen(true);
              }}
              disabled={!hasResults}
              sx={{ textTransform: 'none', py: 1.25 }}
            >
              全屏预览
            </Button>
            <Button
              fullWidth
              variant="contained"
              startIcon={exporting ? <CircularProgress size={16} color="inherit" /> : <DownloadIcon />}
              onClick={() => {
                closeSheet();
                handleExport();
              }}
              disabled={!hasResults || exporting}
              sx={{ textTransform: 'none', py: 1.25 }}
            >
              {exporting ? '导出中...' : '导出 PNG'}
            </Button>
            <Typography variant="caption" color="text.secondary" sx={{ textAlign: 'center', pt: 1 }}>
              也可点击预览区右下角的导出按钮
            </Typography>
          </Stack>
        </Box>
      </Drawer>

      {/* ===== 弹窗：变体选择（已有的 JiziSwitcherSheet） ===== */}
      <JiziSwitcherSheet
        open={switcherOpen}
        result={switcherIndex >= 0 ? filteredResults[switcherIndex] : null}
        selectedIndex={switcherIndex >= 0 ? selections[switcherIndex] ?? 0 : 0}
        onPick={handleSwitcherPick}
        onClose={() => setSwitcherOpen(false)}
      />

      {/* ===== 弹窗：全屏预览 ===== */}
      <JiziFullscreenPreview
        open={fullscreenOpen}
        onClose={() => setFullscreenOpen(false)}
        results={filteredResults}
        selections={selections}
        layout={layout}
        onOpenPicker={handleOpenPicker}
        onExport={handleExport}
        exporting={exporting}
        text={text}
      />

      {/* ===== 风格统一确认对话框 ===== */}
      <Dialog open={styleConfirmOpen} onClose={handleStyleCancel} maxWidth="xs" fullWidth>
        <DialogTitle>是否参考该字风格自动集字？</DialogTitle>
        <DialogContent>
          <DialogContentText>
            将根据所选字的字帖
            {pendingStyleHit?.deck_name && (
              <Typography component="span" sx={{ mx: 0.5, fontWeight: 500, color: 'primary.main' }}>
                《{pendingStyleHit.deck_name}》
              </Typography>
            )}
            {pendingStyleHit?.calligrapher && (
              <>
                / 书家
                <Typography component="span" sx={{ mx: 0.5, fontWeight: 500, color: 'primary.main' }}>
                  {pendingStyleHit.calligrapher}
                </Typography>
              </>
            )}
            自动匹配后续所有字。无匹配的字保持原状。
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleStyleCancel}>取消</Button>
          <Button variant="contained" onClick={handleStyleConfirm}>确认</Button>
        </DialogActions>
      </Dialog>

      {/* ===== 删除历史确认对话框 ===== */}
      <Dialog open={!!deleteConfirmId} onClose={() => setDeleteConfirmId(null)} maxWidth="xs" fullWidth>
        <DialogTitle>删除历史记录？</DialogTitle>
        <DialogContent>
          <DialogContentText>删除后无法恢复。</DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteConfirmId(null)}>取消</Button>
          <Button
            variant="contained"
            color="error"
            onClick={() => {
              const id = deleteConfirmId;
              setDeleteConfirmId(null);
              if (id) {
                deleteJiziHistory(id)
                  .then(() => {
                    store.setHistory(useJiziStore.getState().history.filter((h) => h.id !== id));
                  })
                  .catch((e) => console.error('delete history failed', e));
              }
            }}
          >
            删除
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default JiziPage;
