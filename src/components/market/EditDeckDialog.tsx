import { useEffect, useState, useCallback, useRef } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  TextField,
  Switch,
  FormControlLabel,
  Box,
  Typography,
  Alert,
  CircularProgress,
  Divider,
  Chip,
} from '@mui/material';
import {
  fetchMarketplaceDeck,
  publishDeck,
  updateMarketplaceDeck,
  updateDeckName,
  uploadMarketCover,
  getImageUrl,
} from '@/lib/api';
import type { PublishDeckData, MarketplaceDeck } from '@/types';

/** 书体选项 */
const STYLE_OPTIONS = ['楷', '行', '草', '隶', '篆'] as const;

export interface EditDeckDialogProps {
  open: boolean;
  deckId: string | null;
  deckName: string;
  onClose: () => void;
  onSaved: (deck?: MarketplaceDeck) => void;
  /** true = 发布模式（"发布到市场"/"编辑市场信息"标题，书家必填）
   *  false = 仅编辑模式（"编辑牌组信息"标题，无必填） */
  publishMode?: boolean;
}

/**
 * 统一牌组编辑对话框。
 * 同时支持发布到市场（publishMode=true）和编辑已有市场信息（publishMode=false）。
 * 封面图同时支持 URL 输入和本地文件上传。
 */
const EditDeckDialog: React.FC<EditDeckDialogProps> = ({
  open,
  deckId,
  deckName,
  onClose,
  onSaved,
  publishMode = false,
}) => {
  const [calligrapher, setCalligrapher] = useState('');
  const [dynasty, setDynasty] = useState('');
  const [style, setStyle] = useState<string[]>([]);
  const [description, setDescription] = useState('');
  const [coverImageUrl, setCoverImageUrl] = useState('');
  const [featured, setFeatured] = useState(false);
  const [editingDeckName, setEditingDeckName] = useState(deckName);

  // 当 props.deckName 变化时同步
  useEffect(() => { setEditingDeckName(deckName); }, [deckName]);

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [coverSuccess, setCoverSuccess] = useState(false);
  const [isPublished, setIsPublished] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  /** 加载已发布元数据 */
  const loadExisting = useCallback(async (id: string) => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchMarketplaceDeck(id);
      setIsPublished(true);
      setCalligrapher(data.calligrapher || '');
      setDynasty(data.dynasty || '');
      setStyle(data.style ? data.style.split(',').filter(Boolean) : []);
      setDescription(data.description || '');
      setCoverImageUrl(data.cover_image || '');
      setFeatured(data.featured === 1);
    } catch {
      // 未发布或不存在的市场牌组：视为新发布
      setIsPublished(false);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open && deckId) {
      // 重置状态
      setCalligrapher('');
      setDynasty('');
      setStyle([]);
      setDescription('');
      setCoverImageUrl('');
      setFeatured(false);
      setError(null);
      setCoverSuccess(false);
      setIsPublished(false);
      loadExisting(deckId);
    }
  }, [open, deckId, loadExisting]);

  /** 封面文件上传 */
  const handleCoverUpload = useCallback(async (file: File) => {
    if (!deckId) return;
    setUploading(true);
    setError(null);
    try {
      const result = await uploadMarketCover(deckId, file);
      setCoverImageUrl(result.cover_image);
      setCoverSuccess(true);
      setTimeout(() => setCoverSuccess(false), 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : '封面上传失败');
    } finally {
      setUploading(false);
    }
  }, [deckId]);

  /** 保存 */
  const handleSave = useCallback(async () => {
    if (!deckId || saving) return;
    if (publishMode && !calligrapher.trim()) {
      setError('请填写书家');
      return;
    }
    setSaving(true);
    setError(null);

    const payload: PublishDeckData = {
      calligrapher: calligrapher.trim(),
      dynasty: dynasty.trim(),
      style: style.join(','),
      description: description.trim(),
      cover_image: coverImageUrl.trim(),
      featured,
    };

    try {
      // 如果牌组名称有变化，先更新
      if (editingDeckName.trim() !== deckName.trim()) {
        await updateDeckName(deckId, editingDeckName.trim());
      }

      let result: MarketplaceDeck;
      if (isPublished) {
        result = await updateMarketplaceDeck(deckId, payload);
      } else {
        result = await publishDeck(deckId, payload);
      }
      setIsPublished(true);
      onSaved(result);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败');
    } finally {
      setSaving(false);
    }
  }, [
    deckId, saving, publishMode,
    calligrapher, dynasty, style, description, coverImageUrl, featured,
    editingDeckName, deckName, isPublished, onSaved, onClose,
  ]);

  return (
    <Dialog open={open} onClose={saving || uploading ? undefined : onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ pb: 1 }}>
        {publishMode
          ? (isPublished ? '编辑市场信息' : '发布到市场')
          : '编辑牌组信息'
        }
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
          牌组：{deckName}
        </Typography>
      </DialogTitle>
      <DialogContent sx={{ pt: 2 }}>
        {loading ? (
          <Box className="flex justify-center py-8">
            <CircularProgress />
          </Box>
        ) : (
          <Box className="space-y-3">
            {error && <Alert severity="error">{error}</Alert>}
            {coverSuccess && <Alert severity="success" sx={{ py: 0.5 }}>封面图上传成功</Alert>}
            {isPublished && publishMode && (
              <Alert severity="info" sx={{ py: 0.5 }}>
                该牌组已发布到市场，修改将立即生效。
              </Alert>
            )}

            {/* 牌组名称 */}
            <TextField
              fullWidth
              label="牌组名称"
              value={editingDeckName}
              onChange={(e) => setEditingDeckName(e.target.value)}
              disabled={saving}
            />

            {/* 封面图 */}
            <Box>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 1, fontSize: 13 }}>
                封面图
              </Typography>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 1 }}>
                <Box
                  sx={{
                    width: 100, height: 70, borderRadius: '2px', overflow: 'hidden',
                    bgcolor: (t) => t.palette.mode === 'dark' ? 'rgba(255,255,255,0.08)' : 'grey.100',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                    boxShadow: (t) => t.palette.mode === 'dark' ? '0px 0px 0px 1px rgba(255,255,255,0.12)' : '0px 0px 0px 1px rgba(0,0,0,0.08)',
                  }}
                >
                  {coverImageUrl ? (
                    <Box component="img" src={getImageUrl(coverImageUrl)} sx={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  ) : (
                    <Typography fontSize={11} color="text.disabled">无封面</Typography>
                  )}
                </Box>
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                  <Box component="label" sx={{ cursor: 'pointer', fontSize: 13, color: 'primary.main', '&:hover': { textDecoration: 'underline' } }}>
                    {uploading ? '上传中...' : '上传本地图片'}
                    <input
                      ref={fileInputRef}
                      type="file" accept="image/*" hidden
                      disabled={uploading}
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) handleCoverUpload(f);
                      }}
                    />
                  </Box>
                </Box>
              </Box>
              <TextField
                fullWidth
                size="small"
                label="或输入封面图 URL"
                value={coverImageUrl}
                onChange={(e) => setCoverImageUrl(e.target.value)}
                disabled={saving || uploading}
                placeholder="https://..."
              />
            </Box>

            <Divider />

            {/* 书家 */}
            <TextField
              fullWidth
              required={publishMode}
              label="书家"
              value={calligrapher}
              onChange={(e) => setCalligrapher(e.target.value)}
              placeholder="例如：王羲之"
              disabled={saving}
            />

            {/* 朝代 */}
            <TextField
              fullWidth
              label="朝代"
              value={dynasty}
              onChange={(e) => setDynasty(e.target.value)}
              placeholder="例如：东晋"
              disabled={saving}
            />

            {/* 书体（多选） */}
            <Box>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 0.75, fontSize: 13 }}>
                书体
              </Typography>
              <Box sx={{ display: 'flex', gap: 0.5 }}>
                {STYLE_OPTIONS.map((s) => (
                  <Chip
                    key={s}
                    label={s}
                    size="small"
                    color={style.includes(s) ? 'primary' : 'default'}
                    variant={style.includes(s) ? 'filled' : 'outlined'}
                    onClick={() => {
                      setStyle((prev) =>
                        prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]
                      );
                    }}
                    disabled={saving}
                    sx={{ cursor: 'pointer' }}
                  />
                ))}
              </Box>
            </Box>

            {/* 简介 */}
            <TextField
              fullWidth
              multiline
              minRows={3}
              maxRows={6}
              label="简介"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="牌组简介、内容特点等..."
              disabled={saving}
            />

            {/* 推荐状态 */}
            <Divider />
            <FormControlLabel
              control={
                <Switch
                  checked={featured}
                  onChange={(e) => setFeatured(e.target.checked)}
                  disabled={saving}
                  color="primary"
                />
              }
              label={
                <Box>
                  <Typography variant="body2" component="span" fontWeight={500}>
                    推荐牌组
                  </Typography>
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                    推荐牌组会在市场中显示"推荐"标记
                  </Typography>
                </Box>
              }
            />
          </Box>
        )}
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose} disabled={saving || uploading} color="inherit">
          取消
        </Button>
        <Button
          variant="contained"
          onClick={handleSave}
          disabled={loading || saving || uploading || (publishMode && !calligrapher.trim())}
          startIcon={saving ? <CircularProgress size={16} color="inherit" /> : undefined}
        >
          {saving ? '保存中...' : isPublished ? '保存修改' : '发布'}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default EditDeckDialog;
