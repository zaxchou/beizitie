import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  Snackbar,
  Typography,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import SearchIcon from '@mui/icons-material/Search';
import { useAuthStore } from '@/stores/useAuthStore';
import { DialogHead } from '@/components/common/DialogKit';
import {
  fetchAdminUsers,
  updateAdminUser,
  deleteAdminUser,
  fetchUserStats,
  type AdminUser,
  type UserStatsResponse,
} from '@/lib/api';

const mono = { fontFamily: 'var(--font-mono)', letterSpacing: '0.04em' } as const;

/** 用户管理：一行一个账号，统计进弹窗，避免表格里塞 N 次请求 */
const UserManagePage: React.FC = () => {
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const isAdmin = user?.role === 'admin';

  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [keyword, setKeyword] = useState('');
  const [roleFilter, setRoleFilter] = useState<'admin' | 'user' | null>(null);

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

  const handleOpenEdit = (u: AdminUser) => {
    setEditTarget(u);
    setEditUsername(u.username);
    setEditPassword('');
    setEditError('');
    setEditOpen(true);
  };

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

  const admins = users.filter((u) => u.role === 'admin').length;
  const filtered = users.filter((u) => {
    if (roleFilter === 'admin' && u.role !== 'admin') return false;
    if (roleFilter === 'user' && u.role === 'admin') return false;
    const kw = keyword.trim().toLowerCase();
    return !kw || u.username.toLowerCase().includes(kw);
  });

  const latest = users.reduce<string | null>((acc, u) => (!acc || u.created_at > acc ? u.created_at : acc), null);

  const FILTERS: { key: 'admin' | 'user' | null; label: string; en: string; n: number }[] = [
    { key: null, label: '全部', en: 'ALL', n: users.length },
    { key: 'admin', label: '管理员', en: 'ADMIN', n: admins },
    { key: 'user', label: '用户', en: 'USER', n: users.length - admins },
  ];

  const rowActionSx = {
    border: 0,
    background: 'none',
    color: 'inherit',
    p: 0,
    cursor: 'pointer',
    ...mono,
    fontSize: 11,
    opacity: 0.72,
    '&:hover': { opacity: 1, textDecoration: 'underline' },
  } as const;

  return (
    <Box>
      {/* 页头 */}
      <Box sx={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 2, pb: { xs: 1.5, md: 1.75 } }}>
        <Box sx={{ minWidth: 0 }}>
          <Button
            variant="text"
            onClick={() => navigate('/settings')}
            sx={{ minHeight: 0, p: 0, mb: 1, fontSize: 11, ...mono, color: 'text.primary', opacity: 0.7, '&:hover': { backgroundColor: 'transparent', opacity: 1 } }}
          >
            ← 设置
          </Button>
          <Typography component="h1" sx={{ fontSize: { xs: 30, md: 44 }, fontWeight: 900, letterSpacing: { xs: '4px', md: '7px' }, lineHeight: 1.1 }}>
            用户管理
          </Typography>
          <Typography sx={{ ...mono, fontSize: 11, opacity: 0.72, mt: 1 }}>
            {users.length} 个账号 · 管理员 {admins}
            {latest ? ` · 最近注册 ${new Date(latest).toLocaleDateString('zh-CN')}` : ''}
          </Typography>
        </Box>
        <Button
          variant="outlined"
          onClick={loadUsers}
          disabled={loading}
          sx={{ height: 36, px: 1.75, flexShrink: 0, ...mono, fontSize: 11 }}
        >
          {loading ? '读取中…' : '刷新'}
        </Button>
      </Box>

      {/* 工具条 */}
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
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, borderBottom: '1px solid', borderColor: 'text.primary', pb: '3px', width: { xs: '100%', md: 200 } }}>
          <SearchIcon sx={{ fontSize: 15, opacity: 0.55 }} />
          <Box
            component="input"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="搜索账号 / SEARCH"
            aria-label="搜索账号"
            sx={{ border: 0, outline: 'none', background: 'transparent', color: 'text.primary', ...mono, fontSize: 12, width: '100%', p: 0 }}
          />
          {keyword && (
            <Box component="button" type="button" onClick={() => setKeyword('')} aria-label="清除搜索" sx={{ border: 0, background: 'none', p: 0, cursor: 'pointer', color: 'inherit', display: 'flex' }}>
              <CloseIcon sx={{ fontSize: 14, opacity: 0.6 }} />
            </Box>
          )}
        </Box>

        <Box sx={{ display: 'flex' }}>
          {FILTERS.map((f, i) => {
            const on = roleFilter === f.key;
            return (
              <Box
                key={f.en}
                component="button"
                type="button"
                onClick={() => setRoleFilter(f.key)}
                aria-pressed={on}
                sx={{
                  border: '1px solid',
                  borderColor: 'text.primary',
                  borderLeftWidth: i === 0 ? 1 : 0,
                  px: 1.1,
                  height: 28,
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                  bgcolor: on ? 'text.primary' : 'transparent',
                  color: on ? 'background.default' : 'inherit',
                  ...mono,
                  fontSize: 11,
                  '&:hover': on ? {} : { backgroundColor: 'action.hover' },
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
          {filtered.length} / {users.length} 个账号
        </Typography>
      </Box>

      {error && (
        <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1.5, py: 1.25, borderBottom: '1px solid', borderColor: 'divider' }}>
          <Typography sx={{ ...mono, fontSize: 11, color: 'var(--hot-ink)' }}>{error}</Typography>
          <Box component="button" type="button" onClick={loadUsers} sx={{ border: 0, background: 'none', p: 0, cursor: 'pointer', ...mono, fontSize: 11, color: 'inherit', textDecoration: 'underline' }}>
            重试
          </Box>
        </Box>
      )}

      {loading ? (
        <Typography sx={{ ...mono, fontSize: 11, opacity: 0.7, py: 8 }}>正在读取账号…</Typography>
      ) : filtered.length === 0 ? (
        <Box sx={{ borderTop: '2px solid', borderColor: 'text.primary', py: { xs: 8, md: 10 }, textAlign: 'center' }}>
          <Typography sx={{ fontSize: 64, fontWeight: 900, lineHeight: 1, opacity: 0.14, letterSpacing: '0.12em' }}>
            {keyword.trim() || roleFilter ? '无' : '空'}
          </Typography>
          <Typography sx={{ mt: 1.5, fontSize: 15, fontWeight: 700, letterSpacing: '0.1em' }}>
            {keyword.trim() || roleFilter ? '没有匹配的账号' : '还没有账号'}
          </Typography>
          <Typography sx={{ ...mono, fontSize: 10.5, opacity: 0.65, mt: 0.75 }}>
            {keyword.trim() || roleFilter ? 'NO MATCH' : 'EMPTY'}
          </Typography>
        </Box>
      ) : (
        <Box>
          {/* 表头 */}
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: { xs: 'minmax(0,1fr) 88px 108px', md: 'minmax(0,1.4fr) 120px 160px 140px' },
              alignItems: 'center',
              columnGap: 2,
              borderTop: '2px solid',
              borderBottom: '1px solid',
              borderColor: 'text.primary',
              px: { xs: 0.5, md: 1 },
              py: 0.9,
              ...mono,
              fontSize: 9.5,
              letterSpacing: '0.12em',
              opacity: 0.6,
            }}
          >
            <Box>用户名 · Username</Box>
            <Box>角色</Box>
            <Box sx={{ display: { xs: 'none', md: 'block' } }}>注册时间</Box>
            <Box sx={{ textAlign: 'right' }}>操作</Box>
          </Box>

          {filtered.map((u) => {
            const isSelf = u.id === user?.id;
            return (
              <Box
                key={u.id}
                sx={{
                  display: 'grid',
                  gridTemplateColumns: { xs: 'minmax(0,1fr) 88px 108px', md: 'minmax(0,1.4fr) 120px 160px 140px' },
                  alignItems: 'center',
                  columnGap: 2,
                  px: { xs: 0.5, md: 1 },
                  py: { xs: '12px', md: '13px' },
                  borderBottom: '1px solid',
                  borderColor: 'divider',
                  transition: 'background-color 120ms linear, color 120ms linear',
                  '&:hover': { backgroundColor: 'text.primary', color: 'background.default' },
                }}
              >
                <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1, minWidth: 0 }}>
                  <Typography sx={{ fontSize: 15, fontWeight: 600, letterSpacing: '0.02em', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {u.username}
                  </Typography>
                  {isSelf && (
                    <Typography sx={{ ...mono, fontSize: 9, opacity: 0.55, border: '1px solid', borderColor: 'currentColor', px: 0.5, flexShrink: 0 }}>
                      当前
                    </Typography>
                  )}
                </Box>

                <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 0.6 }}>
                  <Typography sx={{ fontSize: 12.5, fontWeight: u.role === 'admin' ? 900 : 500 }}>
                    {u.role === 'admin' ? '管理员' : '用户'}
                  </Typography>
                  <Typography sx={{ ...mono, fontSize: 9.5, opacity: 0.55 }}>{u.role === 'admin' ? 'ADMIN' : 'USER'}</Typography>
                </Box>

                <Typography sx={{ display: { xs: 'none', md: 'block' }, ...mono, fontSize: 11, opacity: 0.72, fontVariantNumeric: 'tabular-nums' }}>
                  {new Date(u.created_at).toLocaleDateString('zh-CN')}
                </Typography>

                <Box sx={{ display: 'flex', gap: 1.25, justifyContent: 'flex-end', alignItems: 'center' }}>
                  <Box component="button" type="button" onClick={() => handleViewStats(u)} sx={rowActionSx}>统计</Box>
                  <Box component="button" type="button" onClick={() => handleOpenEdit(u)} aria-label={`编辑 ${u.username}`} sx={rowActionSx}>改</Box>
                  {!isSelf && (
                    <Box component="button" type="button" onClick={() => { setDeleteTarget(u); setDeleteError(''); }} aria-label={`删除 ${u.username}`} sx={rowActionSx}>删</Box>
                  )}
                </Box>
              </Box>
            );
          })}

          <Box sx={{ py: 1.25, borderBottom: '1px solid', borderColor: 'text.primary' }}>
            <Typography sx={{ ...mono, fontSize: 10, opacity: 0.5 }}>
              只显示账号与注册时间 · 学习量请点「统计」
            </Typography>
          </Box>
        </Box>
      )}

      {/* 编辑对话框 */}
      <Dialog open={editOpen} onClose={() => setEditOpen(false)} maxWidth="xs" fullWidth aria-labelledby="edit-user-dialog-title">
        <DialogHead id="edit-user-dialog-title" title="编辑账号" en="Edit account" sub={editTarget?.username} />
        <DialogContent sx={{ p: '16px 20px 4px' }}>
          {editError && (
            <Typography sx={{ ...mono, fontSize: 11, color: 'var(--hot-ink)', mb: 1.5 }}>{editError}</Typography>
          )}
          <Box sx={{ borderBottom: '1px solid', borderColor: 'text.primary', pb: '6px', mb: 2 }}>
            <Typography sx={{ ...mono, fontSize: 9.5, letterSpacing: '0.12em', textTransform: 'uppercase', opacity: 0.6 }}>用户名</Typography>
            <Box
              component="input"
              value={editUsername}
              onChange={(e) => setEditUsername(e.target.value)}
              disabled={editLoading}
              aria-label="用户名"
              sx={{ width: '100%', border: 0, outline: 'none', background: 'transparent', color: 'text.primary', fontSize: 18, letterSpacing: '0.03em', mt: 0.75, p: 0 }}
            />
          </Box>
          <Box sx={{ borderBottom: '1px solid', borderColor: 'text.primary', pb: '6px' }}>
            <Typography sx={{ ...mono, fontSize: 9.5, letterSpacing: '0.12em', textTransform: 'uppercase', opacity: 0.6 }}>新密码 · 留空不改</Typography>
            <Box
              component="input"
              type="password"
              value={editPassword}
              onChange={(e) => setEditPassword(e.target.value)}
              disabled={editLoading}
              aria-label="新密码"
              sx={{ width: '100%', border: 0, outline: 'none', background: 'transparent', color: 'text.primary', fontSize: 18, letterSpacing: '0.03em', mt: 0.75, p: 0 }}
            />
          </Box>
          <Typography sx={{ ...mono, fontSize: 9.5, opacity: 0.5, mt: 0.75 }}>6–64 个字符</Typography>
        </DialogContent>
        <DialogActions sx={{ p: '14px 20px 16px', gap: 1 }}>
          <Button onClick={() => setEditOpen(false)} disabled={editLoading} sx={{ ...mono, fontSize: 11, color: 'text.primary' }}>
            取消
          </Button>
          <Button variant="contained" disabled={editLoading} onClick={handleEditSubmit} sx={{ ...mono, fontSize: 11, height: 36, px: 2 }}>
            {editLoading ? '保存中…' : '保存'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* 删除确认 */}
      <Dialog open={!!deleteTarget} onClose={() => setDeleteTarget(null)} maxWidth="xs" fullWidth aria-labelledby="delete-user-dialog-title">
        <DialogHead id="delete-user-dialog-title" title="删除账号" en="Delete account" sub={deleteTarget?.username} />
        <DialogContent sx={{ p: '16px 20px 4px' }}>
          {deleteError && <Typography sx={{ ...mono, fontSize: 11, color: 'var(--hot-ink)', mb: 1.5 }}>{deleteError}</Typography>}
          <Typography sx={{ fontSize: 17, fontWeight: 700, letterSpacing: '0.03em' }}>
            {deleteTarget?.username}
          </Typography>
          <Typography sx={{ fontSize: 13, lineHeight: 1.8, mt: 1 }}>
            删除后该用户的学习进度会被清除，其创建的牌组将转移给管理员。不可撤销。
          </Typography>
        </DialogContent>
        <DialogActions sx={{ p: '14px 20px 16px', gap: 1 }}>
          <Button onClick={() => setDeleteTarget(null)} disabled={deleteLoading} sx={{ ...mono, fontSize: 11, color: 'text.primary' }}>
            取消
          </Button>
          <Button
            variant="contained"
            disabled={deleteLoading}
            onClick={handleDelete}
            sx={{ ...mono, fontSize: 11, height: 36, px: 2, backgroundColor: 'var(--hot-ink)' }}
          >
            {deleteLoading ? '删除中…' : '确认删除'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* 学习统计 */}
      <Dialog open={statsOpen} onClose={() => setStatsOpen(false)} maxWidth="sm" fullWidth aria-labelledby="user-stats-dialog-title">
        <DialogHead
          id="user-stats-dialog-title"
          title="学习统计"
          en="Study stats"
          sub={
            statsTarget
              ? `${statsTarget.username}${statsData ? ` · ${statsData.stats.total_sessions} 次 · ${statsData.stats.active_days} 天` : ''}`
              : undefined
          }
        />
        <DialogContent sx={{ p: '16px 20px 4px' }}>
          {statsLoading ? (
            <Typography sx={{ ...mono, fontSize: 11, opacity: 0.7, py: 4 }}>正在读取统计…</Typography>
          ) : statsError ? (
            <Typography sx={{ ...mono, fontSize: 11, color: 'var(--hot-ink)' }}>{statsError}</Typography>
          ) : statsData ? (
            <Box>
              <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', borderTop: '2px solid', borderColor: 'text.primary' }}>
                {[
                  { label: '累计背写', en: 'STUDIED', value: statsData.stats.total_studied, unit: '字' },
                  { label: '学习天数', en: 'DAYS', value: statsData.stats.active_days, unit: '天' },
                  { label: '学习时长', en: 'MINUTES', value: statsData.stats.total_minutes, unit: '分' },
                ].map((s, i) => (
                  <Box key={s.en} sx={{ py: 1.5, pr: 1.5, borderRight: i < 2 ? '1px solid' : 0, borderColor: 'divider' }}>
                    <Typography sx={{ ...mono, fontSize: 9, letterSpacing: '0.08em', opacity: 0.6 }}>
                      {s.label}
                      <Box component="span" sx={{ display: { xs: 'none', md: 'inline' } }}> · {s.en}</Box>
                    </Typography>
                    <Typography sx={{ fontSize: { xs: 24, md: 28 }, fontWeight: 900, lineHeight: 1, mt: 0.75, fontVariantNumeric: 'tabular-nums' }}>
                      {s.value}<Box component="span" sx={{ fontSize: 10, fontWeight: 400, ml: 0.5, opacity: 0.6 }}>{s.unit}</Box>
                    </Typography>
                  </Box>
                ))}
              </Box>

              <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', borderTop: '1px solid', borderBottom: '1px solid', borderColor: 'text.primary', mt: 0 }}>
                {[
                  { label: '新字', en: 'NEW', value: statsData.stats.cards.new_count },
                  { label: '学习中', en: 'LEARNING', value: statsData.stats.cards.learning_count },
                  { label: '已掌握', en: 'MATURE', value: statsData.stats.cards.mature_count },
                ].map((s, i) => (
                  <Box key={s.en} sx={{ py: 1.25, pr: 1.5, borderRight: i < 2 ? '1px solid' : 0, borderColor: 'divider' }}>
                    <Typography sx={{ ...mono, fontSize: 9, letterSpacing: '0.08em', opacity: 0.6 }}>
                      {s.label}
                      <Box component="span" sx={{ display: { xs: 'none', md: 'inline' } }}> · {s.en}</Box>
                    </Typography>
                    <Typography sx={{ ...mono, fontSize: 14, mt: 0.5, fontVariantNumeric: 'tabular-nums' }}>{s.value}</Typography>
                  </Box>
                ))}
              </Box>

              <Box sx={{ mt: 2 }}>
                <Typography sx={{ ...mono, fontSize: 9.5, letterSpacing: '0.12em', textTransform: 'uppercase', opacity: 0.6 }}>
                  已订阅 · Subscriptions
                </Typography>
                {statsData.subscriptions.length === 0 ? (
                  <Typography sx={{ ...mono, fontSize: 11, opacity: 0.6, mt: 1 }}>无</Typography>
                ) : (
                  <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75, mt: 1 }}>
                    {statsData.subscriptions.map((s) => (
                      <Typography key={s.id} sx={{ fontSize: 12, border: '1px solid', borderColor: 'divider', px: 0.9, py: 0.4 }}>
                        {s.name}
                      </Typography>
                    ))}
                  </Box>
                )}
              </Box>
            </Box>
          ) : null}
        </DialogContent>
        <DialogActions sx={{ p: '14px 20px 16px' }}>
          <Button variant="outlined" onClick={() => setStatsOpen(false)} sx={{ ...mono, fontSize: 11, height: 34, px: 2 }}>
            关闭
          </Button>
        </DialogActions>
      </Dialog>

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

export default UserManagePage;
