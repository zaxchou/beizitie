import { useState, useCallback, useEffect, useRef } from 'react';
import { useNavigate, Link as RouterLink } from 'react-router-dom';
import {
  Box,
  Typography,
  List,
  ListItem,
  ListItemText,
  ListItemSecondaryAction,
  ToggleButtonGroup,
  ToggleButton,
  Button,
  Card,
  Divider,
  Select,
  MenuItem,
  Alert,
  Snackbar,
  CircularProgress,
  LinearProgress,
  TextField,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogContentText,
  DialogActions,
  Link,
} from '@mui/material';
import RestartAltIcon from '@mui/icons-material/RestartAlt';
import DownloadIcon from '@mui/icons-material/Download';
import UploadIcon from '@mui/icons-material/Upload';
import LogoutIcon from '@mui/icons-material/Logout';
import LockIcon from '@mui/icons-material/Lock';
import GroupIcon from '@mui/icons-material/Group';
import StorageIcon from '@mui/icons-material/Storage';
import { useSettingsStore } from '@/stores/useSettingsStore';
import ConfirmDialog from '@/components/common/ConfirmDialog';
import { fetchDecks, exportDeck, exportAllDecks, exportContentPackage, importApkgFile, importLocalBackup, changePassword, publishDeck } from '@/lib/api';
import { useAuthStore } from '@/stores/useAuthStore';
import type { Deck } from '@/types';

const SettingsPage: React.FC = () => {
  const { darkMode, setDarkMode, resetToDefaults } = useSettingsStore();
  const { user, logout } = useAuthStore();
  const navigate = useNavigate();
  const [resetDialogOpen, setResetDialogOpen] = useState(false);

  // 修改密码
  const [pwdDialogOpen, setPwdDialogOpen] = useState(false);
  const [oldPwd, setOldPwd] = useState('');
  const [newPwd, setNewPwd] = useState('');
  const [confirmPwd, setConfirmPwd] = useState('');
  const [pwdLoading, setPwdLoading] = useState(false);
  const [pwdError, setPwdError] = useState('');

  // APKG 导出
  const [decks, setDecks] = useState<Deck[]>([]);
  const [selectedDeckId, setSelectedDeckId] = useState<string>('all');

  // APKG 导入
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importProgress, setImportProgress] = useState(0);
  const importingRef = useRef(false);

  // 单文件版备份导入
  const backupInputRef = useRef<HTMLInputElement>(null);
  const [backupImporting, setBackupImporting] = useState(false);

  // 导入后自动发布
  const [publishDialogOpen, setPublishDialogOpen] = useState(false);
  const [importedDecks, setImportedDecks] = useState<Array<{ id: string; name: string }>>([]);
  const [publishingDecks, setPublishingDecks] = useState(false);

  const handlePublishAll = useCallback(async () => {
    if (importedDecks.length === 0) return;
    setPublishingDecks(true);
    let successCount = 0;
    for (const d of importedDecks) {
      try {
        await publishDeck(d.id, { calligrapher: '', dynasty: '', style: '', description: '', cover_image: '', featured: false });
        successCount++;
      } catch { /* 单个失败不影响其他 */ }
    }
    setPublishingDecks(false);
    setPublishDialogOpen(false);
    setSnackbar({
      open: true,
      message: `已成功将 ${successCount}/${importedDecks.length} 个牌组发布到市场`,
      severity: successCount > 0 ? 'success' : 'error',
    });
  }, [importedDecks]);

  const handleSkipPublish = useCallback(() => {
    setPublishDialogOpen(false);
    setImportedDecks([]);
  }, []);

  // 通知
  const [snackbar, setSnackbar] = useState<{
    open: boolean;
    message: string;
    severity: 'success' | 'error' | 'info';
  }>({ open: false, message: '', severity: 'info' });

  // 加载牌组列表
  useEffect(() => {
    fetchDecks()
      .then(setDecks)
      .catch(() => setSnackbar({ open: true, message: '加载牌组列表失败', severity: 'error' }));
  }, []);

  const handleDarkModeChange = useCallback(
    (_event: React.MouseEvent<HTMLElement>, newMode: 'system' | 'light' | 'dark' | null) => {
      if (newMode !== null) setDarkMode(newMode);
    },
    [setDarkMode]
  );

  const handleConfirmReset = useCallback(() => {
    resetToDefaults();
    setResetDialogOpen(false);
  }, [resetToDefaults]);

  // 导出
  const handleExport = () => {
    if (selectedDeckId === 'all') {
      exportAllDecks();
    } else {
      const deck = decks.find((d) => d.id === selectedDeckId);
      exportDeck(selectedDeckId, deck?.name || 'deck');
    }
    setSnackbar({ open: true, message: '正在导出…', severity: 'info' });
  };

  const handleExportContentPackage = () => {
    if (selectedDeckId === 'all') {
      setSnackbar({ open: true, message: '内容包请选择单个牌组', severity: 'error' });
      return;
    }
    const deck = decks.find((d) => d.id === selectedDeckId);
    exportContentPackage(selectedDeckId, deck?.name || 'deck');
    setSnackbar({ open: true, message: '正在导出内容包…', severity: 'info' });
  };

  // 导入
  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // 校验扩展名
    if (!file.name.endsWith('.apkg')) {
      setSnackbar({ open: true, message: '请选择 .apkg 文件', severity: 'error' });
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }

    setImportProgress(0);
    importingRef.current = true;
    try {
      const result = await importApkgFile(file, (pct) => {
        setImportProgress(pct);
      });
      importingRef.current = false;
      if (result.success) {
        const totalCards = result.decks.reduce((s, d) => s + d.card_count, 0);
        const deckNames = result.decks.map((d) => d.name).join('、');
        const errors = result.errors.length > 0
          ? `（${result.errors.length} 个警告）`
          : '';
        setSnackbar({
          open: true,
          message: `导入成功！${totalCards} 张卡片 → ${deckNames} ${errors}`,
          severity: result.errors.length > 0 ? 'info' : 'success',
        });
        // 重新加载牌组列表
        fetchDecks().then(setDecks).catch(() => {});
        // 询问是否发布到市场
        setImportedDecks(result.decks.map((d) => ({ id: d.id, name: d.name })));
        setPublishDialogOpen(true);
      } else {
        const errMsg = result.errors ? result.errors.map((e) => e.message).join('; ') : (result as any).error || '导入失败';
        setSnackbar({ open: true, message: `导入失败：${errMsg}`, severity: 'error' });
      }
    } catch (err) {
      importingRef.current = false;
      setSnackbar({
        open: true,
        message: `导入出错：${err instanceof Error ? err.message : String(err)}`,
        severity: 'error',
      });
    } finally {
      setImportProgress(0);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleBackupFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setBackupImporting(true);
    try {
      const json = await file.text();
      const data = JSON.parse(json);
      if (data.format !== 'beizitie-backup' && data.format !== 'beizitie-export') {
        setSnackbar({ open: true, message: '不是背字帖的备份文件', severity: 'error' });
        return;
      }
      const result = await importLocalBackup(json);
      const r = result.report;
      const parts = [
        `匹配已有帖 ${r.decks_matched}`,
        r.decks_created ? `新建帖 ${r.decks_created}` : '',
        `进度 ${r.progress_imported} 条`,
      ].filter(Boolean);
      setSnackbar({ open: true, message: `导入成功：${parts.join('，')}`, severity: 'success' });
      fetchDecks().then(setDecks).catch(() => {});
    } catch (err) {
      setSnackbar({
        open: true,
        message: `导入失败：${err instanceof Error ? err.message : String(err)}`,
        severity: 'error',
      });
    } finally {
      setBackupImporting(false);
      if (backupInputRef.current) backupInputRef.current.value = '';
    }
  };

  return (
    <Box className="space-y-4 py-4">
      <Typography variant="h5" className="font-kai">设置</Typography>

      {/* 账号管理 */}
      <Card variant="outlined" sx={{ borderRadius: 2 }}>
        <List disablePadding>
          <ListItem className="py-4">
            <ListItemText
              primary="账号信息"
              secondary={user?.username ? `用户名：${user.username}${user.role === 'admin' ? '（管理员）' : ''}` : ''}
              primaryTypographyProps={{ variant: 'subtitle1' as const }}
            />
            <ListItemSecondaryAction>
              <Button
                variant="outlined"
                color="error"
                startIcon={<LogoutIcon />}
                onClick={() => { logout(); navigate('/login'); }}
              >
                退出登录
              </Button>
            </ListItemSecondaryAction>
          </ListItem>

          <Divider component="li" />

          {user?.role === 'admin' && (
            <>
              <ListItem className="py-4" component={RouterLink} to="/settings/admin-dashboard" sx={{ textDecoration: 'none', color: 'inherit', cursor: 'pointer' }}>
                <ListItemText
                  primary="后台数据"
                  secondary="查看生产数据、用户活跃和内容统计"
                  primaryTypographyProps={{ variant: 'subtitle1' as const }}
                />
                <ListItemSecondaryAction>
                  <StorageIcon color="action" />
                </ListItemSecondaryAction>
              </ListItem>
              <Divider component="li" />

              <ListItem className="py-4" component={RouterLink} to="/settings/users" sx={{ textDecoration: 'none', color: 'inherit', cursor: 'pointer' }}>
                <ListItemText
                  primary="用户管理"
                  secondary="管理用户账号、查看学习统计"
                  primaryTypographyProps={{ variant: 'subtitle1' as const }}
                />
                <ListItemSecondaryAction>
                  <GroupIcon color="action" />
                </ListItemSecondaryAction>
              </ListItem>
              <Divider component="li" />
            </>
          )}

          <ListItem className="py-4">
            <ListItemText
              primary="修改密码"
              secondary="修改当前账号的登录密码"
              primaryTypographyProps={{ variant: 'subtitle1' as const }}
            />
            <ListItemSecondaryAction>
              <Button
                variant="outlined"
                startIcon={<LockIcon />}
                onClick={() => {
                  setOldPwd('');
                  setNewPwd('');
                  setConfirmPwd('');
                  setPwdError('');
                  setPwdDialogOpen(true);
                }}
              >
                修改
              </Button>
            </ListItemSecondaryAction>
          </ListItem>
        </List>
      </Card>

      {/* 外观设置 */}
      <Card variant="outlined" sx={{ borderRadius: 2 }}>
        <List disablePadding>
          <ListItem className="py-4">
            <ListItemText
              primary="深色模式"
              secondary="切换界面的颜色主题"
              primaryTypographyProps={{ variant: 'subtitle1' as const }}
            />
            <ListItemSecondaryAction>
              <ToggleButtonGroup
                value={darkMode}
                exclusive
                onChange={handleDarkModeChange}
                size="small"
              >
                <ToggleButton value="system">跟随系统</ToggleButton>
                <ToggleButton value="light">浅色</ToggleButton>
                <ToggleButton value="dark">深色</ToggleButton>
              </ToggleButtonGroup>
            </ListItemSecondaryAction>
          </ListItem>

          <Divider component="li" />

          <ListItem className="py-4">
            <ListItemText
              primary="恢复默认设置"
              secondary="重置应用偏好为默认值"
              primaryTypographyProps={{ variant: 'subtitle1' as const }}
            />
            <ListItemSecondaryAction>
              <Button
                variant="outlined"
                color="error"
                startIcon={<RestartAltIcon />}
                onClick={() => setResetDialogOpen(true)}
              >
                重置
              </Button>
            </ListItemSecondaryAction>
          </ListItem>
        </List>
      </Card>

      {/* 单文件版备份导入（所有登录用户可见） */}
      <Card variant="outlined" sx={{ borderRadius: 2 }}>
        <List disablePadding>
          <ListItem className="py-4 flex-col items-start gap-2">
            <ListItemText
              primary="导入单文件版备份"
              secondary="选择单文件版（beizitie.html）导出的备份 JSON，学习进度将恢复到本账号"
              primaryTypographyProps={{ variant: 'subtitle1' as const }}
              sx={{ width: '100%' }}
            />
            <Box className="self-stretch flex justify-end">
              <input
                ref={backupInputRef}
                type="file"
                accept=".json,application/json"
                hidden
                onChange={handleBackupFileChange}
              />
              <Button
                variant="outlined"
                disabled={backupImporting}
                startIcon={backupImporting ? <CircularProgress size={18} /> : <UploadIcon />}
                onClick={() => backupInputRef.current?.click()}
              >
                {backupImporting ? '导入中…' : '选择备份文件'}
              </Button>
            </Box>
          </ListItem>
        </List>
      </Card>

      {/* APKG 导入/导出（仅管理员可见） */}
      {user?.role === 'admin' && (
        <Card variant="outlined" sx={{ borderRadius: 2 }}>
          <List disablePadding>
            <ListItem className="py-4 flex-col items-start gap-2">
              <ListItemText
                primary="导出牌组"
                secondary="将牌组导出为 .apkg 格式，可在 Anki 桌面版中导入"
                primaryTypographyProps={{ variant: 'subtitle1' as const }}
                sx={{ width: '100%' }}
              />
              <Box className="flex items-center gap-2 self-stretch justify-end">
                <Select
                  size="small"
                  value={selectedDeckId}
                  onChange={(e) => setSelectedDeckId(e.target.value)}
                  sx={{ minWidth: 140 }}
                >
                  <MenuItem value="all">全部牌组</MenuItem>
                  {decks.map((d) => (
                    <MenuItem key={d.id} value={d.id}>{d.name}</MenuItem>
                  ))}
                </Select>
                <Button
                  variant="outlined"
                  startIcon={<DownloadIcon />}
                  onClick={handleExport}
                >
                  导出
                </Button>
                <Button
                  variant="outlined"
                  startIcon={<DownloadIcon />}
                  onClick={handleExportContentPackage}
                  disabled={selectedDeckId === 'all'}
                >
                  内容包
                </Button>
              </Box>
            </ListItem>

            <Divider component="li" />

            <ListItem className="py-4 flex-col items-start gap-2">
              <ListItemText
                primary="导入牌组"
                secondary="从 .apkg 文件导入卡片，同名牌组合并"
                primaryTypographyProps={{ variant: 'subtitle1' as const }}
                sx={{ width: '100%' }}
              />
              <Box className="self-stretch flex justify-end">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".apkg"
                  hidden
                  onChange={handleFileChange}
                />
                <Button
                  variant="outlined"
                  disabled={importProgress > 0}
                  startIcon={importProgress > 0 ? <CircularProgress size={18} /> : <UploadIcon />}
                  onClick={() => fileInputRef.current?.click()}
                >
                  {importProgress > 0 ? `上传中 ${importProgress}%` : '选择文件'}
                </Button>
              </Box>
              {importProgress > 0 && (
                <LinearProgress
                  variant="determinate"
                  value={importProgress}
                  sx={{ mt: 1, borderRadius: 1, height: 6 }}
                />
              )}
            </ListItem>
          </List>

          <Divider />

          <Box sx={{ px: 2, py: 1.5 }}>
            <Link
              component={RouterLink}
              to="/decks"
              underline="hover"
              sx={{ fontSize: 14, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 0.5 }}
            >
              前往牌组管理 →
            </Link>
          </Box>
        </Card>
      )}

      <Typography variant="body2" color="text.secondary" className="text-center">
        新卡和复习上限请在「牌组管理」中为每个牌组单独设置
      </Typography>

      <ConfirmDialog
        open={resetDialogOpen}
        title="恢复默认设置"
        message="确定要将所有设置恢复为默认值吗？"
        onConfirm={handleConfirmReset}
        onCancel={() => setResetDialogOpen(false)}
      />

      <Snackbar
        open={snackbar.open}
        autoHideDuration={4000}
        onClose={() => setSnackbar((s) => ({ ...s, open: false }))}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert
          severity={snackbar.severity}
          onClose={() => setSnackbar((s) => ({ ...s, open: false }))}
        >
          {snackbar.message}
        </Alert>
      </Snackbar>

      {/* 修改密码对话框 */}
      <Dialog open={pwdDialogOpen} onClose={() => setPwdDialogOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>修改密码</DialogTitle>
        <DialogContent>
          {pwdError && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setPwdError('')}>{pwdError}</Alert>}
          <TextField
            fullWidth
            margin="dense"
            label="旧密码"
            type="password"
            value={oldPwd}
            onChange={(e) => setOldPwd(e.target.value)}
            autoComplete="current-password"
            disabled={pwdLoading}
          />
          <TextField
            fullWidth
            margin="dense"
            label="新密码"
            type="password"
            value={newPwd}
            onChange={(e) => setNewPwd(e.target.value)}
            helperText="6-64 个字符"
            autoComplete="new-password"
            disabled={pwdLoading}
          />
          <TextField
            fullWidth
            margin="dense"
            label="确认新密码"
            type="password"
            value={confirmPwd}
            onChange={(e) => setConfirmPwd(e.target.value)}
            autoComplete="new-password"
            disabled={pwdLoading}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPwdDialogOpen(false)} disabled={pwdLoading}>取消</Button>
          <Button
            variant="contained"
            disabled={pwdLoading || !oldPwd || !newPwd || !confirmPwd}
            onClick={async () => {
              if (newPwd !== confirmPwd) {
                setPwdError('两次输入的新密码不一致');
                return;
              }
              setPwdLoading(true);
              setPwdError('');
              try {
                await changePassword(oldPwd, newPwd);
                setPwdDialogOpen(false);
                setSnackbar({ open: true, message: '密码修改成功', severity: 'success' });
              } catch (err) {
                setPwdError(err instanceof Error ? err.message : '修改失败');
              } finally {
                setPwdLoading(false);
              }
            }}
          >
            {pwdLoading ? <CircularProgress size={20} color="inherit" /> : '确认修改'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* 导入后自动发布确认 */}
      <Dialog open={publishDialogOpen} onClose={handleSkipPublish} maxWidth="xs" fullWidth>
        <DialogTitle>发布到市场</DialogTitle>
        <DialogContent>
          <DialogContentText>
            已成功导入 {importedDecks.length} 个牌组。是否要将它们发布到市场中？
            发布后其他用户可以在市场中浏览和订阅这些牌组。
            {importedDecks.length > 0 && (
              <Box component="ul" sx={{ mt: 1, pl: 2 }}>
                {importedDecks.map((d) => (
                  <Typography component="li" variant="body2" key={d.id}>{d.name}</Typography>
                ))}
              </Box>
            )}
          </DialogContentText>
          <Alert severity="info" sx={{ mt: 2, py: 0.5 }}>
            导入的牌组也可以稍后在卡牌管理页面中随时发布。
          </Alert>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleSkipPublish} disabled={publishingDecks} color="inherit">
            暂不发布
          </Button>
          <Button onClick={handlePublishAll} disabled={publishingDecks} variant="contained">
            {publishingDecks ? <CircularProgress size={20} color="inherit" /> : '发布全部'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default SettingsPage;
