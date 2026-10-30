import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Box,
  Typography,
  Card,
  CardContent,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Button,
  IconButton,
  TextField,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Alert,
  CircularProgress,
  Chip,
  Tooltip,
  Snackbar,
} from '@mui/material';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import VisibilityIcon from '@mui/icons-material/Visibility';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import { useAuthStore } from '@/stores/useAuthStore';
import {
  fetchAdminUsers,
  updateAdminUser,
  deleteAdminUser,
  fetchUserStats,
  type AdminUser,
  type UserStatsResponse,
} from '@/lib/api';

const UserManagePage: React.FC = () => {
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const isAdmin = user?.role === 'admin';

  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // 编辑对话框
  const [editOpen, setEditOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<AdminUser | null>(null);
  const [editUsername, setEditUsername] = useState('');
  const [editPassword, setEditPassword] = useState('');
  const [editLoading, setEditLoading] = useState(false);
  const [editError, setEditError] = useState('');

  // 删除确认
  const [deleteTarget, setDeleteTarget] = useState<AdminUser | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [deleteError, setDeleteError] = useState('');

  // 统计查看
  const [statsOpen, setStatsOpen] = useState(false);
  const [statsTarget, setStatsTarget] = useState<AdminUser | null>(null);
  const [statsData, setStatsData] = useState<UserStatsResponse | null>(null);
  const [statsLoading, setStatsLoading] = useState(false);
  const [statsError, setStatsError] = useState('');

  // Snackbar
  const [snackbar, setSnackbar] = useState<{ open: boolean; message: string; severity: 'success' | 'error' }>({
    open: false, message: '', severity: 'success',
  });

  const loadUsers = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchAdminUsers();
      setUsers(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isAdmin) {
      navigate('/settings');
      return;
    }
    loadUsers();
  }, [isAdmin, navigate, loadUsers]);

  // 打开编辑对话框
  const handleOpenEdit = (u: AdminUser) => {
    setEditTarget(u);
    setEditUsername(u.username);
    setEditPassword('');
    setEditError('');
    setEditOpen(true);
  };

  // 提交编辑
  const handleEditSubmit = async () => {
    if (!editTarget) return;
    if (!editUsername.trim()) {
      setEditError('用户名不能为空');
      return;
    }
    setEditLoading(true);
    setEditError('');
    try {
      const body: { username?: string; password?: string } = {};
      if (editUsername.trim() !== editTarget.username) body.username = editUsername.trim();
      if (editPassword) body.password = editPassword;
      if (Object.keys(body).length === 0) {
        setEditError('没有要修改的内容');
        setEditLoading(false);
        return;
      }
      await updateAdminUser(editTarget.id, body);
      setEditOpen(false);
      setSnackbar({ open: true, message: '用户信息已更新', severity: 'success' });
      loadUsers();
    } catch (err) {
      setEditError(err instanceof Error ? err.message : '修改失败');
    } finally {
      setEditLoading(false);
    }
  };

  // 删除用户
  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleteLoading(true);
    setDeleteError('');
    try {
      await deleteAdminUser(deleteTarget.id);
      setDeleteTarget(null);
      setSnackbar({ open: true, message: `用户「${deleteTarget.username}」已删除`, severity: 'success' });
      loadUsers();
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : '删除失败');
    } finally {
      setDeleteLoading(false);
    }
  };

  // 查看统计
  const handleViewStats = async (u: AdminUser) => {
    setStatsTarget(u);
    setStatsData(null);
    setStatsError('');
    setStatsOpen(true);
    setStatsLoading(true);
    try {
      const data = await fetchUserStats(u.id);
      setStatsData(data);
    } catch (err) {
      setStatsError(err instanceof Error ? err.message : '加载统计失败');
    } finally {
      setStatsLoading(false);
    }
  };

  if (!isAdmin) return null;

  return (
    <Box className="space-y-4 py-4">
      {/* 顶部导航 */}
      <Box className="flex items-center gap-2">
        <IconButton onClick={() => navigate('/settings')} size="small">
          <ArrowBackIcon />
        </IconButton>
        <Typography variant="h5" className="font-kai">用户管理</Typography>
      </Box>

      {error && <Alert severity="error">{error}</Alert>}

      {/* 用户列表 */}
      <Card variant="outlined" sx={{ borderRadius: '2px' }}>
        <CardContent sx={{ p: 0, '&:last-child': { pb: 0 } }}>
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell sx={{ fontWeight: 600 }}>用户名</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>角色</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>注册时间</TableCell>
                  <TableCell sx={{ fontWeight: 600 }} align="right">操作</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {loading ? (
                  <TableRow>
                    <TableCell colSpan={4} align="center" sx={{ py: 4 }}>
                      <CircularProgress size={24} />
                    </TableCell>
                  </TableRow>
                ) : users.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} align="center" sx={{ py: 4, color: 'text.secondary' }}>
                      暂无用户
                    </TableCell>
                  </TableRow>
                ) : (
                  users.map((u) => (
                    <TableRow key={u.id} hover>
                      <TableCell>
                        <Box className="flex items-center gap-1.5">
                          {u.username}
                          {u.id === user?.id && (
                            <Chip label="当前账号" size="small" color="primary" variant="outlined" sx={{ height: 20, fontSize: 11 }} />
                          )}
                        </Box>
                      </TableCell>
                      <TableCell>
                        <Chip
                          label={u.role === 'admin' ? '管理员' : '用户'}
                          size="small"
                          color={u.role === 'admin' ? 'warning' : 'default'}
                          variant="outlined"
                          sx={{ height: 20, fontSize: 11 }}
                        />
                      </TableCell>
                      <TableCell sx={{ fontSize: 13, color: 'text.secondary' }}>
                        {new Date(u.created_at).toLocaleDateString('zh-CN')}
                      </TableCell>
                      <TableCell align="right">
                        <Box className="flex items-center justify-end gap-0.5">
                          <Tooltip title="查看统计">
                            <IconButton size="small" onClick={() => handleViewStats(u)}>
                              <VisibilityIcon fontSize="small" />
                            </IconButton>
                          </Tooltip>
                          <Tooltip title="编辑">
                            <IconButton size="small" onClick={() => handleOpenEdit(u)}>
                              <EditIcon fontSize="small" />
                            </IconButton>
                          </Tooltip>
                          {u.id !== user?.id && (
                            <Tooltip title="删除">
                              <IconButton size="small" color="error" onClick={() => { setDeleteTarget(u); setDeleteError(''); }}>
                                <DeleteIcon fontSize="small" />
                              </IconButton>
                            </Tooltip>
                          )}
                        </Box>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </TableContainer>
        </CardContent>
      </Card>

      {/* 编辑对话框 */}
      <Dialog open={editOpen} onClose={() => setEditOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>编辑用户 — {editTarget?.username}</DialogTitle>
        <DialogContent>
          {editError && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setEditError('')}>{editError}</Alert>}
          <TextField
            fullWidth
            margin="dense"
            label="用户名"
            value={editUsername}
            onChange={(e) => setEditUsername(e.target.value)}
            disabled={editLoading}
          />
          <TextField
            fullWidth
            margin="dense"
            label="新密码（留空则不修改）"
            type="password"
            value={editPassword}
            onChange={(e) => setEditPassword(e.target.value)}
            helperText="6-64 个字符"
            disabled={editLoading}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setEditOpen(false)} disabled={editLoading}>取消</Button>
          <Button variant="contained" disabled={editLoading} onClick={handleEditSubmit}>
            {editLoading ? <CircularProgress size={20} color="inherit" /> : '保存'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* 删除确认对话框 */}
      <Dialog open={!!deleteTarget} onClose={() => setDeleteTarget(null)} maxWidth="xs" fullWidth>
        <DialogTitle>确认删除</DialogTitle>
        <DialogContent>
          {deleteError && <Alert severity="error" sx={{ mb: 2 }}>{deleteError}</Alert>}
          <Typography>
            确定要删除用户「{deleteTarget?.username}」吗？
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            该用户的学习进度将被清除，其创建的牌组将转移给管理员。
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteTarget(null)} disabled={deleteLoading}>取消</Button>
          <Button variant="contained" color="error" disabled={deleteLoading} onClick={handleDelete}>
            {deleteLoading ? <CircularProgress size={20} color="inherit" /> : '确认删除'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* 统计查看对话框 */}
      <Dialog open={statsOpen} onClose={() => setStatsOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>
          学习统计 — {statsTarget?.username}
        </DialogTitle>
        <DialogContent>
          {statsLoading ? (
            <Box className="flex justify-center py-8"><CircularProgress /></Box>
          ) : statsError ? (
            <Alert severity="error">{statsError}</Alert>
          ) : statsData ? (
            <Box className="space-y-4">
              {/* 汇总卡片 */}
              <Box display="grid" gridTemplateColumns="1fr 1fr 1fr" gap={1.5}>
                <StatBox label="累计学习" value={statsData.stats.total_studied} unit="张" />
                <StatBox label="学习天数" value={statsData.stats.active_days} unit="天" />
                <StatBox label="学习时长" value={statsData.stats.total_minutes} unit="分钟" />
              </Box>
              <Box display="grid" gridTemplateColumns="1fr 1fr 1fr" gap={1.5}>
                <StatBox label="新卡" value={statsData.stats.cards.new_count} unit="张" />
                <StatBox label="学习中" value={statsData.stats.cards.learning_count} unit="张" />
                <StatBox label="已掌握" value={statsData.stats.cards.mature_count} unit="张" />
              </Box>

              {/* 已订阅牌组 */}
              <Box>
                <Typography variant="subtitle2" fontWeight={600} sx={{ mb: 0.5 }}>已订阅牌组</Typography>
                {statsData.subscriptions.length === 0 ? (
                  <Typography variant="body2" color="text.secondary">无</Typography>
                ) : (
                  <Box className="flex flex-wrap gap-1">
                    {statsData.subscriptions.map((s) => (
                      <Chip key={s.id} label={s.name} size="small" variant="outlined" />
                    ))}
                  </Box>
                )}
              </Box>
            </Box>
          ) : null}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setStatsOpen(false)}>关闭</Button>
        </DialogActions>
      </Dialog>

      {/* Snackbar */}
      <Snackbar
        open={snackbar.open}
        autoHideDuration={3000}
        onClose={() => setSnackbar((s) => ({ ...s, open: false }))}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert severity={snackbar.severity} onClose={() => setSnackbar((s) => ({ ...s, open: false }))}>
          {snackbar.message}
        </Alert>
      </Snackbar>
    </Box>
  );
};

/** 统计数字卡片 */
const StatBox: React.FC<{ label: string; value: number; unit: string }> = ({ label, value, unit }) => (
  <Box sx={{ border: 1, borderColor: 'divider', borderRadius: '2px', p: 1.25, bgcolor: 'action.hover' }}>
    <Typography variant="caption" color="text.secondary" sx={{ fontSize: 11 }}>{label}</Typography>
    <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 0.5, mt: 0.25 }}>
      <Typography sx={{ fontWeight: 600, fontSize: 20, lineHeight: 1.1 }}>{value}</Typography>
      <Typography variant="caption" color="text.secondary">{unit}</Typography>
    </Box>
  </Box>
);

export default UserManagePage;
