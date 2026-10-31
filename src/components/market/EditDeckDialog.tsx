import { useEffect, useState, useCallback, useRef } from 'react';
import { Dialog, DialogContent, Button, TextField, Box, Typography } from '@mui/material';
import {
  fetchMarketplaceDeck,
  publishDeck,
  updateMarketplaceDeck,
  updateDeckName,
  uploadMarketCover,
  getImageUrl,
} from '@/lib/api';
import type { PublishDeckData, MarketplaceDeck } from '@/types';
import { DialogHead, FieldLabel, dlgFieldSx, DlgActions, dlgCancelSx, dlgSaveSx } from '@/components/common/DialogKit';

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
      <DialogHead
        title={publishMode ? (isPublished ? '编辑市场信息' : '发布到市场') : '编辑牌组信息'}
        en={publishMode ? 'Market listing' : 'Deck info'}
        sub={deckName}
      />
      <DialogContent sx={{ p: '16px 20px 6px' }}>
        {loading ? (
          <Typography sx={{ fontFamily: 'var(--font-mono)', fontSize: 11, opacity: 0.7, py: 5 }}>
            正在读取牌组…
          </Typography>
        ) : (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.25 }}>
            {error && (
              <Typography sx={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--hot-ink)' }}>{error}</Typography>
            )}
            {coverSuccess && (
              <Typography sx={{ fontFamily: 'var(--font-mono)', fontSize: 11, opacity: 0.75 }}>封面图上传成功</Typography>
            )}
            {isPublished && publishMode && (
              <Typography sx={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, opacity: 0.6 }}>
                已发布到市场 · 修改立即生效
              </Typography>
            )}

            <Box>
              <FieldLabel>牌组名称 · Title</FieldLabel>
              <TextField
                fullWidth
                value={editingDeckName}
                onChange={(e) => setEditingDeckName(e.target.value)}
                disabled={saving}
                sx={dlgFieldSx}
              />
            </Box>

            <Box>
              <FieldLabel hint="封面用于市场书表缩略图">封面图 · Cover</FieldLabel>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 1 }}>
                <Box
                  sx={{
                    width: 84,
                    height: 60,
                    flexShrink: 0,
                    border: '1px solid',
                    borderColor: 'divider',
                    overflow: 'hidden',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  {coverImageUrl ? (
                    <Box component="img" src={getImageUrl(coverImageUrl)} sx={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  ) : (
                    <Typography sx={{ fontFamily: 'var(--font-mono)', fontSize: 9, opacity: 0.45 }}>无封面</Typography>
                  )}
                </Box>
                <Box component="label" sx={{ cursor: 'pointer', fontFamily: 'var(--font-mono)', fontSize: 11, textDecoration: 'underline', textUnderlineOffset: 3, opacity: uploading ? 0.5 : 0.8, '&:hover': { opacity: 1 } }}>
                  {uploading ? '上传中…' : '上传本地图片'}
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    hidden
                    disabled={uploading}
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) handleCoverUpload(f);
                    }}
                  />
                </Box>
              </Box>
              <TextField
                fullWidth
                size="small"
                value={coverImageUrl}
                onChange={(e) => setCoverImageUrl(e.target.value)}
                disabled={saving || uploading}
                placeholder="或输入封面图 URL：https://…"
                sx={dlgFieldSx}
              />
            </Box>

            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 2 }}>
              <Box>
                <FieldLabel required={publishMode}>书家 · Author</FieldLabel>
                <TextField
                  fullWidth
                  required={publishMode}
                  value={calligrapher}
                  onChange={(e) => setCalligrapher(e.target.value)}
                  placeholder="例如：王羲之"
                  disabled={saving}
                  sx={dlgFieldSx}
                />
              </Box>
              <Box>
                <FieldLabel>朝代 · Dynasty</FieldLabel>
                <TextField
                  fullWidth
                  value={dynasty}
                  onChange={(e) => setDynasty(e.target.value)}
                  placeholder="例如：东晋"
                  disabled={saving}
                  sx={dlgFieldSx}
                />
              </Box>
            </Box>

            <Box>
              <FieldLabel>书体 · Script</FieldLabel>
              <Box sx={{ display: 'flex' }}>
                {STYLE_OPTIONS.map((s, i) => {
                  const on = style.includes(s);
                  return (
                    <Box
                      key={s}
                      component="button"
                      type="button"
                      onClick={() => {
                        setStyle((prev) => (prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]));
                      }}
                      disabled={saving}
                      aria-pressed={on}
                      sx={{
                        flex: 1,
                        border: '1px solid',
                        borderColor: on ? 'text.primary' : 'divider',
                        borderLeftWidth: i === 0 ? 1 : 0,
                        bgcolor: on ? 'text.primary' : 'transparent',
                        color: on ? 'background.default' : 'inherit',
                        height: 34,
                        cursor: saving ? 'not-allowed' : 'pointer',
                        fontSize: 13,
                        opacity: saving ? 0.5 : 1,
                        '&:hover': on || saving ? {} : { borderColor: 'text.primary' },
                      }}
                    >
                      {s}
                    </Box>
                  );
                })}
              </Box>
            </Box>

            <Box>
              <FieldLabel>简介 · Description</FieldLabel>
              <TextField
                fullWidth
                multiline
                minRows={3}
                maxRows={6}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="牌组简介、内容特点…"
                disabled={saving}
                sx={dlgFieldSx}
              />
            </Box>

            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 2, borderTop: '1px solid', borderColor: 'divider', pt: 1.75 }}>
              <Box>
                <Typography sx={{ fontSize: 14 }}>推荐牌组</Typography>
                <Typography sx={{ fontFamily: 'var(--font-mono)', fontSize: 9.5, opacity: 0.55, mt: 0.3 }}>
                  FEATURED · 市场中显示推荐标记
                </Typography>
              </Box>
              <Box
                component="button"
                type="button"
                onClick={() => setFeatured((v) => !v)}
                disabled={saving}
                aria-pressed={featured}
                sx={{
                  border: '1px solid',
                  borderColor: featured ? 'text.primary' : 'divider',
                  bgcolor: featured ? 'text.primary' : 'transparent',
                  color: featured ? 'background.default' : 'inherit',
                  fontFamily: 'var(--font-mono)',
                  fontSize: 11,
                  height: 28,
                  px: 1.25,
                  cursor: saving ? 'not-allowed' : 'pointer',
                  flexShrink: 0,
                }}
              >
                {featured ? '推荐' : '普通'}
              </Box>
            </Box>
          </Box>
        )}
      </DialogContent>
      <DlgActions>
        <Button onClick={onClose} disabled={saving || uploading} sx={dlgCancelSx}>
          取消
        </Button>
        <Button
          variant="contained"
          onClick={handleSave}
          disabled={loading || saving || uploading || (publishMode && !calligrapher.trim())}
          sx={dlgSaveSx}
        >
          {saving ? '保存中…' : isPublished ? '保存修改' : '发布'}
        </Button>
      </DlgActions>
    </Dialog>
  );
};

export default EditDeckDialog;
