import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Box,
  Typography,
  TextField,
  Button,
  List,
  ListItem,
  ListItemButton,
  ListItemText,
  IconButton,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogContentText,
  DialogActions,
  Alert,
  Card,
  CircularProgress,
} from '@mui/material';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import AddIcon from '@mui/icons-material/Add';
import LibraryBooksIcon from '@mui/icons-material/LibraryBooks';
import StoreIcon from '@mui/icons-material/Store';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import { useDeckStore } from '@/stores/useDeckStore';
import { useAuthStore } from '@/stores/useAuthStore';
import ConfirmDialog from '@/components/common/ConfirmDialog';
import EditDeckDialog from '@/components/market/EditDeckDialog';
import { LoadingState, EmptyState } from '@/components/common/LoadingState';
import { publishDeck, unpublishDeck } from '@/lib/api';
import type { Deck } from '@/types';

/**
 * 牌组管理页面。
 * 支持创建、重命名、删除牌组。
 */
const DecksPage: React.FC = () => {
  const navigate = useNavigate();
  const { decks, loading, error, loadDecks, createDeck, deleteDeck, clearError } =
    useDeckStore();
  const { user } = useAuthStore();
  const isAdmin = user?.role === 'admin';

  const [newDeckName, setNewDeckName] = useState('');
  const [creating, setCreating] = useState(false);

  // 发布/撤回操作的错误（独立于 store 的 error）
  const [actionError, setActionError] = useState<string | null>(null);

  // 编辑对话框状态
  const [editTarget, setEditTarget] = useState<{ id: string; name: string } | null>(null);

  // 删除确认对话框状态
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);
  const [deleteTargetName, setDeleteTargetName] = useState('');

  // 发布相关
  const [publishingId, setPublishingId] = useState<string | null>(null);
  const [unpubConfirmDeck, setUnpubConfirmDeck] = useState<Deck | null>(null);
  const [unpublishing, setUnpublishing] = useState(false);

  /** 发布到市场 */
  const handlePublish = useCallback(async (deck: Deck) => {
    if (publishingId) return;
    setPublishingId(deck.id);
    try {
      await publishDeck(deck.id, { calligrapher: '', dynasty: '', style: '', description: '', cover_image: '', featured: false });
      await loadDecks();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : '发布失败');
    } finally {
      setPublishingId(null);
    }
  }, [publishingId, loadDecks]);

  /** 确认撤回 */
  const handleConfirmUnpublish = useCallback(async () => {
    if (!unpubConfirmDeck || unpublishing) return;
    setUnpublishing(true);
    try {
      await unpublishDeck(unpubConfirmDeck.id);
      setUnpubConfirmDeck(null);
      await loadDecks();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : '撤回失败');
    } finally {
      setUnpublishing(false);
    }
  }, [unpubConfirmDeck, unpublishing, loadDecks]);

  useEffect(() => {
    loadDecks();
  }, [loadDecks]);

  /** 创建新牌组 */
  const handleCreate = useCallback(async () => {
    if (!newDeckName.trim() || creating) return;
    setCreating(true);
    await createDeck(newDeckName.trim());
    setNewDeckName('');
    setCreating(false);
  }, [newDeckName, creating, createDeck]);

  /** 按回车创建 */
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        handleCreate();
      }
    },
    [handleCreate]
  );

  /** 打开编辑对话框 */
  const handleOpenEdit = useCallback((id: string, name: string) => {
    setEditTarget({ id, name });
  }, []);

  /** 打开删除确认对话框 */
  const handleOpenDelete = useCallback((id: string, name: string) => {
    setDeleteTargetId(id);
    setDeleteTargetName(name);
    setDeleteDialogOpen(true);
  }, []);

  /** 确认删除 */
  const handleConfirmDelete = useCallback(async () => {
    if (deleteTargetId) {
      await deleteDeck(deleteTargetId);
    }
    setDeleteDialogOpen(false);
    setDeleteTargetId(null);
    setDeleteTargetName('');
  }, [deleteTargetId, deleteDeck]);

  /** 取消删除 */
  const handleCancelDelete = useCallback(() => {
    setDeleteDialogOpen(false);
    setDeleteTargetId(null);
    setDeleteTargetName('');
  }, []);

  // 加载状态
  if (loading) {
    return <LoadingState message="正在加载牌组列表..." />;
  }

  return (
    <Box className="space-y-4 py-4">
      <Typography variant="h5" className="font-kai">
        牌组管理
      </Typography>

      {/* 错误提示 */}
      {error && (
        <Alert severity="error" onClose={() => clearError()}>
          {error}
        </Alert>
      )}
      {actionError && (
        <Alert severity="error" onClose={() => setActionError(null)}>
          {actionError}
        </Alert>
      )}

      {/* 创建牌组输入区（仅管理员） */}
      {isAdmin && (
      <Card variant="outlined" className="p-4" sx={{ borderRadius: 2, bgcolor: 'background.paper' }}>
        <Box className="flex gap-2">
          <TextField
            label="新牌组名称"
            size="medium"
            fullWidth
            value={newDeckName}
            onChange={(e) => setNewDeckName(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="输入牌组名称..."
            disabled={creating}
            inputProps={{ maxLength: 50 }}
          />
          <Button
            variant="contained"
            startIcon={creating ? <CircularProgress size={20} color="inherit" /> : <AddIcon />}
            onClick={handleCreate}
            disabled={!newDeckName.trim() || creating}
            className="shrink-0"
          >
            创建
          </Button>
        </Box>
      </Card>
      )}

      {/* 牌组列表或空状态 */}
      {!decks || decks.length === 0 ? (
        <EmptyState
          icon={<LibraryBooksIcon />}
          title="还没有牌组"
          description="点击上方按钮创建你的第一个书法记忆牌组"
        />
      ) : (
        <Card variant="outlined" sx={{ borderRadius: 2 }}>
          <List disablePadding>
            {decks.map((deck, index) => {
              const isPublished = !!deck.published_at;
              return (
              <ListItem
                key={deck.id}
                divider={index < decks.length - 1}
                disablePadding
                secondaryAction={
                  <Box className="flex items-center">
                    {isAdmin && (
                      <IconButton
                        edge="end"
                        aria-label={isPublished ? '撤回' : '发布'}
                        onClick={(e) => {
                          e.stopPropagation();
                          if (isPublished) {
                            setUnpubConfirmDeck(deck);
                          } else {
                            handlePublish(deck);
                          }
                        }}
                        size="small"
                        disabled={publishingId === deck.id}
                        sx={{ color: isPublished ? 'success.main' : 'action.disabled' }}
                      >
                        {publishingId === deck.id ? (
                          <CircularProgress size={16} />
                        ) : isPublished ? (
                          <CheckCircleIcon fontSize="small" />
                        ) : (
                          <StoreIcon fontSize="small" />
                        )}
                      </IconButton>
                    )}
                    {isAdmin && (
                      <IconButton
                        edge="end"
                        aria-label={`重命名 ${deck.name}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleOpenEdit(deck.id, deck.name);
                        }}
                        size="small"
                        className="mr-1"
                      >
                        <EditIcon fontSize="small" />
                      </IconButton>
                    )}
                    {isAdmin && (
                      <IconButton
                        edge="end"
                        aria-label={`删除 ${deck.name}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleOpenDelete(deck.id, deck.name);
                        }}
                        size="small"
                        color="error"
                      >
                        <DeleteIcon fontSize="small" />
                      </IconButton>
                    )}
                  </Box>
                }
              >
                <ListItemButton
                  onClick={() => navigate(`/decks/${deck.id}/cards`)}
                  className="px-4 py-3"
                >
                  <ListItemText
                    primary={
                      <Typography variant="subtitle1" className="font-kai">
                        {deck.name}
                      </Typography>
                    }
                    secondary={`${deck.card_count} 张卡片`}
                  />
                </ListItemButton>
              </ListItem>
              );
            })}
          </List>
        </Card>
      )}

      {/* 编辑对话框 */}
      <EditDeckDialog
        deckId={editTarget?.id ?? null}
        deckName={editTarget?.name ?? ''}
        open={!!editTarget}
        publishMode={false}
        onClose={() => setEditTarget(null)}
        onSaved={() => { setEditTarget(null); loadDecks(); }}
      />

      {/* 删除确认对话框 */}
      <ConfirmDialog
        open={deleteDialogOpen}
        title="删除牌组"
        message={`确定要删除「${deleteTargetName}」吗？牌组中的所有卡片将被永久删除，此操作不可撤销。`}
        onConfirm={handleConfirmDelete}
        onCancel={handleCancelDelete}
      />

      {/* 撤回确认对话框 */}
      <Dialog
        open={!!unpubConfirmDeck}
        onClose={() => { if (!unpublishing) setUnpubConfirmDeck(null); }}
      >
        <DialogTitle>从市场撤回</DialogTitle>
        <DialogContent>
          <DialogContentText>
            确定要将「{unpubConfirmDeck?.name ?? ''}」从市场中撤下吗？撤回后其他用户将无法订阅此牌组，但已有订阅数据不受影响。
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setUnpubConfirmDeck(null)} disabled={unpublishing} color="inherit">
            取消
          </Button>
          <Button onClick={handleConfirmUnpublish} disabled={unpublishing} color="error" variant="contained">
            {unpublishing ? '撤回中...' : '确认撤回'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default DecksPage;
