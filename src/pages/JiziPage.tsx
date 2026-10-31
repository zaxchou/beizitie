import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  Box,
  Typography,
  Button,
  Drawer,
  Alert,
  CircularProgress,
  Slider,
  Fab,
  Paper,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogContentText,
  DialogActions,
} from '@mui/material';
import EditIcon from '@mui/icons-material/Edit';
import StyleIcon from '@mui/icons-material/Style';
import DashboardIcon from '@mui/icons-material/Dashboard';
import VisibilityIcon from '@mui/icons-material/Visibility';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import CloseIcon from '@mui/icons-material/Close';
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

const MONO = { fontFamily: 'var(--font-mono)', letterSpacing: '0.04em' } as const;

/** 底部抽屉统一：直角 + 2px 墨线上边 + 88vh 上限 */
const drawerPaper = {
  borderTopLeftRadius: 0,
  borderTopRightRadius: 0,
  borderTop: '2px solid',
  borderColor: 'text.primary',
  maxHeight: '88vh',
} as const;

/** 表单小标签：等宽、小号、字距放开 */
const labelSx = {
  ...MONO,
  fontSize: 9.5,
  letterSpacing: '0.14em',
  textTransform: 'uppercase',
  opacity: 0.6,
  display: 'block',
  mb: 0.75,
} as const;

const linkBtnSx = {
  border: 0,
  background: 'none',
  color: 'inherit',
  p: 0,
  cursor: 'pointer',
  ...MONO,
  fontSize: 11,
  '&:hover': { textDecoration: 'underline' },
} as const;

const stepBtnSx = {
  width: 34,
  height: 32,
  border: 0,
  bgcolor: 'transparent',
  color: 'inherit',
  cursor: 'pointer',
  fontSize: 15,
  lineHeight: 1,
  '&:hover': { bgcolor: 'text.primary', color: 'background.default' },
} as const;

const sliderSx = {
  height: 2,
  '& .MuiSlider-rail': { bgcolor: 'divider', opacity: 1 },
  '& .MuiSlider-track': { border: 0, color: 'text.primary' },
  '& .MuiSlider-thumb': {
    width: 9,
    height: 9,
    borderRadius: 0,
    color: 'text.primary',
    '&:hover, &.Mui-focusVisible, &.Mui-active': { boxShadow: 'none' },
  },
  '& .MuiSlider-valueLabel': { borderRadius: 0, fontFamily: 'var(--font-mono)', fontSize: 10 },
} as const;

/** Sheet 顶部标题栏：标题 + 方框关闭，下面一条墨线 */
const SheetHeader: React.FC<{ title: string; onClose: () => void }> = ({ title, onClose }) => (
  <Box sx={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', pb: 1.25, mb: 1.75, borderBottom: '1px solid', borderColor: 'text.primary' }}>
    <Typography component="h2" sx={{ fontSize: 20, fontWeight: 900, letterSpacing: '0.08em', lineHeight: 1.1 }}>{title}</Typography>
    <Box
      component="button"
      type="button"
      onClick={onClose}
      aria-label="关闭"
      sx={{
        border: '1px solid',
        borderColor: 'text.primary',
        bgcolor: 'transparent',
        color: 'inherit',
        width: 28,
        height: 28,
        p: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: 'pointer',
        '&:hover': { bgcolor: 'text.primary', color: 'background.default' },
      }}
    >
      <CloseIcon sx={{ fontSize: 16 }} />
    </Box>
  </Box>
);

const JiziPage: React.FC = () => {
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
              bgcolor: 'background.paper',
              border: '1px solid',
              borderColor: 'text.primary',
              px: 1.25, py: '2px',
              fontFamily: 'var(--font-mono)',
              fontSize: 10.5,
              letterSpacing: '0.04em',
              color: 'text.primary',
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
                borderRadius: 0,
                border: '1px solid',
                borderColor: 'text.primary',
                bgcolor: 'background.paper',
                color: 'text.primary',
                boxShadow: 'none',
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
                elevation={0}
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
                  height: 42,
                  border: '1px solid',
                  borderColor: 'text.primary',
                  bgcolor: activeTab === btn.value ? 'text.primary' : 'background.paper',
                  color: activeTab === btn.value ? 'background.default' : 'text.primary',
                  transition: 'background-color 0.15s ease, color 0.15s ease',
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
            borderRadius: 0,
            border: '1px solid',
            borderColor: 'text.primary',
            bgcolor: 'background.paper',
            color: 'text.primary',
            boxShadow: 'none',
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
            <Typography sx={{ fontSize: 40, fontWeight: 900, letterSpacing: '0.16em', color: 'text.primary', lineHeight: 1 }}>
              集字
            </Typography>
            <Typography sx={{ fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '0.04em' }}>
              输入文字后这里会显示集字预览
            </Typography>
            <Typography sx={{ fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.04em', opacity: 0.6 }}>
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
        PaperProps={{ sx: drawerPaper }}
      >
        <Box sx={{ p: { xs: 2, md: '18px 28px 24px' }, width: '100%', maxWidth: 780, mx: 'auto' }}>
          <SheetHeader title="编辑文字" onClose={closeSheet} />

          <Box sx={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', mb: 0.75 }}>
            <Typography sx={labelSx}>集字内容 · Text</Typography>
            <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1.25 }}>
              {text && (
                <Box component="button" type="button" onClick={() => store.setText('')} sx={linkBtnSx}>
                  清空
                </Box>
              )}
              <JiziPresetButton onSelect={store.setText} />
            </Box>
          </Box>
          <Box
            component="textarea"
            value={text}
            onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => store.setText(e.target.value)}
            placeholder="输入诗句，如：春江潮水连海平"
            rows={4}
            sx={{
              width: '100%',
              resize: 'none',
              border: '1px solid',
              borderColor: 'text.primary',
              bgcolor: 'transparent',
              color: 'text.primary',
              p: '10px 12px',
              fontSize: 15,
              lineHeight: 1.9,
              letterSpacing: '0.05em',
              outline: 'none',
              fontFamily: 'inherit',
              '&::placeholder': { color: 'text.disabled' },
            }}
          />
          <Typography sx={{ ...MONO, fontSize: 10, opacity: 0.55, mt: 0.75 }}>
            支持中文汉字，标点自动忽略，最多 500 字
          </Typography>
          <Button
            fullWidth
            variant="contained"
            onClick={handleMatch}
            disabled={loading || !text.trim()}
            sx={{ mt: 1.75, height: 48, justifyContent: 'space-between', px: 2.25 }}
          >
            <span>{loading ? '集字中…' : '开始集字'}</span>
            <span aria-hidden>→</span>
          </Button>

          {isLoggedIn && history.length > 0 && (
            <Box sx={{ mt: 2.5 }}>
              <Typography sx={labelSx}>历史记录 · History</Typography>
              <Box sx={{ borderTop: '1px solid', borderColor: 'text.primary' }}>
                {history.map((item) => {
                  const firstLine = item.text.split('\n')[0];
                  const display = firstLine.length > 30 ? firstLine.slice(0, 30) + '…' : firstLine;
                  const date = item.created_at.slice(0, 10);
                  return (
                    <Box
                      key={item.id}
                      sx={{ display: 'flex', alignItems: 'center', gap: 1.5, py: 0.9, borderBottom: '1px solid', borderColor: 'divider' }}
                    >
                      <Box
                        component="button"
                        type="button"
                        onClick={() => store.setText(item.text)}
                        sx={{
                          flex: 1,
                          minWidth: 0,
                          textAlign: 'left',
                          border: 0,
                          background: 'none',
                          color: 'inherit',
                          p: 0,
                          cursor: 'pointer',
                          fontSize: 13,
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          '&:hover': { textDecoration: 'underline' },
                        }}
                      >
                        {display}
                      </Box>
                      <Typography sx={{ ...MONO, fontSize: 10, opacity: 0.5, flexShrink: 0 }}>{date}</Typography>
                      <Box
                        component="button"
                        type="button"
                        onClick={() => setDeleteConfirmId(item.id)}
                        sx={{ ...linkBtnSx, flexShrink: 0, opacity: 0.55, '&:hover': { opacity: 1, color: 'var(--hot-ink)' } }}
                      >
                        删除
                      </Box>
                    </Box>
                  );
                })}
              </Box>
            </Box>
          )}
        </Box>
      </Drawer>

      {/* ===== Sheet: 选择 ===== */}
      <Drawer
        anchor="bottom"
        open={activeTab === 'select'}
        onClose={closeSheet}
        PaperProps={{ sx: drawerPaper }}
      >
        <Box sx={{ p: { xs: 2, md: '18px 28px 24px' }, width: '100%', maxWidth: 780, mx: 'auto' }}>
          <SheetHeader title="选择风格" onClose={closeSheet} />

          {filters.styles.length > 0 && (
            <Box sx={{ mb: 2.25 }}>
              <Typography sx={labelSx}>书体 · Style</Typography>
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75 }}>
                {['', ...filters.styles].map((s) => {
                  const on = (s === '' && !styleFilter) || styleFilter === s;
                  return (
                    <Box
                      key={s || 'all'}
                      component="button"
                      type="button"
                      onClick={() => store.setStyleFilter(s)}
                      aria-pressed={on}
                      sx={{
                        border: '1px solid',
                        borderColor: on ? 'text.primary' : 'divider',
                        bgcolor: on ? 'text.primary' : 'transparent',
                        color: on ? 'background.default' : 'inherit',
                        ...MONO,
                        fontSize: 11,
                        height: 28,
                        px: 1.1,
                        cursor: 'pointer',
                        '&:hover': on ? {} : { borderColor: 'text.primary' },
                      }}
                    >
                      {s || '全部'}
                    </Box>
                  );
                })}
              </Box>
            </Box>
          )}

          {filters.calligraphers.length > 0 && (
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 2, py: 1.25, borderTop: '1px solid', borderBottom: '1px solid', borderColor: 'divider', mb: 2.25 }}>
              <Typography sx={{ fontSize: 13 }}>书家<Box component="span" sx={{ ...MONO, fontSize: 9.5, opacity: 0.55, ml: 0.75 }}>ARTIST</Box></Typography>
              <Box
                component="select"
                value={calligrapherFilter || ''}
                onChange={(e: React.ChangeEvent<HTMLSelectElement>) => store.setCalligrapherFilter(e.target.value)}
                aria-label="选择书家"
                sx={{
                  border: 0,
                  borderBottom: '1px solid',
                  borderColor: 'text.primary',
                  background: 'transparent',
                  color: 'text.primary',
                  ...MONO,
                  fontSize: 11,
                  py: '3px',
                  pr: '16px',
                  maxWidth: 200,
                  outline: 'none',
                  cursor: 'pointer',
                }}
              >
                <option value="">全部书家</option>
                {filters.calligraphers.map((name) => (
                  <option key={name} value={name}>{name}</option>
                ))}
              </Box>
            </Box>
          )}

          {hasResults && (
            <Box>
              <Typography sx={labelSx}>逐字调整 · Per character</Typography>
              <Typography sx={{ ...MONO, fontSize: 10, opacity: 0.55, mb: 1.25 }}>
                点击任一文字，可切换写法
              </Typography>
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75 }}>
                {filteredResults.map((r, i) => {
                  const sel = selections[i] ?? 0;
                  const hit = r.hits[sel];
                  if (!hit) return null;
                  return (
                    <Box
                      key={i}
                      onClick={() => handleOpenPickerFromList(i)}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          handleOpenPickerFromList(i);
                        }
                      }}
                      sx={{
                        position: 'relative',
                        cursor: 'pointer',
                        border: '1px solid',
                        borderColor: 'text.primary',
                        width: 58,
                        height: 58,
                        overflow: 'hidden',
                        '&:hover': { bgcolor: 'text.primary', color: 'background.default' },
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
                            ...MONO,
                            fontSize: 8,
                            bgcolor: 'background.paper',
                            color: 'text.primary',
                            px: 0.3,
                            lineHeight: 1.3,
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
          )}
        </Box>
      </Drawer>

      {/* ===== Sheet: 排版 ===== */}
      <Drawer
        anchor="bottom"
        open={activeTab === 'layout'}
        onClose={closeSheet}
        PaperProps={{ sx: drawerPaper }}
      >
        <Box sx={{ p: { xs: 2, md: '18px 28px 24px' }, width: '100%', maxWidth: 780, mx: 'auto' }}>
          <SheetHeader title="排版设置" onClose={closeSheet} />

          {/* 方向 */}
          <Typography sx={labelSx}>方向 · Direction</Typography>
          <Box sx={{ display: 'flex', mb: 2.25 }}>
            {([
              { value: 'vertical-rl', glyph: '↓←', label: '竖右' },
              { value: 'vertical-lr', glyph: '↓→', label: '竖左' },
              { value: 'horizontal-lr', glyph: '→↓', label: '横左' },
              { value: 'horizontal-rl', glyph: '←↓', label: '横右' },
            ] as const).map((d, i) => {
              const on = layout.direction === d.value;
              return (
                <Box
                  key={d.value}
                  component="button"
                  type="button"
                  onClick={() => update({ direction: d.value as JiziDirection })}
                  aria-pressed={on}
                  aria-label={`${d.label}排`}
                  sx={{
                    flex: 1,
                    border: '1px solid',
                    borderColor: on ? 'text.primary' : 'divider',
                    borderLeftWidth: i === 0 ? 1 : 0,
                    bgcolor: on ? 'text.primary' : 'transparent',
                    color: on ? 'background.default' : 'inherit',
                    height: 54,
                    cursor: 'pointer',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 0.5,
                    '&:hover': on ? {} : { borderColor: 'text.primary' },
                  }}
                >
                  <Box component="span" sx={{ fontFamily: 'monospace', fontSize: 14, letterSpacing: -1 }}>{d.glyph}</Box>
                  <Box component="span" sx={{ ...MONO, fontSize: 10 }}>{d.label}</Box>
                </Box>
              );
            })}
          </Box>

          {/* 字号 */}
          <Typography sx={labelSx}>字号 · Size</Typography>
          <Box sx={{ display: 'flex', mb: 1 }}>
            {([
              { value: 80, label: '小' },
              { value: 120, label: '中' },
              { value: 160, label: '大' },
            ] as const).map((s, i) => {
              const on = layout.fontSize === s.value;
              return (
                <Box
                  key={s.value}
                  component="button"
                  type="button"
                  onClick={() => update({ fontSize: s.value })}
                  aria-pressed={on}
                  sx={{
                    flex: 1,
                    border: '1px solid',
                    borderColor: on ? 'text.primary' : 'divider',
                    borderLeftWidth: i === 0 ? 1 : 0,
                    bgcolor: on ? 'text.primary' : 'transparent',
                    color: on ? 'background.default' : 'inherit',
                    height: 34,
                    cursor: 'pointer',
                    fontSize: 13,
                    '&:hover': on ? {} : { borderColor: 'text.primary' },
                  }}
                >
                  {s.label}
                </Box>
              );
            })}
          </Box>

          {/* 每列/行字数 */}
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', py: 1.5, borderTop: '1px solid', borderColor: 'divider', mt: 1.5 }}>
            <Typography sx={{ fontSize: 13 }}>
              {layout.direction.startsWith('vertical') ? '每列字数' : '每行字数'}
              <Box component="span" sx={{ ...MONO, fontSize: 9.5, opacity: 0.55, ml: 0.75 }}>PER LINE</Box>
            </Typography>
            <Box sx={{ display: 'flex', alignItems: 'center', border: '2px solid', borderColor: 'text.primary' }}>
              <Box
                component="button"
                type="button"
                aria-label="减少每行字数"
                onClick={() => update({ colCount: Math.max(4, layout.colCount - 2) })}
                sx={stepBtnSx}
              >
                −
              </Box>
              <Box sx={{ width: 52, textAlign: 'center', ...MONO, fontSize: 14, fontVariantNumeric: 'tabular-nums' }}>
                {layout.colCount}
              </Box>
              <Box
                component="button"
                type="button"
                aria-label="增加每行字数"
                onClick={() => update({ colCount: Math.min(20, layout.colCount + 2) })}
                sx={stepBtnSx}
              >
                ＋
              </Box>
            </Box>
          </Box>

          {/* 间距 */}
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', py: 1.5, borderTop: '1px solid', borderBottom: '1px solid', borderColor: 'divider' }}>
            <Box>
              <Typography sx={{ fontSize: 13 }}>间距</Typography>
              <Typography sx={{ ...MONO, fontSize: 9.5, opacity: 0.55, mt: 0.25 }}>字距 / 行距</Typography>
            </Box>
            <Box
              component="button"
              type="button"
              onClick={() => update({ compact: !layout.compact })}
              aria-pressed={layout.compact}
              sx={{
                border: '1px solid',
                borderColor: 'text.primary',
                bgcolor: layout.compact ? 'text.primary' : 'transparent',
                color: layout.compact ? 'background.default' : 'inherit',
                ...MONO,
                fontSize: 11,
                height: 28,
                px: 1.25,
                cursor: 'pointer',
              }}
            >
              {layout.compact ? '紧凑' : '常规'}
            </Box>
          </Box>

          <Box sx={{ opacity: layout.compact ? 0.35 : 1, pointerEvents: layout.compact ? 'none' : 'auto', transition: 'opacity 0.2s', py: 1.25 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
              <Typography sx={{ ...MONO, fontSize: 10, minWidth: 32, opacity: 0.7 }}>字距</Typography>
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
                  sx={sliderSx}
                />
              </Box>
              <Typography sx={{ ...MONO, fontSize: 10, minWidth: 36, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                {Math.round(layout.charGap * 100)}%
              </Typography>
            </Box>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
              <Typography sx={{ ...MONO, fontSize: 10, minWidth: 32, opacity: 0.7 }}>行距</Typography>
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
                  sx={sliderSx}
                />
              </Box>
              <Typography sx={{ ...MONO, fontSize: 10, minWidth: 36, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                {Math.round(layout.lineGap * 100)}%
              </Typography>
            </Box>
          </Box>

          {/* 背景 */}
          <Typography sx={{ ...labelSx, mt: 1 }}>背景 · Ground</Typography>
          <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
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
                  component="button"
                  type="button"
                  onClick={() => update({ background: bg.value as JiziBackground })}
                  aria-pressed={active}
                  sx={{
                    border: '1px solid',
                    borderColor: active ? 'var(--hot-ink)' : 'divider',
                    background: 'none',
                    p: 0.5,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 0.75,
                  }}
                >
                  <Box sx={{ width: 18, height: 18, bgcolor: bg.color, border: '1px solid', borderColor: 'divider' }} />
                  <Box component="span" sx={{ ...MONO, fontSize: 10, color: active ? 'var(--hot-ink)' : 'inherit', opacity: active ? 1 : 0.7 }}>
                    {bg.label}
                  </Box>
                </Box>
              );
            })}
          </Box>

          <Box sx={{ display: 'flex', justifyContent: 'flex-end', mt: 1.5 }}>
            <Box component="button" type="button" onClick={handleResetLayout} sx={linkBtnSx}>
              恢复默认
            </Box>
          </Box>
        </Box>
      </Drawer>

      {/* ===== Sheet: 预览 ===== */}
      <Drawer
        anchor="bottom"
        open={activeTab === 'preview'}
        onClose={closeSheet}
        PaperProps={{ sx: drawerPaper }}
      >
        <Box sx={{ p: { xs: 2, md: '18px 28px 24px' }, width: '100%', maxWidth: 780, mx: 'auto' }}>
          <SheetHeader title="预览与导出" onClose={closeSheet} />
          <Button
            fullWidth
            variant="outlined"
            onClick={() => {
              closeSheet();
              setFullscreenOpen(true);
            }}
            disabled={!hasResults}
            sx={{ height: 46, justifyContent: 'space-between', px: 2.25 }}
          >
            <span>全屏预览</span>
            <span aria-hidden>↗</span>
          </Button>
          <Button
            fullWidth
            variant="contained"
            onClick={() => {
              closeSheet();
              handleExport();
            }}
            disabled={!hasResults || exporting}
            sx={{ mt: 1, height: 46, justifyContent: 'space-between', px: 2.25 }}
          >
            <span>{exporting ? '导出中…' : '导出 PNG'}</span>
            <span aria-hidden>↓</span>
          </Button>
          <Typography sx={{ ...MONO, fontSize: 10, opacity: 0.55, textAlign: 'center', pt: 1.5 }}>
            也可点预览区右下角的导出按钮
          </Typography>
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
