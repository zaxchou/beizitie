import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import {
  Box,
  Typography,
  Button,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Alert,
  CardMedia,
} from '@mui/material';
import ImageIcon from '@mui/icons-material/Image';
import SearchIcon from '@mui/icons-material/Search';
import CloseIcon from '@mui/icons-material/Close';
import { useDeckStore } from '@/stores/useDeckStore';
import { useAuthStore } from '@/stores/useAuthStore';
import { ALLOWED_IMAGE_TYPES, MAX_IMAGE_SIZE } from '@/lib/constants';
import {
  fetchCards,
  createCard as createCardApi,
  deleteCardApi,
  batchImportCards,
  fetchDecks,
  getImageUrl,
  updateCard,
  fetchMarketplaceDeck,
  unpublishDeck,
  setArticleText,
} from '@/lib/api';
import type { Card, Deck, MarketplaceDeck } from '@/types';
import ConfirmDialog from '@/components/common/ConfirmDialog';
import { DialogHead, FieldLabel, dlgFieldSx, dlgActionSx, dlgCancelSx, dlgSaveSx } from '@/components/common/DialogKit';
import { LoadingState } from '@/components/common/LoadingState';
import EditDeckDialog from '@/components/market/EditDeckDialog';

const PAGE_SIZE = 20;

/** 表单文件选择接受类型字符串 */
const ACCEPT_TYPES = ALLOWED_IMAGE_TYPES.join(',');

/** 将 File 转为 base64 data URL */
function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/**
 * 卡片管理页面。
 * 路由 /decks/:deckId/cards
 * 支持查看卡片列表、添加卡片（含图片）、删除卡片、批量导入。
 */
const CardManagePage: React.FC = () => {
  const { deckId } = useParams<{ deckId: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { updateCardCount, loadDecks } = useDeckStore();
  const { user } = useAuthStore();
  const isAdmin = user?.role === 'admin';

  // 数据状态
  const [deck, setDeck] = useState<Deck | null>(null);
  const [cards, setCards] = useState<Card[]>([]);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // 难度筛选（从 URL searchParams 初始化，例如 ?difficulty=hard）
  const [difficultyFilter, setDifficultyFilter] = useState<string | null>(
    () => searchParams.get('difficulty') || null
  );

  // 卡片搜索关键词
  const [searchKeyword, setSearchKeyword] = useState('');

  /** 难度 + 关键词筛选逻辑 */
  const filteredCards = useMemo(() => {
    let list = cards;

    // 关键词过滤（front_text 包含搜索词，大小写不敏感）
    if (searchKeyword.trim()) {
      const kw = searchKeyword.trim().toLowerCase();
      list = list.filter((c) => c.front_text.toLowerCase().includes(kw));
    }

    // 难度过滤
    if (difficultyFilter) {
      list = list.filter((c) => {
        if (difficultyFilter === 'new') return c.interval === 0;
        if (difficultyFilter === 'hard') return c.interval > 0 && c.ease < 2.0;
        if (difficultyFilter === 'medium') return c.interval > 0 && c.ease >= 2.0 && c.ease < 2.5;
        if (difficultyFilter === 'easy') return c.interval > 0 && c.ease >= 2.5;
        return true;
      });
    }

    return list;
  }, [cards, difficultyFilter, searchKeyword]);

  /** 总页数（基于筛选后的列表，而非全量） */
  const totalPages = useMemo(
    () => Math.max(1, Math.ceil(filteredCards.length / PAGE_SIZE)),
    [filteredCards]
  );

  /** 筛选条件变化时回到第 1 页，避免停留在不存在的页码导致空白 */
  useEffect(() => {
    setPage(1);
  }, [searchKeyword, difficultyFilter]);

  /** 若当前页码超出范围（例如删除卡片后），收敛到最后一页 */
  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  /** 当前页卡片 */
  const pagedCards = useMemo(() => {
    const start = (page - 1) * PAGE_SIZE;
    return filteredCards.slice(start, start + PAGE_SIZE);
  }, [filteredCards, page]);

  // 添加卡片对话框
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [newFrontText, setNewFrontText] = useState('');
  const [newBackText, setNewBackText] = useState('');
  const [newImageFile, setNewImageFile] = useState<File | null>(null);
  const [newImagePreview, setNewImagePreview] = useState<string | null>(null);
  const [addError, setAddError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 删除确认对话框
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Card | null>(null);

  // 批量导入对话框
  const [batchDialogOpen, setBatchDialogOpen] = useState(false);
  const [batchFiles, setBatchFiles] = useState<File[]>([]);
  const [batchPreviews, setBatchPreviews] = useState<
    { file: File; previewUrl: string; frontText: string; valid: boolean; error?: string }[]
  >([]);

  // 文字批量导入
  const [textBatchOpen, setTextBatchOpen] = useState(false);
  const [textBatchContent, setTextBatchContent] = useState('');
  const [textBatchImporting, setTextBatchImporting] = useState(false);
  const [textBatchResult, setTextBatchResult] = useState<string | null>(null);

  const [batchImporting, setBatchImporting] = useState(false);
  const [batchImportProgress, setBatchImportProgress] = useState(0);
  const [batchImportTotal, setBatchImportTotal] = useState(0);
  const [batchGeneralError, setBatchGeneralError] = useState<string | null>(null);
  const batchFileInputRef = useRef<HTMLInputElement>(null);

  // 编辑卡片
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<Card | null>(null);
  const [editFrontText, setEditFrontText] = useState('');
  const [editBackText, setEditBackText] = useState('');
  const [editImageFile, setEditImageFile] = useState<File | null>(null);
  const [editImagePreview, setEditImagePreview] = useState<string | null>(null);
  const [editError, setEditError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);

  // 预览卡片
  const [previewCard, setPreviewCard] = useState<Card | null>(null);
  const editFileInputRef = useRef<HTMLInputElement>(null);

  // 发布到市场弹窗
  const [publishDialogOpen, setPublishDialogOpen] = useState(false);
  const [publishedDeck, setPublishedDeck] = useState<MarketplaceDeck | null>(null);

  // 从市场撤回
  const [unpublishConfirmOpen, setUnpublishConfirmOpen] = useState(false);
  const [unpublishing, setUnpublishing] = useState(false);

  // 文章顺序设置
  const [articleDialogOpen, setArticleDialogOpen] = useState(false);
  const [articleTextValue, setArticleTextValue] = useState('');
  const [articleSetting, setArticleSetting] = useState(false);
  const [articleError, setArticleError] = useState('');
  const [articleResult, setArticleResult] = useState<{
    matched: number;
    unmatched: number;
    total_cards: number;
  } | null>(null);
  const loadAbortedRef = useRef(false);

  const handleUnpublishClick = useCallback(() => {
    setUnpublishConfirmOpen(true);
  }, []);

  const handleConfirmUnpublish = useCallback(async () => {
    if (!deckId) return;
    setUnpublishing(true);
    try {
      await unpublishDeck(deckId);
      setPublishedDeck(null);
      setUnpublishConfirmOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : '撤回失败');
    } finally {
      setUnpublishing(false);
    }
  }, [deckId]);

  // 加载牌组和卡片数据
  const loadData = useCallback(async () => {
    if (!deckId) {
      setError('无效的牌组 ID');
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const [decks, cardsData] = await Promise.all([
        fetchDecks(),
        fetchCards(deckId),
      ]);

      const deckData = decks.find((d) => d.id === deckId);
      if (!deckData) {
        setError('牌组不存在');
        setLoading(false);
        return;
      }

      setDeck(deckData);
      setCards(cardsData);
      setPage(1); // reset to page 1 when loading new deck

      // 检查牌组是否已发布到市场
      loadAbortedRef.current = false;
      fetchMarketplaceDeck(deckId).then((data) => {
        if (!loadAbortedRef.current) setPublishedDeck(data);
      }).catch(() => {
        // 未发布，保持 publishedDeck = null
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载卡片失败');
    } finally {
      setLoading(false);
    }
  }, [deckId]);

  useEffect(() => {
    loadData();
    return () => { loadAbortedRef.current = true; };
  }, [loadData]);

  /** 刷新卡片计数 */
  const refreshCardCount = useCallback(
    async (newCards: Card[]) => {
      if (!deckId) return;
      const count = newCards.length;
      await updateCardCount(deckId, count);
      // 同步更新本地 deck 状态
      setDeck((prev) => (prev ? { ...prev, card_count: count } : prev));
      // 同步更新牌组 store
      loadDecks();
    },
    [deckId, updateCardCount, loadDecks]
  );

  /** 打开添加对话框 */
  const handleOpenAddDialog = useCallback(() => {
    setNewFrontText('');
    setNewImageFile(null);
    setNewImagePreview(null);
    setAddError(null);
    setAddDialogOpen(true);
  }, []);

  /** 关闭添加对话框 */
  const handleCloseAddDialog = useCallback(() => {
    setAddDialogOpen(false);
    setNewFrontText('');
    setNewBackText('');
    setNewImageFile(null);
    setNewImagePreview(null);
    setAddError(null);
  }, []);

  /** 处理文件选择 */
  const handleFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      setAddError(null);

      // 验证文件类型
      if (!ALLOWED_IMAGE_TYPES.includes(file.type as (typeof ALLOWED_IMAGE_TYPES)[number])) {
        setAddError('不支持的图片格式，请选择 JPG、PNG 或 WebP 格式');
        return;
      }

      // 验证文件大小
      if (file.size > MAX_IMAGE_SIZE) {
        setAddError(`图片大小不能超过 ${MAX_IMAGE_SIZE / 1024 / 1024}MB`);
        return;
      }

      // 释放旧的 ObjectURL
      if (newImagePreview) {
        URL.revokeObjectURL(newImagePreview);
      }

      const previewUrl = URL.createObjectURL(file);
      setNewImageFile(file);
      setNewImagePreview(previewUrl);
    },
    [newImagePreview]
  );

  /** 确认添加卡片 */
  const handleConfirmAdd = useCallback(async () => {
    if (!deckId || !newFrontText.trim() || adding) return;

    setAddError(null);
    setAdding(true);

    try {
      // 如果有图片，先转为 base64
      let imageBase64: string | undefined;
      if (newImageFile) {
        imageBase64 = await fileToBase64(newImageFile);
      }

      const newCard = await createCardApi(deckId, newFrontText.trim(), imageBase64, newBackText.trim());

      const updatedCards = [newCard, ...cards];
      setCards(updatedCards);
      await refreshCardCount(updatedCards);
      handleCloseAddDialog();
    } catch (err) {
      setAddError(err instanceof Error ? err.message : '添加卡片失败');
    } finally {
      setAdding(false);
    }
  }, [deckId, newFrontText, newBackText, newImageFile, adding, cards, refreshCardCount, handleCloseAddDialog]);

  /** 打开删除确认 */
  const handleOpenDelete = useCallback((card: Card) => {
    setDeleteTarget(card);
    setDeleteDialogOpen(true);
  }, []);

  /** 确认删除卡片 */
  const handleConfirmDelete = useCallback(async () => {
    if (!deleteTarget) return;

    try {
      await deleteCardApi(deleteTarget.id);

      // 释放 ObjectURL 内存（如果是旧 blob URL）
      if (deleteTarget.image_url && deleteTarget.image_url.startsWith('blob:')) {
        URL.revokeObjectURL(deleteTarget.image_url);
      }

      const updatedCards = cards.filter((c) => c.id !== deleteTarget.id);
      setCards(updatedCards);
      await refreshCardCount(updatedCards);
    } catch (err) {
      console.error('[CardManagePage] 删除卡片失败:', err);
    } finally {
      setDeleteDialogOpen(false);
      setDeleteTarget(null);
    }
  }, [deleteTarget, cards, refreshCardCount]);

  /** 取消删除 */
  const handleCancelDelete = useCallback(() => {
    setDeleteDialogOpen(false);
    setDeleteTarget(null);
  }, []);

  /** 打开编辑对话框 */
  const handleOpenEdit = useCallback((card: Card) => {
    setEditTarget(card);
    setEditFrontText(card.front_text);
    setEditBackText(card.back_text || '');
    setEditImageFile(null);
    setEditImagePreview(null);
    setEditError(null);
    setEditDialogOpen(true);
  }, []);

  /** 关闭编辑对话框 */
  const handleCloseEdit = useCallback(() => {
    setEditDialogOpen(false);
    setEditTarget(null);
    setEditFrontText('');
    setEditBackText('');
    setEditImageFile(null);
    if (editImagePreview) {
      URL.revokeObjectURL(editImagePreview);
    }
    setEditImagePreview(null);
    setEditError(null);
  }, [editImagePreview]);

  /** 编辑状态下选择新图片 */
  const handleEditFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      setEditError(null);

      if (!ALLOWED_IMAGE_TYPES.includes(file.type as (typeof ALLOWED_IMAGE_TYPES)[number])) {
        setEditError('不支持的图片格式，请选择 JPG、PNG 或 WebP 格式');
        return;
      }

      if (file.size > MAX_IMAGE_SIZE) {
        setEditError(`图片大小不能超过 ${MAX_IMAGE_SIZE / 1024 / 1024}MB`);
        return;
      }

      if (editImagePreview) {
        URL.revokeObjectURL(editImagePreview);
      }

      const previewUrl = URL.createObjectURL(file);
      setEditImageFile(file);
      setEditImagePreview(previewUrl);
    },
    [editImagePreview]
  );

  /** 确认保存编辑 */
  const handleConfirmEdit = useCallback(async () => {
    if (!editTarget || !editFrontText.trim() || editing) return;

    setEditError(null);
    setEditing(true);

    try {
      const updateFields: Record<string, string> = {
        front_text: editFrontText.trim(),
        back_text: editBackText.trim(),
      };
      if (editImageFile) {
        updateFields.image_url = await fileToBase64(editImageFile);
      }
      const updated = await updateCard(editTarget.id, updateFields as any);
      setCards((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
      handleCloseEdit();
    } catch (err) {
      setEditError(err instanceof Error ? err.message : '保存卡片失败');
    } finally {
      setEditing(false);
    }
  }, [editTarget, editFrontText, editBackText, editImageFile, editing, handleCloseEdit]);

  /** 打开批量导入对话框 */
  const handleOpenBatchDialog = useCallback(() => {
    setBatchFiles([]);
    setBatchPreviews([]);
    setBatchGeneralError(null);
    setBatchImportProgress(0);
    setBatchImportTotal(0);
    setBatchDialogOpen(true);
  }, []);

  /** 关闭批量导入对话框，释放所有 blob URL */
  const handleCloseBatchDialog = useCallback(() => {
    setBatchDialogOpen(false);
    for (const entry of batchPreviews) {
      URL.revokeObjectURL(entry.previewUrl);
    }
    setBatchFiles([]);
    setBatchPreviews([]);
    setBatchGeneralError(null);
    setBatchImportProgress(0);
    setBatchImportTotal(0);
  }, [batchPreviews]);

  /** 处理批量文件选择 */
  const handleBatchFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      if (!files || files.length === 0) return;

      setBatchGeneralError(null);

      // 释放旧预览
      for (const entry of batchPreviews) {
        URL.revokeObjectURL(entry.previewUrl);
      }

      const newPreviews: {
        file: File;
        previewUrl: string;
        frontText: string;
        valid: boolean;
        error?: string;
      }[] = [];

      for (let i = 0; i < files.length; i++) {
        const file = files[i];

        // 验证文件类型
        if (
          !ALLOWED_IMAGE_TYPES.includes(
            file.type as (typeof ALLOWED_IMAGE_TYPES)[number]
          )
        ) {
          newPreviews.push({
            file,
            previewUrl: '',
            frontText: file.name.replace(/\.[^.]+$/, ''),
            valid: false,
            error: `不支持的文件类型：${file.type || '未知'}`,
          });
          continue;
        }

        // 验证文件大小
        if (file.size > MAX_IMAGE_SIZE) {
          newPreviews.push({
            file,
            previewUrl: '',
            frontText: file.name.replace(/\.[^.]+$/, ''),
            valid: false,
            error: `文件过大：${(file.size / 1024 / 1024).toFixed(1)}MB（上限 ${MAX_IMAGE_SIZE / 1024 / 1024}MB）`,
          });
          continue;
        }

        const previewUrl = URL.createObjectURL(file);
        const frontText = file.name.replace(/\.[^.]+$/, '');

        newPreviews.push({
          file,
          previewUrl,
          frontText,
          valid: true,
        });
      }

      setBatchFiles(Array.from(files));
      setBatchPreviews(newPreviews);
    },
    [batchPreviews]
  );

  /** 确认批量导入 */
  const handleConfirmBatchImport = useCallback(async () => {
    if (!deckId || batchImporting) return;

    const validEntries = batchPreviews.filter((e) => e.valid);
    if (validEntries.length === 0) {
      setBatchGeneralError('没有可导入的有效图片文件');
      return;
    }

    setBatchImporting(true);
    setBatchGeneralError(null);
    setBatchImportTotal(validEntries.length);
    setBatchImportProgress(0);

    try {
      const validFiles = validEntries.map((e) => e.file);
      const result = await batchImportCards(deckId, validFiles);

      // 更新卡片列表
      const updatedCards = [...result.cards, ...cards];
      setCards(updatedCards);
      await refreshCardCount(updatedCards);

      // 释放预览 URL
      for (const entry of batchPreviews) {
        URL.revokeObjectURL(entry.previewUrl);
      }

      setBatchImporting(false);
      setBatchDialogOpen(false);
      setBatchFiles([]);
      setBatchPreviews([]);
      setBatchGeneralError(null);
      setBatchImportProgress(0);
      setBatchImportTotal(0);
    } catch (err) {
      setBatchGeneralError(
        err instanceof Error ? err.message : '批量导入失败'
      );
      setBatchImporting(false);
    }
  }, [deckId, batchImporting, batchPreviews, cards, refreshCardCount]);

  /** 文字批量导入 */
  const handleTextBatchImport = useCallback(async () => {
    if (!deckId || !textBatchContent.trim() || textBatchImporting) return;
    setTextBatchImporting(true);
    setTextBatchResult(null);
    try {
      const { batchImportText } = await import('@/lib/api');
      const result = await batchImportText(deckId, textBatchContent);
      setTextBatchResult(`成功导入 ${result.created} 张卡片`);
      setTextBatchContent('');
      const updatedCards = await fetchCards(deckId);
      setCards(updatedCards);
      await refreshCardCount(updatedCards);
    } catch (err) {
      setTextBatchResult(err instanceof Error ? err.message : '导入失败');
    } finally {
      setTextBatchImporting(false);
    }
  }, [deckId, textBatchContent, textBatchImporting, refreshCardCount]);

  /** 清理 ObjectURL（组件卸载时） */
  useEffect(() => {
    return () => {
      if (newImagePreview) {
        URL.revokeObjectURL(newImagePreview);
      }
      if (editImagePreview) {
        URL.revokeObjectURL(editImagePreview);
      }
      for (const entry of batchPreviews) {
        if (entry.previewUrl) {
          URL.revokeObjectURL(entry.previewUrl);
        }
      }
    };
  }, [newImagePreview, editImagePreview, batchPreviews]);

  // 加载状态
  if (loading) {
    return <LoadingState message="正在加载卡片列表..." />;
  }

  // 错误状态
  if (error) {
    return (
      <Box className="py-4">
        <Alert severity="error" className="mb-4">
          {error}
        </Alert>
        <Box className="flex gap-2">
          <Button variant="outlined" onClick={() => navigate(-1)}>
            返回
          </Button>
          <Button variant="contained" onClick={loadData}>
            重试
          </Button>
        </Box>
      </Box>
    );
  }

  const mono = { fontFamily: 'var(--font-mono)', letterSpacing: '0.04em' } as const;

  /** 每张字的状态：以 SM-2 的 interval / ease 判定 */
  const statusOf = (c: Card): { label: string; en: string; hard: boolean } => {
    if (c.interval === 0) return { label: '新卡', en: 'NEW', hard: false };
    if (c.ease < 2) return { label: '困难', en: 'HARD', hard: true };
    if (c.ease < 2.5) return { label: '普通', en: 'MID', hard: false };
    return { label: '简单', en: 'EASY', hard: false };
  };

  /** 下次复习：只给相对天数，避免一列日期读不动 */
  const nextLabel = (c: Card): string => {
    if (c.interval === 0) return '—';
    const t = new Date(c.next_review).getTime();
    if (Number.isNaN(t)) return '—';
    const days = Math.ceil((t - Date.now()) / 86400000);
    if (days <= 0) return '今天';
    return `${days} 天后`;
  };

  const counts = cards.reduce(
    (acc, c) => {
      if (c.interval === 0) acc.new += 1;
      else if (c.ease < 2) acc.hard += 1;
      else if (c.ease < 2.5) acc.medium += 1;
      else acc.easy += 1;
      return acc;
    },
    { new: 0, hard: 0, medium: 0, easy: 0 },
  );

  const FILTERS: { key: string | null; label: string; en: string; n: number }[] = [
    { key: null, label: '全部', en: 'ALL', n: cards.length },
    { key: 'new', label: '新卡', en: 'NEW', n: counts.new },
    { key: 'hard', label: '困难', en: 'HARD', n: counts.hard },
    { key: 'medium', label: '普通', en: 'MID', n: counts.medium },
    { key: 'easy', label: '简单', en: 'EASY', n: counts.easy },
  ];

  const startStudy = (): void => {
    if (!deck) return;
    const filter = difficultyFilter ? `?difficulty=${difficultyFilter}` : '';
    navigate(`/study/${deck.id}${filter}`);
  };

  const pagerSx = {
    border: '1px solid',
    borderColor: 'text.primary',
    background: 'transparent',
    color: 'inherit',
    ...mono,
    fontSize: 11,
    px: 1.25,
    height: 28,
    cursor: 'pointer',
    '&:hover': { backgroundColor: 'text.primary', color: 'background.default' },
    '&:disabled': { opacity: 0.28, cursor: 'not-allowed', backgroundColor: 'transparent', color: 'inherit' },
  } as const;

  const rowActionSx = {
    border: 0,
    background: 'none',
    color: 'inherit',
    p: 0,
    cursor: 'pointer',
    ...mono,
    fontSize: 11,
    opacity: 0.72,
    textDecoration: 'none',
    '&:hover': { opacity: 1, textDecoration: 'underline' },
  } as const;

  return (
    <Box>
      {/* 帖头 */}
      <Box sx={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 2, pb: { xs: 1.5, md: 1.75 } }}>
        <Box sx={{ minWidth: 0 }}>
          <Button
            variant="text"
            onClick={() => navigate(-1)}
            sx={{ minHeight: 0, p: 0, mb: 1, fontSize: 11, ...mono, color: 'text.primary', opacity: 0.7, '&:hover': { backgroundColor: 'transparent', opacity: 1 } }}
          >
            ← 返回
          </Button>
          <Typography
            component="h1"
            sx={{
              fontSize: { xs: 24, md: 44 },
              fontWeight: 900,
              letterSpacing: { xs: '2px', md: '7px' },
              lineHeight: 1.12,
              overflowWrap: 'anywhere',
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
            }}
          >
            {deck?.name ?? '牌组'}
          </Typography>
          {deck && (
            <Typography sx={{ ...mono, fontSize: 11, opacity: 0.75, mt: 1 }}>
              {deck.card_count} 字 · {deck.study_mode === 'sequential' ? '原帖顺序' : deck.study_mode === 'random' ? '随机' : '默认顺序'}
              {' · '}每日新字 {deck.daily_new_card_limit} · 复习 {deck.daily_review_limit}
              {publishedDeck ? ' · 已上市场' : ''}
            </Typography>
          )}
        </Box>
        {deck && (
          <Box sx={{ display: { xs: 'none', md: 'flex' }, gap: 1, flexShrink: 0, alignItems: 'center' }}>
            <Button variant="outlined" onClick={() => navigate(`/decks/${deck.id}`)} sx={{ height: 42 }}>
              帖设置
            </Button>
            <Button variant="contained" onClick={startStudy} disabled={deck.card_count === 0} sx={{ height: 42, px: 2.5 }}>
              开始背写 →
            </Button>
          </Box>
        )}
      </Box>

      {/* 工具条：搜索 + 状态筛选 + 计数 */}
      <Box
        sx={{
          borderTop: '1px solid',
          borderBottom: '1px solid',
          borderColor: 'text.primary',
          display: 'flex',
          alignItems: 'center',
          gap: { xs: 1.25, md: 2 },
          flexWrap: 'wrap',
          py: 1.25,
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, borderBottom: '1px solid', borderColor: 'text.primary', pb: '3px', width: { xs: '100%', md: 210 } }}>
          <SearchIcon sx={{ fontSize: 15, opacity: 0.55 }} />
          <Box
            component="input"
            value={searchKeyword}
            onChange={(e) => setSearchKeyword(e.target.value)}
            placeholder="搜索正字 / SEARCH"
            aria-label="搜索卡片"
            sx={{ border: 0, outline: 'none', background: 'transparent', color: 'text.primary', ...mono, fontSize: 12, width: '100%', p: 0 }}
          />
          {searchKeyword && (
            <Box component="button" type="button" onClick={() => setSearchKeyword('')} aria-label="清除搜索" sx={{ border: 0, background: 'none', p: 0, cursor: 'pointer', color: 'inherit', display: 'flex' }}>
              <CloseIcon sx={{ fontSize: 14, opacity: 0.6 }} />
            </Box>
          )}
        </Box>

        <Box sx={{ display: 'flex' }}>
          {FILTERS.map((f, i) => {
            const active = difficultyFilter === f.key;
            return (
              <Box
                key={f.en}
                component="button"
                type="button"
                onClick={() => setDifficultyFilter(f.key)}
                aria-pressed={active}
                sx={{
                  border: '1px solid',
                  borderColor: 'text.primary',
                  borderLeftWidth: i === 0 ? 1 : 0,
                  px: 1.1,
                  height: 28,
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                  bgcolor: active ? 'text.primary' : 'transparent',
                  color: active ? 'background.default' : 'inherit',
                  ...mono,
                  fontSize: 11,
                  '&:hover': active ? {} : { backgroundColor: 'action.hover' },
                }}
              >
                {f.label}
                <Box component="span" sx={{ ml: 0.6, opacity: 0.58 }}>{f.n}</Box>
              </Box>
            );
          })}
        </Box>

        <Box sx={{ flex: 1 }} />

        <Typography sx={{ ...mono, fontSize: 10.5, opacity: 0.62, display: { xs: 'none', md: 'block' } }}>
          {filteredCards.length} / {cards.length} 字
        </Typography>
      </Box>

      {/* 移动端主动作 */}
      {deck && (
        <Box sx={{ display: { xs: 'flex', md: 'none' }, gap: 1, mt: 1.5 }}>
          <Button variant="contained" fullWidth onClick={startStudy} disabled={deck.card_count === 0} sx={{ height: 44 }}>
            开始背写 →
          </Button>
          <Button variant="outlined" onClick={() => navigate(`/decks/${deck.id}`)} sx={{ height: 44, flexShrink: 0 }}>
            设置
          </Button>
        </Box>
      )}

      {/* 管理员动作 */}
      {deck && isAdmin && (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap', mt: 1.5 }}>
          <Button variant="outlined" onClick={handleOpenAddDialog} sx={{ height: 36, px: 1.75 }}>添加卡片</Button>
          <Button variant="outlined" onClick={handleOpenBatchDialog} sx={{ height: 36, px: 1.75 }}>批量导入</Button>
          <Button variant="outlined" onClick={() => setTextBatchOpen(true)} sx={{ height: 36, px: 1.75 }}>文字导入</Button>
          <Box sx={{ flex: 1 }} />
          {deck.card_count > 0 && (
            <Button
              variant="text"
              size="small"
              onClick={() => {
                setArticleTextValue(deck.article_text || '');
                setArticleResult(null);
                setArticleDialogOpen(true);
              }}
              sx={{ ...mono, fontSize: 11, color: 'text.primary', opacity: 0.75, '&:hover': { backgroundColor: 'transparent', opacity: 1 } }}
            >
              碑帖文本
            </Button>
          )}
          <Button
            variant="text"
            size="small"
            onClick={() => setPublishDialogOpen(true)}
            sx={{ ...mono, fontSize: 11, color: 'text.primary', opacity: 0.75, '&:hover': { backgroundColor: 'transparent', opacity: 1 } }}
          >
            {publishedDeck ? '编辑发布' : '发布到市场'}
          </Button>
          {publishedDeck && (
            <Button
              variant="text"
              size="small"
              color="error"
              onClick={handleUnpublishClick}
              sx={{ ...mono, fontSize: 11, color: 'var(--hot-ink)', '&:hover': { backgroundColor: 'transparent' } }}
            >
              撤回
            </Button>
          )}
        </Box>
      )}

      {/* 字表 */}
      {filteredCards.length === 0 ? (
        <Box sx={{ borderTop: '2px solid', borderColor: 'text.primary', py: { xs: 8, md: 10 }, textAlign: 'center' }}>
          <Typography sx={{ fontSize: 64, fontWeight: 900, lineHeight: 1, opacity: 0.14, letterSpacing: '0.12em' }}>
            {searchKeyword.trim() ? '无' : difficultyFilter ? '零' : '空'}
          </Typography>
          <Typography sx={{ mt: 1.5, fontSize: 15, fontWeight: 700, letterSpacing: '0.1em' }}>
            {searchKeyword.trim() ? '没有匹配的字' : difficultyFilter ? '这帖没有这一类的字' : '这帖还没有字'}
          </Typography>
          <Typography sx={{ ...mono, fontSize: 10.5, opacity: 0.65, mt: 0.75 }}>
            {searchKeyword.trim()
              ? `NO MATCH · 「${searchKeyword.trim()}」`
              : difficultyFilter
                ? `FILTER · ${FILTERS.find((f) => f.key === difficultyFilter)?.label ?? difficultyFilter} 0 字`
                : isAdmin ? 'EMPTY · 用上面的按钮导入碑帖图片' : 'EMPTY'}
          </Typography>
        </Box>
      ) : (
        <Box>
          {/* 表头 */}
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: { xs: '32px minmax(0,1fr) 96px', md: '52px minmax(0,1fr) 104px 116px 132px' },
              alignItems: 'center',
              columnGap: { xs: 1, md: 2 },
              borderTop: '2px solid',
              borderBottom: '1px solid',
              borderColor: 'text.primary',
              px: { xs: 0.5, md: 1 },
              py: 0.9,
              ...mono,
              fontSize: 9.5,
              opacity: 0.6,
              letterSpacing: '0.12em',
            }}
          >
            <Box>NO</Box>
            <Box>字形 · 正字 / 背字</Box>
            <Box sx={{ display: { xs: 'none', md: 'block' } }}>状态</Box>
            <Box sx={{ display: { xs: 'none', md: 'block' } }}>下次复习</Box>
            <Box sx={{ textAlign: 'right' }}>操作</Box>
          </Box>

          {pagedCards.map((card, index) => {
            const st = statusOf(card);
            return (
              <Box
                key={card.id}
                sx={{
                  display: 'grid',
                  gridTemplateColumns: { xs: '32px minmax(0,1fr) 96px', md: '52px minmax(0,1fr) 104px 116px 132px' },
                  alignItems: 'center',
                  columnGap: { xs: 1, md: 2 },
                  px: { xs: 0.5, md: 1 },
                  py: { xs: '9px', md: '10px' },
                  borderBottom: '1px solid',
                  borderColor: 'divider',
                  transition: 'background-color 120ms linear, color 120ms linear',
                  '&:hover': { backgroundColor: 'text.primary', color: 'background.default' },
                }}
              >
                <Typography sx={{ ...mono, fontSize: 10.5, opacity: 0.5, fontVariantNumeric: 'tabular-nums' }}>
                  {String((page - 1) * PAGE_SIZE + index + 1).padStart(2, '0')}
                </Typography>

                <Box
                  component="button"
                  type="button"
                  onClick={() => setPreviewCard(card)}
                  aria-label={`预览 ${card.front_text}`}
                  sx={{ display: 'flex', alignItems: 'center', gap: { xs: 1, md: 1.5 }, border: 0, background: 'none', color: 'inherit', p: 0, minWidth: 0, textAlign: 'left', cursor: 'pointer' }}
                >
                  <Box
                    sx={{
                      width: { xs: 40, md: 52 },
                      height: { xs: 40, md: 52 },
                      flexShrink: 0,
                      border: '1px solid',
                      borderColor: 'currentColor',
                      opacity: 0.9,
                      overflow: 'hidden',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    {card.image_url ? (
                      <Box
                        component="img"
                        src={getImageUrl(card.image_url)}
                        alt={card.front_text}
                        loading="lazy"
                        sx={{ width: '100%', height: '100%', objectFit: 'cover', filter: 'grayscale(1) contrast(1.05)' }}
                      />
                    ) : (
                      <Typography sx={{ fontSize: { xs: 18, md: 24 }, fontWeight: 900, lineHeight: 1 }}>{card.front_text.slice(0, 1)}</Typography>
                    )}
                  </Box>
                  <Box sx={{ minWidth: 0 }}>
                    <Typography
                      className="font-kai"
                      sx={{ fontSize: { xs: 17, md: 19 }, fontWeight: 600, letterSpacing: '0.06em', lineHeight: 1.2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
                    >
                      {card.front_text}
                    </Typography>
                    {card.back_text && (
                      <Typography sx={{ ...mono, fontSize: 10, opacity: 0.58, mt: 0.35, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {card.back_text}
                      </Typography>
                    )}
                  </Box>
                </Box>

                <Box sx={{ display: { xs: 'none', md: 'flex' }, alignItems: 'baseline', gap: 0.6 }}>
                  <Typography sx={{ fontSize: 12.5, fontWeight: st.hard ? 900 : 500 }}>{st.label}</Typography>
                  <Typography sx={{ ...mono, fontSize: 9.5, opacity: 0.55 }}>{st.en}</Typography>
                </Box>

                <Typography
                  sx={{ display: { xs: 'none', md: 'block' }, ...mono, fontSize: 11, opacity: 0.75, fontVariantNumeric: 'tabular-nums' }}
                >
                  {nextLabel(card)}
                </Typography>

                <Box sx={{ display: 'flex', gap: { xs: 0.75, md: 1.25 }, justifyContent: 'flex-end', alignItems: 'center' }}>
                  <Box component="button" type="button" onClick={() => setPreviewCard(card)} sx={rowActionSx}>看</Box>
                  {isAdmin && (
                    <>
                      <Box component="button" type="button" onClick={() => handleOpenEdit(card)} aria-label={`编辑 ${card.front_text}`} sx={rowActionSx}>改</Box>
                      <Box component="button" type="button" onClick={() => handleOpenDelete(card)} aria-label={`删除 ${card.front_text}`} sx={rowActionSx}>删</Box>
                    </>
                  )}
                </Box>
              </Box>
            );
          })}

          {/* 分页 */}
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1, borderBottom: '1px solid', borderColor: 'text.primary', py: 1.25 }}>
            <Typography sx={{ ...mono, fontSize: 10.5, opacity: 0.62, fontVariantNumeric: 'tabular-nums' }}>
              {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, filteredCards.length)} / {filteredCards.length} 字
            </Typography>
            {totalPages > 1 && (
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <Box component="button" type="button" disabled={page <= 1} onClick={() => setPage((p) => p - 1)} sx={pagerSx}>
                  ← 上一页
                </Box>
                <Typography sx={{ ...mono, fontSize: 10.5, opacity: 0.7, fontVariantNumeric: 'tabular-nums' }}>
                  {page} / {totalPages}
                </Typography>
                <Box component="button" type="button" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)} sx={pagerSx}>
                  下一页 →
                </Box>
              </Box>
            )}
          </Box>
        </Box>
      )}

      {/* 卡片预览弹窗 */}
      {previewCard && (() => {
        const idx = cards.findIndex((c) => c.id === previewCard.id);
        const prevCard = idx > 0 ? cards[idx - 1] : null;
        const nextCard = idx >= 0 && idx < cards.length - 1 ? cards[idx + 1] : null;
        return (
      <Dialog
        open={!!previewCard}
        onClose={() => setPreviewCard(null)}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle sx={{ p: '14px 20px 10px', display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', borderBottom: '1px solid', borderColor: 'divider' }}>
          <Typography sx={{ ...mono, fontSize: 10.5, letterSpacing: '0.14em', textTransform: 'uppercase', opacity: 0.7 }}>
            卡片预览 · Preview
          </Typography>
          <Typography sx={{ ...mono, fontSize: 10.5, opacity: 0.6, fontVariantNumeric: 'tabular-nums' }}>
            {idx + 1} / {cards.length}
          </Typography>
        </DialogTitle>
        <DialogContent sx={{ p: '16px 20px 6px' }}>
          {previewCard && (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              {previewCard.image_url && (
                <Box sx={{ width: '100%', border: '1px solid', borderColor: 'text.primary', overflow: 'hidden' }}>
                  <CardMedia
                    component="img"
                    image={getImageUrl(previewCard.image_url)}
                    alt={previewCard.front_text}
                    sx={{ maxHeight: 300, objectFit: 'contain' }}
                  />
                </Box>
              )}

              <Box>
                <Typography sx={{ ...mono, fontSize: 9.5, letterSpacing: '0.14em', textTransform: 'uppercase', opacity: 0.6 }}>
                  正面 · Front
                </Typography>
                <Typography className="font-kai" sx={{ fontSize: 34, fontWeight: 700, lineHeight: 1.1, mt: 0.5, letterSpacing: '0.06em' }}>
                  {previewCard.front_text}
                </Typography>
              </Box>

              <Box>
                <Typography sx={{ ...mono, fontSize: 9.5, letterSpacing: '0.14em', textTransform: 'uppercase', opacity: 0.6 }}>
                  背面 · Back
                </Typography>
                <Typography sx={{ fontSize: 14, lineHeight: 1.8, mt: 0.5, whiteSpace: 'pre-wrap' }}>
                  {previewCard.back_text || '（无背面内容）'}
                </Typography>
              </Box>

              <Typography sx={{ ...mono, fontSize: 10, opacity: 0.55, fontVariantNumeric: 'tabular-nums' }}>
                {new Date(previewCard.created_at).toLocaleDateString('zh-CN')}
                {previewCard.interval > 0 && ` · 已复习 ${previewCard.repetitions} 次`}
                {previewCard.interval > 0 && ` · ${statusOf(previewCard).label}`}
              </Typography>
            </Box>
          )}
        </DialogContent>
        <DialogActions sx={{ p: '10px 20px 16px', gap: 1, justifyContent: 'space-between' }}>
          <Button
            onClick={() => prevCard && setPreviewCard(prevCard)}
            disabled={!prevCard}
            sx={{ ...mono, fontSize: 11, color: 'text.primary', px: 0, minWidth: 0, '&:hover': { backgroundColor: 'transparent', textDecoration: 'underline' } }}
          >
            ← 上一张
          </Button>
          <Button onClick={() => setPreviewCard(null)} variant="outlined" sx={{ ...mono, fontSize: 11, height: 34, px: 2 }}>
            关闭
          </Button>
          <Button
            onClick={() => nextCard && setPreviewCard(nextCard)}
            disabled={!nextCard}
            sx={{ ...mono, fontSize: 11, color: 'text.primary', px: 0, minWidth: 0, '&:hover': { backgroundColor: 'transparent', textDecoration: 'underline' } }}
          >
            下一张 →
          </Button>
        </DialogActions>
      </Dialog>
        );
      })()}

      {/* 添加卡片对话框 */}
      <Dialog
        open={addDialogOpen}
        onClose={handleCloseAddDialog}
        aria-labelledby="add-card-dialog-title"
        maxWidth="sm"
        fullWidth
      >
        <DialogHead id="add-card-dialog-title" title="添加卡片" en="New card" />
        <DialogContent sx={{ p: '16px 20px 6px' }}>
          {addError && (
            <Typography sx={{ ...mono, fontSize: 11, color: 'var(--hot-ink)', mb: 1.5 }}>{addError}</Typography>
          )}

          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.25 }}>
            <Box>
              <FieldLabel required hint="≤ 100 字">正面文字 · Front</FieldLabel>
              <TextField
                autoFocus
                fullWidth
                required
                value={newFrontText}
                onChange={(e) => setNewFrontText(e.target.value)}
                placeholder="输入卡片正面的汉字…"
                multiline
                minRows={3}
                maxRows={8}
                inputProps={{ maxLength: 100 }}
                sx={dlgFieldSx}
              />
            </Box>

            <Box>
              <FieldLabel hint="可留空">背面文字 · Back</FieldLabel>
              <TextField
                fullWidth
                value={newBackText}
                onChange={(e) => setNewBackText(e.target.value)}
                placeholder="纯文字卡片可在此输入背面内容…"
                multiline
                minRows={3}
                maxRows={10}
                inputProps={{ maxLength: 500 }}
                sx={dlgFieldSx}
              />
            </Box>

            <Box>
              <FieldLabel hint="JPG / PNG / WebP · ≤ 10MB">书法图片 · Image</FieldLabel>
              <input
                ref={fileInputRef}
                type="file"
                accept={ACCEPT_TYPES}
                onChange={handleFileSelect}
                style={{ display: 'none' }}
              />
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25 }}>
                <Button variant="outlined" onClick={() => fileInputRef.current?.click()} sx={{ height: 36, px: 1.75 }}>
                  选择图片
                </Button>
                <Typography sx={{ ...mono, fontSize: 10, opacity: 0.6, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {newImageFile ? newImageFile.name : '未选择'}
                </Typography>
              </Box>
            </Box>

            {newImagePreview && (
              <Box
                component="img"
                src={newImagePreview}
                alt="预览"
                sx={{ maxHeight: 180, maxWidth: '100%', objectFit: 'contain', border: '1px solid', borderColor: 'text.primary', alignSelf: 'flex-start' }}
              />
            )}
          </Box>
        </DialogContent>
        <DialogActions sx={dlgActionSx}>
          <Button onClick={handleCloseAddDialog} disabled={adding} sx={dlgCancelSx}>
            取消
          </Button>
          <Button
            onClick={handleConfirmAdd}
            variant="contained"
            disabled={!newFrontText.trim() || adding}
            sx={dlgSaveSx}
          >
            {adding ? '添加中…' : '确认添加'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* 文字批量导入对话框 */}
      <Dialog
        open={textBatchOpen}
        onClose={() => { setTextBatchOpen(false); setTextBatchResult(null); }}
        maxWidth="sm" fullWidth
      >
        <DialogHead title="文字批量导入" en="Text import" />
        <DialogContent sx={{ p: '16px 20px 6px' }}>
          <Typography sx={{ ...mono, fontSize: 10.5, opacity: 0.6, mb: 1.25 }}>
            每两行为一组（正面 / 背面），空行自动忽略
          </Typography>
          <TextField
            autoFocus
            multiline
            minRows={8}
            maxRows={16}
            fullWidth
            value={textBatchContent}
            onChange={(e) => setTextBatchContent(e.target.value)}
            placeholder={`天地
世界
日月
星辰`}
            disabled={textBatchImporting}
            sx={dlgFieldSx}
          />
          {textBatchResult && (
            <Typography
              sx={{
                ...mono,
                fontSize: 11,
                mt: 1.5,
                color: textBatchResult.startsWith('成功') ? 'inherit' : 'var(--hot-ink)',
              }}
            >
              {textBatchResult}
            </Typography>
          )}
        </DialogContent>
        <DialogActions sx={dlgActionSx}>
          <Button onClick={() => { setTextBatchOpen(false); setTextBatchResult(null); }} disabled={textBatchImporting} sx={dlgCancelSx}>
            取消
          </Button>
          <Button
            variant="contained"
            onClick={handleTextBatchImport}
            disabled={!textBatchContent.trim() || textBatchImporting}
            sx={dlgSaveSx}
          >
            {textBatchImporting ? '导入中…' : '确认导入'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* 删除确认对话框 */}
      <ConfirmDialog
        open={deleteDialogOpen}
        title="删除卡片"
        message={
          deleteTarget
            ? `确定要删除卡片「${deleteTarget.front_text}」吗？此操作不可撤销。`
            : ''
        }
        onConfirm={handleConfirmDelete}
        onCancel={handleCancelDelete}
      />

      {/* 编辑卡片对话框 */}
      <Dialog
        open={editDialogOpen}
        onClose={handleCloseEdit}
        aria-labelledby="edit-card-dialog-title"
        maxWidth="sm"
        fullWidth
      >
        <DialogHead id="edit-card-dialog-title" title="编辑卡片" en="Edit card" />
        <DialogContent sx={{ p: '16px 20px 6px' }}>
          {editError && (
            <Typography sx={{ ...mono, fontSize: 11, color: 'var(--hot-ink)', mb: 1.5 }}>{editError}</Typography>
          )}

          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.25 }}>
            <Box>
              <FieldLabel required hint="≤ 100 字">正面文字 · Front</FieldLabel>
              <TextField
                autoFocus
                fullWidth
                required
                value={editFrontText}
                onChange={(e) => setEditFrontText(e.target.value)}
                placeholder="输入卡片正面的汉字…"
                multiline
                minRows={3}
                maxRows={8}
                inputProps={{ maxLength: 100 }}
                sx={dlgFieldSx}
              />
            </Box>

            <Box>
              <FieldLabel hint="可留空">背面文字 · Back</FieldLabel>
              <TextField
                fullWidth
                value={editBackText}
                onChange={(e) => setEditBackText(e.target.value)}
                placeholder="纯文字卡片在此输入背面内容…"
                multiline
                minRows={3}
                maxRows={10}
                inputProps={{ maxLength: 500 }}
                sx={dlgFieldSx}
              />
            </Box>

            <Box>
              <FieldLabel hint="不选则保留原图">书法图片 · Image</FieldLabel>

              {editTarget?.image_url && (
                <Box
                  component="img"
                  src={getImageUrl(editTarget.image_url)}
                  alt={editTarget.front_text}
                  sx={{ display: 'block', maxHeight: 160, maxWidth: '100%', objectFit: 'contain', border: '1px solid', borderColor: 'divider', mb: 1.25 }}
                />
              )}

              <input
                ref={editFileInputRef}
                type="file"
                accept={ACCEPT_TYPES}
                onChange={handleEditFileSelect}
                style={{ display: 'none' }}
              />
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25 }}>
                <Button variant="outlined" onClick={() => editFileInputRef.current?.click()} disabled={editing} sx={{ height: 36, px: 1.75 }}>
                  更换图片
                </Button>
                <Typography sx={{ ...mono, fontSize: 10, opacity: 0.6, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {editImageFile ? editImageFile.name : '未选择新图'}
                </Typography>
              </Box>
            </Box>

            {editImagePreview && (
              <Box
                component="img"
                src={editImagePreview}
                alt="新图片预览"
                sx={{ maxHeight: 180, maxWidth: '100%', objectFit: 'contain', border: '1px solid', borderColor: 'text.primary', alignSelf: 'flex-start' }}
              />
            )}
          </Box>
        </DialogContent>
        <DialogActions sx={dlgActionSx}>
          <Button onClick={handleCloseEdit} disabled={editing} sx={dlgCancelSx}>
            取消
          </Button>
          <Button
            onClick={handleConfirmEdit}
            variant="contained"
            disabled={!editFrontText.trim() || editing}
            sx={dlgSaveSx}
          >
            {editing ? '保存中…' : '保存'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* 批量导入对话框 */}
      <Dialog
        open={batchDialogOpen}
        onClose={batchImporting ? undefined : handleCloseBatchDialog}
        aria-labelledby="batch-import-dialog-title"
        maxWidth="sm"
        fullWidth
      >
        <DialogHead id="batch-import-dialog-title" title="批量导入" en="Batch import" />
        <DialogContent sx={{ p: '16px 20px 6px' }}>
          {batchGeneralError && (
            <Typography sx={{ ...mono, fontSize: 11, color: 'var(--hot-ink)', mb: 1.5, whiteSpace: 'pre-line' }}>
              {batchGeneralError}
            </Typography>
          )}

          <Box sx={{ mb: 2 }}>
            <input
              ref={batchFileInputRef}
              type="file"
              multiple
              accept={ACCEPT_TYPES}
              onChange={handleBatchFileSelect}
              style={{ display: 'none' }}
            />
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25 }}>
              <Button variant="outlined" onClick={() => batchFileInputRef.current?.click()} disabled={batchImporting} sx={{ height: 36, px: 1.75 }}>
                选择图片
              </Button>
              <Typography sx={{ ...mono, fontSize: 10, opacity: 0.6 }}>
                {batchFiles.length > 0 ? `已选 ${batchFiles.length} 个文件` : '可多选'} · JPG / PNG / WebP · ≤ 10MB
              </Typography>
            </Box>
          </Box>

          {batchImporting && batchImportTotal > 0 && (
            <Box sx={{ mb: 2 }}>
              <Box sx={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', mb: 0.75 }}>
                <Typography sx={{ ...mono, fontSize: 10.5, opacity: 0.7 }}>
                  正在导入 · {batchImportProgress} / {batchImportTotal}
                </Typography>
                <Typography sx={{ ...mono, fontSize: 10.5, opacity: 0.5, fontVariantNumeric: 'tabular-nums' }}>
                  {Math.round((batchImportProgress / batchImportTotal) * 100)}%
                </Typography>
              </Box>
              <Box sx={{ height: 4, bgcolor: 'divider' }}>
                <Box sx={{ height: '100%', bgcolor: 'text.primary', width: `${(batchImportProgress / batchImportTotal) * 100}%` }} />
              </Box>
            </Box>
          )}

          {batchPreviews.length > 0 && (
            <Box sx={{ borderTop: '1px solid', borderColor: 'text.primary', maxHeight: 280, overflowY: 'auto' }}>
              {batchPreviews.map((entry, index) => (
                <Box
                  key={`${entry.file.name}-${index}`}
                  sx={{ display: 'flex', alignItems: 'center', gap: 1.25, py: 0.9, borderBottom: '1px solid', borderColor: 'divider' }}
                >
                  <Box sx={{ width: 34, height: 34, flexShrink: 0, border: '1px solid', borderColor: 'divider', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
                    {entry.valid && entry.previewUrl ? (
                      <Box component="img" src={entry.previewUrl} alt={entry.frontText} sx={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    ) : (
                      <ImageIcon sx={{ fontSize: 14, opacity: 0.35 }} />
                    )}
                  </Box>
                  <Typography className="font-kai" sx={{ fontSize: 14, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {entry.frontText || entry.file.name}
                  </Typography>
                  <Typography
                    sx={{ ...mono, fontSize: 10, flexShrink: 0, opacity: entry.valid ? 0.55 : 1, color: entry.valid ? 'inherit' : 'var(--hot-ink)' }}
                  >
                    {entry.valid ? `${(entry.file.size / 1024).toFixed(1)} KB` : entry.error}
                  </Typography>
                </Box>
              ))}
            </Box>
          )}
        </DialogContent>
        <DialogActions sx={dlgActionSx}>
          <Button onClick={handleCloseBatchDialog} disabled={batchImporting} sx={dlgCancelSx}>
            取消
          </Button>
          <Button
            onClick={handleConfirmBatchImport}
            variant="contained"
            disabled={batchImporting || batchPreviews.filter((e) => e.valid).length === 0}
            sx={dlgSaveSx}
          >
            {batchImporting ? '导入中…' : `确认导入（${batchPreviews.filter((e) => e.valid).length} 张）`}
          </Button>
        </DialogActions>
      </Dialog>

      {/* 发布到市场弹窗（仅管理员） */}
      {isAdmin && deck && (
        <EditDeckDialog
          open={publishDialogOpen}
          deckId={deck.id}
          deckName={deck.name}
          publishMode={true}
          onClose={() => setPublishDialogOpen(false)}
          onSaved={(d) => {
            if (d) setPublishedDeck(d as MarketplaceDeck);
            setPublishDialogOpen(false);
            // 刷新牌组列表以获取新的名称
            fetchDecks().then((decks) => {
              const updated = decks.find((dk) => dk.id === deck.id);
              if (updated) setDeck(updated);
            }).catch(() => {});
          }}
        />
      )}

      {/* 从市场撤回确认弹窗 */}
      <Dialog
        open={unpublishConfirmOpen}
        onClose={() => { if (!unpublishing) setUnpublishConfirmOpen(false); }}
        maxWidth="xs"
        fullWidth
      >
        <DialogHead title="从市场撤回" en="Unpublish" />
        <DialogContent sx={{ p: '16px 20px 6px' }}>
          <Typography sx={{ fontSize: 13, lineHeight: 1.8 }}>
            撤回后其他用户将无法订阅这帖，已有订阅数据不受影响。
          </Typography>
        </DialogContent>
        <DialogActions sx={dlgActionSx}>
          <Button onClick={() => setUnpublishConfirmOpen(false)} disabled={unpublishing} sx={dlgCancelSx}>
            取消
          </Button>
          <Button
            onClick={handleConfirmUnpublish}
            disabled={unpublishing}
            variant="contained"
            sx={{ ...dlgSaveSx, backgroundColor: 'var(--hot-ink)' }}
          >
            {unpublishing ? '撤回中…' : '确认撤回'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* 文章顺序设置弹窗 */}
      <Dialog
        open={articleDialogOpen}
        onClose={() => { if (!articleSetting) setArticleDialogOpen(false); }}
        maxWidth="sm"
        fullWidth
      >
        <DialogHead title="碑帖文本" en="Deck text" />
        <DialogContent sx={{ p: '16px 20px 6px' }}>
          <Typography sx={{ ...mono, fontSize: 10.5, opacity: 0.6, mb: 1.25, lineHeight: 1.9 }}>
            粘贴全文，系统把每张卡片对到文中的位置；匹配完成后学习时可选出卡顺序为「碑帖文本」。
          </Typography>

          <TextField
            autoFocus
            multiline
            minRows={6}
            maxRows={16}
            fullWidth
            value={articleTextValue}
            onChange={(e) => {
              setArticleTextValue(e.target.value);
              setArticleResult(null);
            }}
            placeholder={'在此粘贴文章全文，例如：\n大唐三藏圣教序太宗文皇帝制'}
            disabled={articleSetting}
            sx={dlgFieldSx}
          />

          {articleResult && (
            <Box
              sx={{
                mt: 1.5,
                border: '1px solid',
                borderColor: articleResult.unmatched === 0 ? 'text.primary' : 'var(--hot-ink)',
                p: '8px 12px',
                ...mono,
                fontSize: 11,
                lineHeight: 1.8,
              }}
            >
              匹配 {articleResult.matched} / {articleResult.total_cards} 张
              {articleResult.unmatched > 0 && ` · 未匹配 ${articleResult.unmatched} 张`}
            </Box>
          )}
          {articleError && (
            <Typography sx={{ ...mono, fontSize: 11, color: 'var(--hot-ink)', mt: 1.5 }}>{articleError}</Typography>
          )}
        </DialogContent>
        <DialogActions sx={dlgActionSx}>
          <Button onClick={() => setArticleDialogOpen(false)} disabled={articleSetting} sx={dlgCancelSx}>
            关闭
          </Button>
          <Button
            variant="contained"
            onClick={async () => {
              if (!deckId || !articleTextValue.trim() || articleSetting) return;
              setArticleSetting(true);
              setArticleResult(null);
              try {
                const result = await setArticleText(deckId, articleTextValue.trim());
                setArticleResult(result);
                setArticleError('');
                loadData();
                // 全部匹配成功才自动关闭；有未匹配时保留弹窗让用户看警告
                if (result.unmatched === 0) {
                  setTimeout(() => setArticleDialogOpen(false), 1200);
                }
              } catch (err) {
                setArticleError(err instanceof Error ? err.message : '保存失败');
                console.error('setArticleText error:', err);
              } finally {
                setArticleSetting(false);
              }
            }}
            disabled={!articleTextValue.trim() || articleSetting}
            sx={dlgSaveSx}
          >
            {articleSetting ? '保存中…' : '保存'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default CardManagePage;
