import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Box,
  Typography,
  Card,
  CardContent,
  CardActions,
  Button,
  Alert,
  LinearProgress,
  Chip,
  useMediaQuery,
  useTheme,
} from '@mui/material';
import RestartAltIcon from '@mui/icons-material/RestartAlt';
import SettingsIcon from '@mui/icons-material/Settings';
import PauseCircleIcon from '@mui/icons-material/PauseCircle';
import PlayCircleIcon from '@mui/icons-material/PlayCircle';
import LibraryBooksIcon from '@mui/icons-material/LibraryBooks';
import AutoStoriesIcon from '@mui/icons-material/AutoStories';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import { useDeckStore } from '@/stores/useDeckStore';
import { resetDeckProgress, forceResetDeckProgress, getImageUrl, toggleDeckPause } from '@/lib/api';
import OverviewPanel from '@/components/dashboard/OverviewPanel';
import { LoadingState, EmptyState } from '@/components/common/LoadingState';
import ConfirmDialog from '@/components/common/ConfirmDialog';

/**
 * 仪表盘页面。
 * 显示牌组列表入口。统计逻辑已抽离到 useDashboardStats：
 *  - PC 端由 AppShell 侧栏注入展示
 *  - 移动端仍在本页顶部渲染
 */
const DashboardPage: React.FC = () => {
  const navigate = useNavigate();
  const theme = useTheme();
  const isPc = useMediaQuery(theme.breakpoints.up('md'));
  const decks = useDeckStore((s) => s.decks);
  const loading = useDeckStore((s) => s.loading);
  const error = useDeckStore((s) => s.error);
  const loadDecks = useDeckStore((s) => s.loadDecks);

  const [resetTarget, setResetTarget] = useState<{ id: string; name: string } | null>(null);
  const [resetError, setResetError] = useState<string | null>(null);
  const [pauseTarget, setPauseTarget] = useState<{ id: string; name: string; paused: boolean } | null>(null);

  useEffect(() => {
    loadDecks(true);
  }, [loadDecks]);

  /** 确认暂停/恢复 */
  const handleConfirmPause = useCallback(async () => {
    if (!pauseTarget) return;
    try {
      await toggleDeckPause(pauseTarget.id, pauseTarget.paused);
      await loadDecks(true);
    } catch (err) {
      console.error('[Dashboard] 暂停/恢复失败:', err);
    } finally {
      setPauseTarget(null);
    }
  }, [pauseTarget, loadDecks]);

  /** 确认重置进度 */
  const handleConfirmReset = useCallback(async () => {
    if (!resetTarget) return;
    setResetError(null);
    try {
      // 先尝试重置；如果有进度，带上 force=1 再试
      let res = await resetDeckProgress(resetTarget.id);
      console.log('[Dashboard] 重置成功:', res);
      await loadDecks(true);
      setResetTarget(null);
    } catch (err: any) {
      const msg = err?.message || '';
      if (msg.includes('force=1') || msg.includes('409')) {
        // 有学习进度，自动用 force 重试
        try {
          const res = await forceResetDeckProgress(resetTarget.id);
          console.log('[Dashboard] 强制重置成功:', res);
          await loadDecks(true);
          setResetTarget(null);
          return;
        } catch (err2) {
          console.error('[Dashboard] 强制重置失败:', err2);
          setResetError(err2 instanceof Error ? err2.message : '强制重置失败');
        }
      } else {
        console.error('[Dashboard] 重置失败:', err);
        setResetError(msg || '重置失败');
      }
    } finally {
      setResetTarget(null);
    }
  }, [resetTarget, loadDecks]);

  // 错误状态
  if (error) {
    return (
      <Box className="py-4">
        <Alert severity="error" className="mb-4">
          {error}
        </Alert>
        <Button variant="outlined" onClick={() => loadDecks(true)}>
          重试
        </Button>
      </Box>
    );
  }

  // 加载状态
  if (loading) {
    return <LoadingState message="正在加载仪表盘..." />;
  }

  // 空状态
  if (!decks || decks.length === 0) {
    return (
      <EmptyState
        icon={<LibraryBooksIcon />}
        title="还没有牌组"
        description="创建你的第一个书法记忆牌组，开始学习之旅吧！"
        action={
          <Button variant="contained" onClick={() => navigate('/decks')}>
            前往创建
          </Button>
        }
      />
    );
  }

  return (
    <>
    <Box className="space-y-6 py-4">
      {/* 概览面板：仅移动端（PC 端由侧栏 OverviewPanel 注入） */}
      {!isPc && <OverviewPanel />}

      {/* 牌组列表：宽度撑满主区，卡片列数按容器宽度自动计算 */}
      <Box sx={{ width: '100%' }}>
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            mb: 2,
            transform: 'translateY(-16px)',
          }}
        >
          <Typography variant="h6" className="font-kai" sx={{ fontWeight: 600 }}>
            我的牌组
          </Typography>
          <Button
            size="small"
            startIcon={<LibraryBooksIcon />}
            onClick={() => navigate('/decks')}
            sx={{ textTransform: 'none' }}
          >
            管理牌组
          </Button>
        </Box>
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: '1fr',
            gap: 2,
            alignItems: 'stretch',
          }}
        >
          {decks.map((deck) => {
            const reviewProgress = deck.card_count > 0
              ? Math.round(((deck.card_count - (deck.new_count ?? deck.card_count)) / deck.card_count) * 100)
              : 0;
            return (
              <Card
                key={deck.id}
                variant="outlined"
                className="cursor-pointer"
                sx={{ borderColor: 'divider', '&:hover': { borderColor: 'text.disabled' } }}
                onClick={() => navigate(`/study/${deck.id}`)}
              >
                <CardContent className="flex items-center gap-4 !pb-2">
                  <Box
                    className="flex items-center justify-center w-12 h-12 shrink-0 overflow-hidden"
                    sx={{ bgcolor: deck.cover_image ? 'transparent' : 'primary.main', color: '#fff', borderRadius: '2px' }}
                  >
                    {deck.cover_image ? (
                      <Box component="img" src={getImageUrl(deck.cover_image)} alt={deck.name}
                        sx={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    ) : (
                      <AutoStoriesIcon />
                    )}
                  </Box>
                  <Box className="flex-1 min-w-0">
                    <Box className="flex items-center justify-between mb-1">
                      <Typography variant="subtitle1" fontWeight={600} noWrap>
                        {deck.name}
                      </Typography>

                      <Box className="flex items-center gap-2 shrink-0 ml-2">
                        <Typography variant="body2" color="text.secondary" fontWeight={500}>
                          {deck.card_count} 张
                        </Typography>
                        <Chip
                          label={deck.card_count > 0 ? ((deck.new_count ?? deck.card_count) < deck.card_count ? `${reviewProgress}%` : '新牌组') : '空'}
                          size="small"
                          sx={(t) => ({
                            fontSize: 11,
                            height: 22,
                            bgcolor: reviewProgress > 0 ? 'primary.main' : (t.palette.mode === 'dark' ? 'rgba(255,255,255,0.12)' : 'grey.200'),
                            color: reviewProgress > 0 ? '#fff' : (t.palette.mode === 'dark' ? 'rgba(255,255,255,0.7)' : 'text.secondary'),
                          })}
                        />
                      </Box>
                    </Box>
                    {deck.card_count > 0 && (
                      <LinearProgress
                        variant="determinate"
                        value={reviewProgress}
                        sx={{
                          height: 6,
                          borderRadius: '2px',
                          bgcolor: 'action.hover',
                          '& .MuiLinearProgress-bar': { borderRadius: '2px' },
                        }}
                      />
                    )}
                  </Box>
                </CardContent>
                <Box className="px-4 pt-0 pb-1">
                  {deck.paused_at ? (
                    <Chip label="已暂停" size="small" variant="outlined" icon={<PauseCircleIcon />}
                      sx={{ fontSize: 11, height: 22 }} />
                  ) : (
                    <Typography variant="caption" color="text.secondary">
                      新卡 {(deck as any).new_available_today ?? deck.daily_new_card_limit ?? 20} · 复习 {(deck as any).due_count ?? 0}
                    </Typography>
                  )}
                </Box>
                <CardActions className="flex items-center px-4 pt-1 pb-3 gap-1">
                  <Box
                    onClick={(e) => { e.stopPropagation(); if (!deck.paused_at) navigate(`/study/${deck.id}`); }}
                    sx={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 0.5,
                      px: 1.5,
                      py: 0.4,
                      borderRadius: '2px',
                      fontSize: 13,
                      fontWeight: 600,
                      color: deck.card_count === 0 || deck.paused_at ? 'text.disabled' : 'primary.main',
                      bgcolor: 'transparent',
                      border: '1px solid',
                      borderColor: deck.card_count === 0 || deck.paused_at ? 'divider' : 'primary.main',
                      cursor: deck.card_count === 0 || deck.paused_at ? 'not-allowed' : 'pointer',
                      transition: 'background-color 0.15s ease',
                      userSelect: 'none',
                      '&:hover': {
                        bgcolor: deck.card_count === 0 || deck.paused_at ? 'transparent' : 'primary.main',
                        color: deck.card_count === 0 || deck.paused_at ? 'text.disabled' : 'primary.contrastText',
                      },
                      pointerEvents: deck.card_count === 0 || deck.paused_at ? 'none' : 'auto',
                    }}
                  >
                    <PlayArrowIcon sx={{ fontSize: 15 }} />
                    开始学习
                  </Box>
                  <Box sx={{ flex: 1 }} />
                  <Button
                    size="small"
                    startIcon={<SettingsIcon />}
                    onClick={(e) => { e.stopPropagation(); navigate(`/decks/${deck.id}/cards`); }}
                    sx={{ textTransform: 'none', minWidth: 0 }}
                  >
                    管理
                  </Button>
                  <Button
                    size="small"
                    color="inherit"
                    startIcon={deck.paused_at ? <PlayCircleIcon /> : <PauseCircleIcon />}
                    onClick={(e) => { e.stopPropagation(); setPauseTarget({ id: deck.id, name: deck.name, paused: !deck.paused_at }); }}
                    sx={{ textTransform: 'none', minWidth: 0, color: 'text.secondary' }}
                  >
                    {deck.paused_at ? '恢复' : '暂停'}
                  </Button>
                  <Button
                    size="small"
                    color="error"
                    startIcon={<RestartAltIcon />}
                    onClick={(e) => { e.stopPropagation(); setResetTarget({ id: deck.id, name: deck.name }); }}
                    disabled={deck.card_count === 0}
                    sx={{ textTransform: 'none', minWidth: 0 }}
                  >
                    重置
                  </Button>
                </CardActions>
              </Card>
            );
          })}
        </Box>
      </Box>
    </Box>

    {/* 重置进度确认对话框 */}
    <ConfirmDialog
      open={!!resetTarget}
      title="重置学习进度"
      message={resetError || `确定要重置「${resetTarget?.name ?? ''}」的所有学习进度吗？所有卡片将恢复到未学习状态，此操作不可撤销。`}
      onConfirm={handleConfirmReset}
      onCancel={() => { setResetTarget(null); setResetError(null); }}
    />

    {/* 暂停/恢复确认对话框 */}
    <ConfirmDialog
      open={!!pauseTarget}
      title={pauseTarget?.paused ? '暂停学习' : '恢复学习'}
      message={pauseTarget?.paused
        ? `确定要暂停「${pauseTarget?.name ?? ''}」吗？暂停后不再推送新的学习和复习卡片，可随时恢复。`
        : `确定要恢复「${pauseTarget?.name ?? ''}」吗？恢复后会继续推送到期卡片。`}
      onConfirm={handleConfirmPause}
      onCancel={() => setPauseTarget(null)}
    />
    </>
  );
};

export default DashboardPage;
